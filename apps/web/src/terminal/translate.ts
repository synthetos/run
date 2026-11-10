/**
 * The terminal's translator (H91, owner 2026-11-09; docs/design/terminal-typed-moves.md).
 *
 * The rule: every typed line goes through the same path as the button that does the same thing. There is no second
 * path to the board. So this module only classifies; it sends nothing:
 *
 * | Typed | Becomes |
 * |---|---|
 * | `$xvm`, `xvm`, `?`, `{"xvm":null}` | `read`: the console's allowlisted read (console/translate.ts) |
 * | `G0`..`G4` with G17–G19, G20/G21, G90/G91, G53, G54–G59, F | `move`: the session's `typedMove` (typedLine.ts decides again) |
 * | `M3 S…`, `M4 S…`, `M5` | `spindle`: the Spindle button's command (C24 for on) |
 * | `M7`, `M8`, `M9` | `coolant`: the Coolant buttons' command |
 * | `G10 L20 P… X0`, `G92 X0`, `G92.1`, `G28.3 X0`, `G54`..`G59` | `offset`: the zero and offset buttons (C16, C27, C28, C26, C29) |
 * | `G28.2 X0 …` | `home`: the Home button (C4) |
 * | `!` `~` `%` Ctrl-X | `realtime`: the Pause, Resume and Stop job handlers |
 * | more than one line | `paste`: the view offers "Open as a job" |
 * | anything else | `refused`, with a plain reason and what to do instead |
 *
 * Pure.
 */
import { parseTypedLine } from '@synthetos/safety';
import { FORBIDDEN_WRITES, forbiddenWriteReason } from '@synthetos/schema';
import { JOB_STREAMING, MAX_INPUT, normaliseGcode, translate as consoleTranslate, type TranslateContext } from '../console/translate.ts';
import type { MotionAxis, MotionCommand } from '../machine-worker/rpc.ts';
import { pastedLines } from './paste.ts';
import { typoHelp } from './typo.ts';

/** The confirmation the matching button asks first (SAFETY §6). */
export type ConfirmId = 'C4' | 'C16' | 'C24' | 'C26' | 'C27' | 'C28' | 'C29';

export type TerminalCommand =
  | { readonly kind: 'empty' }
  | { readonly kind: 'read'; readonly token: string; readonly wire: string }
  | { readonly kind: 'move'; readonly line: string }
  | { readonly kind: 'spindle' | 'coolant' | 'offset' | 'home'; readonly command: MotionCommand; readonly confirm: ConfirmId | null; readonly line: string }
  | { readonly kind: 'realtime'; readonly action: 'pause' | 'resume' | 'stop' }
  | { readonly kind: 'paste'; readonly lines: readonly string[] }
  | { readonly kind: 'refused'; readonly reason: string; readonly remedy: string };

export interface TerminalContext extends TranslateContext {
  /** The board's dialect, for the forbidden writes (SAFETY H61). Null before one is classified. */
  readonly dialect: string | null;
  /** The settings this board can read, for typo help. */
  readonly readable: readonly string[];
  /** The active work coordinate system (`coor` 1..6), or null when not known or G53. */
  readonly activeSystem: number | null;
  /** A feed is in effect on the board (read with status 0 and more than 0). */
  readonly feedInEffect: boolean;
}

