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
 * coolant readouts.
 */
import { STOP_TEXT, type Decision, type Intent } from '@synthetos/safety';
import { mapStat, type Dialect, type MachineClass } from '@synthetos/protocol';
import { CLEAR_LINE, MAX_JOG_FEED, MAX_RPM, jogLine, motionLineKind, restoreLine, safeZLine, setZeroLine, spindleLine, toZeroLine, type MotionAxisLetter } from './motionLines.ts';
import type { FaultCause, FaultKind, HoldReason, JogAxis, JogFeed, MotionCtx, PendingRead, SessionBase, SessionConfig, SessionEffect, SessionIntent, SessionState, TimerId } from './types.ts';

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
  /** Longest single jog step, mm (100 mm, or 4 in = 101.6 mm). */
  maxStepMm: 102,
  maxFeed: MAX_JOG_FEED,
  maxRpm: MAX_RPM,
});

/** The polled reads of the motion layer, in order; the cycle is complete when the last one is answered. */
export const POLL_TOKENS: readonly string[] = Object.freeze(['stat', 'hold', 'vel', 'qr']);

const LETTER: Readonly<Record<JogAxis, MotionAxisLetter>> = { x: 'X', y: 'Y', z: 'Z', a: 'A' };
const JOG_AXES: readonly JogAxis[] = ['x', 'y', 'z', 'a'];

/**
 * Classes that are at rest when `hold` is 0: ready, program end, and STOP (stat 3), which edge-next reports
 * after every move that finished without a program end. A program pause is stat 3 with `hold` 6 (PN §8),
 * which `atRest` excludes by requiring `hold` 0.
 */
const RESTING: ReadonlySet<MachineClass> = new Set(['idle', 'end', 'programStop']);
const ALARMED: ReadonlySet<MachineClass> = new Set(['alarm', 'softAlarm', 'shutdown', 'panic']);
/** Bases an alarm report moves to ALARM. */
const ALARMABLE: ReadonlySet<SessionBase> = new Set(['IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING', 'HELD', 'STOPPING_JOB']);
/** Bases a Stop job in a motion session may start from (anything else keeps the Phase 1 `!` only). */
const STOPPABLE: ReadonlySet<SessionBase> = new Set(['IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING', 'HELD', 'STOPPING_JOB', 'CONNECTED_UNKNOWN']);

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

/** At rest by polled values: idle or ended, not moving, nothing held, planner empty. */
function atRest(s: SessionState): boolean {
  const cls = machineClass(s);
  return cls !== undefined && RESTING.has(cls) && s.live.vel === 0 && s.live.hold === 0 && s.live.qr === planner(s);
}

function heldNow(s: SessionState): boolean {
  return s.live.hold !== undefined && dialect(s).hold[s.live.hold] === 'HOLD';
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
  // A Stop job from CONNECTED_UNKNOWN (UNKNOWN overlay, or a FAULT) returns there; everything else to idle.
  return { op, phase: 'feed', jog: null, steps: [], reason: null, confirmed: 0, deadline: null, units: s.live.unit, returnTo: s.base === 'CONNECTED_UNKNOWN' ? s.base : 'IDLE_UNHOMED', refusal: null };
}

/** Where a motion returns: CONNECTED_UNKNOWN if it started there, else the idle base for the homing state. */
function returnBase(ctx: MotionCtx, s: SessionState): SessionBase {
  return ctx.returnTo === 'CONNECTED_UNKNOWN' ? 'CONNECTED_UNKNOWN' : idleBase(s);
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
      const steps: string[] = [];
      if (planar.length > 0) {
        const z = machineZ(s);
        if (z === undefined || typeof safeZ !== 'number' || !Number.isFinite(safeZ)) return deny('The machine Z position is not known yet.', 'Wait for the position to be read.');
        // Never lower Z first: the safe height is at least where Z already is (H53).
        steps.push(safeZLine(Math.max(z, safeZ)), toZeroLine(planar));
      }
      if (letters.includes('Z')) steps.push(toZeroLine(['Z']));
      if (steps.some((l) => motionLineKind(l) === undefined)) return deny('The safe height is out of range.', 'Choose another safe height.');
      t.set({ motion: { ...newCtx(s, 'goToZero'), phase: 'drain', steps: steps.slice(1) }, base: 'JOGGING' });
      queueLine(t, steps[0] as string, 'goToZero');
      requestPoll(t);
      tick(t);
      return ALLOWED;
    }
    case 'setWorkZero': {
      // The matrix allows this only from idle, and an idle base never has a motion running.
      if (!validAxisList(request.axes)) return deny('Set zero names one or more of X, Y, Z and A.', 'Choose an axis.');
      queueLine(t, setZeroLine(request.axes.map((a) => LETTER[a])), 'setWorkZero');
      return ALLOWED;
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
      // positionVerify (the reducer passes nothing else here).
      if (!motionCapable(s, t.config)) return deny('This board is not approved for motion in this session.', 'Use an approved firmware build.');
      const overlays = s.overlays.filter((o) => o !== 'UNKNOWN');
      t.set({ overlays, base: idleBase(s) });
      return ALLOWED;
    }
  }
}

