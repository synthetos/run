/**
 * The Phase 2 motion layer of the session reducer (owner 2026-11-02; SAFETY
 * §4.4, §4.5b, H50–H56; T-S89–T-S92).
 *
 * Pure functions over the reducer's transition (`MotionTx`): they read the
 * state, queue lines and realtime bytes as effects, and arm the `motion`
 * timer. Nothing here touches a port or a clock. The reducer calls them
 * only when the session's release allows motion; every intent has passed
 * the allow-matrix first, and every line and byte is checked again by the
 * write gate when it is written (writePolicy.ts).
 *
 * What runs here:
 * - **Jog** (H50): the session feeds short `G21 G91 G1` pieces, each at most
 *   `pieceMs` of travel at the jog feed, and only while the planner holds
 *   fewer than `lookahead` blocks (`qr`, polled after every piece). A step
 *   longer than one piece is fed the same way. A hold jog (no distance)
 *   needs a renewal from the page every `keepAliveMs`; without one it is
 *   released by the session itself.
 * - **Go to zero** (H53): `G53 G0 Z<safe>` first when X or Y move, then
 *   `G90 G0` to work zero, then Z; each line waits for polled idle.
 * - **Set zero**, **spindle and coolant**, **clear alarm**: single lines.
 * - **Ending a jog, Pause, Stop job** (H56): `!`, then polled reads until the
 *   hold is complete (or the machine is at rest) and every written line is
 *   answered, then `%` when anything is held or queued, then polled reads
 *   until the hold is gone and the planner is empty, then the closing lines
 *   (`M5`, `M9` for Stop job; `G90` and the units for a jog). A step that
 *   times out is W12 and FAULT. A Pause stops at the confirmed hold (HELD);
 *   Resume writes `~` and drains.
 *
 * Every decision about the machine uses polled `stat`, `hold`, `vel`, `qr`
 * (SAFETY §4.2), never the last status report and never the spindle and
 * coolant readouts. A decision reads the values of the poll cycle that
 * just completed (`SessionState.polled`), and only when every one of its
 * four reads was answered with status 0: a rejected, missing or damaged
 * answer makes the cycle count for nothing (independent review 2026-11-03,
 * R5; H56, H69). The shared live view (also fed by pushed reports) is for
 * display.
 *
 * Modes (independent review 2026-11-03, R1 and R2): a jog writes `G21` on
 * its own answered line before its first piece, because the firmware reads
 * F before it changes units in the same block; go to zero writes `G90 G21`
 * on its own answered line before its `G53 G0` move, because G53 keeps
 * G91 and G20, and puts the distance mode and units back at the end. What "back" means is read, never taken
 * from the live view: `unit` and `dist` GETs go out before the first line of either (modes.ts), because the
 * last pushed report can still show the previous jog's `G91` after its closing `G90` was answered.
 */
import { STOP_TEXT, type Decision, type Intent } from '@synthetos/safety';
import { mapStat, type Dialect, type MachineClass } from '@synthetos/protocol';
import { restingStat } from './resting.ts';
import { homingAxes, isReadAllowed } from '@synthetos/schema';
import {
  ABSOLUTE_MM_LINE,
  CLEAR_LINE,
  CLEAR_TEMP_OFFSET_LINE,
  MAX_JOG_FEED,
  MAX_RPM,
  UNITS_LINE,
  homeLine,
  jogLine,
  motionLineKind,
  restoreLine,
  safeZLine,
  selectCoordLine,
  setPositionLine,
  setZeroLine,
  spindleLine,
  tempOffsetLine,
  toZeroLine,
  type MotionAxisLetter,
} from './motionLines.ts';
import { queueModeReads } from './modes.ts';
import { sessionSettings } from './settingWrite.ts';
import { failJob, forgetJobLines, jobActive, jobStopped, lastFileLine } from './jobState.ts';
import type { ChangeKind, FaultCause, FaultKind, FollowUp, HoldReason, JogAxis, JogFeed, MotionCtx, PendingRead, PolledValues, SessionBase, SessionConfig, SessionEffect, SessionIntent, SessionState, TimerId } from './types.ts';

/** Timing and bounds of the motion layer (SAFETY §4.5b). Milliseconds unless named otherwise. */
export const MOTION_LIMITS = Object.freeze({
  /** Polled reads while motion is in progress. */
  pollMs: 100,
  /** Longest travel time of one jog piece at the jog feed. */
  pieceMs: 150,
  /** Most jog pieces queued in the planner at once. */
  lookahead: 2,
  /** A hold jog ends when the page has not renewed it for this long. */
  keepAliveMs: 500,
  /** Each stop step (hold, flush) must complete within this. */
  stopStepMs: 3000,
  /** Consecutive polled reads that must agree (SAFETY §4.2). */
  confirmations: 2,
  /**
   * An offset write (G10 L20, G54..G59) refused with status 13 (buffer full) is written again after this long, at
   * most `offsetAttempts` times in all (firmware bug hunt 2026-11-02: back-to-back G10 can be refused with 13 even
   * when each reply is awaited; the cause is not known yet).
   */
  offsetRetryMs: 500,
  offsetAttempts: 3,
  /** Longest single jog step, mm (100 mm, or 4 in = 101.6 mm). */
  maxStepMm: 102,
  maxFeed: MAX_JOG_FEED,
  maxRpm: MAX_RPM,
  /**
   * Homing (amendment 2026-11-02): pushed reports say when the cycle may have ended; a check poll runs at most
   * this often in case a report was missed. Two polled reads confirm the end.
   */
  homingCheckMs: 1000,
});

/** The polled reads of the motion layer, in order; the cycle is complete when the last one is answered. */
export const POLL_TOKENS: readonly string[] = Object.freeze(['stat', 'hold', 'vel', 'qr']);

const LETTER: Readonly<Record<JogAxis, MotionAxisLetter>> = { x: 'X', y: 'Y', z: 'Z', a: 'A' };
const JOG_AXES: readonly JogAxis[] = ['x', 'y', 'z', 'a'];

