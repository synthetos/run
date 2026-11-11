/**
 * The read-only session statechart as a pure reducer (ROADMAP P1-02; SAFETY
 * §3, §4.1, §4.4; PN §2.3; OLD-TP §4.2).
 *
 * `reduce(config, state, event)` returns the next state and the effects the
 * executor (machineSession.ts) must carry out. It reads no clock, timer,
 * port or global: time arrives in events, and timers are effects.
 *
 * The path: NOT_CONNECTED → PORT_REQUEST (the worker asks the build's
 * transport source for the chosen port) → OPENING → IDENTIFYING (the
 * capability probe, PN §2.3, `{sr:null}` first) → READING (`stat`,
 * `hold`, `vel`, `qr`, `ex`) → CONNECTED_UNKNOWN. The probe result and the
 * classification are recorded in the session log (a `log` effect). BLOCKED when the board's id is
 * not the selected machine's (T-S21): nothing more is written.
 *
 * Overlays (SAFETY §3), in precedence order FAULT > LOST > ORPHANED_MOTION >
 * UNKNOWN > STALE > READ_ONLY > NEEDS_REVIEW:
 * - FAULT: a banner after the board was ready (T-S10), a write failure or a
 *   refused write, an unexpected response, a footer revision change, an
 *   `er` report, a board that keeps resetting during the probe. Latched;
 *   `ackFault` completes only when two polled reads 250 ms apart show
 *   `hold` = 0 and `qr` = the dialect's `plannerBlocks`, then the board is
 *   probed again from `{sr:null}`.
 * - LOST: the link dropped. The port is closed; acknowledging it returns to
 *   NOT_CONNECTED and the next connect starts with UNKNOWN.
 * - ORPHANED_MOTION: no answer to a probe GET (3 s for the first line), an
 *   unsolicited report showing motion while connecting, or READING finds
 *   the board not idle (`stat` not idle/end, `hold` ≠ 0, `vel` ≠ 0, `qr`
 *   not `plannerBlocks`). A boot banner while unclassified ends it (the
 *   reset ended the motion) and the probe restarts.
 * - UNKNOWN: after LOST, after a reset banner.
 * - STALE: the receive watchdog (SAFETY §4.2, P1-04). On a classified,
 *   connected link, after `livenessIdleMs` of received silence the session
 *   asks for proof of life: ENQ on edge-next after a rev-2/3 footer (at
 *   most one outstanding), otherwise a `stat` GET. No byte within
 *   `staleAfterMs` of asking is unexpected silence: STALE. A read after
 *   classification that goes unanswered is STALE as well. Cleared by the
 *   next line received. With the heartbeat on, the window is
 *   `reportSilenceMs` and ends in STALE with nothing sent, except while the
 *   machine is held, dwelling or queued without stepping (the heartbeat is
 *   silent then): one ask per window, STALE only if it goes unanswered.
 * - READ_ONLY: the classifier returned READ_ONLY, or READING found `ex`
 *   other than 0, 1 or 2 (2 is RTS/CTS, accepted since OD-33 with RTS held
 *   on after every open, rts.ts; an unread `ex` counts as unknown, fail
 *   closed).
 * - NEEDS_REVIEW: a settings drift (the drift check that raises it arrives
 *   with the settings read; the overlay and its matrix rules exist now).
 *
 * Phase 1 writes (the only ones this file can produce): single-token GETs
 * from the probe list before classification and from the dialect's read
 * allowlist after it, ENQ (classified `tinyg-en`, after a rev-2/3 footer,
 * at most one outstanding), and the feedhold `!` for Pause, Stop job and
 * Spindle off (the last two with "Use your E-stop", SAFETY §4.4 READ_ONLY
 * row). Every intent goes through `safety.allowed` with the configured
 * release first, and every line through the matrix again when it is sent.
 */
import {
  BYTE,
  PROBE_STEPS,
  buildProbeResult,
  checkFooterForDialect,
  classify,
  mapStat,
  type Banner,
  type ClassifiedLine,
  type Dialect,
  type Inbound,
  type JsonObject,
  type JsonValue,
  type MachineClass,
  type Classification,
  type ProbeKey,
  type ProbeResult,
  type Response,
  type StatusReport,
  classifyLine,
} from '@synthetos/protocol';
import { OVERLAYS, allowed, type Decision, type Intent, type MatrixSnapshot, type Overlay } from '@synthetos/safety';
import { getLineFor, isReadAllowed } from '@synthetos/schema';
import { writeLineCapFor } from '../writeShape.ts';
import type { PortSelector } from '../transport.ts';
import { gateTokens, judgeGate, readBackMatches, readBackValue, settingLine, settingRefusal } from './settingWrite.ts';
import { restingStat, restingUsesHold } from './resting.ts';
import { onModesAnswer } from './modes.ts';
import { onAlarmRestoreAnswered, onAlarmRestoreMissed } from './alarmRestore.ts';
import { BOARD_MODES_UNKNOWN, forgetBoardModes, noteModeLine, noteModeRead } from './boardModes.ts';
import { forgetHomed, noteHomingRead } from './homedAxes.ts';
import { onTypedReadsIn, startTypedMove } from './typedMove.ts';
import { POLL_TOKENS, abandonMotion, checkAlarm, idleBase, motionCapable, onFollowUp, onMotionAnswer, onMotionIntent, onMotionReport, onMotionStop, onMotionTimer, onPollDone, type MotionDeps } from './motion.ts';
import { HEARTBEAT_INTERVAL_MS, JV_LINE, REPORT_DIALECTS, SEED_TOKENS, heartbeatCoversHold, reportLineShape, reportSteps, srListMatches, type ReportStep } from './reports.ts';

/** OD-14: the margin after a persisted SET's own reply before the next line (TinyG maintainer, N35). */
const NORMALIZE_SETTLE_MS = 50;
import {
  abandonLoad,
  maybeRestoreLineMode,
  onFeedLimit,
  onJobAnswer,
  onJobBreakpoints,
  onJobFault,
  onJobLinkLost,
  onJobMotionAnswer,
  onJobMotionTimeout,
  onJobPause,
  onJobPoll,
  onJobPrepAnswer,
  onJobReset,
  onJobResume,
  onJobRuntimeAnswer,
  onJobStop,
  onJobTimer,
  onLineModeAnswer,
  onLineModeMemory,
  onLoadJob,
  onStartJob,
  pumpJob,
  rxmLine,
  type JobDeps,
} from './job.ts';
import { jobActive, patchJob } from './jobState.ts';
import { maybeRereadOffsets } from './jobOffsets.ts';
import { PROBE_CLOSED } from './probe/state.ts';
import { onProbeIntent, probeRefusal } from './probe/intents.ts';
import { onProbeAlarm, onProbeAnswer, onProbePoll, onProbeReport, onProbeTimer } from './probe/run.ts';
import { abandonProbe, onProbeGarbled, onProbeLineDropped, onProbeMissed, onProbeStop } from './probe/stops.ts';
import { probeCarried, probeSeedReads, syncProbe } from './probe/sync.ts';
import {
  MAX_PROBE_RESTARTS,
  MAX_QUEUED_READS,
  READY_BASES,
  type Axis,
  type Expected,
  type FaultCause,
  type FaultKind,
  type Identity,
  type LiveState,
  type PendingRead,
  type ProbeProgress,
  type ReadPurpose,
  type ReportChange,
  type ReportsState,
  type RxmState,
  type SessionConfig,
  type SessionEffect,
  type SessionEvent,
  type SessionIntent,
  type SessionState,
  type SettingWriteOutcome,
  type SettingWriteState,
  type TimerId,
  type Transition,
} from './types.ts';

/** Tokens READING reads, where the dialect's allowlist has them (SAFETY H14 inputs, PN §2.3 step 0). */
export const READING_TOKENS: readonly string[] = Object.freeze(['stat', 'hold', 'vel', 'qr', 'ex']);

/**
 * `ex` values a full session accepts: FLOW_CONTROL_OFF, FLOW_CONTROL_XON and
 * FLOW_CONTROL_RTS (@cite EN config.h:204-206; TG config.h:206-208).
 * RTS (2) is accepted since OD-33 (2026-11-10): run holds RTS on after every
 * open (rts.ts), and line mode keeps the unanswered bytes far below the
 * board's RTS marks (TinyG B-FC-1, measured on 450.02 and edge-next). An ex
 * that cannot be read, or any other value, still makes the session READ_ONLY
 * (fail closed). Run never writes ex (SAFETY H61).
 */
export const FULL_SESSION_FLOW_CONTROL: ReadonlySet<number> = new Set([0, 1, 2]);

/** READING's extra tokens in a motion session: the homing state (W34, IDLE_HOMED) and the units to restore after a jog. */
export const MOTION_READING_TOKENS: readonly string[] = Object.freeze(['home', 'unit']);

/** Tokens the `ackFault` verification reads (SAFETY §3 FAULT exits). */
export const VERIFY_TOKENS: readonly string[] = Object.freeze(['hold', 'qr']);

/** The probe's tokens: the only GETs written before the board is classified (PN §2.3, probe.ts). */
export const PROBE_TOKENS: ReadonlySet<string> = new Set(PROBE_STEPS.map((s) => s.key));

const AXES: readonly Axis[] = ['x', 'y', 'z', 'a', 'b', 'c'];

/** Machine classes that mean the board is moving or about to (unsolicited report while connecting). */
const MOTION_CLASSES: ReadonlySet<MachineClass> = new Set(['running', 'homing', 'jogging', 'probing']);


/** Classes READING takes as a controller alarm in a motion session (not motion from elsewhere). */
const ALARM_CLASSES: ReadonlySet<MachineClass> = new Set(['alarm', 'softAlarm', 'shutdown']);

const EMPTY_LIVE: LiveState = Object.freeze({ pos: Object.freeze({}), mpo: Object.freeze({}) });

const REPORTS_IDLE: ReportsState = Object.freeze({ phase: 'idle', step: null, remaining: Object.freeze([]), heartbeatMs: null, changes: Object.freeze([]), detail: null });

const RXM_IDLE: RxmState = Object.freeze({ restore: null, memoryKnown: false, pending: false, leftAsFound: false, step: null, footerExpect: null, current: null, changed: null, detail: null });

export function initialState(): SessionState {
  return Object.freeze({
    base: 'NOT_CONNECTED',
    overlays: Object.freeze([]),
    epoch: 0,
    port: null,
    expectedDeviceId: null,
    unknownOnNextConnect: false,
    xoff: false,
    footerRev: undefined,
    probe: null,
    ready: false,
    identity: null,
    classification: null,
    dialect: null,
    portInfo: null,
    queue: Object.freeze([]),
    expected: Object.freeze([]),
    writing: null,
    enqOutstanding: false,
    liveness: null,
    stale: null,
    live: EMPTY_LIVE,
    values: Object.freeze({}),
    fault: null,
    ackVerify: null,
    blocked: null,
    notices: Object.freeze({ adviseEstop: false }),
    timers: Object.freeze({}),
    timerSeq: 0,
    sent: Object.freeze({ lines: 0, realtime: 0 }),
    motion: null,
    polled: null,
    settingWrite: null,
    bootEntry: null,
    reports: REPORTS_IDLE,
    link: Object.freeze({ heartbeatMs: null, silenceMs: DEFAULT_SILENCE_MS }),
    job: null,
    rxm: RXM_IDLE,
    rtLeaves: Object.freeze([]),
    probeZ: PROBE_CLOSED,
    boardModes: BOARD_MODES_UNKNOWN,
    alarmRestore: null,
  });
}

/** The fallback silence window (no heartbeat) with the default timings. */
const DEFAULT_SILENCE_MS = 7000;

/** The classified dialect, or null (unclassified, or not yet probed). */
export function dialectOf(state: SessionState): Dialect | null {
  return state.dialect;
}

/** What the allow-matrix needs to know about this state. */
export function matrixSnapshot(state: SessionState): MatrixSnapshot {
  const dialect = dialectOf(state);
  return { base: state.base, overlays: state.overlays, classified: dialect !== null, enqCapable: dialect?.caps.enq === true };
}

/** True when a GET of `token` may be written in this state (probe tokens before classification, the allowlist after). */
export function readableNow(state: SessionState, token: string): boolean {
  const dialect = dialectOf(state);
  if (dialect !== null) return isReadAllowed(dialect.id, token);
  return state.classification === null && PROBE_TOKENS.has(token);
}

/**
 * True when the dialect side of ENQ holds: classified, the dialect has ENQ,
 * and a rev-2/3 footer was seen on this link (T-S24b, T-S87). The
 * allow-matrix (`enq`, with the session's release) is checked separately,
 * at the intent and again right before the write.
 */
export function enqAllowedNow(state: SessionState): boolean {
  return enqByte(state) !== undefined;
}

/** The ENQ byte when `enqAllowedNow` holds (dialect data: present exactly where `caps.enq`), else undefined. */

/**
 * TinyG 450.02 statuses (EN error.h:211-212): a persisted setting written while a job runs or has queued work is
 * refused and nothing changes (117, N60; listed in the tinyg-en status table as notAccepted); stored settings that
 * would not load run on their defaults, reported once after the banner (118, N61), which the session turns into a
 * start-up notice instead of a FAULT.
 */
const TINYG_SETTING_REFUSED_IN_CYCLE = 117;
const TINYG_SETTINGS_DEFAULTED = 118;
function enqByte(state: SessionState): number | undefined {
  if (state.footerRev !== 2 && state.footerRev !== 3) return undefined;
  return dialectOf(state)?.realtime.enq?.byte;
}

