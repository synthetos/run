/**
 * The Console command line's translator (WORKSPACE_FEATURES "Console command
 * line"). What the user types becomes a JSON request, so the board never
 * leaves JSON mode:
 *
 *   g0x100, G1 X10 F500   {"gc":"G0X100"}   motion: shown, never sent in Phase 1
 *   $xvm, xvm             {"xvm":null}      a read, if the dialect allowlists it
 *   $xvm=5000             {"xvm":5000}      a settings write: shown, never sent in Phase 1
 *   ?                     {"sr":null}       a status report read
 *   {"xvm":null}          passed only when it parses as an allowlisted read
 *
 * Text-mode commands (`$$`, `$h`, ...) are mapped to their JSON form or
 * refused with the reason. The realtime characters (`!`, `~`, `%`, ^X) are
 * refused: Pause and Stop job are buttons, never typed.
 *
 * Pure. The result says what would be on the wire and whether Phase 1 sends
 * it; only `kind: 'read'` is ever sent, through the worker's read path, which
 * checks the read allowlist again (SAFETY H37).
 */

export type Translation =
  | { readonly kind: 'empty' }
  /** Sent in Phase 1: one allowlisted GET. */
  | { readonly kind: 'read'; readonly token: string; readonly wire: string }
  /** Shown and not sent: typed motion comes later (Phase 2 motion is the jog panel's, SAFETY §4.5b). */
  | { readonly kind: 'motion'; readonly wire: string; readonly reason: string }
  /** Shown and not sent: settings writes arrive in a later phase. */
  | { readonly kind: 'write'; readonly wire: string; readonly reason: string }
  /** Not sent, with the reason and what to do instead. */
  | { readonly kind: 'refused'; readonly reason: string; readonly wire?: string };

export interface TranslateContext {
  /** May the classified dialect GET this token? Null when no board is classified yet. */
  readonly readDecision: ((token: string) => { readonly allowed: true } | { readonly allowed: false; readonly reason: string }) | null;
  /** A job is streaming: nothing is sent from the command line. */
  readonly jobStreaming: boolean;
}

export const MOTION_LATER = 'Typed motion comes later; use the jog panel';
export const WRITES_LATER = 'Settings writes arrive in a later phase';
export const REALTIME_REFUSED = 'Realtime commands are never typed here. Pause and Stop job are the buttons at the top right, in every view (and Escape pauses).';
export const JOB_STREAMING = 'A job is streaming, so the command line sends nothing until it ends. Pause and Stop job stay where they are.';
export const NOT_CLASSIFIED = 'Connect a board and wait until it is identified: reads go only to a classified board.';

/** Longest line accepted (TinyG's own receive buffer is 255 bytes). */
export const MAX_INPUT = 254;

/** Text-mode-only commands: their JSON form, or why there is none. */
const TEXT_MODE: Readonly<Record<string, { readonly token?: string; readonly reason?: string }>> = {
  $: { reason: 'A bare $ lists the settings in text mode. Type a setting name instead, such as $xvm, or open Board → All settings.' },
  $$: { reason: '$$ lists every setting in text mode, and run keeps the board in JSON mode. Open Board → All settings to read them all, or type one name, such as $xvm.' },
  $h: { reason: '$h prints the text-mode help screen. The setting names and what they mean are offered as you type here.' },
  $help: { reason: '$help prints the text-mode help screen. The setting names and what they mean are offered as you type here.' },
  $test: { reason: '$test runs the firmware’s built-in tests, which move the machine. They are never sent from the console.' },
  $defa: { reason: '$defa resets every setting to the firmware defaults: a settings write. Settings writes arrive in a later phase.' },
  $defaults: { reason: '$defaults resets every setting to the firmware defaults: a settings write. Settings writes arrive in a later phase.' },
  $boot: { reason: '$boot restarts the board into its bootloader. Firmware updates are their own reviewed phase.' },
  $sr: { token: 'sr' },
  $sys: { token: 'sys' },
  $qr: { token: 'qr' },
};

const TOKEN = /^[a-z0-9_]{1,16}$/;
/** A G-code word: a letter, then a number. */
const GCODE_LINE = /^(?:[A-Z][+-]?(?:\d+\.?\d*|\.\d+))+$/;
const REALTIME = new Set(['!', '~', '%', '^x', '\u0018', 'ctrl-x', 'ctrl+x']);

/** The line with comments and spaces removed and letters upper-cased, or null when it is not G-code. */
export function normaliseGcode(input: string): string | null {
  const stripped = input.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').replace(/\s+/g, '').toUpperCase();
  if (stripped === '' || !GCODE_LINE.test(stripped)) return null;
  return stripped;
}