export const TERMINAL_TEXT = Object.freeze({
  tooLong: `That line is longer than ${MAX_INPUT} characters.`,
  shorten: 'Shorten it, or open it as a job.',
  notAscii: "That line has a character the board can't take.",
  plain: 'Type plain letters and numbers.',
  noFeed: 'Add a feed, e.g. F500.',
  noFeedWhy: 'No feed is set yet.',
  toolChange: 'Use the tool change button.',
  toolChangeWhy: 'Tool changes are not typed.',
  programStop: 'M0 and M1 pause a program. They only mean something inside a job.',
  programEnd: 'M2 and M30 end a program. They only mean something inside a job.',
  asJob: 'Open it as a job.',
  mHigh: 'M100 and above are not sent from here.',
  mOther: 'is not sent from here.',
  oneCommand: 'One command per line.',
  oneCommandHow: 'Type the move and the M code on separate lines.',
  modeAlone: 'changes a mode only.',
  modeHow: 'Put it in the move line, e.g. G91 G0 X10.',
  feedAlone: 'A feed on its own moves nothing.',
  feedHow: 'Put it in the move line, e.g. G1 X10 F500.',
  noMotion: 'That line has no G0 or G1.',
  noMotionHow: 'Add one, e.g. G0 X10.',
  storedPosition: 'G28 and G30 go to a stored position. Run has no button for that.',
  storedHow: 'Use Home, or Go to zero.',
  speed: 'Add a speed, e.g. M3 S12000.',
  speedRange: 'Spindle speed is a whole number from 1.',
  zeroOnly: 'sets 0 at the current position only.',
  zeroHow: 'Jog to the spot, then type it with 0, e.g. X0.',
  g10l2: 'G10 L2 sets an offset by number. Run sets offsets at the current position.',
  g10How: 'Jog to the spot, then type G10 L20 P1 X0, or use Set zero.',
  g10Form: 'Set zero is G10 L20 P<system> with axes at 0.',
  otherSystem: 'Set zero works on the active coordinate system.',
  noSystem: 'The active coordinate system is not known yet.',
  noSystemHow: 'Select G54 to G59 first.',
  axesNeeded: 'Name the axes, e.g. X0 Y0 Z0.',
  axesHow: 'Only X, Y, Z and A, each at 0.',
  settingsHow: 'Change settings in Board → Pending changes.',
  settingsWhy: 'Settings are not changed from here.',
});

const AXIS_LETTERS: Readonly<Record<string, MotionAxis>> = { X: 'x', Y: 'y', Z: 'z', A: 'a' };
const REALTIME: Readonly<Record<string, 'pause' | 'resume' | 'stop'>> = { '!': 'pause', '~': 'resume', '%': 'stop', '\u0018': 'stop', '^x': 'stop', 'ctrl-x': 'stop', 'ctrl+x': 'stop' };
const WORD = /([A-Z])([+-]?(?:\d+\.?\d*|\.\d+))/g;

function refused(reason: string, remedy: string): TerminalCommand {
  return { kind: 'refused', reason, remedy };
}

interface Word {
  readonly letter: string;
  readonly value: number;
  readonly raw: string;
}

function words(code: string): readonly Word[] {
  return [...code.matchAll(WORD)].map((m) => ({ letter: m[1] as string, value: Number(m[2]), raw: m[2] as string }));
}

/** Axis words that are all exactly 0 on X, Y, Z or A, as button axes; null when any other word or value is there. */
function zeroAxes(ws: readonly Word[]): readonly MotionAxis[] | null {
  const axes: MotionAxis[] = [];
  for (const w of ws) {
    const axis = AXIS_LETTERS[w.letter];
    if (axis === undefined || w.value !== 0 || axes.includes(axis)) return null;
    axes.push(axis);
  }
  return axes.length > 0 ? axes : null;
}

function realtime(text: string): TerminalCommand | null {
  const lower = text.toLowerCase();
  const exact = REALTIME[lower];
  if (exact !== undefined) return { kind: 'realtime', action: exact };
  if (/^!+$/.test(text)) return { kind: 'realtime', action: 'pause' };
  return null;
}

function mCode(m: Word, rest: readonly Word[], line: string): TerminalCommand {
  const n = m.value;
  if (n === 6) return refused(TERMINAL_TEXT.toolChangeWhy, TERMINAL_TEXT.toolChange);
  if (n === 0 || n === 1) return refused(TERMINAL_TEXT.programStop, TERMINAL_TEXT.asJob);
  if (n === 2 || n === 30) return refused(TERMINAL_TEXT.programEnd, TERMINAL_TEXT.asJob);
  if (n >= 100) return refused(TERMINAL_TEXT.mHigh, TERMINAL_TEXT.asJob);
  if (n === 3 || n === 4) {
    const s = rest.find((w) => w.letter === 'S');
    if (s === undefined || rest.length !== 1) return refused(`M${n} needs a speed.`, TERMINAL_TEXT.speed);
    // The upper bound is the session's (the Spindle button's own check, motion.ts).
    if (!(Number.isInteger(s.value) && s.value >= 1)) return refused(TERMINAL_TEXT.speedRange, TERMINAL_TEXT.speed);
    return { kind: 'spindle', command: { op: 'spindleOn', direction: n === 3 ? 'cw' : 'ccw', rpm: s.value }, confirm: 'C24', line };
  }
  if (rest.length > 0) return refused(TERMINAL_TEXT.oneCommand, `Type M${n} alone.`);
  if (n === 5) return { kind: 'spindle', command: { op: 'spindleOff' }, confirm: null, line };
  if (n === 7 || n === 8) return { kind: 'coolant', command: { op: 'coolantOn', which: n === 7 ? 'mist' : 'flood' }, confirm: null, line };
  if (n === 9) return { kind: 'coolant', command: { op: 'coolantOff' }, confirm: null, line };
  return refused(`M${m.raw} ${TERMINAL_TEXT.mOther}`, TERMINAL_TEXT.asJob);
}