/** Bases a homing or G28.3 read-back settles into idle (or CONNECTED_UNKNOWN). */
const SETTLE_BASES: ReadonlySet<SessionBase> = new Set(['HOMING', 'CONNECTED_UNKNOWN', 'IDLE_UNHOMED', 'IDLE_HOMED']);
const ALARMED: ReadonlySet<MachineClass> = new Set(['alarm', 'softAlarm', 'shutdown', 'panic']);
/** Bases an alarm report moves to ALARM. */
const ALARMABLE: ReadonlySet<SessionBase> = new Set(['IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING', 'HOMING', 'HELD', 'STOPPING_JOB', 'PREAMBLE', 'RUNNING', 'PROGRAM_PAUSED']);
/** Bases a Stop job in a motion session may start from (anything else keeps the Phase 1 `!` only). Phase 3 adds the job bases. */
const STOPPABLE: ReadonlySet<SessionBase> = new Set(['IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING', 'HOMING', 'HELD', 'STOPPING_JOB', 'CONNECTED_UNKNOWN', 'PREAMBLE', 'RUNNING', 'PROGRAM_PAUSED']);

/** The reducer's transition, as this module uses it. */
export interface MotionTx {
  s: SessionState;
  readonly config: SessionConfig;
  set(patch: Partial<SessionState>): void;
  emit(effect: SessionEffect): void;
  arm(id: TimerId, ms: number): void;
  cancel(id: TimerId): void;
}

/** What the reducer lends this module (it may not import the reducer: no cycles). */
export interface MotionDeps {
  fault(t: MotionTx, cause: FaultCause, kind: FaultKind, detail: string, at: number): void;
}

const ALLOWED: Decision = Object.freeze({ allowed: true });

function deny(reason: string, remedy: string): Decision {
  return { allowed: false, reason, remedy, citation: 'SAFETY §4.5b' };
}

/**
 * True when this session may move the machine at all: a motion release, a classified board that was not
 * made READ_ONLY (an approved build), and a dialect with both `%` and `~`.
 */
export function motionCapable(s: SessionState, config: SessionConfig): boolean {
  const d = s.dialect;
  return config.release.motion && d !== null && s.classification?.mode === 'full' && !s.overlays.includes('READ_ONLY') && d.realtime.flush !== undefined && d.realtime.resume !== undefined;
}

/** The idle base the homing state calls for. */
export function idleBase(s: SessionState): SessionBase {
  return s.live.home === 1 ? 'IDLE_HOMED' : 'IDLE_UNHOMED';
}

function dialect(s: SessionState): Dialect {
  return s.dialect as Dialect;
}

function machineClass(s: SessionState): MachineClass | undefined {
  return s.live.stat === undefined ? undefined : mapStat(dialect(s), s.live.stat);
}

function planner(s: SessionState): number {
  return dialect(s).limits.plannerBlocks;
}

/**
 * The values of the poll cycle that just completed, or null when any of its four reads was rejected (a non-zero
 * status, or no number), damaged or missing (independent review 2026-11-03, R5). Shared with the job layer.
 */
export function completedPoll(s: SessionState): PolledValues | null {
  const p = s.polled;
  if (p === null || p.failed || p.stat === undefined || p.hold === undefined || p.vel === undefined || p.qr === undefined) return null;
  return { stat: p.stat, hold: p.hold, vel: p.vel, qr: p.qr };
}

/** At rest by this cycle's polled values: idle or ended, not moving, nothing held, planner empty. Shared with the job layer. */
export function atRestPolled(s: SessionState, p: PolledValues): boolean {
  // The same rule as READING (resting.ts, SAFETY H14 as amended 2026-11-02), plus hold 0 on every dialect.
  return restingStat(dialect(s), p.stat, p.hold) && p.vel === 0 && p.hold === 0 && p.qr === planner(s);
}

/** The hold is complete by this cycle's polled `hold`. Shared with the job layer. */
export function heldPolled(s: SessionState, p: PolledValues): boolean {
  return dialect(s).hold[p.hold] === 'HOLD';
}

/**
 * No motion line is waiting or being written. (None can be owed an answer either: the board answers lines in
 * order, so when a later poll or line has been answered every earlier motion line has been answered too.)
 */
function motionLinesSettled(s: SessionState): boolean {
  return !s.queue.some((q) => q.purpose === 'motion') && s.writing?.purpose !== 'motion';
}

function queueLine(t: MotionTx, line: string, intent: Intent): void {
  // Built here, from the grammar's own builders; the write gate checks the exact bytes again.
  const token = line === CLEAR_LINE ? 'clear' : 'gc';
  const entry: PendingRead = { token, purpose: 'motion', line, intent };
  t.set({ queue: [...t.s.queue, entry] });
}

function writeRealtime(t: MotionTx, name: 'feedhold' | 'flush' | 'resume', intent: Intent): void {
  const realtime = dialect(t.s).realtime;
  const byte = name === 'feedhold' ? realtime.feedhold.byte : name === 'flush' ? (realtime.flush as { readonly byte: number }).byte : realtime.resume.byte;
  t.set({ sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name, byte, intent });
}

function message(t: MotionTx, kind: NonNullable<SessionState['notices']['motion']>['kind'], text: string, at: number): void {
  t.set({ notices: { ...t.s.notices, motion: { kind, text, at } } });
}

/** The single read-back after run changed a value (amendment 2026-11-02), through the read allowlist. */
function readBack(t: MotionTx, tokens: readonly string[], then?: FollowUp): void {
  const d = dialect(t.s);
  const reads: PendingRead[] = tokens.filter((tok) => isReadAllowed(d.id, tok)).map((token) => ({ token, purpose: 'seed' as const }));
  const last = reads.at(-1);
  if (then !== undefined && last !== undefined) reads[reads.length - 1] = { ...last, then };
  t.set({ queue: [...t.s.queue, ...reads] });
}

/** `G5x` of the active system (`coor` 1..6), or null when it is not known or G53. */
export function activeSystem(s: SessionState): number | null {
  const coor = s.live.coor;
  return coor !== undefined && Number.isInteger(coor) && coor >= 1 && coor <= 6 ? coor : null;
}