function parseValue(raw: string): number | string | null {
  const v = raw.trim();
  if (v === '') return null;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v)) return Number(v);
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true' ? 1 : 0;
  return v.replace(/^"(.*)"$/, '$1');
}

function read(token: string, ctx: TranslateContext): Translation {
  const wire = JSON.stringify({ [token]: null });
  if (ctx.jobStreaming) return { kind: 'refused', reason: JOB_STREAMING, wire };
  if (ctx.readDecision === null) return { kind: 'refused', reason: NOT_CLASSIFIED, wire };
  const d = ctx.readDecision(token);
  if (!d.allowed) return { kind: 'refused', reason: `Not on this board’s read allowlist: ${d.reason}`, wire };
  return { kind: 'read', token, wire };
}

function write(token: string, value: number | string, ctx: TranslateContext): Translation {
  const wire = JSON.stringify({ [token]: value });
  if (ctx.jobStreaming) return { kind: 'refused', reason: JOB_STREAMING, wire };
  return { kind: 'write', wire, reason: WRITES_LATER };
}

function fromJson(text: string, ctx: TranslateContext): Translation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'refused', reason: 'That is not valid JSON. Type a setting name such as xvm, or ? for a status report.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'refused', reason: 'A request is a JSON object with one key, such as {"xvm":null}.' };
  const keys = Object.keys(parsed);
  if (keys.length !== 1) return { kind: 'refused', reason: 'Send one request at a time: a JSON object with exactly one key, such as {"xvm":null}.' };
  const key = keys[0] as string;
  const value = (parsed as Record<string, unknown>)[key];
  if (key === 'gc') {
    if (typeof value !== 'string') return { kind: 'refused', reason: '{"gc": …} takes a G-code line as a string.' };
    const line = normaliseGcode(value);
    if (line === null) return { kind: 'refused', reason: 'That G-code line could not be read.' };
    return ctx.jobStreaming ? { kind: 'refused', reason: JOB_STREAMING } : { kind: 'motion', wire: JSON.stringify({ gc: line }), reason: MOTION_LATER };
  }
  const token = key.toLowerCase();
  if (!TOKEN.test(token)) return { kind: 'refused', reason: `${JSON.stringify(key)} is not a setting name.` };
  if (value === null || value === '') return read(token, ctx);
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return write(token, typeof value === 'boolean' ? (value ? 1 : 0) : value, ctx);
  return { kind: 'refused', reason: 'Group writes and nested values are not accepted here.' };
}

/** What `input` becomes on the wire, and whether Phase 1 sends it. */
export function translate(input: string, ctx: TranslateContext): Translation {
  const text = input.trim();
  if (text === '') return { kind: 'empty' };
  if (text.length > MAX_INPUT) return { kind: 'refused', reason: `That line is longer than ${MAX_INPUT} characters, the board’s line limit.` };
  if (REALTIME.has(text.toLowerCase()) || /^[!~%\u0018]+$/.test(text) || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) return { kind: 'refused', reason: REALTIME_REFUSED };
  if (text === '?') return read('sr', ctx);
  if (text.startsWith('{')) return fromJson(text, ctx);
  if (text.startsWith('$')) {
    const lower = text.toLowerCase().replace(/\s+/g, '');
    const eq = lower.indexOf('=');
    const name = eq === -1 ? lower : lower.slice(0, eq);
    const mapped = TEXT_MODE[name];
    if (mapped?.reason !== undefined) return { kind: 'refused', reason: mapped.reason };
    const token = mapped?.token ?? name.slice(1);
    if (!TOKEN.test(token)) return { kind: 'refused', reason: `${JSON.stringify(text)} is not a setting name. Setting names are letters and digits, such as $xvm or $1ma.` };
    if (eq === -1) return read(token, ctx);
    const value = parseValue(text.slice(text.indexOf('=') + 1));
    if (value === null) return read(token, ctx);
    return write(token, value, ctx);
  }
  const gcode = normaliseGcode(text);
  if (gcode !== null) {
    const wire = JSON.stringify({ gc: gcode });
    return ctx.jobStreaming ? { kind: 'refused', reason: JOB_STREAMING, wire } : { kind: 'motion', wire, reason: MOTION_LATER };
  }
  const bare = text.toLowerCase().replace(/\s+/g, '');
  const eq = bare.indexOf('=');
  const name = eq === -1 ? bare : bare.slice(0, eq);
  if (TOKEN.test(name)) {
    if (eq === -1) return read(name, ctx);
    const value = parseValue(text.slice(text.indexOf('=') + 1));
    return value === null ? read(name, ctx) : write(name, value, ctx);
  }
  return { kind: 'refused', reason: 'Not a G-code line, a setting name or a JSON request. Try ? for a status report, or a name such as xvm.' };
}