/** One transition being built. */
class Tx {
  s: SessionState;
  readonly fx: SessionEffect[] = [];
  readonly config: SessionConfig;

  constructor(config: SessionConfig, state: SessionState) {
    this.config = config;
    this.s = state;
  }

  set(patch: Partial<SessionState>): void {
    this.s = { ...this.s, ...patch };
  }

  emit(effect: SessionEffect): void {
    this.fx.push(Object.freeze(effect));
  }

  decide(intent: Intent, decision: Decision): void {
    this.emit({ kind: 'decision', intent, decision: Object.freeze(decision) });
  }

  arm(id: TimerId, ms: number): void {
    const seq = this.s.timerSeq + 1;
    this.set({ timerSeq: seq, timers: { ...this.s.timers, [id]: seq } });
    this.emit({ kind: 'armTimer', id, seq, ms });
  }

  cancel(id: TimerId): void {
    if (this.s.timers[id] === undefined) return;
    const timers = { ...this.s.timers };
    delete timers[id];
    this.set({ timers });
    this.emit({ kind: 'cancelTimer', id });
  }

  cancelAll(): void {
    for (const id of Object.keys(this.s.timers) as TimerId[]) this.cancel(id);
  }

  addOverlay(o: Overlay): void {
    if (this.s.overlays.includes(o)) return;
    this.set({ overlays: OVERLAYS.filter((x) => x === o || this.s.overlays.includes(x)) });
  }

  removeOverlay(o: Overlay): void {
    if (!this.s.overlays.includes(o)) return;
    this.set({ overlays: this.s.overlays.filter((x) => x !== o) });
  }

  done(): Transition {
    return { state: deepFreezeState(this.s), effects: Object.freeze(this.fx) };
  }
}

/** What the motion layer borrows from this file (motion.ts may not import it: no cycles). */
const MOTION_DEPS: MotionDeps = { fault: (t, cause, kind, detail, at) => enterFault(t as Tx, cause, kind, detail, at) };
const JOB_DEPS: JobDeps = { fault: (t, cause, kind, detail, at) => enterFault(t as Tx, cause, kind, detail, at) };

/** The next state and effects. Pure: never throws for any event in any state. */
export function reduce(config: SessionConfig, state: SessionState, event: SessionEvent): Transition {
  const t = new Tx(config, state);
  switch (event.type) {
    case 'intent':
      onIntent(t, event.request, event.at);
      break;
    case 'transportAcquired':
      if (event.epoch === t.s.epoch && t.s.base === 'PORT_REQUEST') {
        t.set({ base: 'OPENING' });
        t.emit({ kind: 'open', epoch: t.s.epoch });
      }
      break;
    case 'transportUnavailable':
    case 'openFailed':
      if (event.epoch === t.s.epoch && (t.s.base === 'PORT_REQUEST' || t.s.base === 'OPENING')) {
        resetToNotConnected(t, false);
        const code = event.type === 'transportUnavailable' ? 'unavailable' : 'open-failed';
        t.set({ notices: { ...t.s.notices, connectFailed: { code, reason: event.reason } } });
      }
      break;
    case 'opened':
      if (event.epoch === t.s.epoch && t.s.base === 'OPENING') {
        t.set({ portInfo: Object.freeze({ ...event.info }) });
        onOpened(t);
      }
      break;
    case 'inbound':
      if (event.epoch === t.s.epoch && linkUp(t.s)) {
        onInbound(t, event.event, event.at);
        // An alarm ends any motion of this session; a cleared alarm returns to idle (SAFETY §4.5b).
        checkAlarm(t, event.at);
      }
      break;
    case 'lineWritten':
      // Only for the line being written: its answer may already have arrived (and the next line been asked for).
      if (event.epoch === t.s.epoch && linkUp(t.s) && t.s.writing?.seq === event.seq) onLineWritten(t, event.at ?? 0);
      break;
    case 'lineDropped':
      if (event.epoch === t.s.epoch && event.index !== undefined) onJobLineDropped(t, event.index);
      else if (event.epoch === t.s.epoch && t.s.writing?.seq === event.seq) {
        const dropped = t.s.writing;
        t.set({ writing: null });
        // Probe Z: a line the write gate held back (after Pause or Stop job) is the probe's to account for.
        if (dropped.purpose === 'probeZ' && dropped.line !== undefined) onProbeLineDropped(t, dropped.line, t.s.live.lastRxAt as number);
      }
      break;
    case 'writeFailed':
      if (event.epoch === t.s.epoch && linkUp(t.s)) {
        t.set({ writing: null });
        enterFault(t, 'writeFailed', 'integrity', `a write failed: ${event.detail}`, event.at);
      }
      break;
    case 'writeRefused':
      if (event.epoch === t.s.epoch && linkUp(t.s)) {
        t.set({ writing: null });
        enterFault(t, 'writeRefused', 'integrity', `the session's write gate refused bytes: ${event.detail}`, event.at);
      }
      break;
    case 'linkLost':
      if (event.epoch === t.s.epoch && linkUp(t.s)) onLinkLost(t, event.at);
      break;
    case 'timer':
      if (t.s.timers[event.id] === event.seq) {
        const timers = { ...t.s.timers };
        delete timers[event.id];
        t.set({ timers });
        onTimer(t, event.id, event.at);
      }
      break;
    case 'driftDetected':
      if (event.epoch === t.s.epoch && linkUp(t.s)) t.addOverlay('NEEDS_REVIEW');
      break;
    case 'driftResolved':
      // "Keep the board's settings" (C23): the read became the reference and nothing on the board changed, so the
      // review is done for this link (OD-13 §5: a gate's way out is beside it). Only for the current link.
      if (event.epoch === t.s.epoch && linkUp(t.s) && t.s.overlays.includes('NEEDS_REVIEW')) {
        t.removeOverlay('NEEDS_REVIEW');
        t.emit({ kind: 'log', text: "settings: the board's settings were kept as this computer's reference (C23, nothing written): review resolved" });
      }
      break;
    case 'lineModeMemory':
      // The page's remembered line mode for this board (H77). It writes nothing; only a jobs release uses it.
      if (event.epoch === t.s.epoch && linkUp(t.s) && t.config.release.jobs === true) onLineModeMemory(t, event.remembered);
      break;
  }
  maybeConfigure(t);
  maybeRestoreLineMode(t, linkUp(t.s) && allowed(matrixSnapshot(t.s), 'lineMode', t.config.release).allowed);
  maybeRereadOffsets(t, linkUp(t.s) && allowed(matrixSnapshot(t.s), 'read', t.config.release).allowed);
  pump(t);
  pumpJob(t, linkUp(t.s) && allowed(matrixSnapshot(t.s), 'jobLine', t.config.release).allowed);
  syncProbe(t);
  syncWatchdog(t);
  return t.done();
}

/** A job line the executor did not write (the matrix no longer allowed it): it is sent again from there. */
function onJobLineDropped(t: Tx, index: number): void {
  t.set({ expected: t.s.expected.filter((e) => !(e.purpose === 'job' && e.index === index)) });
  const job = t.s.job;
  if (job !== null && index < job.next) patchJob(t, { next: index });
}

/** The port is open and the link has not been lost. */
function linkUp(s: SessionState): boolean {
  return (s.base === 'IDENTIFYING' || s.base === 'READING' || s.base === 'BLOCKED' || READY_BASES.has(s.base)) && !s.overlays.includes('LOST');
}

// --- Intents -------------------------------------------------------------

const PHASE_1_NOT_HANDLED = {
  reason: 'The machine session does not handle this request in this release.',
  remedy: 'This release only reads the machine; use your usual sender to control it.',
};

function deny(reason: string, remedy: string, citation: string): Decision {
  return { allowed: false, reason, remedy, citation };
}

function onIntent(t: Tx, request: SessionIntent, at: number): void {
  const intent = request.intent;
  const matrix = allowed(matrixSnapshot(t.s), intent, t.config.release);
  if (!matrix.allowed) {
    t.decide(intent, matrix);
    return;
  }
  // Probe Z (SAFETY §4.5c): nothing else moves the machine while it is open; no Start job or Spindle on with the plate out.
  const probeHeld = probeRefusal(t.s, request);
  if (probeHeld !== undefined) {
    t.decide(intent, probeHeld);
    return;
  }
  switch (request.intent) {
    case 'connect': {
      const epoch = t.s.epoch + 1;
      t.s = { ...initialState(), epoch, unknownOnNextConnect: t.s.unknownOnNextConnect || request.unknown === true, timerSeq: t.s.timerSeq, probeZ: probeCarried(t.s.probeZ) };
      t.set({ base: 'PORT_REQUEST', port: request.port, expectedDeviceId: request.expectedDeviceId });
      t.emit({ kind: 'acquireTransport', epoch, port: request.port });
      t.decide(intent, matrix);
      return;
    }
    case 'disconnect': {
      const epoch = t.s.epoch;
      t.cancelAll();
      t.emit({ kind: 'close', epoch });
      resetToNotConnected(t, t.s.unknownOnNextConnect);
      t.decide(intent, matrix);
      return;
    }
    case 'feedhold':
    case 'stopJob':
    case 'spindleOffNow': {
      // Phase 3 (SAFETY §4.4a): during a job, Pause holds the job (`!`, streaming stops) and Stop job runs the
      // flush sequence for it. Spindle off at a stop point where nothing is queued sends M5/M9 alone.
      if (request.intent === 'feedhold' && !('release' in request) && onJobPause(t, at)) {
        t.decide(intent, matrix);
        return;
      }
      const atStopPoint = t.s.job !== null && (t.s.job.phase === 'toolChange' || t.s.job.phase === 'breakpoint' || t.s.job.phase === 'programStop') && t.s.motion === null;
      if (request.intent !== 'feedhold' && !(request.intent === 'spindleOffNow' && atStopPoint) && onJobStop(t, at)) {
        t.decide(intent, matrix);
        return;
      }
      // Probe Z (SAFETY §4.5c): Pause is `!` (it ends the probe), Stop job and Spindle off are ^D.
      // A motion session (Phase 2, SAFETY §4.4): Pause holds this session's motion, Stop job runs the
      // flush sequence, Spindle off sends M5/M9 when idle. A hold jog's release lands here too.
      if (onProbeStop(t, request, at) || onMotionStop(t, request, at)) {
        t.decide(intent, matrix);
        return;
      }
      if ('release' in request) {
        t.decide(intent, matrix); // no hold jog to release: nothing to send
        return;
      }
      // Phase 1 (and every READ_ONLY session): the only stop is `!`, with "Use your E-stop" for Stop
      // job and Spindle off (SAFETY §4.4). Never ^D, `%` or an M-code.
      writeFeedhold(t);
      t.set({ notices: { ...t.s.notices, pauseRequestedAt: at, adviseEstop: t.s.notices.adviseEstop || request.intent !== 'feedhold' } });
      t.decide(intent, matrix);
      return;
    }
    case 'ackFault':
      onAckFault(t, matrix);
      return;
    case 'acknowledgeLost':
      resetToNotConnected(t, true);
      t.decide(intent, matrix);
      return;
    case 'enq':
      onEnq(t, matrix);
      return;
    case 'read':
      onRead(t, request.tokens, matrix);
      return;
    case 'jog':
    case 'goToZero':
    case 'setWorkZero':
    case 'home':
    case 'setMachinePosition':
    case 'tempOffset':
    case 'selectCoordSystem':
    case 'spindleOn':
    case 'clearAlarm':
    case 'resume':
    case 'positionVerify':
    case 'typedMove':
      // Reached only when the release allows motion (the matrix denied it above otherwise), except
      // positionVerify, a session intent: the motion layer refuses it without a motion release.
      // Never while a settings write is being made: its gate, write and read-back own the link until it ends.
      if (settingWriteActive(t.s)) {
        t.decide(intent, deny('A setting is being written.', 'Wait for the write and its read-back to finish.', 'SAFETY §4.6 (amendment 2026-11-02)'));
        return;
      }
      // Phase 3: a job owns the machine. Resume goes to the job; at a tool change only a jog and the Z re-zero.
      if (request.intent === 'resume' && jobActive(t.s) && t.s.motion === null) {
        t.decide(intent, onJobResume(t, request, at));
        return;
      }
      if (t.s.base === 'PROGRAM_PAUSED' && t.s.job?.phase !== 'toolChange') {
        t.decide(intent, deny('Only Resume and Stop job are offered at this stop.', 'Resume the job, or stop it.', 'SAFETY §4.4a'));
        return;
      }
      /* c8 ignore next 4 -- defence in depth: the matrix allows no motion intent but Resume in RUNNING, HELD or PREAMBLE */
      if (jobActive(t.s) && t.s.base !== 'PROGRAM_PAUSED' && request.intent !== 'resume') {
        t.decide(intent, deny('A job is running.', 'Pause or stop the job first.', 'SAFETY §4.4a'));
        return;
      }
      // H91: a typed move is a motion of the motion layer, started by its own module (typedMove.ts).
      t.decide(intent, request.intent === 'typedMove' ? startTypedMove(t, request, at) : onMotionIntent(t, request, at));
      return;
    case 'loadJob':
      t.decide(intent, onLoadJob(t, request, at));
      return;
    case 'startJob':
      t.decide(intent, onStartJob(t, request, at));
      return;
    case 'jobBreakpoints':
      t.decide(intent, onJobBreakpoints(t, request.lines, at));
      return;
    case 'settingsWrite':
      onSettingsWrite(t, request.key, request.value, matrix);
      return;
    case 'flash':
      onFlash(t, matrix);
      return;
    case 'probeZ':
    case 'probeZClose':
      t.decide(intent, onProbeIntent(t, request, at));
      return;
    default:
      t.decide(intent, deny(PHASE_1_NOT_HANDLED.reason, PHASE_1_NOT_HANDLED.remedy, `ROADMAP P1-02 (${t.config.release.name})`));
  }
}