function setZero(ws: readonly Word[], line: string, ctx: TerminalContext): TerminalCommand {
  const l = ws.find((w) => w.letter === 'L');
  const p = ws.find((w) => w.letter === 'P');
  if (l?.value === 2) return refused(TERMINAL_TEXT.g10l2, TERMINAL_TEXT.g10How);
  if (l?.value !== 20 || p === undefined) return refused(TERMINAL_TEXT.g10Form, TERMINAL_TEXT.g10How);
  const axes = zeroAxes(ws.filter((w) => w.letter !== 'G' && w.letter !== 'L' && w.letter !== 'P'));
  if (axes === null) return refused(`G10 L20 ${TERMINAL_TEXT.zeroOnly}`, TERMINAL_TEXT.zeroHow);
  if (ctx.activeSystem === null) return refused(TERMINAL_TEXT.noSystem, TERMINAL_TEXT.noSystemHow);
  if (p.value !== 0 && p.value !== ctx.activeSystem) return refused(TERMINAL_TEXT.otherSystem, `Type G${53 + p.value} first, or use P${ctx.activeSystem}.`);
  return { kind: 'offset', command: { op: 'setZero', axes }, confirm: 'C16', line };
}

/** A line with G codes that are not a move: offsets, homing, a coordinate system, or a refusal. */
function gNonMove(gs: readonly number[], others: readonly Word[], line: string, ctx: TerminalContext): TerminalCommand {
  const [g] = gs;
  if (gs.length === 1 && g === 10) return setZero([...others], line, ctx);
  if (gs.length === 1 && (g === 28 || g === 30)) return refused(TERMINAL_TEXT.storedPosition, TERMINAL_TEXT.storedHow);
  if (gs.length === 1 && g === 92.1 && others.length === 0) return { kind: 'offset', command: { op: 'clearTempOffset' }, confirm: 'C28', line };
  if (gs.length === 1 && g !== undefined && g >= 54 && g <= 59 && Number.isInteger(g) && others.length === 0) return { kind: 'offset', command: { op: 'selectCoord', system: g - 53 }, confirm: 'C29', line };
  const axisCommand: Readonly<Record<number, { readonly op: 'tempOffset' | 'setPosition' | 'home'; readonly kind: 'offset' | 'home'; readonly confirm: ConfirmId }>> = {
    92: { op: 'tempOffset', kind: 'offset', confirm: 'C27' },
    28.3: { op: 'setPosition', kind: 'offset', confirm: 'C26' },
    28.2: { op: 'home', kind: 'home', confirm: 'C4' },
  };
  const a = gs.length === 1 && g !== undefined ? axisCommand[g] : undefined;
  if (a !== undefined) {
    if (others.length === 0) return refused(TERMINAL_TEXT.axesNeeded, TERMINAL_TEXT.axesHow);
    const axes = zeroAxes(others);
    if (axes === null) return refused(`G${g} ${TERMINAL_TEXT.zeroOnly}`, TERMINAL_TEXT.zeroHow);
    return { kind: a.kind, command: { op: a.op, axes }, confirm: a.confirm, line };
  }
  const modal = gs.every((x) => [17, 18, 19, 20, 21, 53, 54, 55, 56, 57, 58, 59, 90, 91].includes(x));
  if (modal && others.length === 0) return refused(`${gs.map((x) => `G${x}`).join(' ')} ${TERMINAL_TEXT.modeAlone}`, TERMINAL_TEXT.modeHow);
  if (modal) return refused(TERMINAL_TEXT.noMotion, TERMINAL_TEXT.noMotionHow);
  return refused(`${gs.map((x) => `G${x}`).join(' ')} ${TERMINAL_TEXT.mOther}`, TERMINAL_TEXT.asJob);
}