/** Machine Z, mm: from a status report's `mpoz`, else from the polled `mpo` group (SAFETY §4.2). */
function machineZ(s: SessionState): number | undefined {
  if (s.live.mpo.z !== undefined) return s.live.mpo.z;
  const group = s.values['mpo'];
  const value = group?.status === 0 ? group.value : null;
  const z = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)['z'] : undefined;
  return typeof z === 'number' && Number.isFinite(z) ? z : undefined;
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
  setMotion(t, { jog: { ...jog, remainingMm: jog.remainingMm === null ? null : Math.max(0, jog.remainingMm - d) } });
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
    motion: { ...ctx, phase: 'hold', reason, jog: null, steps: [], confirmed: 0, deadline: at + MOTION_LIMITS.stopStepMs },
    ...(stop ? { base: 'STOPPING_JOB' as const } : {}),
  });
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
  const confirm = (ok: boolean): number => (ok ? ctx.confirmed + 1 : 0);
  switch (ctx.phase) {
    case 'feed': {
      const jog = ctx.jog as JogFeed;
      // `qr` is always known here: READING required it, or the board would be ORPHANED_MOTION.
      const queued = planner(s) - (s.live.qr as number);
      if (moreToFeed(jog)) {
        if (queued < MOTION_LIMITS.lookahead && motionLinesSettled(s)) sendPiece(t);
      } else {
        setMotion(t, { phase: 'drain', confirmed: 0 });
      }
      requestPoll(t);
      return;
    }
    case 'drain': {
      if (s.base === 'HELD') t.set({ base: 'JOGGING' });
      const confirmed = confirm(atRest(s) && motionLinesSettled(s));
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
      const held = heldNow(s);
      const confirmed = confirm((held || atRest(s)) && motionLinesSettled(s));
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
      if (held || s.live.qr !== planner(s)) {
        writeRealtime(t, 'flush', ctx.reason === 'stopJob' ? 'stopJob' : 'feedhold');
        setMotion(t, { phase: 'flush', confirmed: 0, deadline: at + MOTION_LIMITS.stopStepMs });
        requestPoll(t);
        return;
      }
      finish(t, at);
      return;
    }
    case 'flush': {
      const confirmed = confirm(s.live.hold === 0 && s.live.qr === planner(s) && motionLinesSettled(s));
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
  // A jog used G21 G91: put the modes back. Go to zero used G90 and the non-modal G53 only.
  if (ctx.op === 'jog' || stop) lines.push(restoreLine(ctx.units));
  setMotion(t, { phase: 'finish', confirmed: 0, deadline: null });
  for (const line of lines) queueLine(t, line, stop ? 'stopJob' : 'jog');
  t.cancel('motion');
  if (lines.length === 0) complete(t, at);
}

function complete(t: MotionTx, at: number): void {
  const ctx = t.s.motion as MotionCtx;
  t.set({ motion: null, base: returnBase(ctx, t.s) });
  t.cancel('motion');
  if (ctx.reason === 'stopJob') message(t, 'stopped', STOP_TEXT.stopped, at);
  else if (ctx.reason === 'keepalive') message(t, 'failed', 'Jog stopped: the page stopped holding the button.', at);
  else if (ctx.refusal !== null) message(t, 'refused', ctx.refusal, at);
}

/** A motion line was answered. A non-zero status ends the motion (the board refused it). */
export function onMotionAnswer(t: MotionTx, line: string | undefined, status: number, at: number): void {
  const ctx = t.s.motion;
  if (status !== 0) {
    const text = `The controller refused ${String(line)} (status ${status}).`;
    if (ctx === null) {
      message(t, 'refused', text, at);
    } else {
      setMotion(t, { refusal: ctx.refusal ?? text });
      if (ctx.phase === 'feed' || ctx.phase === 'drain') beginHold(t, 'refused', at);
    }
  }
  const now = t.s.motion;
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
    return false;
  }
  if (s.base === 'ALARM' && RESTING.has(cls)) t.set({ base: idleBase(s) });
  return true;
}

/** The link dropped or a FAULT latched: the motion is over (nothing more is fed). */
export function abandonMotion(t: MotionTx): void {
  const ctx = t.s.motion;
  t.cancel('motion');
  if (ctx === null) return;
  t.set({ motion: null, base: returnBase(ctx, t.s), queue: t.s.queue.filter((q) => q.purpose !== 'motion') });
}