function onEnq(t: Tx, matrix: Decision): void {
  if (t.s.enqOutstanding) {
    t.decide('enq', deny('A liveness probe is already outstanding.', 'Wait for its answer.', 'SAFETY §4.2 (at most one ENQ outstanding)'));
    return;
  }
  const byte = enqByte(t.s);
  if (byte === undefined) {
    t.decide('enq', deny('ENQ is sent only to classified edge-next after a revision 2 or 3 footer.', 'Nothing to do.', 'SAFETY §4.1 Liveness probe row; T-S24b; PN §2.3'));
    return;
  }
  writeEnq(t, byte);
  t.decide('enq', matrix);
}

function writeEnq(t: Tx, byte: number): void {
  t.set({ enqOutstanding: true, sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name: 'enq', byte });
}

function onRead(t: Tx, tokens: readonly string[], matrix: Decision): void {
  const dialect = dialectOf(t.s);
  if (t.s.base === 'BLOCKED') {
    t.decide('read', deny('This board is not the machine you selected, so nothing is sent to it.', 'Choose the right machine, or disconnect.', 'T-S21; SAFETY §3 BLOCKED'));
    return;
  }
  if (dialect === null || t.s.base === 'IDENTIFYING') {
    t.decide('read', deny('Reads are sent only once the board is classified and its read allowlist is known.', 'Wait for the board to be identified.', 'SAFETY H37; PN §12.3'));
    return;
  }
  if (!Array.isArray(tokens) || tokens.length === 0) {
    t.decide('read', deny('Nothing to read.', 'Name at least one setting.', 'SAFETY H37'));
    return;
  }
  const refused = tokens.filter((tok) => typeof tok !== 'string' || !isReadAllowed(dialect.id, tok));
  if (refused.length > 0) {
    const shown = refused.slice(0, 5).map((r) => JSON.stringify(typeof r === 'string' ? r.slice(0, 16) : String(r)));
    t.decide('read', deny(`Not on the ${dialect.id} read allowlist: ${shown.join(', ')}.`, 'Only allowlisted settings can be read.', 'SAFETY H37; PN §12.3; T-S38'));
    return;
  }
  const fresh = [...new Set(tokens)].filter((tok) => !t.s.queue.some((q) => q.token === tok && q.purpose === 'request'));
  if (t.s.queue.length + fresh.length > MAX_QUEUED_READS) {
    t.decide('read', deny('Too many reads are waiting.', 'Wait for the current reads to finish.', 'ROADMAP P1-02'));
    return;
  }
  t.set({ queue: [...t.s.queue, ...fresh.map((token) => ({ token, purpose: 'request' as const }))] });
  t.decide('read', matrix);
}

// --- Settings writes (SAFETY §4.6, H57-H63, amendment 2026-11-02) -----------

/** True while a settings write has not finished. */
export function settingWriteActive(s: SessionState): boolean {
  return s.settingWrite !== null && s.settingWrite.phase !== 'done';
}

function onSettingsWrite(t: Tx, key: unknown, value: unknown, matrix: Decision): void {
  const dialect = dialectOf(t.s);
  /* c8 ignore next 4 -- defence in depth: an unclassified or read-only board carries READ_ONLY, which the matrix denies first */
  if (dialect === null || t.s.classification?.mode !== 'full') {
    t.decide('settingsWrite', deny('Settings are written only to an approved, identified board.', 'Connect a board running approved firmware.', 'SAFETY §4.6; P1-03'));
    return;
  }
  /* c8 ignore next 4 -- defence in depth: a move in progress has a motion base, which the settings row already denies */
  if (t.s.motion !== null) {
    t.decide('settingsWrite', deny('A move is in progress. Settings are written only while the machine is idle.', 'Wait for the move to finish.', 'SAFETY §4.6; §4.5b'));
    return;
  }
  if (settingWriteActive(t.s)) {
    t.decide('settingsWrite', deny('One setting at a time: the last write has not finished.', 'Wait for its answer and read-back.', 'SAFETY §4.6 step 6; firmware maintainer 2026-11-02 (one token at a time)'));
    return;
  }
  if (typeof key !== 'string') {
    t.decide('settingsWrite', deny('Name one setting.', 'Name one setting.', 'SAFETY §4.6'));
    return;
  }
  const refusal = settingRefusal(dialect.id, key, value, t.s.values);
  if (refusal !== null) {
    t.decide('settingsWrite', deny(`Not written: ${refusal}`, 'Correct the value and try again.', 'SAFETY §4.6; PN §12.4 (forbidden writes); schema overlay'));
    return;
  }
  const holdTrusted = restingUsesHold(dialect);
  const tokens = gateTokens(dialect, holdTrusted);
  const id = (t.s.settingWrite?.id ?? 0) + 1;
  t.set({
    settingWrite: { id, key, value: value as number, phase: 'gate', gate: {} },
    queue: [...tokens.map((token) => ({ token, purpose: 'gate' as const })), ...t.s.queue],
  });
  t.emit({ kind: 'log', text: `settings write #${id}: ${key} = ${String(value)} (gate: ${tokens.join(' ')})` });
  t.decide('settingsWrite', matrix);
}

function finishSettingWrite(t: Tx, outcome: SettingWriteOutcome, detail: string, patch: Partial<SettingWriteState> = {}): void {
  const w = t.s.settingWrite;
  /* c8 ignore next -- callers finish only a write in progress; kept so a second finish can never overwrite the first */
  if (w === null || w.phase === 'done') return;
  t.set({
    settingWrite: { ...w, ...patch, phase: 'done', outcome, detail },
    queue: t.s.queue.filter((q) => q.purpose !== 'gate' && q.purpose !== 'setting' && q.purpose !== 'readback'),
  });
  t.emit({ kind: 'log', text: `settings write #${w.id}: ${w.key} → ${outcome}${detail === '' ? '' : ` (${detail})`}` });
}

function onGateAnswer(t: Tx, token: string, r: Response): void {
  const w = t.s.settingWrite;
  /* c8 ignore next -- gate reads are queued only by a write in its gate phase, and dropped when it ends */
  if (w === null || w.phase !== 'gate') return;
  const value = r.r[token];
  if (r.footer.status !== 0 || typeof value !== 'number' || !Number.isFinite(value)) {
    finishSettingWrite(t, 'refused', `Not written: the board did not answer the ${token} read (status ${r.footer.status}).`);
    return;
  }
  const gate = { ...w.gate, [token]: value };
  t.set({ settingWrite: { ...w, gate }, live: withNumber(t, t.s.live, token, value) });
  if (t.s.queue.some((q) => q.purpose === 'gate')) return;
  const dialect = dialectOf(t.s) as Dialect;
  const verdict = judgeGate(dialect, gate, restingUsesHold(dialect));
  if (!verdict.ok) {
    finishSettingWrite(t, 'refused', verdict.detail);
    return;
  }
  // The state may have changed while the gate was read (an overlay, a status report): ask the matrix again.
  const again = allowed(matrixSnapshot(t.s), 'settingsWrite', t.config.release);
  /* c8 ignore next 4 -- an overlay that denies writes (FAULT, LOST) also ends the write before the gate completes; the re-check stays */
  if (!again.allowed) {
    finishSettingWrite(t, 'refused', `Not written: ${again.reason}`);
    return;
  }
  t.set({ settingWrite: { ...(t.s.settingWrite as SettingWriteState), phase: 'writing' }, queue: [{ token: w.key, purpose: 'setting', value: w.value }, ...t.s.queue] });
}

function onSettingAnswer(t: Tx, r: Response): void {
  const w = t.s.settingWrite;
  /* c8 ignore next -- a setting line is written only in the writing phase */
  if (w === null || w.phase !== 'writing') return;
  const echoed = readBackValue(r.r, w.key);
  if (w.exception !== undefined && r.footer.status === 0) {
    // TG answers 0 after an `er` 9 although nothing was saved (TG-SETTINGS-GATE): the `er` decides.
    finishSettingWrite(t, 'rejected', `The board refused to save the setting (status ${w.exception}: a cycle was active); it may hold the value until a reset.`, { answer: { status: 0, value: echoed } });
    return;
  }
  if (r.footer.status !== 0) {
    const inJob = r.footer.status === TINYG_SETTING_REFUSED_IN_CYCLE && t.s.dialect?.id === 'tinyg-en';
    const text = inJob ? 'The board refused the write: a job is running or has moves queued (status 117). Nothing changed; set it when the machine is idle.' : `The board refused the write (status ${r.footer.status}); the setting was not stored.`;
    finishSettingWrite(t, 'rejected', text, { answer: { status: r.footer.status, value: echoed } });
    return;
  }
  t.set({ settingWrite: { ...w, phase: 'readback', answer: { status: 0, value: echoed } }, queue: [{ token: w.key, purpose: 'readback' }, ...t.s.queue] });
}

function onReadBackAnswer(t: Tx, r: Response, at: number): void {
  const w = t.s.settingWrite;
  /* c8 ignore next -- a read-back is queued only in the readback phase */
  if (w === null || w.phase !== 'readback') return;
  const value = readBackValue(r.r, w.key);
  t.set({ values: { ...t.s.values, [w.key]: { value, status: r.footer.status, at } } });
  const dialect = dialectOf(t.s) as Dialect;
  if (r.footer.status === 0 && readBackMatches(dialect.id, w.key, w.value, value)) {
    finishSettingWrite(t, 'verified', '', { readBack: value });
    return;
  }
  const shown = r.footer.status !== 0 ? `the read-back failed (status ${r.footer.status})` : `the board reads back ${JSON.stringify(value)}, not ${w.value}`;
  finishSettingWrite(t, 'mismatch', `Written, but ${shown}.`, { readBack: value });
}

/** A settings write in progress is cut off (FAULT, LOST, reset, link change). */
function interruptSettingWrite(t: Tx, why: string): void {
  interruptBootEntry(t, why);
  if (!settingWriteActive(t.s)) return;
  const w = t.s.settingWrite as SettingWriteState;
  // A write already sent may have been stored: say so.
  const outcome: SettingWriteOutcome = w.phase === 'gate' ? 'refused' : 'interrupted';
  finishSettingWrite(t, outcome, outcome === 'refused' ? `Not written: ${why}.` : `Interrupted: ${why}. The board may or may not hold the new value; read it back before trusting it.`);
}

// --- The firmware update: into the bootloader (SAFETY §4.8 as amended 2026-11-03, H79-H88) -------

/** The TinyG dialects whose firmware takes `{"boot":1}` (EN `hw_run_boot`; TG and stock 449 the same token). */
const BOOT_DIALECTS: readonly string[] = ['tinyg-en', 'tinyg-440', 'tinyg-449-stock'];

/** The exact line that asks the running firmware to reset into its bootloader. Written only by `flash`. */
export const BOOT_LINE = '{"boot":1}';

function refuseBoot(t: Tx, why: string): void {
  t.set({ bootEntry: null, queue: t.s.queue.filter((q) => q.purpose !== 'bootGate' && q.purpose !== 'boot'), notices: { ...t.s.notices, bootRefused: why } });
  t.emit({ kind: 'log', text: `bootloader entry refused: ${why}` });
}

/**
 * `flash`: the idle gate (polled `stat`, `hold` where trusted, `vel`, `qr`), then `{"boot":1}`. The firmware
 * answers, then resets into xboot (a 60 s window); the session closes the link as soon as the line is written
 * and returns to NOT_CONNECTED, so the flasher can open the same port in bootloader role. Allowed by the matrix
 * row of kind `flash` (the flasher phase switch); the session also needs a classified TinyG dialect, no job, no
 * move and no settings write in progress.
 */
function onFlash(t: Tx, matrix: Decision): void {
  const dialect = dialectOf(t.s);
  if (dialect === null || !BOOT_DIALECTS.includes(dialect.id)) {
    t.decide('flash', deny('This board was not identified as a TinyG, so run does not ask it to enter its bootloader.', 'Use recovery: unplug the USB cable and plug it back in while run waits for the bootloader.', 'SAFETY §4.8 (amended 2026-11-03); OLD-S §4.8 step 1'));
    return;
  }
  if (t.s.bootEntry !== null) {
    t.decide('flash', deny('The board is already being asked to enter its bootloader.', 'Wait for it.', 'SAFETY §4.8'));
    return;
  }
  if (settingWriteActive(t.s) || t.s.motion !== null || t.s.job !== null) {
    t.decide('flash', deny('Something else is in progress: a move, a job or a settings write.', 'Wait for it to finish, and unload the job.', 'SAFETY §4.1 Flash row; §4.8'));
    return;
  }
  const tokens = gateTokens(dialect, restingUsesHold(dialect)).filter((tok) => tok !== 'unit');
  const { bootRefused: _old, ...notices } = t.s.notices;
  t.set({ bootEntry: { phase: 'gate', gate: {} }, notices, queue: [...tokens.map((token) => ({ token, purpose: 'bootGate' as const })), ...t.s.queue] });
  t.emit({ kind: 'log', text: `bootloader entry: idle gate (${tokens.join(' ')})` });
  t.decide('flash', matrix);
}