/** Plain names: "X, Y and Z". */
function axisNames(axes: readonly JogAxis[]): string {
  const n = axes.map((a) => LETTER[a]);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n.at(-1) as string}`;
}

/** Asks for one poll cycle unless one is already waiting or owed. */
export function requestPoll(t: MotionTx): void {
  const s = t.s;
  const pending = s.queue.some((q) => q.purpose === 'poll') || s.writing?.purpose === 'poll' || s.expected.some((e) => e.purpose === 'poll' && !e.late);
  if (pending) return;
  t.set({ queue: [...s.queue, ...POLL_TOKENS.map((token) => ({ token, purpose: 'poll' as const }))] });
}

function tick(t: MotionTx): void {
  t.arm('motion', MOTION_LIMITS.pollMs);
}

function setMotion(t: MotionTx, patch: Partial<MotionCtx>): void {
  t.set({ motion: { ...(t.s.motion as MotionCtx), ...patch } });
}

function newCtx(s: SessionState, op: MotionCtx['op']): MotionCtx {
  // A Stop job from CONNECTED_UNKNOWN (UNKNOWN overlay, or a FAULT) returns there; a jog or Z re-zero during a
  // job's tool change (Phase 3) returns to PROGRAM_PAUSED; everything else to idle.
  const returnTo: SessionBase = s.base === 'CONNECTED_UNKNOWN' || s.base === 'PROGRAM_PAUSED' ? s.base : 'IDLE_UNHOMED';
  // The modes are never taken from the live view (pushed reports lag): a jog, go to zero and a stop read them (modes.ts).
  return { op, phase: 'feed', jog: null, steps: [], reason: null, confirmed: 0, deadline: null, units: undefined, dist: undefined, returnTo, refusal: null, holdPolls: 0, queued: 0 };
}

/**
 * A change that moves nothing (G10 L20, G92, G92.1, G28.3, G54..G59): the line, then polled idle (two reads), then
 * its single read-back. The base stays where it is; the motion context only keeps other motion out meanwhile.
 */
function startChange(t: MotionTx, change: ChangeKind, line: string, intent: Intent, axes: readonly JogAxis[] = []): Decision {
  const retried = change === 'setZero' || change === 'selectCoord' ? { line, attempts: 1, retryAt: null } : {};
  t.set({ motion: { ...newCtx(t.s, 'change'), phase: 'drain', change, axes: [...axes], returnTo: t.s.base, ...retried } });
  queueLine(t, line, intent);
  requestPoll(t);
  tick(t);
  return ALLOWED;
}

/** Where a motion returns: CONNECTED_UNKNOWN if it started there, else the idle base for the homing state. */
function returnBase(ctx: MotionCtx, s: SessionState): SessionBase {
  if (ctx.returnTo === 'PROGRAM_PAUSED' && ctx.reason !== 'stopJob' && jobActive(s)) return 'PROGRAM_PAUSED';
  return ctx.returnTo === 'CONNECTED_UNKNOWN' && s.overlays.length > 0 ? 'CONNECTED_UNKNOWN' : idleBase(s);
}

// --- Intents ------------------------------------------------------------------

/** Common preconditions of every motion intent beyond the matrix (SAFETY §4.5b). */
function precondition(s: SessionState): Decision | undefined {
  // An idle base is reached only in a motion-capable session (an approved board with a motion release). The matrix has already required an idle base (or JOGGING, for the jog row): JOGGING always has a motion,
  // and an alarm moves the base to ALARM (checkAlarm).
  if (s.motion !== null) return deny('Another move is still running.', 'Wait for it to finish, or use Pause or Stop job.');
  return undefined;
}

function validAxes(axes: Readonly<Partial<Record<JogAxis, 1 | -1>>>): boolean {
  const keys = typeof axes === 'object' && axes !== null ? Object.keys(axes) : [];
  return keys.length > 0 && keys.every((k) => (JOG_AXES as readonly string[]).includes(k) && (axes[k as JogAxis] === 1 || axes[k as JogAxis] === -1));
}

function validAxisList(axes: readonly JogAxis[]): boolean {
  return Array.isArray(axes) && axes.length > 0 && axes.length <= 4 && new Set(axes).size === axes.length && axes.every((a) => (JOG_AXES as readonly string[]).includes(a));
}

/**
 * A Phase 2 motion intent the matrix has already allowed. Returns the decision; on success the lines
 * are queued. `jog` with `renew` only refreshes a hold jog's keep-alive.
 */
export function onMotionIntent(t: MotionTx, request: SessionIntent, at: number): Decision {
  const s = t.s;
  switch (request.intent) {
    case 'jog': {
      if ('renew' in request) {
        const jog = s.motion?.jog;
        if (jog === null || jog === undefined || jog.remainingMm !== null || s.motion?.phase !== 'feed') return deny('No hold jog is running.', 'Nothing to do.');
        setMotion(t, { jog: { ...jog, renewedAt: at } });
        return ALLOWED;
      }
      const pre = precondition(s);
      if (pre !== undefined) return pre;
      const { axes, distanceMm, feed } = request;
      if (!validAxes(axes)) return deny('A jog names one or more of X, Y, Z and A, each + or −.', 'Choose an axis.');
      if (typeof feed !== 'number' || !Number.isFinite(feed) || feed < 1 || feed > MOTION_LIMITS.maxFeed) return deny(`Jog speed must be 1 to ${MOTION_LIMITS.maxFeed} mm/min.`, 'Choose another jog speed.');
      if (distanceMm !== null && (typeof distanceMm !== 'number' || !Number.isFinite(distanceMm) || distanceMm < 0.001 || distanceMm > MOTION_LIMITS.maxStepMm)) {
        return deny(`A jog step is 0.001 to ${MOTION_LIMITS.maxStepMm} mm.`, 'Choose another step.');
      }
      const pieceMm = Math.max(0.001, (feed / 60) * (MOTION_LIMITS.pieceMs / 1000));
      const jog: JogFeed = { axes: { ...axes }, remainingMm: distanceMm, feed, pieceMm, renewedAt: at };
      t.set({ motion: { ...newCtx(s, 'jog'), jog }, base: 'JOGGING' });
      // The board's own units and distance mode, answered before anything of the jog changes them (modes.ts).
      queueModeReads(t, 'motion');
      // Millimetres first, on a line of its own that is answered before the first piece goes out (R2): the
      // board may be in inches (a job, another sender), and the firmware reads a piece's F before its G21.
      queueLine(t, UNITS_LINE, 'jog');
      sendPiece(t);
      requestPoll(t);
      tick(t);
      return ALLOWED;
    }
    case 'goToZero': {
      const pre = precondition(s);
      if (pre !== undefined) return pre;
      const { axes, safeZ } = request;
      if (!validAxisList(axes)) return deny('Go to zero names one or more of X, Y, Z and A.', 'Choose an axis.');
      const letters = axes.map((a) => LETTER[a]);
      const planar = letters.filter((l) => l !== 'Z');
      // Explicit absolute millimetres first, on a line of its own, answered before any move (R1): `G53 G0 Z`
      // under G91 would go DOWN by the safe height, under G20 25.4 times too far. The modes are put back at the end.
      const steps: string[] = [ABSOLUTE_MM_LINE];
      if (planar.length > 0) {
        const z = machineZ(s);
        if (z === undefined || typeof safeZ !== 'number' || !Number.isFinite(safeZ)) return deny('The machine Z position is not known yet.', 'Wait for the position to be read.');
        // Never lower Z first: the safe height is at least where Z already is (H53).
        steps.push(safeZLine(Math.max(z, safeZ)), toZeroLine(planar));
      }
      if (letters.includes('Z')) steps.push(toZeroLine(['Z']));
      if (steps.some((l) => motionLineKind(l) === undefined)) return deny('The safe height is out of range.', 'Choose another safe height.');
      t.set({ motion: { ...newCtx(s, 'goToZero'), phase: 'drain', steps: steps.slice(1) }, base: 'JOGGING' });
      queueModeReads(t, 'motion');
      queueLine(t, steps[0] as string, 'goToZero');
      requestPoll(t);
      tick(t);
      return ALLOWED;
    }
    case 'setWorkZero': {
      const pre = precondition(s);
      if (pre !== undefined) return pre;
      if (!validAxisList(request.axes)) return deny('Set zero names one or more of X, Y, Z and A.', 'Choose an axis.');
      const system = activeSystem(s);
      if (system === null) return deny('The active work coordinate system is not known (or is G53).', 'Select G54 to G59 first.');
      // G10 L20 in the ACTIVE system, saved on the controller (C16); then its offsets are read back.
      return startChange(t, 'setZero', setZeroLine(request.axes.map((a) => LETTER[a]), system), 'setWorkZero', request.axes);
    }
    case 'home': {
      const pre = precondition(s);
      if (pre !== undefined) return pre;
      // Defence in depth: the matrix allows home only in these bases (HOMING always has a motion, refused above), and a
      // board that is not motion-capable carries READ_ONLY, which the matrix denies.
      /* c8 ignore start */
      if (!motionCapable(s, t.config)) return deny('This board is not approved for motion in this session.', 'Use an approved firmware build.');
      if (s.base !== 'IDLE_UNHOMED' && s.base !== 'IDLE_HOMED' && s.base !== 'CONNECTED_UNKNOWN') return deny('Homing starts only while the machine is idle.', 'Wait until the machine is idle.');
      /* c8 ignore stop */
      if (!validAxisList(request.axes)) return deny('Home names one or more of X, Y, Z and A.', 'Choose an axis.');
      const config = homingAxes(sessionSettings(dialect(s).id, s.values));
      const missing = request.axes.filter((a) => !config[a].configured);
      if (missing.length > 0) {
        const why = missing.map((a) => `${LETTER[a]}: ${config[a].reason as string}`).join('; ');
        return deny(`Homing is not configured for ${axisNames(missing)} (${why}).`, 'Configure the homing switch and search speed in the Board view, or set the machine position here (G28.3) on a machine without switches.');
      }
      t.set({ motion: { ...newCtx(s, 'home'), phase: 'homing', axes: [...request.axes], seen: false }, base: 'HOMING' });
      queueLine(t, homeLine(request.axes.map((a) => LETTER[a])), 'home');
      requestPoll(t);
      t.arm('motion', MOTION_LIMITS.homingCheckMs);
      return ALLOWED;
    }
    case 'setMachinePosition': {
      const pre = precondition(s);
      if (pre !== undefined) return pre;
      /* c8 ignore next -- defence in depth, as for home */
      if (!motionCapable(s, t.config)) return deny('This board is not approved for motion in this session.', 'Use an approved firmware build.');
      if (!validAxisList(request.axes)) return deny('Set machine position names one or more of X, Y, Z and A.', 'Choose an axis.');
      return startChange(t, 'setPosition', setPositionLine(request.axes.map((a) => LETTER[a])), 'setMachinePosition', request.axes);
    }
    case 'tempOffset': {
      const pre = precondition(s);
      if (pre !== undefined) return pre;
      if ('clear' in request) return startChange(t, 'clearTempOffset', CLEAR_TEMP_OFFSET_LINE, 'tempOffset');
      if (!validAxisList(request.axes)) return deny('A temporary offset names one or more of X, Y, Z and A.', 'Choose an axis.');
      return startChange(t, 'tempOffset', tempOffsetLine(request.axes.map((a) => LETTER[a])), 'tempOffset', request.axes);
    }
    case 'selectCoordSystem': {
      const pre = precondition(s);
      if (pre !== undefined) return pre;
      const system = request.system;
      if (typeof system !== 'number' || !Number.isInteger(system) || system < 1 || system > 6) return deny('Choose G54 to G59.', 'Choose G54 to G59.');
      return startChange(t, 'selectCoord', selectCoordLine(system), 'selectCoordSystem');
    }
    case 'spindleOn': {
      // As setWorkZero: idle only, so nothing else is moving.
      if (request.output === 'spindle') {
        const { direction, rpm } = request;
        if ((direction !== 'cw' && direction !== 'ccw') || typeof rpm !== 'number' || !Number.isFinite(rpm) || rpm < 1 || rpm > MOTION_LIMITS.maxRpm) {
          return deny(`Spindle speed must be 1 to ${MOTION_LIMITS.maxRpm}.`, 'Choose another speed.');
        }
        queueLine(t, spindleLine(direction, rpm), 'spindleOn');
        return ALLOWED;
      }
      if (request.output !== 'mist' && request.output !== 'flood') return deny('Unknown output.', 'Choose spindle, mist or flood.');
      queueLine(t, request.output === 'mist' ? 'M7' : 'M8', 'spindleOn');
      return ALLOWED;
    }
    case 'clearAlarm': {
      // ALARM (the only state the matrix allows this in) is reached only in a motion-capable session.
      queueLine(t, CLEAR_LINE, 'clearAlarm');
      requestPoll(t);
      t.set({ queue: [...t.s.queue, { token: 'home', purpose: 'poll' }] });
      return ALLOWED;
    }
    case 'resume': {
      const ctx = s.motion;
      // A motion context exists only in a motion-capable session.
      if (ctx === null || ctx.phase !== 'held') return deny('Resume is only for a hold of motion this session sent.', 'Use Stop job to end it.');
      writeRealtime(t, 'resume', 'resume');
      // The base stays HELD until the first poll after `~`: the write gate checks `~` against the resume row
      // (HELD only) when the byte is written, after this transition.
      t.set({ motion: { ...ctx, phase: 'drain', jog: null, confirmed: 0, deadline: null } });
      message(t, 'resumed', STOP_TEXT.resumed, at);
      requestPoll(t);
      tick(t);
      return ALLOWED;
    }
    default: {
      // positionVerify (the reducer passes nothing else here). The user has checked the machine: UNKNOWN clears.
      // Without motion (a read-only release or board) the base stays CONNECTED_UNKNOWN; nothing moves either way.
      const overlays = s.overlays.filter((o) => o !== 'UNKNOWN');
      t.set({ overlays, base: motionCapable(s, t.config) && overlays.length === 0 ? idleBase(s) : s.base });
      return ALLOWED;
    }
  }
}

/** Machine Z, mm: from the connect-time read of `mpo`, then from pushed reports (amendment 2026-11-02). */
function machineZ(s: SessionState): number | undefined {
  return s.live.mpo.z;
}

/** Sends the next jog piece when fewer than the lookahead are believed queued and nothing is being written. */
function feedMore(t: MotionTx): void {
  const ctx = t.s.motion as MotionCtx;
  if (ctx.queued < MOTION_LIMITS.lookahead && motionLinesSettled(t.s)) sendPiece(t);
}

function moreToFeed(jog: JogFeed): boolean {
  return jog.remainingMm === null || jog.remainingMm > 1e-9;
}

function sendPiece(t: MotionTx): void {
  const ctx = t.s.motion as MotionCtx;
  const jog = ctx.jog as JogFeed;
  const d = jog.remainingMm === null ? jog.pieceMm : Math.min(jog.pieceMm, jog.remainingMm);
  const move: Partial<Record<MotionAxisLetter, number>> = {};
  for (const axis of JOG_AXES) {
    const sign = jog.axes[axis];
    if (sign !== undefined) move[LETTER[axis]] = sign * d;
  }
  queueLine(t, jogLine(move, jog.feed), 'jog');
  setMotion(t, { jog: { ...jog, remainingMm: jog.remainingMm === null ? null : Math.max(0, jog.remainingMm - d) }, queued: ctx.queued + 1 });
}

// --- Stops ----------------------------------------------------------------------

/** True when a Stop job, Pause or Spindle off in this state is handled here instead of Phase 1's `!` alone. */
export function motionStopApplies(s: SessionState, config: SessionConfig): boolean {
  return motionCapable(s, config) && STOPPABLE.has(s.base) && !s.overlays.includes('ORPHANED_MOTION') && !s.overlays.includes('LOST');
}

/** Starts the hold step of a stop or release (SAFETY §4.4 Phase 2 steps 1–3). */
export function beginHold(t: MotionTx, reason: HoldReason, at: number): void {
  const s = t.s;
  const stop = reason === 'stopJob';
  writeRealtime(t, 'feedhold', stop ? 'stopJob' : 'feedhold');
  // Stop feeding: unsent pieces and steps never go out.
  const queue = t.s.queue.filter((q) => q.purpose !== 'motion');
  const ctx = s.motion ?? newCtx(s, 'stop');
  t.set({
    queue,
    motion: { ...ctx, phase: 'hold', reason, jog: null, steps: [], confirmed: 0, deadline: at + MOTION_LIMITS.stopStepMs, holdPolls: 0 },
    ...(stop ? { base: 'STOPPING_JOB' as const } : {}),
  });
  // A stop with no motion of ours (a job's Stop job, a Stop job from idle) reads the units it puts back with its
  // closing G90 (§4.4 step 5), answered ahead of the polls that confirm the hold, so before any `%` (modes.ts).
  if (s.motion === null) queueModeReads(t, 'motion');
  requestPoll(t);
  tick(t);
}

/**
 * Pause, Stop job, Spindle off and a hold jog's release in a motion session. Returns false when the
 * request is not handled here (the caller falls back to the Phase 1 `!`).
 */
export function onMotionStop(t: MotionTx, request: SessionIntent, at: number): boolean {
  if (!motionStopApplies(t.s, t.config)) return false;
  const ctx = t.s.motion;
  if (request.intent === 'feedhold') {
    if ('release' in request) {
      if (ctx !== null && ctx.jog !== null && ctx.jog.remainingMm === null && ctx.phase === 'feed') beginHold(t, 'release', at); // a hold jog is fed until released
      return true;
    }
    if (ctx !== null && ctx.phase === 'homing') {
      // Pause during homing ends it (hold, then flush): a homing cycle is not resumed (amendment 2026-11-02).
      beginHold(t, 'homeAbort', at);
      return true;
    }
    if (ctx !== null && (ctx.phase === 'feed' || ctx.phase === 'drain')) {
      beginHold(t, 'pause', at);
      return true;
    }
    return false; // nothing of ours is moving: `!` alone, as in Phase 1
  }
  if (request.intent === 'stopJob') {
    if (ctx !== null && ctx.reason === 'stopJob') writeRealtime(t, 'feedhold', 'stopJob');
    else beginHold(t, 'stopJob', at);
    return true;
  }
  // spindleOffNow (the reducer passes only the stop class here).
  if (ctx !== null) {
    // Something of ours is moving or held: M5 would queue behind it, so end it like Stop job (§4.4).
    if (ctx.reason !== 'stopJob') beginHold(t, 'stopJob', at);
    return true;
  }
  const outputs = 'outputs' in request ? request.outputs : undefined;
  if (outputs !== 'coolant') queueLine(t, 'M5', 'spindleOffNow');
  if (outputs !== 'spindle') queueLine(t, 'M9', 'spindleOffNow');
  return true;
}

// --- Polls, answers, timer --------------------------------------------------------

/** One poll cycle was answered (after `qr`). */
export function onPollDone(t: MotionTx, at: number): void {
  const ctx = t.s.motion;
  if (ctx === null || !checkAlarm(t, at)) return;
  const s = t.s;
  const p = completedPoll(s);
  if (p === null) {
    // A read of this cycle was rejected, damaged or missing: it confirms nothing, whatever the live view says (R5;
    // H56, H69). Count from zero again; the hold and flush deadlines still run (W12 and FAULT on a silent board).
    setMotion(t, { confirmed: 0 });
    if (ctx.phase !== 'homing') requestPoll(t); // homing polls again from its own check timer
    return;
  }
  const confirm = (ok: boolean): number => (ok ? ctx.confirmed + 1 : 0);
  switch (ctx.phase) {
    case 'feed': {
      const jog = ctx.jog as JogFeed;
      // Every piece written before this poll's `qr` is counted in it (lines are answered in order).
      // Pieces still waiting are not in `qr` yet: count them too. (Nothing is being written: this runs as `qr`
      // is answered, before the next line goes out.)
      const unwritten = s.queue.filter((q) => q.purpose === 'motion').length;
      setMotion(t, { queued: planner(s) - p.qr + unwritten });
      if (moreToFeed(jog)) {
        feedMore(t);
      } else {
        setMotion(t, { phase: 'drain', confirmed: 0 });
      }
      requestPoll(t);
      return;
    }
    case 'drain': {
      if (s.base === 'HELD') t.set({ base: 'JOGGING' });
      // An offset write waiting to be written again (status 13) is not settled yet.
      const confirmed = confirm(atRestPolled(s, p) && motionLinesSettled(s) && (ctx.retryAt ?? null) === null);
      if (confirmed < MOTION_LIMITS.confirmations) {
        setMotion(t, { confirmed });
        requestPoll(t);
        return;
      }
      const [next, ...rest] = ctx.steps;
      if (next !== undefined) {
        setMotion(t, { steps: rest, confirmed: 0 });
        queueLine(t, next, 'goToZero'); // only go to zero has steps
        requestPoll(t);
        return;
      }
      finish(t, at);
      return;
    }
    case 'hold': {
      const held = heldPolled(s, p);
      // `!` is ignored while nothing moves (a line still being parsed, the planner's start-up): if the board is
      // moving with no hold in progress, send it again (SAFETY §4.4 Pause step 6).
      // The first cycle may have been asked before the `!` was written, so only later cycles count.
      if (ctx.holdPolls > 0 && p.hold === 0 && p.vel !== 0) writeRealtime(t, 'feedhold', ctx.reason === 'stopJob' ? 'stopJob' : 'feedhold');
      setMotion(t, { holdPolls: ctx.holdPolls + 1 });
      const confirmed = confirm((held || atRestPolled(s, p)) && motionLinesSettled(s));
      if (confirmed < MOTION_LIMITS.confirmations) {
        setMotion(t, { confirmed });
        requestPoll(t);
        return;
      }
      if (ctx.reason === 'pause') {
        if (held) {
          setMotion(t, { phase: 'held', confirmed: 0, deadline: null });
          t.set({ base: 'HELD' });
          t.cancel('motion');
          message(t, 'paused', STOP_TEXT.paused, at);
        } else {
          message(t, 'paused', STOP_TEXT.pausedIdle, at);
          finish(t, at);
        }
        return;
      }
      if (held || p.qr !== planner(s)) {
        writeRealtime(t, 'flush', ctx.reason === 'stopJob' ? 'stopJob' : 'feedhold');
        // `%` drops the board's line buffers: job lines still owed may never be answered (Phase 3).
        forgetJobLines(t);
        setMotion(t, { phase: 'flush', confirmed: 0, deadline: at + MOTION_LIMITS.stopStepMs });
        requestPoll(t);
        return;
      }
      finish(t, at);
      return;
    }
    case 'homing': {
      const resting = atRestPolled(s, p) && motionLinesSettled(s);
      const cls = mapStat(dialect(s), p.stat);
      const seen = ctx.seen === true || cls === 'homing' || p.vel !== 0;
      const confirmed = confirm(resting);
      // Done after two polled reads at rest, once the cycle was seen running (or three in a row: it ended unseen).
      if (confirmed < MOTION_LIMITS.confirmations || (!seen && confirmed < MOTION_LIMITS.confirmations + 1)) {
        setMotion(t, { confirmed, seen });
        if (confirmed > 0) requestPoll(t);
        return;
      }
      setMotion(t, { phase: 'readback', confirmed: 0, seen });
      t.cancel('motion');
      readBack(t, ['hom', 'mpo', 'pos', 'ofs', 'home'], 'homed');
      return;
    }
    case 'flush': {
      const confirmed = confirm(p.hold === 0 && p.qr === planner(s) && motionLinesSettled(s));
      if (confirmed < MOTION_LIMITS.confirmations) {
        setMotion(t, { confirmed });
        requestPoll(t);
        return;
      }
      finish(t, at);
      return;
    }
    /* c8 ignore next 2 -- held and finish stop the poll timer, so no poll cycle completes in them */
    default:
      return;
  }
}

/** Queues the closing lines (SAFETY §4.4 Phase 2 step 5, §4.5b). */
function finish(t: MotionTx, at: number): void {
  const ctx = t.s.motion as MotionCtx;
  const stop = ctx.reason === 'stopJob';
  const lines = stop ? ['M5', 'M9'] : [];
  // A jog used G21 G91 and go to zero G90 G21 (R1, R2): put back the modes read before them (modes.ts). A jog and
  // a Stop job end in absolute distance (§4.4, §4.5b); a jog during a job's tool change puts back the job's own
  // distance mode (Phase 3, H74), and go to zero the board's. A mode that was not read is not put back.
  const dist = stop || (ctx.op === 'jog' && ctx.returnTo !== 'PROGRAM_PAUSED') ? 0 : ctx.dist;
  if (ctx.op === 'jog' || ctx.op === 'goToZero' || stop) lines.push(restoreLine(ctx.units, dist));
  setMotion(t, { phase: 'finish', confirmed: 0, deadline: null });
  // Phase 3: the hold and the flush are confirmed, so every job line the board still had is gone (`%` dropped its
  // line buffers) and every one it ran has been answered: none is owed any more, and M5's answer is M5's.
  if (stop) t.set({ expected: t.s.expected.filter((e) => e.purpose !== 'job') });
  for (const line of lines) queueLine(t, line, stop ? 'stopJob' : ctx.op === 'goToZero' ? 'goToZero' : 'jog');
  t.cancel('motion');
  if (lines.length === 0) complete(t, at);
}

/** The read-back of each change (amendment 2026-11-02): what it changed, read once. */
const CHANGE_READBACK: Readonly<Record<ChangeKind, (s: SessionState) => readonly string[]>> = {
  setZero: (s) => [`g${53 + (activeSystem(s) as number)}`, 'ofs', 'pos'],
  setPosition: () => ['mpo', 'pos', 'hom', 'ofs', 'home'],
  tempOffset: () => ['g92', 'ofs', 'pos'],
  clearTempOffset: () => ['g92', 'ofs', 'pos'],
  selectCoord: () => ['coor', 'ofs', 'pos', 'g54', 'g55', 'g56', 'g57', 'g58', 'g59'],
};

const CHANGE_DONE: Readonly<Record<ChangeKind, (axes: string) => string>> = {
  setZero: (axes) => `Work zero set for ${axes} (saved on the controller); offsets read back.`,
  setPosition: (axes) => `Machine position set to 0 here for ${axes} (G28.3); position read back.`,
  tempOffset: (axes) => `Temporary offset set: ${axes} read 0 here (G92, not saved).`,
  clearTempOffset: () => 'Temporary offset cleared (G92.1).',
  selectCoord: () => 'Work coordinate system changed; offsets read back.',
};

function complete(t: MotionTx, at: number): void {
  const ctx = t.s.motion as MotionCtx;
  t.set({ motion: null, base: returnBase(ctx, t.s) });
  t.cancel('motion');
  if (ctx.op === 'change' && ctx.reason === null && ctx.refusal === null) {
    const change = ctx.change as ChangeKind;
    readBack(t, CHANGE_READBACK[change](t.s), change === 'setPosition' ? 'positionSet' : undefined);
    changeNotice(t, 'done', CHANGE_DONE[change](axisNames(ctx.axes as readonly JogAxis[])), at);
  }
  if (ctx.op === 'home') {
    // Homing ended by Pause, Stop job or a refusal: the machine is not homed. Read the homing state back.
    readBack(t, ['hom', 'mpo', 'pos', 'home']);
    if (ctx.reason === 'homeAbort') changeNotice(t, 'failed', 'Homing stopped by Pause. The machine is not homed: home again before relying on positions.', at);
  }
  if (ctx.reason === 'stopJob') {
    message(t, 'stopped', STOP_TEXT.stopped, at);
    jobStopped(t, at);
  }
  else if (ctx.reason === 'keepalive') message(t, 'failed', 'Jog stopped: the page stopped holding the button.', at);
  else if (ctx.refusal !== null) message(t, 'refused', ctx.refusal, at);
}

function changeNotice(t: MotionTx, kind: 'done' | 'refused' | 'failed', text: string, at: number): void {
  t.set({ notices: { ...t.s.notices, change: { kind, text, at } } });
}

/**
 * A follow-up after the last read-back of a homing (`homed`) or a G28.3 (`positionSet`): with all of X, Y and Z
 * homed (`home` 1) the position is trusted, so UNKNOWN clears and the base is IDLE_HOMED.
 */
export function onFollowUp(t: MotionTx, then: FollowUp, at: number): void {
  const s = t.s;
  const homed = s.live.home === 1;
  if (homed && s.overlays.includes('UNKNOWN')) t.set({ overlays: s.overlays.filter((o) => o !== 'UNKNOWN') });
  const ctx = s.motion;
  if (then === 'homed' && ctx !== null && ctx.op === 'home' && ctx.phase === 'readback') {
    const axes = axisNames(ctx.axes as readonly JogAxis[]);
    t.set({ motion: null });
    changeNotice(t, homed ? 'done' : 'failed', homed ? `Homed ${axes}. Machine position is set from the switches.` : `Homing of ${axes} ended, but the board does not report X, Y and Z all homed.`, at);
  }
  // Nothing else of ours runs and the base is idle-class (an alarm meanwhile has moved it to ALARM): follow the homing state.
  if (t.s.motion !== null || !SETTLE_BASES.has(t.s.base)) return;
  t.set({ base: t.s.overlays.length === 0 ? idleBase(t.s) : 'CONNECTED_UNKNOWN' });
}

/** A pushed status report during homing: a resting or alarmed state asks for confirming polls (pushed stat is never proof). */
export function onMotionReport(t: MotionTx, sr: Readonly<Record<string, unknown>>, _at: number): void {
  const ctx = t.s.motion;
  if (ctx === null || ctx.phase !== 'homing' || !('stat' in sr) || t.s.dialect === null) return;
  const cls = machineClass(t.s);
  if (cls === 'homing') setMotion(t, { seen: true });
  else requestPoll(t);
}

/** A motion line was answered. A non-zero status ends the motion (the board refused it). */
export function onMotionAnswer(t: MotionTx, line: string | undefined, status: number, at: number): void {
  const ctx = t.s.motion;
  if (status === 13 && ctx !== null && ctx.op === 'change' && ctx.line === line && ctx.attempts !== undefined) {
    if (ctx.attempts < MOTION_LIMITS.offsetAttempts) {
      // Status 13 (buffer full) on an offset write: wait, then write the same line again (bug hunt 2026-11-02).
      t.emit({ kind: 'log', text: `offset: the controller refused ${String(line)} with status 13 (buffer full), attempt ${ctx.attempts} of ${MOTION_LIMITS.offsetAttempts}; writing it again in ${MOTION_LIMITS.offsetRetryMs} ms` });
      setMotion(t, { retryAt: at + MOTION_LIMITS.offsetRetryMs, confirmed: 0 });
      return;
    }
    t.emit({ kind: 'log', text: `offset: the controller refused ${String(line)} with status 13 (buffer full) ${ctx.attempts} times; not written` });
    t.set({ motion: null, base: returnBase(ctx, t.s), queue: t.s.queue.filter((q) => q.purpose !== 'motion' && q.purpose !== 'poll') });
    t.cancel('motion');
    changeNotice(t, 'refused', `The controller refused ${String(line)} ${ctx.attempts} times (status 13, its buffer was full). Nothing was changed: try again in a moment.`, at);
    return;
  }
  if (status !== 0) {
    const text = `The controller refused ${String(line)} (status ${status}).`;
    if (ctx !== null && (ctx.op === 'change' || (ctx.op === 'home' && ctx.phase === 'homing'))) {
      // Nothing was started: end without a hold, and say why.
      t.set({ motion: null, base: returnBase(ctx, t.s), queue: t.s.queue.filter((q) => q.purpose !== 'motion' && q.purpose !== 'poll') });
      t.cancel('motion');
      changeNotice(t, 'refused', text, at);
      if (ctx.op === 'home') readBack(t, ['hom', 'home']);
      return;
    }
    if (ctx === null) {
      message(t, 'refused', text, at);
    } else {
      setMotion(t, { refusal: ctx.refusal ?? text });
      if (ctx.phase === 'feed' || ctx.phase === 'drain') beginHold(t, 'refused', at);
    }
  }
  const now = t.s.motion;
  // A piece was taken: top the planner up at once rather than waiting for the next poll (no stutter).
  if (status === 0 && now !== null && now.phase === 'feed' && now.jog !== null && moreToFeed(now.jog)) feedMore(t);
  if (now !== null && now.phase === 'finish' && motionLinesSettled(t.s)) complete(t, at);
}

/** The `motion` timer: keep-alive, deadlines, and the next poll. */
export function onMotionTimer(t: MotionTx, deps: MotionDeps, at: number): void {
  // Armed only while a motion is in a polling phase: complete, abandon, held and finish cancel it.
  const ctx = t.s.motion as MotionCtx;
  if ((ctx.phase === 'hold' || ctx.phase === 'flush') && ctx.deadline !== null && at > ctx.deadline) {
    const what = ctx.phase === 'hold' ? 'did not report the hold' : 'did not report an empty queue after the flush';
    t.set({ motion: null, base: returnBase(ctx, t.s), queue: t.s.queue.filter((q) => q.purpose !== 'motion' && q.purpose !== 'poll') });
    message(t, 'failed', 'Stop not confirmed: use your E-stop.', at);
    deps.fault(t, 'stopNotConfirmed', 'integrity', `the controller ${what} within ${MOTION_LIMITS.stopStepMs / 1000} s`, at);
    return;
  }
  if (ctx.retryAt !== undefined && ctx.retryAt !== null && at >= ctx.retryAt && ctx.line !== undefined) {
    setMotion(t, { retryAt: null, attempts: (ctx.attempts as number) + 1, confirmed: 0 });
    queueLine(t, ctx.line, ctx.change === 'setZero' ? 'setWorkZero' : 'selectCoordSystem');
    requestPoll(t);
    tick(t);
    return;
  }
  if (ctx.phase === 'homing') {
    // The fallback check: a pushed report may have been missed (only one is pending at a time).
    requestPoll(t);
    t.arm('motion', MOTION_LIMITS.homingCheckMs);
    return;
  }
  const jog = ctx.jog;
  if (jog !== null && jog.remainingMm === null && ctx.phase === 'feed' && at - jog.renewedAt > MOTION_LIMITS.keepAliveMs) {
    beginHold(t, 'keepalive', at);
    return;
  }
  requestPoll(t);
  tick(t);
}

/**
 * After live values changed (a report or a read): an alarm ends any motion (the controller stopped it) and
 * puts the session in ALARM; an alarm that cleared returns to idle. Returns false when motion was ended.
 */
export function checkAlarm(t: MotionTx, at: number): boolean {
  const s = t.s;
  if (!t.config.release.motion || s.dialect === null) return true;
  const cls = machineClass(s);
  if (cls === undefined) return true;
  if (ALARMED.has(cls) && ALARMABLE.has(s.base)) {
    const moving = s.motion !== null;
    t.set({ motion: null, base: 'ALARM', queue: s.queue.filter((q) => q.purpose !== 'motion') });
    t.cancel('motion');
    if (moving) message(t, 'failed', 'The controller alarmed and stopped the move. Read the alarm, then clear it.', at);
    // Phase 3: an alarm ends the job (on edge-next the controller has already flushed and turned its outputs off).
    if (jobActive(t.s)) failJob(t, at, `The controller alarmed at line ${lastFileLine(t.s.job as NonNullable<SessionState['job']>, t.s.live.line)} and stopped the job. Read the alarm, then clear it.`);
    return false;
  }
  if (s.base === 'ALARM' && restingStat(dialect(s), s.live.stat as number, s.live.hold)) t.set({ base: idleBase(s) });
  return true;
}

/** The link dropped or a FAULT latched: the motion is over (nothing more is fed). */
export function abandonMotion(t: MotionTx): void {
  const ctx = t.s.motion;
  t.cancel('motion');
  if (ctx === null) return;
  t.set({ motion: null, base: returnBase(ctx, t.s), queue: t.s.queue.filter((q) => q.purpose !== 'motion') });
}