/** A G-code line: a move, a button, or a refusal. `code` is upper case with no spaces (normaliseGcode). */
function gcode(code: string, ctx: TerminalContext): TerminalCommand {
  const ws = words(code);
  const line = ws.map((w) => `${w.letter}${w.raw}`).join(' ');
  if (ctx.jobStreaming) return refused(JOB_STREAMING, 'Pause and Stop job still work.');
  if (ws.some((w) => w.letter === 'T')) return refused(TERMINAL_TEXT.toolChangeWhy, TERMINAL_TEXT.toolChange);
  const ms = ws.filter((w) => w.letter === 'M');
  const gs = ws.filter((w) => w.letter === 'G').map((w) => w.value);
  if (ms.length > 1 || (ms.length === 1 && gs.length > 0)) return refused(TERMINAL_TEXT.oneCommand, TERMINAL_TEXT.oneCommandHow);
  if (ms.length === 1) return mCode(ms[0] as Word, ws.filter((w) => w.letter !== 'M'), line);
  const motion = gs.filter((g) => g === 0 || g === 1 || g === 2 || g === 3 || g === 4);
  if (motion.length > 0) {
    const parsed = parseTypedLine(line);
    if (!parsed.ok) return refused(parsed.reason, parsed.remedy);
    const m = parsed.value.motion;
    if ((m === 1 || m === 2 || m === 3) && parsed.value.words.F === undefined && !ctx.feedInEffect) return refused(TERMINAL_TEXT.noFeedWhy, TERMINAL_TEXT.noFeed);
    return { kind: 'move', line: parsed.value.line };
  }
  if (gs.length === 0) {
    if (ws.length === 1 && ws[0]?.letter === 'F') return refused(TERMINAL_TEXT.feedAlone, TERMINAL_TEXT.feedHow);
    return refused(TERMINAL_TEXT.noMotion, TERMINAL_TEXT.noMotionHow);
  }
  return gNonMove(gs, ws.filter((w) => w.letter !== 'G'), line, ctx);
}

/** The forbidden-write reason in plain words, or null (SAFETY H61). */
function forbidden(token: string, value: unknown, dialect: string | null): string | null {
  const list = dialect === null ? undefined : (FORBIDDEN_WRITES as Readonly<Record<string, (typeof FORBIDDEN_WRITES)[keyof typeof FORBIDDEN_WRITES] | undefined>>)[dialect];
  const reason = list === undefined ? null : forbiddenWriteReason(list, token, value);
  if (reason === null) return null;
  const plain = reason.replace(/\s*\([^)]*\)/g, '');
  return `$${token} is never written from here: ${plain}.`;
}

/** What `input` is, and which path it takes. Sends nothing. */
export function classify(input: string, ctx: TerminalContext): TerminalCommand {
  const lines = pastedLines(input);
  if (lines !== null) return { kind: 'paste', lines };
  const text = input.trim();
  if (text === '') return { kind: 'empty' };
  const rt = realtime(text);
  if (rt !== null) return rt;
  if (text.length > MAX_INPUT) return refused(TERMINAL_TEXT.tooLong, TERMINAL_TEXT.shorten);
  if (/[^\x20-\x7e]/.test(text)) return refused(TERMINAL_TEXT.notAscii, TERMINAL_TEXT.plain);
  if (!text.startsWith('{') && !text.startsWith('$')) {
    const code = normaliseGcode(text);
    if (code !== null) return gcode(code, ctx);
  }
  const t = consoleTranslate(text, ctx);
  switch (t.kind) {
    case 'read':
      return { kind: 'read', token: t.token, wire: t.wire };
    case 'motion': {
      // {"gc":"…"}: the G-code inside takes the same path as when typed.
      const code = normaliseGcode((JSON.parse(t.wire) as { gc: string }).gc) as string;
      return gcode(code, ctx);
    }
    case 'write': {
      const parsed = JSON.parse(t.wire) as Record<string, unknown>;
      const [token, value] = Object.entries(parsed)[0] as [string, unknown];
      const why = forbidden(token, value, ctx.dialect);
      return refused(why ?? TERMINAL_TEXT.settingsWhy, TERMINAL_TEXT.settingsHow);
    }
    case 'refused': {
      const read = t.wire === undefined ? null : /^\{"([a-z0-9_]+)":null\}$/.exec(t.wire);
      if (read !== null && ctx.readDecision !== null && !ctx.jobStreaming) return typoHelp(text, read[1] as string, ctx.readable);
      return refused(t.reason, '');
    }
    /* c8 ignore next 2 -- the console never returns empty for a non-empty line */
    default:
      return { kind: 'empty' };
  }
}