function onBootGateAnswer(t: Tx, token: string, r: Response): void {
  const b = t.s.bootEntry;
  /* c8 ignore next -- gate reads are queued only by an entry in its gate phase, and dropped when it ends */
  if (b === null || b.phase !== 'gate') return;
  const value = r.r[token];
  if (r.footer.status !== 0 || typeof value !== 'number' || !Number.isFinite(value)) {
    refuseBoot(t, `the board did not answer the ${token} read (status ${r.footer.status})`);
    return;
  }
  const gate = { ...b.gate, [token]: value };
  t.set({ bootEntry: { ...b, gate }, live: withNumber(t, t.s.live, token, value) });
  if (t.s.queue.some((q) => q.purpose === 'bootGate')) return;
  const dialect = dialectOf(t.s) as Dialect;
  // The settings gate's rule without the units (the bootloader does not care whether the board works in inches).
  const verdict = judgeGate(dialect, { ...gate, unit: 1 }, restingUsesHold(dialect));
  if (!verdict.ok) {
    refuseBoot(t, verdict.detail.replace('Not written: ', '').replace(', with nothing queued and in millimetres', ', with nothing queued'));
    return;
  }
  const again = allowed(matrixSnapshot(t.s), 'flash', t.config.release);
  /* c8 ignore next 4 -- an overlay that denies the entry (FAULT, LOST) also ends it before the gate completes; the re-check stays */
  if (!again.allowed) {
    refuseBoot(t, again.reason);
    return;
  }
  t.set({ bootEntry: { phase: 'writing', gate }, queue: [{ token: 'boot', purpose: 'boot' }, ...t.s.queue] });
}

/** `{"boot":1}` was written: the board resets now. Close the link and leave the port to the flasher. */
function onBootWritten(t: Tx, at: number): void {
  const port = t.s.port as PortSelector;
  const boardId = typeof t.s.identity?.id === 'string' ? t.s.identity.id : null;
  t.emit({ kind: 'log', text: 'bootloader entry: {"boot":1} written; the board resets into its bootloader; the link closes' });
  t.emit({ kind: 'close', epoch: t.s.epoch });
  // The board resets: position, homing and every RAM setting are gone. The next connect starts in UNKNOWN.
  resetToNotConnected(t, true);
  t.set({ notices: { ...t.s.notices, bootloaderEntered: { at, port, boardId } } });
}

/** An entry in progress is cut off (FAULT, LOST, reset). */
function interruptBootEntry(t: Tx, why: string): void {
  if (t.s.bootEntry === null) return;
  refuseBoot(t, why);
}

function onAckFault(t: Tx, matrix: Decision): void {
  const dialect = dialectOf(t.s);
  if (t.s.ackVerify !== null) {
    t.decide('ackFault', deny('The fault is already being verified.', 'Wait for the verification to finish.', 'SAFETY §3 FAULT exits'));
    return;
  }
  if (dialect === null || !VERIFY_TOKENS.every((tok) => isReadAllowed(dialect.id, tok))) {
    t.decide(
      'ackFault',
      deny(
        'This board is not classified, so the session cannot verify that it has stopped and emptied its planner.',
        'Check the machine is stopped, then disconnect and connect again.',
        'SAFETY §3 FAULT exits (ackFault cannot complete while hold ≠ 0 or the planner is not empty)',
      ),
    );
    return;
  }
  const { ackFaultRefused: _dropped, ...notices } = t.s.notices;
  t.set({ ackVerify: { round: 0 }, notices, queue: [...VERIFY_TOKENS.map((token) => ({ token, purpose: 'verify' as const })), ...t.s.queue] });
  t.decide('ackFault', matrix);
}

function writeFeedhold(t: Tx): void {
  const byte = dialectOf(t.s)?.realtime.feedhold.byte ?? BYTE.FEEDHOLD;
  t.set({ sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name: 'feedhold', byte });
}

/** Back to NOT_CONNECTED on a new epoch (late events of the old link are ignored). */
function resetToNotConnected(t: Tx, unknownOnNextConnect: boolean): void {
  t.cancelAll();
  t.s = { ...initialState(), epoch: t.s.epoch + 1, unknownOnNextConnect, timerSeq: t.s.timerSeq, notices: { adviseEstop: false }, probeZ: probeCarried(t.s.probeZ) };
}

// --- Link events ----------------------------------------------------------

function onOpened(t: Tx): void {
  const timings = t.config.timings;
  t.set({ base: 'IDENTIFYING', link: { heartbeatMs: null, silenceMs: timings.livenessIdleMs + timings.staleAfterMs } });
  if (t.s.unknownOnNextConnect) {
    t.addOverlay('UNKNOWN');
    t.set({ unknownOnNextConnect: false });
  }
  startProbe(t, 0, undefined);
}

/** (Re)starts the probe from `{sr:null}`: the first line written on every connect path (T-S86, H49). */
function startProbe(t: Tx, restarts: number, banner: Banner | undefined, normalized = false): void {
  t.set({
    probe: { next: 0, answers: [], banner, spliceRetried: false, settling: 'none', restarts, backlog: 0, normalized, normalizing: false },
    classification: null,
    dialect: null,
    identity: null,
    ready: false,
    footerRev: undefined,
    queue: [{ token: 'sr', purpose: 'splice' }],
    reports: REPORTS_IDLE,
    link: { heartbeatMs: null, silenceMs: t.config.timings.livenessIdleMs + t.config.timings.staleAfterMs },
  });
}

function onLineWritten(t: Tx, at: number): void {
  const { seq: _seq, ...line } = t.s.writing as PendingRead & { readonly seq: number };
  t.set({ writing: null });
  if (line.purpose === 'boot') {
    onBootWritten(t, at);
    return;
  }
  // A line written while the board was resetting is lost with its RX ring: expect nothing for it.
  if (t.s.probe !== null && t.s.probe.settling !== 'none') return;
  t.set({ expected: [...t.s.expected, { ...line, late: false }] });
  t.arm('answer', answerTimeout(t, line.purpose));
}

function answerTimeout(t: Tx, purpose: ReadPurpose): number {
  const timings = t.config.timings;
  if (purpose === 'splice') return timings.firstAnswerMs;
  if (purpose === 'probe') return timings.probeAnswerMs;
  return timings.readAnswerMs;
}

function onLinkLost(t: Tx, at: number): void {
  interruptSettingWrite(t, 'the connection was lost');
  onJobLinkLost(t, at);
  abandonLoad(t, at, 'the connection was lost');
  abandonMotion(t);
  abandonProbe(t, 'lost', at);
  t.cancelAll();
  t.addOverlay('LOST');
  t.set({ queue: [], expected: [], writing: null, ackVerify: null, xoff: false, enqOutstanding: false, liveness: null, unknownOnNextConnect: true });
  t.emit({ kind: 'close', epoch: t.s.epoch });
}

function onTimer(t: Tx, id: TimerId, at: number): void {
  if (id === 'settle') {
    const probe = t.s.probe;
    if (probe === null || probe.settling === 'none') return;
    if (probe.restarts >= MAX_PROBE_RESTARTS) {
      t.set({ probe: { ...probe, settling: 'none' } });
      enterFault(t, 'resetLoop', 'integrity', `the board reset ${probe.restarts + 1} times while it was being identified`, at);
      return;
    }
    startProbe(t, probe.restarts + 1, probe.banner, probe.normalized);
    return;
  }
  if (id === 'watchdog') {
    onWatchdog(t, at);
    return;
  }
  if (id === 'motion') {
    onMotionTimer(t, MOTION_DEPS, at);
    return;
  }
  if (id === 'job') {
    onJobTimer(t, JOB_DEPS, at);
    return;
  }
  if (id === 'probe') {
    onProbeTimer(t, at);
    return;
  }
  if (id === 'verify') {
    if (t.s.ackVerify?.round === 1) t.set({ queue: [...VERIFY_TOKENS.map((token) => ({ token, purpose: 'verify' as const })), ...t.s.queue] });
    return;
  }
  // 'answer': the line in flight went unanswered. Job lines have no answer timer: in line mode a line can wait in
  // the board's buffer for as long as the planner is full, and liveness comes from reports (SAFETY §4.2, H76).
  const index = t.s.expected.findIndex((e) => !e.late && e.purpose !== 'job');
  if (index < 0) return;
  const missed = t.s.expected[index] as Expected;
  t.set({ expected: t.s.expected.map((e, i) => (i === index ? { ...e, late: true } : e)) });
  if (missed.purpose === 'splice' || missed.purpose === 'probe') {
    // A busy or silent board (PN §2.3 step 0): only stop-class bytes from now on.
    t.addOverlay('ORPHANED_MOTION');
    t.set({ queue: [] });
    return;
  }
  if (missed.purpose === 'gate') finishSettingWrite(t, 'refused', `Not written: the board did not answer the ${missed.token} read in time.`);
  if (missed.purpose === 'bootGate') refuseBoot(t, `the board did not answer the ${missed.token} read in time`);
  if (missed.purpose === 'setting') finishSettingWrite(t, 'unconfirmed', 'The board did not answer the write in time. It may or may not hold the new value; read it back before trusting it.');
  if (missed.purpose === 'readback') finishSettingWrite(t, 'mismatch', 'Written (status 0), but the read-back was not answered in time.');
  if (missed.purpose === 'jobPrep') abandonLoad(t, at, `the controller did not answer the ${missed.token} read in time`);
  if (missed.purpose === 'lineMode') onLineModeAnswer(t, null, at);
  // A tool change's M5/M9 or a resume step unanswered: the job layer fails closed (independent review 2026-11-03, R6).
  if (missed.purpose === 'motion') onJobMotionTimeout(t, missed.line, at);
  if (missed.intent === 'alarmRestore') onAlarmRestoreMissed(t);
  if (missed.purpose === 'probeZ') onProbeMissed(t, missed);
  if (missed.purpose === 'seed' || missed.purpose === 'report' || t.s.reports.phase === 'seeding' || t.s.reports.phase === 'configuring') {
    failReports(t, `the board did not answer the ${missed.token} read in time`);
  }
  enterStale(t, at);
  const pendingReading = t.s.queue.some((q) => q.purpose === 'reading') || missed.purpose === 'reading';
  t.set({ queue: [] });
  if (missed.purpose === 'verify' || t.s.ackVerify !== null) {
    t.set({ ackVerify: null, notices: { ...t.s.notices, ackFaultRefused: `no answer to the ${missed.token} read` } });
  }
  if (t.s.base === 'READING' && pendingReading) finishReading(t);
}

// --- Inbound --------------------------------------------------------------

function onInbound(t: Tx, raw: Inbound, at: number): void {
  if (raw.kind === 'FlowSignal') {
    t.set({ xoff: raw.signal === 'xoff' });
    return;
  }
  // Receive-timestamp liveness (SAFETY §4.2): any line is proof of life.
  t.set({ live: { ...t.s.live, lastRxAt: at }, liveness: null, stale: null });
  t.removeOverlay('STALE');
  if (t.s.timers.watchdog !== undefined) t.arm('watchdog', watchdogMs(t));
  const dialect = dialectOf(t.s);
  const event: ClassifiedLine = dialect === null ? raw : checkFooterForDialect(dialect, raw);
  // Before the first answer on this link, a line is output a previous program left unread: pushed reports and
  // heartbeats (the board keeps sending them to a port nobody drains), and fragments of them torn by the USB and
  // tty buffers (bench 2, 2026-11-03). The board answers in order, so that backlog ends at the first `r` frame:
  // it is counted and discarded, never merged into the live view and never taken for a damaged answer (H49
  // amendment 2026-11-03). A banner still means the board reset.
  const probe = t.s.probe;
  // A status 118 (TinyG 450.02, settings run on their defaults) follows the banner, so it is in that output after a
  // reset; it is true whenever it was printed, so it is kept, not discarded (handled under Exception).
  const defaulted = event.kind === 'Exception' && event.st === TINYG_SETTINGS_DEFAULTED;
  if (probe !== null && probe.settling === 'none' && probe.next === 0 && !probe.spliceRetried && !t.s.ready && event.kind !== 'Banner' && event.kind !== 'Response' && !defaulted) {
    // A torn frame of that output can run straight into the answer (bench 3, 2026-11-04: half a heartbeat, then
    // the reply to {sr:null} on the same line). The answer is a complete frame at the line's end: take it.
    const from = event.kind === 'Garbled' ? event.line.lastIndexOf('{"r":') : -1;
    const answer = from > 0 ? classifyLine(event.line.slice(from)) : null;
    t.set({ probe: { ...probe, backlog: probe.backlog + 1 } });
    if (answer !== null && answer.kind === 'Response') onResponse(t, answer, at);
    return;
  }
  switch (event.kind) {
    case 'Banner':
      onBanner(t, event, at);
      return;
    case 'Response':
      onResponse(t, event, at);
      return;
    case 'StatusReport':
      onStatusReport(t, event, at);
      return;
    case 'Heartbeat':
      // Proof of life (recorded above). Its stat and hold are what the board reported: kept for display.
      mergeLive(t, Object.fromEntries(Object.entries(event.hb).filter(([k]) => k === 'stat' || k === 'hold')));
      return;
    // Edge-next feed-limit push lines (fs, fl): proof of life (recorded above). They answer nothing, are never an
    // acknowledgement and never a report of motion, so they touch no owed answer, no ENQ and no ORPHANED_MOTION
    // check, in any state. During a job that opened a feed-limit window they feed its display (observational, H78);
    // otherwise nothing reads them (another host may have turned the push on: RAM, kept until a reset).
    case 'FeedLimitSummary':
      onFeedLimit(t, 'fs', event.fs, event.totalsShort);
      return;
    case 'FeedGapSummary':
      onFeedLimit(t, 'fg', event.fg, false);
      return;
    case 'FeedLimitEvent':
      onFeedLimit(t, 'fl', event.fl, false);
      return;
    case 'QueueReport':
      t.set({ live: { ...t.s.live, qr: event.qr } });
      return;
    case 'Exception':
      // TinyG 450.02+ (N61): settings that would not load run on their defaults, reported once right after the
      // banner, so it can arrive while the board is identified again: checked first. The board is working and the
      // user is told which settings changed. Status 90 (a setting with no valid value) and any other `er` stay FAULT.
      if (event.st === TINYG_SETTINGS_DEFAULTED && (t.s.dialect === null || t.s.dialect.id === 'tinyg-en')) {
        t.set({ notices: { ...t.s.notices, settingsDefaulted: { text: event.msg.slice(0, 200), at } } });
        t.emit({ kind: 'log', text: `the board reset stored settings to their defaults (status 118): ${event.msg.slice(0, 120)}` });
        return;
      }
      // An `er` answering the first line is the spliced fragment being rejected (PN §2.3 step 0): recorded only.
      if (t.s.probe !== null && t.s.probe.next === 0 && !t.s.ready) return;
      // A settings write refused because a cycle is active: EN prints an `er` with 106, TG answers 9
      // (SAFETY §4.6 step 6, HIL-4.2). It is a refusal of this write, answered by its own response, not a FAULT.
      if (t.s.settingWrite?.phase === 'writing' && (event.st === 106 || event.st === 9)) {
        t.set({ settingWrite: { ...t.s.settingWrite, exception: event.st } });
        t.emit({ kind: 'log', text: `settings write #${t.s.settingWrite.id}: the board reported ${event.st} (a cycle was active): refused` });
        return;
      }
      // Probe Z: the alarm a probe ends in (250, 220, 203, 207) is its outcome; the owner clears it (C13).
      if (onProbeAlarm(t, event, at)) return;
      enterFault(t, 'exceptionReport', 'integrity', `the board reported an exception (status ${event.st}): ${event.msg.slice(0, 80)}`, at);
      return;
    case 'ProbeReport':
      onProbeReport(t, event, at);
      return;
    case 'Ack':
      t.set({ enqOutstanding: false, lastAckAt: at });
      return;
    case 'Garbled':
      onGarbled(t, at);
      return;
    case 'RxReport':
    case 'Text':
      return;
  }
}

function onBanner(t: Tx, banner: Banner, at: number): void {
  interruptSettingWrite(t, 'the board reset');
  // The board restarted: it boots in XON and never says so (@cite EN xio/xio_usart.c:128-130).
  // An ENQ written before the reset was either answered before the banner (lines arrive in order) or
  // lost with the RX ring, so no `ack` is still owed.
  t.set({ xoff: false, enqOutstanding: false });
  if (t.s.ready) {
    // SAFETY H19, T-S10: any banner after Ready means the board reset. FAULT, then UNKNOWN. A job is over (H72).
    // The reset also ended whatever motion was queued or held: ORPHANED_MOTION is over (its documented exit, §3).
    t.removeOverlay('ORPHANED_MOTION');
    onJobReset(t, at);
    abandonLoad(t, at, 'the controller reset');
    enterFault(t, 'bannerAfterReady', 'integrity', `the board printed a boot banner (${banner.shape}) after it was ready: it reset`, at);
    t.addOverlay('UNKNOWN');
    return;
  }
  // Not ready means IDENTIFYING with a probe running (ready is cleared only when a probe starts).
  const probe = t.s.probe as ProbeProgress;
  // The board is booting while it is being identified: every line sent before the reset is lost with its RX ring.
  if (t.s.overlays.includes('ORPHANED_MOTION') && t.s.classification === null) {
    // The reset ended whatever motion was running (SAFETY §3 ORPHANED_MOTION exits); the position is gone.
    t.removeOverlay('ORPHANED_MOTION');
    t.addOverlay('UNKNOWN');
  }
  t.cancel('answer');
  const isReady = banner.ready !== false;
  t.set({ queue: [], expected: [], probe: { ...probe, banner, settling: isReady ? 'ready' : 'boot' } });
  t.arm('settle', isReady ? t.config.timings.bannerSettleMs : t.config.timings.bannerWaitMs);
}

function onResponse(t: Tx, r: Response, at: number): void {
  if (t.s.probe !== null && t.s.probe.settling !== 'none') return; // answers a line from before the reset
  if (t.s.footerRev === undefined) {
    t.set({ footerRev: r.footer.rev });
  } else if (r.footer.rev !== t.s.footerRev) {
    // H77: the answer to the line-mode write carries the new footer (revision 3 in line mode, 2 in character mode).
    const expect = t.s.rxm.footerExpect;
    if (expect === null || r.footer.rev !== expect || t.s.rxm.step?.kind !== 'write') {
      enterFault(t, 'footerRevisionChanged', 'integrity', `the footer revision changed from ${t.s.footerRev} to ${r.footer.rev}: the board was reset or reconfigured`, at);
      return;
    }
    t.set({ footerRev: r.footer.rev, rxm: { ...t.s.rxm, footerExpect: null } });
    t.emit({ kind: 'log', text: `line mode: the footer is now revision ${r.footer.rev}` });
  }
  // Line mode (H76): f[2] is the free line slots, in every answer.
  if (r.footer.rev === 3 && t.s.job !== null) patchJob(t, { free: r.footer.field3 });
  // The board answers lines in order; in line mode it serves control lines (`{...}`) before data lines (G-code),
  // so the answers come as two queues, each in order: data answers (no key but `gc`) match the oldest data line,
  // the rest the oldest control line. Late (timed-out) entries ahead of the match in its queue are lost. The line
  // being written comes last: its answer can arrive before the transport reports the write complete.
  const owed = owedAnswers(t.s);
  // A data answer: `r` empty, or the firmware's echo of the line (`gc` at jv 5, and `n` for an N-numbered line at jv 4
  // or more), which run accepts as it comes (independent review 2026-11-03, R7).
  const data = Object.keys(r.r).every((k) => k === 'gc' || k === 'n') && owed.some(isDataEntry);
  let index = -1;
  for (let i = 0; i < owed.length; i++) {
    const e = owed[i] as Expected;
    if (e.purpose !== 'splice' && isDataEntry(e) !== data) continue;
    if (answers(e, r)) {
      index = i;
      break;
    }
    if (!e.late) break;
  }
  if (index < 0 || r.tid !== undefined) {
    // No tid is ever sent in Phase 1, so an echoed one answers a request this session never made (SAFETY §3).
    enterFault(t, 'unexpectedResponse', 'integrity', `a response nobody asked for: ${r.line.slice(0, 80)}`, at);
    return;
  }
  const entry = owed[index] as Expected;
  consumeOwed(t, owed, index, data);
  if (entry.late) return;
  if (entry.purpose !== 'job') t.cancel('answer');
  onAnswer(t, entry, r, at);
}

/** A data line (G-code): a job line or a motion line. Control lines are JSON (`{...}`). */
function isDataEntry(e: Expected): boolean {
  return e.purpose === 'job' || ((e.purpose === 'motion' || e.purpose === 'probeZ') && e.token === 'gc');
}

/** Answers the board owes, oldest first: the written lines, then the line being written. */
function owedAnswers(s: SessionState): readonly Expected[] {
  return s.writing === null ? s.expected : [...s.expected, { token: s.writing.token, purpose: s.writing.purpose, late: false }];
}

/** Removes the answered entry and the late entries of its queue before it (the last owed may be the line being written). */
function consumeOwed(t: Tx, owed: readonly Expected[], index: number, data: boolean): void {
  const gone = new Set<number>([index]);
  for (let i = 0; i < index; i++) {
    const e = owed[i] as Expected;
    if (e.purpose === 'splice' || isDataEntry(e) === data) gone.add(i);
  }
  const count = t.s.expected.length;
  t.set({ expected: t.s.expected.filter((_, i) => !gone.has(i)), ...(gone.has(count) ? { writing: null } : {}) });
}

/** Does `r` answer `e`? A GET's answer holds its own key or nothing; the first line accepts any answer (a splice). */
function answers(e: Expected, r: Response): boolean {
  if (e.purpose === 'splice') return true;
  const keys = Object.keys(r.r);
  // A motion line is answered with an empty `r`, or with the line echoed as `gc` (jv ≥ 5), or `clear`.
  if (e.purpose === 'motion' || (e.purpose === 'probeZ' && e.line !== undefined)) return keys.every((k) => k === 'gc' || k === e.token);
  // A job line is G-code too: the same echo shape (`{"r":{"gc":"N1 G21 G90","n":1}}`: `gc` when another sender
  // left jv at 5, `n` for its N word from jv 4); run does not normalise jv (independent review 2026-11-03, R7).
  if (e.purpose === 'job') return keys.every((k) => k === 'gc' || k === 'n');
  return keys.length === 0 || (keys.length === 1 && keys[0] === e.token);
}

function onAnswer(t: Tx, e: PendingRead, r: Response, at: number): void {
  const value: JsonValue | undefined = r.r[e.token];
  switch (e.purpose) {
    case 'splice': {
      let probe = t.s.probe as ProbeProgress;
      if (probe.backlog > 0) {
        t.emit({ kind: 'log', text: `probe: ${probe.backlog} line${probe.backlog === 1 ? '' : 's'} of output left unread by a previous program arrived before the first answer: discarded` });
        probe = { ...probe, backlog: 0 };
        t.set({ probe });
      }
      if (!Object.hasOwn(r.r, 'sr')) {
        // The first line was answered as G-code ({"r":{},"f":[...]}, no `sr` key): a partial line another
        // program left in the board's buffer joined it. Measured on bench 2, 2026-11-02 (PROTOCOL_NOTES
        // §2.3a): rejected when the fragment does not parse, but RUN when it ends in a comment ("G0 X0.5 (rough"
        // on edge-next and 440.21) and, with the quoted form, on 440.21. Nothing tells the two apart
        // safely, so the board may be moving: only stop-class bytes from now on (SAFETY §3).
        t.emit({ kind: 'log', text: `probe: the first line was answered as G-code (no "sr" key, status ${r.footer.status}): a leftover partial line in the board's buffer joined it and may have run → ORPHANED_MOTION` });
        t.addOverlay('ORPHANED_MOTION');
        t.set({ queue: [] });
        return;
      }
      if (r.footer.status === 0) {
        if (isObject(value)) {
          mergeLive(t, value);
          t.set({ live: { ...t.s.live, srList: Object.freeze(Object.keys(value)) } });
        }
        advanceProbe(t, { ...probe, next: 1 });
      } else if (!probe.spliceRetried) {
        // A spliced fragment was rejected: send `{sr:null}` once more before continuing (PN §2.3 step 0).
        t.set({ probe: { ...probe, spliceRetried: true }, queue: [{ token: 'sr', purpose: 'splice' }, ...t.s.queue] });
      } else {
        advanceProbe(t, { ...probe, next: 1 });
      }
      return;
    }
    case 'probe': {
      const probe = t.s.probe as ProbeProgress;
      // OD-14: the first identity GET answered with no value at all (JSON verbosity below 3): the board can be read
      // only after its jv is raised. Write {jv:4} once (persisted; its own reply means the write is done), wait the
      // firmware's 50 ms EEPROM margin, then identify again from the top (TinyG maintainer, 2026-11-04).
      if (e.token === 'fb' && r.footer.status === 0 && Object.keys(r.r).length === 0 && !probe.normalized && t.config.release.reports === true && [1, 3, 4].includes(t.s.live.stat ?? -1)) {
        t.set({ probe: { ...probe, normalized: true, normalizing: true }, queue: [{ token: 'jv', purpose: 'normalize', line: JV_LINE }] });
        t.emit({ kind: 'log', text: 'probe: the board answered with no values (JSON verbosity below 3): Run sets jv to 4 (saved on the board) and identifies it again' });
        return;
      }
      advanceProbe(t, { ...probe, next: probe.next + 1, answers: [...probe.answers, [e.token as ProbeKey, r]] });
      return;
    }
    case 'normalize': {
      const probe = t.s.probe as ProbeProgress;
      if (r.footer.status !== 0) {
        t.emit({ kind: 'log', text: `probe: the board refused {jv:4} (status ${r.footer.status}): it stays unidentified` });
        t.set({ probe: { ...probe, normalizing: false } });
        advanceProbe(t, { ...probe, normalizing: false, next: PROBE_STEPS.length, answers: probe.answers });
        return;
      }
      t.emit({ kind: 'log', text: 'probe: jv is 4 (saved on the board); identifying the board again' });
      t.set({ probe: { ...probe, normalizing: false, settling: 'ready' } });
      t.arm('settle', NORMALIZE_SETTLE_MS);
      return;
    }
    case 'reading':
      if (r.footer.status === 0 && typeof value === 'number' && Number.isFinite(value)) {
        t.set({ live: withNumber(t, t.s.live, e.token, value) });
      }
      if (!t.s.queue.some((q) => q.purpose === 'reading')) finishReading(t);
      return;
    case 'request':
      t.set({ values: { ...t.s.values, [e.token]: { value: value ?? null, status: r.footer.status, at } } });
      noteHomingRead(t, e.token, r.footer.status, value); // S1
      return;
    case 'verify':
      onVerifyAnswer(t, e.token, r.footer.status === 0 && typeof value === 'number' ? value : undefined);
      return;
    case 'liveness':
      // The answer itself is the proof of life (already recorded on receipt); keep the value it carries.
      if (r.footer.status === 0 && typeof value === 'number') t.set({ live: withNumber(t, t.s.live, e.token, value) });
      return;
    case 'poll': {
      const ok = r.footer.status === 0 && typeof value === 'number' && Number.isFinite(value);
      if (ok) t.set({ live: withNumber(t, t.s.live, e.token, value) });
      // The cycle's own record (independent review 2026-11-03, R5): a new one at its first read, each later read
      // added only when answered with status 0; a rejected answer fails the whole cycle. The motion and job layers
      // confirm from this record, never from the live view, and it is dropped once the cycle has been judged.
      if (POLL_TOKENS.includes(e.token)) {
        const cycle = e.token === POLL_TOKENS[0] || t.s.polled === null ? { failed: false } : t.s.polled;
        t.set({ polled: ok ? { ...cycle, [e.token]: value as number } : { ...cycle, failed: true } });
      }
      noteHomingRead(t, e.token, r.footer.status, value); // S1: a home of 0 forgets the axes homed here
      if (e.token === 'home' && (t.s.base === 'IDLE_HOMED' || t.s.base === 'IDLE_UNHOMED')) t.set({ base: idleBase(t.s) });
      if (e.token === 'qr' && checkAlarm(t, at)) {
        onPollDone(t, at);
        onJobPoll(t, at);
        onProbePoll(t, at);
      }
      if (e.token === 'qr') t.set({ polled: null }); // the cycle has been judged: the next starts its own record
      return;
    }
    case 'motion':
      noteModeLine(t, e.line, r.footer.status);
      // OD-19 (S1): the G90 after a Clear alarm, on its own intent, whatever motion started meanwhile.
      if (e.intent === 'alarmRestore') {
        onAlarmRestoreAnswered(t, e.line, r.footer.status, at);
        return;
      }
      if (!onJobMotionAnswer(t, e.line, r.footer.status, at)) onMotionAnswer(t, e.line, r.footer.status, at);
      return;
    case 'job':
      onJobAnswer(t, e, r, at);
      return;
    case 'jobPrep':
      onJobPrepAnswer(t, e, r, at);
      return;
    case 'lineMode':
      onLineModeAnswer(t, r, at);
      return;
    case 'jobRuntime':
      onJobRuntimeAnswer(t, e, r, at);
      return;
    case 'gate':
      onGateAnswer(t, e.token, r);
      return;
    case 'bootGate':
      onBootGateAnswer(t, e.token, r);
      return;
    /* c8 ignore next 2 -- the link closes as soon as {"boot":1} is written, so its answer is never read */
    case 'boot':
      return;
    case 'setting':
      onSettingAnswer(t, r);
      return;
    case 'readback':
      onReadBackAnswer(t, r, at);
      return;
    case 'seed':
      onSeedAnswer(t, e, r, at);
      return;
    case 'report':
      onReportAnswer(t, r, at);
      return;
    case 'probeZ':
      noteModeLine(t, e.line, r.footer.status);
      onProbeAnswer(t, e, r, at);
      return;
    case 'modes':
      onModesAnswer(t, e, r.footer.status === 0 ? r.r[e.token] : undefined);
      return;
  }
}

function advanceProbe(t: Tx, probe: ProbeProgress): void {
  t.set({ probe });
  if (probe.next < PROBE_STEPS.length) {
    if (t.s.overlays.includes('ORPHANED_MOTION')) return;
    const step = PROBE_STEPS[probe.next] as (typeof PROBE_STEPS)[number];
    t.set({ queue: [...t.s.queue, { token: step.key, purpose: 'probe' }] });
    return;
  }
  finishProbe(t);
}

function finishProbe(t: Tx): void {
  const probe = t.s.probe as ProbeProgress;
  const outcome = buildProbeResult({ ...(probe.banner === undefined ? {} : { banner: probe.banner }), answers: new Map(probe.answers) });
  t.set({ ready: true });
  if (!outcome.ok) {
    t.emit({ kind: 'log', text: `probe: could not be read (${outcome.reason} at ${outcome.key}) → unclassified, read-only` });
    t.set({ classification: { dialectId: null, mode: 'readOnly', reason: 'probeFailed', detail: `the probe could not be read (${outcome.reason} at ${outcome.key})`, upgradeOffer: false } });
    t.addOverlay('READ_ONLY');
    t.set({ base: 'CONNECTED_UNKNOWN' });
    checkUnclassifiedResting(t);
    return;
  }
  const result = outcome.result;
  const c = classify(result, t.config.manifest);
  t.emit({ kind: 'log', text: probeRecord(result, c) });
  const identity = Object.fromEntries(
    Object.entries({ fb: result.fb, fv: result.fv, hp: result.hp, hv: result.hv, id: result.id, fbs: result.fbs }).filter(([, v]) => v !== undefined),
  ) as Identity;
  t.set({
    identity,
    dialect: c.dialect,
    classification: {
      dialectId: c.dialect?.id ?? null,
      mode: c.mode,
      reason: c.reason,
      detail: c.detail,
      upgradeOffer: c.upgradeOffer,
      ...(c.buildIdentity === undefined ? {} : { buildIdentity: c.buildIdentity }),
      ...(c.approvalSource === undefined ? {} : { approvalSource: c.approvalSource }),
    },
  });
  if (c.mode === 'readOnly') t.addOverlay('READ_ONLY');
  if (c.dialect !== null) t.emit({ kind: 'tightenLineCap', epoch: t.s.epoch, maxLineBytes: writeLineCapFor(c.dialect) });
  if (t.s.expectedDeviceId !== null && result.id !== t.s.expectedDeviceId) {
    // T-S21: the board is not the selected machine. Nothing more is written.
    t.set({ base: 'BLOCKED', blocked: { expected: t.s.expectedDeviceId, reported: result.id ?? null }, queue: [] });
    return;
  }
  const dialect = c.dialect;
  const tokens = t.config.release.motion ? [...READING_TOKENS, ...MOTION_READING_TOKENS] : READING_TOKENS;
  const reads = dialect === null ? [] : tokens.filter((tok) => isReadAllowed(dialect.id, tok));
  if (reads.length === 0 || t.s.overlays.includes('ORPHANED_MOTION')) {
    t.set({ base: 'CONNECTED_UNKNOWN', reports: { ...REPORTS_IDLE, phase: 'off' } });
    if (dialect === null) checkUnclassifiedResting(t);
    return;
  }
  // Only READING's own answers count: values from the earlier `{sr:null}` answer are dropped, so a
  // read that fails leaves its value unknown and the board is not trusted as resting.
  const { stat: _stat, machineClass: _class, hold: _hold, vel: _vel, qr: _qr, ...kept } = t.s.live;
  t.set({ base: 'READING', live: kept, queue: [...t.s.queue, ...reads.map((token) => ({ token, purpose: 'reading' as const }))] });
}

/** The probe result and its classification as one session-log line (ROADMAP P1-03 "Record the probe result"). */
export function probeRecord(result: ProbeResult, c: Classification): string {
  const { footers, ...rest } = result;
  const verdict = `${c.dialect?.id ?? 'unclassified'} ${c.mode === 'full' ? 'full' : 'read-only'} (${c.reason})`;
  return `probe: ${JSON.stringify({ ...rest, footers: footers.map((f) => f.raw) })} → ${verdict}: ${c.detail}`;
}

/** Raw `stat` values that count as resting without a dialect: READY and PROGRAM_END (SAFETY H14 mitigation 2). */
const UNCLASSIFIED_RESTING_STAT: ReadonlySet<number> = new Set([1, 4]);

/**
 * The probe ended without a dialect (a failed or damaged probe), so READING never runs. The raw
 * values from the `{sr:null}` answer are all there is: a board that is not plainly resting is
 * treated as busy (SAFETY H14 mitigation 5, T-S60), never as merely read-only.
 */
function checkUnclassifiedResting(t: Tx): void {
  const live = t.s.live;
  const busy =
    live.stat === undefined ||
    !UNCLASSIFIED_RESTING_STAT.has(live.stat) ||
    (live.vel !== undefined && live.vel !== 0) ||
    (live.hold !== undefined && live.hold !== 0);
  if (!busy) return;
  t.addOverlay('ORPHANED_MOTION');
  t.set({ queue: [] });
  t.emit({ kind: 'log', text: `probe: unclassified board not resting (stat ${live.stat ?? 'unknown'}, vel ${live.vel ?? 'unknown'}, hold ${live.hold ?? 'unknown'}) → ORPHANED_MOTION` });
}

export { restingUsesHold } from './resting.ts';

/** READING is complete: a board that is not resting is ORPHANED_MOTION (SAFETY H14, PN §2.3 step 0). */
function finishReading(t: Tx): void {
  const dialect = dialectOf(t.s);
  const live = t.s.live;
  const quiet = dialect !== null && (!restingUsesHold(dialect) || live.hold === 0) && live.vel === 0 && live.qr === dialect.limits.plannerBlocks;
  // One rule for "at rest" (SAFETY H14 as amended 2026-11-02): idle or ended, or on edge-next a finished cycle
  // (stat 3 with hold 0), shared with the motion layer (resting.ts).
  const resting = quiet && live.stat !== undefined && restingStat(dialect, live.stat, live.hold);
  const cls = dialect !== null && live.stat !== undefined ? mapStat(dialect, live.stat) : undefined;
  // A motion session (Phase 2): a controller in alarm with nothing moving, held or queued is not motion
  // from elsewhere; it is ALARM, left only by Clear alarm (C13, SAFETY §4.5b).
  const alarmed = t.config.release.motion && quiet && cls !== undefined && ALARM_CLASSES.has(cls);
  if (!resting && !alarmed) t.addOverlay('ORPHANED_MOTION');
  const c = t.s.classification;
  if (c !== null && c.mode === 'full' && (live.ex === undefined || !FULL_SESSION_FLOW_CONTROL.has(live.ex))) {
    const shown = live.ex === undefined ? 'could not be read' : `is ${live.ex}`;
    t.set({ classification: { ...c, mode: 'readOnly', reason: 'flowControl', detail: `${c.detail}; flow control (ex) ${shown}: read-only, Run knows only ex 0, 1 and 2` } });
    t.addOverlay('READ_ONLY');
    t.emit({ kind: 'log', text: `classification: read-only, flow control (ex) ${shown}` });
  }
  t.set({ base: 'CONNECTED_UNKNOWN', queue: t.s.queue.filter((q) => q.purpose !== 'reading') });
  // A motion session with nothing in the way goes to idle (or ALARM). UNKNOWN (after a reconnect) waits
  // for "I've checked the machine" (positionVerify); any other overlay keeps CONNECTED_UNKNOWN.
  if (motionCapable(t.s, t.config) && t.s.overlays.length === 0) t.set({ base: alarmed ? 'ALARM' : idleBase(t.s) });
  startSeed(t);
}

function onVerifyAnswer(t: Tx, token: string, value: number | undefined): void {
  const verify = t.s.ackVerify;
  if (verify === null) return;
  const next = { ...verify, [token]: value };
  if (value === undefined) {
    refuseAck(t, `the ${token} read gave no value`);
    return;
  }
  t.set({ ackVerify: next });
  if (next.hold === undefined || next.qr === undefined) return;
  const dialect = dialectOf(t.s) as Dialect;
  if (next.hold !== 0 || next.qr !== dialect.limits.plannerBlocks) {
    refuseAck(t, `hold is ${next.hold} and the planner has ${next.qr} of ${dialect.limits.plannerBlocks} buffers free: the board has not stopped`);
    return;
  }
  if (next.round === 0) {
    t.set({ ackVerify: { round: 1 } });
    t.arm('verify', t.config.timings.verifyIntervalMs);
    return;
  }
  // Verified twice: the fault is acknowledged. Identify the board again from `{sr:null}`; the position is not trusted.
  t.set({ fault: null, ackVerify: null, base: 'IDENTIFYING', queue: [] });
  t.removeOverlay('FAULT');
  t.removeOverlay('READ_ONLY');
  t.removeOverlay('ORPHANED_MOTION');
  t.addOverlay('UNKNOWN');
  startProbe(t, 0, undefined);
}

function refuseAck(t: Tx, why: string): void {
  t.cancel('verify');
  t.set({ ackVerify: null, queue: t.s.queue.filter((q) => q.purpose !== 'verify'), notices: { ...t.s.notices, ackFaultRefused: why } });
}

function onStatusReport(t: Tx, report: StatusReport, at: number): void {
  mergeLive(t, report.sr);
  // Homing (amendment 2026-11-02): a pushed report says when the cycle may have ended; polled reads confirm it.
  onMotionReport(t, report.sr, at);
  if (t.s.base !== 'IDENTIFYING' && t.s.base !== 'READING') return;
  const live = t.s.live;
  const moving = (typeof report.sr['vel'] === 'number' && report.sr['vel'] !== 0) || (live.machineClass !== undefined && MOTION_CLASSES.has(live.machineClass) && 'stat' in report.sr);
  if (moving) {
    // PN §2.3 step 0: unsolicited reports showing motion while connecting.
    t.addOverlay('ORPHANED_MOTION');
    if (t.s.classification === null) t.set({ queue: [] });
  }
}

function onGarbled(t: Tx, at: number): void {
  if (t.s.probe !== null && t.s.probe.settling !== 'none') return;
  const owed = owedAnswers(t.s);
  const index = owed.findIndex((e) => !e.late);
  if (index < 0) return; // nothing was asked: nothing to trust or distrust
  // With job lines owed (line mode), a damaged answer could belong to any of them: stop trusting the link.
  if (owed.some((e) => !e.late && e.purpose === 'job')) {
    enterFault(t, 'unexpectedResponse', 'integrity', 'an answer arrived damaged while job lines were owed', at);
    return;
  }
  // The answer in flight arrived damaged.
  const entry = owed[index] as Expected;
  consumeOwed(t, owed, index, isDataEntry(entry));
  t.cancel('answer');
  switch (entry.purpose) {
    case 'splice': {
      // A damaged answer cannot prove that the first line was parsed as sr.
      // It may have completed a pre-existing motion fragment. Only a validated
      // sr-bearing error in onAnswer may retry; uncertainty stops the probe.
      t.emit({ kind: 'log', text: 'probe: the answer to the first line ({sr:null}) arrived damaged: it cannot show the line was read as a status request, and a leftover partial line in the board\'s buffer may have joined it and run → ORPHANED_MOTION' });
      t.addOverlay('ORPHANED_MOTION');
      t.set({ queue: [] });
      return;
    }
    case 'probe':
      t.set({
        ready: true,
        base: 'CONNECTED_UNKNOWN',
        queue: [],
        classification: { dialectId: null, mode: 'readOnly', reason: 'probeFailed', detail: `the answer to the ${entry.token} probe arrived damaged`, upgradeOffer: false },
      });
      t.addOverlay('READ_ONLY');
      t.emit({ kind: 'log', text: `probe: the answer to ${entry.token} arrived damaged → unclassified, read-only` });
      checkUnclassifiedResting(t);
      return;
    case 'reading':
      if (!t.s.queue.some((q) => q.purpose === 'reading')) finishReading(t);
      return;
    case 'request':
      t.set({ values: { ...t.s.values, [entry.token]: { value: null, status: -1, at } } });
      return;
    case 'verify':
      refuseAck(t, `the ${entry.token} read arrived damaged`);
      return;
    case 'liveness':
      return;
    case 'poll':
      return; // the next poll asks again
    case 'motion':
      // Nothing shows whether the line ran: stop trusting the link (SAFETY §3 garbled frame).
      enterFault(t, 'unexpectedResponse', 'integrity', `the answer to a motion line (${String(entry.line)}) arrived damaged`, at);
      return;
    case 'gate':
      finishSettingWrite(t, 'refused', `Not written: the answer to the ${entry.token} read arrived damaged.`);
      return;
    case 'bootGate':
      refuseBoot(t, `the answer to the ${entry.token} read arrived damaged`);
      return;
    /* c8 ignore next 2 -- the link closes as soon as {"boot":1} is written */
    case 'boot':
      return;
    case 'setting':
      finishSettingWrite(t, 'unconfirmed', 'The answer to the write arrived damaged. The board may or may not hold the new value; read it back before trusting it.');
      return;
    case 'readback':
      finishSettingWrite(t, 'mismatch', 'Written (status 0), but the read-back arrived damaged.');
      return;
    case 'seed':
      t.set({ values: { ...t.s.values, [entry.token]: { value: null, status: -1, at } } });
      seedAnswered(t, entry, at);
      return;
    case 'report':
      failReports(t, `the answer to ${reportStepText(t.s.reports.step as ReportStep)} arrived damaged`);
      return;
    /* c8 ignore next 2 -- a job entry owed makes the damaged answer a FAULT above */
    case 'job':
      return;
    case 'jobPrep':
      onJobPrepAnswer(t, entry, null, at);
      return;
    case 'lineMode':
      onLineModeAnswer(t, null, at);
      return;
    case 'jobRuntime':
      onJobRuntimeAnswer(t, entry, null, at);
      return;
    case 'modes':
      onModesAnswer(t, entry, undefined);
      return;
    case 'probeZ':
      onProbeGarbled(t, MOTION_DEPS, entry, at);
      return;
  }
}

// --- Live values ------------------------------------------------------------

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function mergeLive(t: Tx, fields: JsonObject): void {
  let live = t.s.live;
  for (const [key, v] of Object.entries(fields)) {
    if (typeof v === 'number' && Number.isFinite(v)) live = withNumber(t, live, key, v);
  }
  t.set({ live });
}

function withNumber(t: Tx, live: LiveState, key: string, v: number): LiveState {
  switch (key) {
    case 'stat': {
      const dialect = dialectOf(t.s);
      return { ...live, stat: v, ...(dialect === null ? {} : { machineClass: mapStat(dialect, v) }) };
    }
    case 'hold':
    case 'vel':
    case 'qr':
    case 'ex':
    case 'line':
    case 'unit':
    case 'feed':
    case 'tool':
    // Display only (spindle and coolant outputs as last driven): stored for the UI, read by no decision here.
    case 'spe':
    case 'spc':
    case 'spd':
    case 'sps':
    case 'cof':
    case 'com':
    case 'home':
    case 'coor':
    case 'dist':
      return { ...live, [key]: v };
  }
  for (const axis of AXES) {
    if (key === `pos${axis}`) return { ...live, pos: { ...live.pos, [axis]: v } };
    if (key === `mpo${axis}`) return { ...live, mpo: { ...live.mpo, [axis]: v } };
  }
  return live;
}

// --- Push-driven state: the full read at connect and the report configuration (amendment 2026-11-02) ---

/**
 * After READING: read the machine's full state once (SEED_TOKENS through the read allowlist). Nothing polls
 * afterwards: pushed status reports and the heartbeat keep the page current (SAFETY §4.2 as amended).
 */
function startSeed(t: Tx): void {
  const dialect = dialectOf(t.s);
  if (dialect === null || t.s.overlays.includes('ORPHANED_MOTION')) {
    t.set({ reports: { ...REPORTS_IDLE, phase: 'off' } });
    return;
  }
  const reads = SEED_TOKENS.filter((tok) => isReadAllowed(dialect.id, tok));
  t.set({ reports: { ...REPORTS_IDLE, phase: 'seeding' }, queue: [...t.s.queue, ...reads.map((token) => ({ token, purpose: 'seed' as const })), ...probeSeedReads(t.s, t.config)] });
  seedAnswered(t, null, 0);
}

/** A seed read is still to be written. (One line is in flight at a time: when a seed is answered, the next is still queued.) */
function isSeedOwed(s: SessionState): boolean {
  return s.queue.some((q) => q.purpose === 'seed');
}

/** Merges one state read into the live values (scalars, and the `mpo`/`pos` groups). */
function mergeStateValue(t: Tx, token: string, value: JsonValue | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    t.set({ live: withNumber(t, t.s.live, token, value) });
    return;
  }
  if ((token === 'mpo' || token === 'pos') && isObject(value)) {
    const fields: Record<string, JsonValue> = {};
    for (const [axis, v] of Object.entries(value)) fields[`${token}${axis}`] = v;
    mergeLive(t, fields);
  }
}

function onSeedAnswer(t: Tx, e: PendingRead, r: Response, at: number): void {
  const value = r.r[e.token];
  t.set({ values: { ...t.s.values, [e.token]: { value: value ?? null, status: r.footer.status, at } } });
  noteModeRead(t, e.token, r.footer.status, value);
  noteHomingRead(t, e.token, r.footer.status, value); // S1: a home or hom of 0 forgets what was homed here
  if (r.footer.status === 0) mergeStateValue(t, e.token, value);
  // A read-back of `home` after a change keeps the idle base honest (homed or not).
  if (e.token === 'home' && (t.s.base === 'IDLE_HOMED' || t.s.base === 'IDLE_UNHOMED')) t.set({ base: idleBase(t.s) });
  seedAnswered(t, e, at);
}

/** One seed read is answered (or `null` after queueing them): runs its follow-up, and ends the connect-time read. */
function seedAnswered(t: Tx, e: PendingRead | null, at: number): void {
  if (e?.then === 'typedCheck') onTypedReadsIn(t, at);
  else if (e?.then !== undefined) onFollowUp(t, e.then, at);
  if (t.s.reports.phase !== 'seeding' || isSeedOwed(t.s)) return;
  const dialect = dialectOf(t.s);
  const applies = dialect !== null && t.config.release.reports === true && REPORT_DIALECTS.has(dialect.id) && motionCapable(t.s, t.config) && !t.s.overlays.includes('ORPHANED_MOTION');
  t.set({ reports: { ...t.s.reports, phase: applies ? 'pending' : 'off' } });
  t.emit({ kind: 'log', text: `connect: full state read${applies ? '; status reports are configured next' : '; status reports are not configured on this board in this release'}` });
}

/** Starts the configuration when it is pending and the state allows it (idle, never in alarm, nothing else in progress). */
function maybeConfigure(t: Tx): void {
  const s = t.s;
  if (s.reports.phase !== 'pending' || s.motion !== null || settingWriteActive(s) || isSeedOwed(s)) return;
  if (!linkUp(s) || !allowed(matrixSnapshot(s), 'configureReports', t.config.release).allowed) return;
  const steps = reportSteps({ srList: s.live.srList, sv: numberValue(s.values['sv']), si: numberValue(s.values['si']) });
  t.set({ reports: { ...s.reports, phase: 'configuring', step: null, remaining: steps } });
  t.emit({ kind: 'log', text: `reports: the status report list ${srListMatches(s.live.srList) ? 'already holds what run needs: not written' : 'differs from what run needs: it is written (and saved on the board) and read back'}` });
  nextReportStep(t, null);
}

function reportStepText(step: ReportStep): string {
  return step.line ?? `{"${step.token}":null}`;
}

/** The configuration ends unfinished. What was already changed stays recorded (W35, W36). */
function failReports(t: Tx, why: string): void {
  const r = t.s.reports;
  if (r.phase === 'done' || r.phase === 'failed' || r.phase === 'off' || r.phase === 'idle') return;
  t.set({ reports: { ...r, phase: 'failed', step: null, remaining: [], detail: why }, queue: t.s.queue.filter((q) => q.purpose !== 'report' && q.purpose !== 'seed') });
  t.emit({ kind: 'log', text: `reports: not configured (${why}); the page shows what the board pushes, and the watchdog asks for proof of life on its own` });
}

function nextReportStep(t: Tx, detail: string | null, skipReadback = false): void {
  const r = t.s.reports;
  let remaining = r.remaining;
  if (skipReadback && remaining[0]?.kind.endsWith('Readback') === true) remaining = remaining.slice(1);
  const [next, ...rest] = remaining;
  const merged = detail === null ? r.detail : r.detail === null ? detail : `${r.detail}; ${detail}`;
  if (next === undefined) {
    t.set({ reports: { ...r, phase: 'done', step: null, remaining: [], detail: merged } });
    t.emit({ kind: 'log', text: `reports: configured (heartbeat ${r.heartbeatMs === null ? 'not available' : `${r.heartbeatMs} ms`})${merged === null ? '' : `: ${merged}`}` });
    return;
  }
  t.set({ reports: { ...r, step: next, remaining: rest, detail: merged }, queue: [...t.s.queue, { token: next.token, purpose: 'report' }] });
}

function numberValue(v: ReadValueLike): number | undefined {
  return v !== undefined && v.status === 0 && typeof v.value === 'number' ? v.value : undefined;
}
type ReadValueLike = { readonly value: JsonValue | null; readonly status: number } | undefined;

function addChange(t: Tx, change: ReportChange): void {
  t.set({ reports: { ...t.s.reports, changes: [...t.s.reports.changes, change] } });
}

function onReportAnswer(t: Tx, r: Response, at: number): void {
  const reports = t.s.reports;
  const step = reports.step;
  /* c8 ignore next -- a report line is queued only with its step in progress, and dropped when it ends */
  if (step === null || reports.phase !== 'configuring') return;
  const status = r.footer.status;
  switch (step.kind) {
    case 'srList':
    case 'sv':
    case 'si': {
      if (status !== 0) {
        nextReportStep(t, `the board refused ${step.line as string} (status ${status})`, true);
        return;
      }
      const change: ReportChange = { setting: step.kind === 'srList' ? 'sr' : step.kind, ...(step.from === undefined ? {} : { from: step.from }), ...(step.kind === 'sv' ? { to: 1 } : step.kind === 'si' ? { to: 250 } : {}) };
      addChange(t, change);
      t.emit({ kind: 'log', text: `reports: ${step.kind === 'srList' ? "Run set this board's status reports to include position, spindle, coolant and tool" : `Run changed ${step.kind} from ${step.from as number} to ${change.to as number}`} (saved on the board)` });
      nextReportStep(t, null);
      return;
    }
    case 'srReadback': {
      const sr = r.r['sr'];
      if (status === 0 && isObject(sr)) {
        mergeLive(t, sr);
        t.set({ live: { ...t.s.live, srList: Object.freeze(Object.keys(sr)) } });
      }
      nextReportStep(t, status === 0 && isObject(sr) && srListMatches(Object.keys(sr)) ? null : 'the status report list read back is not the one run set');
      return;
    }
    case 'svReadback':
    case 'siReadback': {
      const value = r.r[step.token];
      t.set({ values: { ...t.s.values, [step.token]: { value: value ?? null, status, at } } });
      const want = step.token === 'sv' ? 1 : 250;
      nextReportStep(t, status === 0 && value === want ? null : `${step.token} reads back ${JSON.stringify(value ?? null)}, not ${want}`);
      return;
    }
    case 'rtProbe': {
      const rt = r.r['rt'];
      if (status === 0 && isObject(rt)) {
        // The leaves it answers with are the capability probe of the job flag and the feed-limit window (Phase 3).
        t.set({ rtLeaves: Object.freeze(Object.keys(rt)) });
        nextReportStep(t, null);
        return;
      }
      t.set({ reports: { ...t.s.reports, remaining: t.s.reports.remaining.filter((x) => x.kind !== 'heartbeat') } });
      t.emit({ kind: 'log', text: `reports: no heartbeat on this firmware ({"rt":null} answered status ${status}); the watchdog asks for proof of life after ${t.config.timings.livenessIdleMs} ms of silence` });
      nextReportStep(t, null);
      return;
    }
    case 'heartbeat': {
      if (status !== 0) {
        nextReportStep(t, `the board refused the heartbeat (status ${status})`);
        return;
      }
      t.set({ reports: { ...t.s.reports, heartbeatMs: HEARTBEAT_INTERVAL_MS }, link: { heartbeatMs: HEARTBEAT_INTERVAL_MS, silenceMs: t.config.timings.reportSilenceMs }, liveness: null });
      t.arm('watchdog', t.config.timings.reportSilenceMs);
      nextReportStep(t, null);
      return;
    }
  }
}

// --- Watchdog (SAFETY §4.2) -------------------------------------------------

/** The token of the proof-of-life GET where ENQ is not available. */
export const LIVENESS_TOKEN = 'stat';

/** The watchdog runs on a classified, connected link (it needs the dialect's ENQ or its read allowlist). */
function watchdogActive(s: SessionState): boolean {
  return linkUp(s) && READY_BASES.has(s.base) && dialectOf(s) !== null;
}

/** Arms the watchdog when it should run and is not armed; stops it when it should not run. */
/**
 * How long received silence may last before the watchdog acts: with the heartbeat on, the report silence
 * window (then STALE, nothing sent); otherwise the fallback idle time before one proof-of-life ask.
 */
function watchdogMs(t: Tx): number {
  return t.s.reports.heartbeatMs !== null ? t.config.timings.reportSilenceMs : t.config.timings.livenessIdleMs;
}

function syncWatchdog(t: Tx): void {
  if (watchdogActive(t.s)) {
    if (t.s.timers.watchdog === undefined) t.arm('watchdog', watchdogMs(t));
    return;
  }
  t.cancel('watchdog');
  t.set({ liveness: null });
}

function enterStale(t: Tx, at: number): void {
  if (t.s.overlays.includes('STALE')) return;
  t.addOverlay('STALE');
  // The watchdog and the read timeouts run only after the board has answered, so a receive time exists.
  t.set({ stale: { at, silentForMs: Math.max(0, at - (t.s.live.lastRxAt as number)) } });
  abandonProbe(t, 'stale', at);
}

/**
 * True when the last known state is one in which the edge-next heartbeat is silent and no report is due, so a
 * silent window proves nothing (SAFETY §4.2 amendment "heartbeat silence during hold and dwell"): the heartbeat
 * beats only while the machine is quiet, with nothing moving, held, flushing or queued (@cite EN
 * runtime.c:37-52, :62-71), and a finished feedhold or a long G4 dwell pushes no report either. That is a hold
 * (`hold` ≠ 0, or a held `stat`), or a cycle that is not stepping: a dwell, or moves queued but not moving
 * (a running, homing, jogging or probing `stat`, or planner buffers in use), with `vel` 0. Never while steps may
 * be moving (`vel` not 0, or unknown): pushed position reports cover liveness then, and nothing is sent. A finished
 * hold is the exception: nothing steps whatever `vel` says, and from 450.02 a hold entered during a dwell keeps
 * reporting the last move's final segment velocity (EN canonical_machine.c:2597-2610).
 */
function silentWhileBusy(s: SessionState): boolean {
  const live = s.live;
  if (live.hold !== undefined && dialectOf(s)?.hold[live.hold] === 'HOLD') return true;
  if (live.vel !== 0) return false;
  if ((live.hold !== undefined && live.hold !== 0) || live.machineClass === 'held') return true;
  if (live.machineClass !== undefined && MOTION_CLASSES.has(live.machineClass)) return true;
  const blocks = dialectOf(s)?.limits.plannerBlocks;
  return blocks !== undefined && live.qr !== undefined && live.qr < blocks;
}

function onWatchdog(t: Tx, at: number): void {
  // Armed only while the watchdog is active: syncWatchdog cancels it in the transition that ends that.
  if (t.s.reports.heartbeatMs !== null) {
    if (t.s.liveness !== null) {
      // Asked once for this silent window and no byte came back within `staleAfterMs`: unexpected silence.
      enterStale(t, at);
      t.set({ liveness: null });
      t.arm('watchdog', t.config.timings.reportSilenceMs);
      return;
    }
    if (silentWhileBusy(t.s) && !heartbeatCoversHold()) {
      // Held, dwelling or queued without stepping: the heartbeat does not beat and no report is due, so the
      // silence is expected. Ask ONCE for this window (ENQ, else a `stat` GET); STALE only if that goes unanswered.
      t.set({ liveness: { since: at, via: askForLife(t) } });
      t.arm('watchdog', t.config.timings.staleAfterMs);
      return;
    }
    // Neither a report, a heartbeat nor an answer for the whole window: "No reports from the board". The link
    // is suspect (STALE: only reads and stops), and nothing is sent to ask: while the machine is quiet the
    // heartbeat is the proof of life, and while steps move the pushed position reports are.
    enterStale(t, at);
    t.arm('watchdog', t.config.timings.reportSilenceMs);
    return;
  }
  if (t.s.liveness !== null) {
    // Asked for proof of life `staleAfterMs` ago and nothing came back: unexpected silence.
    enterStale(t, at);
  }
  t.set({ liveness: { since: at, via: askForLife(t) } });
  t.arm('watchdog', t.config.timings.staleAfterMs);
}

/**
 * Asks the board for proof of life. ENQ on edge-next after a rev-2/3 footer
 * when none is outstanding (an unanswered one stays outstanding: at most one,
 * SAFETY §4.2), else a `stat` GET, queued like any read (the matrix and the
 * allowlist are checked when it is written). A line already owed or waiting
 * is proof enough to wait for.
 */
function askForLife(t: Tx): 'enq' | 'get' {
  const byte = enqByte(t.s);
  if (byte !== undefined && !t.s.enqOutstanding && allowed(matrixSnapshot(t.s), 'enq', t.config.release).allowed) {
    writeEnq(t, byte);
    return 'enq';
  }
  if (t.s.queue.length === 0 && t.s.writing === null && !t.s.expected.some((e) => !e.late)) {
    t.set({ queue: [{ token: LIVENESS_TOKEN, purpose: 'liveness' }] });
  }
  return 'get';
}

// --- FAULT ------------------------------------------------------------------

function enterFault(t: Tx, cause: FaultCause, kind: FaultKind, detail: string, at: number): void {
  interruptSettingWrite(t, 'a fault latched');
  abandonLoad(t, at, 'a fault latched');
  forgetBoardModes(t); // N5: what a FAULT (or a reset) left is not known until read again
  forgetHomed(t); // S1: a reset behind the FAULT may have unhomed the board
  if (t.s.reports.phase === 'seeding' || t.s.reports.phase === 'configuring' || t.s.reports.phase === 'pending') failReports(t, 'a fault latched');
  if (t.s.fault === null) t.set({ fault: { cause, kind, detail, at } });
  // A stop sequence of this session is what failed, or the board reset: no new stop is started for the job.
  // An `er` during a job comes with a controller alarm on edge-next, which has already flushed and turned the
  // outputs off (SAFETY §3 effect 3): no flush sequence is sent into an alarm.
  const jobStopUsable = t.s.motion?.reason !== 'stopJob' && t.s.job?.stopping !== true && cause !== 'stopNotConfirmed' && cause !== 'bannerAfterReady' && cause !== 'writeFailed' && cause !== 'exceptionReport';
  if (t.s.rxm.step !== null) t.set({ rxm: { ...t.s.rxm, step: null, footerExpect: null, detail: 'a fault latched' } });
  const wasMoving = (t.s.motion !== null && t.s.motion.phase !== 'held') || t.s.base === 'RUNNING';
  abandonMotion(t);
  abandonProbe(t, 'fault', at);
  t.addOverlay('FAULT');
  t.cancel('verify');
  // Stop feeding (SAFETY §3 FAULT entry effect 1). Lines already written may still be answered.
  t.set({ queue: [], ackVerify: null });
  const live = t.s.live;
  const moving = wasMoving || (live.vel !== undefined && live.vel !== 0) || (live.machineClass !== undefined && MOTION_CLASSES.has(live.machineClass));
  // Effect 2: the machine was moving, so hold it.
  if (moving && allowed(matrixSnapshot(t.s), 'feedhold', t.config.release).allowed) writeFeedhold(t);
  // Effects 3 and 4 for a job (Phase 3): end it with the flush sequence, at once or after the grace period.
  onJobFault(t, kind, detail, at, jobStopUsable);
}

// --- Writing ----------------------------------------------------------------

/** Writes the next queued read when nothing is in flight and the matrix allows a read now. */
function pump(t: Tx): void {
  const s = t.s;
  if (s.writing !== null || s.queue.length === 0 || !linkUp(s)) return;
  // One line at a time, except job lines in line mode (H76): those are paced by the free slots (job.ts).
  if (s.expected.some((e) => !e.late && e.purpose !== 'job')) return;
  if (s.footerRev !== 3 && s.expected.some((e) => !e.late)) return;
  const next = s.queue[0] as PendingRead;
  const reportWrite = next.purpose === 'report' && s.reports.step?.line !== undefined;
  const lineModeWrite = next.purpose === 'lineMode' && next.value !== undefined;
  const ownLine = next.purpose === 'motion' || (next.purpose === 'probeZ' && next.line !== undefined);
  const intent: Intent =
    ownLine
      ? (next.intent as Intent)
      : next.purpose === 'setting'
        ? 'settingsWrite'
        : reportWrite
          ? 'configureReports'
          : lineModeWrite
            ? 'lineMode'
            : next.purpose === 'jobRuntime'
              ? 'jobRuntime'
              : next.purpose === 'boot'
                ? 'flash'
                : 'read';
  if (!allowed(matrixSnapshot(s), intent, t.config.release).allowed) {
    // A motion line or a settings write the matrix no longer allows (the state changed since it was queued) is dropped, never held.
    /* c8 ignore next -- a safety net: every state change that ends motion (STALE, FAULT, LOST, ALARM) empties the motion queue first */
    if (next.purpose === 'motion') t.set({ queue: s.queue.slice(1) });
    /* c8 ignore next -- a setting line is queued in the same transition the matrix allowed it */
    if (next.purpose === 'setting') finishSettingWrite(t, 'refused', 'Not written: the machine is no longer in a state that allows settings writes.');
    /* c8 ignore next -- a report step is queued in the transition maybeConfigure checked the matrix, and an overlay that denies it also fails the configuration first */
    if (reportWrite) failReports(t, 'the machine is no longer in a state that allows report configuration');
    // Probe Z: its line is dropped, never held; the probe says what that means (an alarm, STALE).
    if (next.purpose === 'probeZ' && ownLine) onProbeLineDropped(t, next.line as string, s.live.lastRxAt as number);
    return;
  }
  const line = lineFor(s, next);
  if (line === undefined) {
    t.set({ queue: s.queue.slice(1) });
    enterFault(t, 'writeRefused', 'integrity', `no allowlisted GET for ${JSON.stringify(next.token)} in this state`, s.live.lastRxAt ?? 0);
    return;
  }
  const seq = s.sent.lines + 1;
  t.set({ queue: s.queue.slice(1), writing: { ...next, seq }, sent: { ...s.sent, lines: seq } });
  t.emit({
    kind: 'writeLine',
    epoch: s.epoch,
    seq,
    token: next.token,
    line,
    ...(ownLine
      ? { motion: { intent } }
      : next.purpose === 'setting'
        ? { intent: 'settingsWrite' as const }
        : reportWrite || next.purpose === 'normalize'
          ? { intent: 'configureReports' as const }
          : lineModeWrite
            ? { intent: 'lineMode' as const }
            : next.purpose === 'jobRuntime'
              ? { intent: 'jobRuntime' as const }
              : next.purpose === 'boot'
                ? { intent: 'flash' as const }
                : {}),
  });
}

function lineFor(s: SessionState, read: PendingRead): string | undefined {
  if (read.purpose === 'motion' || (read.purpose === 'probeZ' && read.line !== undefined)) return read.line;
  /* c8 ignore start -- the queued setting line always matches the write in progress; any mismatch is a bug and becomes a writeRefused FAULT */
  if (read.purpose === 'setting') {
    const w = s.settingWrite;
    const dialect = dialectOf(s);
    if (w === null || w.phase !== 'writing' || w.key !== read.token || w.value !== read.value || dialect === null) return undefined;
    if (settingRefusal(dialect.id, w.key, w.value, s.values) !== null) return undefined;
    return settingLine(w.key, w.value) ?? undefined;
  }
  /* c8 ignore stop */
  if (read.purpose === 'lineMode' && read.value !== undefined) return rxmLine(read.value === 1 ? 1 : 0);
  if (read.purpose === 'jobRuntime') return read.line;
  // OD-14: identification needs it, so it goes out under the probe's own gate; the write policy admits exactly this line, only while it is in flight.
  /* c8 ignore next -- the jv line is queued in the same transition that sets normalizing */
  if (read.purpose === 'normalize') return s.probe?.normalizing === true ? JV_LINE : undefined;
  /* c8 ignore next -- the boot line is queued only when the entry passes its gate, in the same transition */
  if (read.purpose === 'boot') return s.bootEntry?.phase === 'writing' ? BOOT_LINE : undefined;
  if (read.purpose === 'report' && s.reports.step?.line !== undefined) {
    const line = s.reports.step.line;
    /* c8 ignore next -- the steps are built from the shapes the gate admits; a mismatch is a bug and becomes a writeRefused FAULT */
    return reportLineShape(line) ? line : undefined;
  }
  if (!readableNow(s, read.token)) return undefined;
  const dialect = dialectOf(s);
  if (dialect === null) return PROBE_STEPS.find((step) => step.key === read.token)?.line;
  return getLineFor(dialect.id, read.token);
}

function deepFreezeState(s: SessionState): SessionState {
  return deepFreeze(s);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}
