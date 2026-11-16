import { bindLive } from './reducers/live.ts';
import { bindIdentify } from './reducers/identify.ts';
import { bindConnect } from './reducers/connect.ts';
import { bindFaults } from './reducers/faults.ts';
import { bindBoot } from './reducers/boot.ts';
import { bindSettings } from './reducers/settings.ts';
import { bindReads } from './reducers/reads.ts';
import { bindShared } from './reducers/shared.ts';
import type { ReducerDeps } from './reducers/deps.ts';
import { createReducerValues } from './reducers/values.ts';
import { Tx } from './reducers/transaction.ts';
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
import { BOARD_MODES_UNKNOWN, forgetBoardModes, noteModeLine, noteModeRead } from './boardModes.ts';
import { forgetHomed, noteHomingRead } from './homedAxes.ts';
import { HEARTBEAT_INTERVAL_MS, JV_LINE, REPORT_DIALECTS, SEED_TOKENS, heartbeatCoversHold, reportLineShape, reportSteps, srListMatches, type ReportStep } from './reports.ts';
import { acknowledgeDwell, observeDwellPoll } from './dwell.ts';
import { PROBE_CLOSED } from './inactiveFeatures.ts';
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

import type { MotionDeps } from './motion.ts';
import type { JobDeps } from './job.ts';
import type { ReducerFeatures } from './reducers/features.ts';
export type { ReducerFeatures, WorkspaceReducerFeatures } from './reducers/features.ts';

export function createSessionReducer(features: ReducerFeatures) {
const values = createReducerValues();
const deps = { features, ...values } as ReducerDeps;
const { NORMALIZE_SETTLE_MS, READING_TOKENS, FULL_SESSION_FLOW_CONTROL, MOTION_READING_TOKENS, VERIFY_TOKENS, PROBE_TOKENS, AXES, MOTION_CLASSES, ALARM_CLASSES, EMPTY_LIVE, REPORTS_IDLE, RXM_IDLE, DEFAULT_SILENCE_MS, TINYG_SETTING_REFUSED_IN_CYCLE, TINYG_SETTINGS_DEFAULTED, PHASE_1_NOT_HANDLED, BOOT_DIALECTS, BOOT_LINE, UNCLASSIFIED_RESTING_STAT, LIVENESS_TOKEN } = values;

/** What the motion layer borrows from this file (motion.ts may not import it: no cycles). */
const MOTION_DEPS: MotionDeps = { fault: (t, cause, kind, detail, at) => enterFault(t as Tx, cause, kind, detail, at) };
const JOB_DEPS: JobDeps = { fault: (t, cause, kind, detail, at) => enterFault(t as Tx, cause, kind, detail, at) };

/** The next state and effects. Pure: never throws for any event in any state. */
function reduce(config: SessionConfig, state: SessionState, event: SessionEvent): Transition {
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
        features.checkAlarm?.(t, event.at);
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
        if (dropped.purpose === 'probeZ' && dropped.line !== undefined) features.onProbeLineDropped?.(t, dropped.line, t.s.live.lastRxAt as number);
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
      if (event.epoch === t.s.epoch && linkUp(t.s) && t.config.release.jobs === true) features.onLineModeMemory?.(t, event.remembered);
      break;
  }
  maybeConfigure(t);
  features.maybeRestoreLineMode?.(t, linkUp(t.s) && allowed(matrixSnapshot(t.s), 'lineMode', t.config.release).allowed);
  features.maybeRereadOffsets?.(t, linkUp(t.s) && allowed(matrixSnapshot(t.s), 'read', t.config.release).allowed);
  pump(t);
  features.pumpJob?.(t, linkUp(t.s) && allowed(matrixSnapshot(t.s), 'jobLine', t.config.release).allowed);
  features.syncProbe?.(t);
  syncWatchdog(t);
  return t.done();
}

/** A job line the executor did not write (the matrix no longer allowed it): it is sent again from there. */
function onJobLineDropped(t: Tx, index: number): void {
  t.set({ expected: t.s.expected.filter((e) => !(e.purpose === 'job' && e.index === index)) });
  const job = t.s.job;
  if (job !== null && index < job.next) features.patchJob?.(t, { next: index });
}

function onIntent(t: Tx, request: SessionIntent, at: number): void {
  const intent = request.intent;
  const matrix = allowed(matrixSnapshot(t.s), intent, t.config.release);
  if (!matrix.allowed) {
    t.decide(intent, matrix);
    return;
  }
  // Probe Z (SAFETY §4.5c): nothing else moves the machine while it is open; no Start job or Spindle on with the plate out.
  const probeHeld = features.probeRefusal?.(t.s, request);
  if (probeHeld !== undefined) {
    t.decide(intent, probeHeld);
    return;
  }
  switch (request.intent) {
    case 'connect': {
      const epoch = t.s.epoch + 1;
      t.s = { ...initialState(), epoch, unknownOnNextConnect: t.s.unknownOnNextConnect || request.unknown === true, timerSeq: t.s.timerSeq, probeZ: features.probeCarried?.(t.s.probeZ) ?? PROBE_CLOSED };
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
      if (request.intent === 'feedhold' && !('release' in request) && features.onJobPause?.(t, at)) {
        t.decide(intent, matrix);
        return;
      }
      const atStopPoint = t.s.job !== null && (t.s.job.phase === 'toolChange' || t.s.job.phase === 'breakpoint' || t.s.job.phase === 'programStop') && t.s.motion === null;
      if (request.intent !== 'feedhold' && !(request.intent === 'spindleOffNow' && atStopPoint) && features.onJobStop?.(t, at)) {
        t.decide(intent, matrix);
        return;
      }
      // Probe Z (SAFETY §4.5c): Pause is `!` (it ends the probe), Stop job and Spindle off are ^D.
      // A motion session (Phase 2, SAFETY §4.4): Pause holds this session's motion, Stop job runs the
      // flush sequence, Spindle off sends M5/M9 when idle. A hold jog's release lands here too.
      if (features.onProbeStop?.(t, request, at) || features.onMotionStop?.(t, request, at)) {
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
      if (request.intent === 'resume' && features.jobActive?.(t.s) && t.s.motion === null) {
        t.decide(intent, (features.onJobResume?.(t, request, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
        return;
      }
      if (t.s.base === 'PROGRAM_PAUSED' && t.s.job?.phase !== 'toolChange') {
        t.decide(intent, deny('Only Resume and Stop job are offered at this stop.', 'Resume the job, or stop it.', 'SAFETY §4.4a'));
        return;
      }
      /* c8 ignore next 4 -- defence in depth: the matrix allows no motion intent but Resume in RUNNING, HELD or PREAMBLE */
      if (features.jobActive?.(t.s) && t.s.base !== 'PROGRAM_PAUSED' && request.intent !== 'resume') {
        t.decide(intent, deny('A job is running.', 'Pause or stop the job first.', 'SAFETY §4.4a'));
        return;
      }
      // H91: a typed move is a motion of the motion layer, started by its own module (typedMove.ts).
      t.decide(intent, (request.intent === 'typedMove' ? features.startTypedMove?.(t, request, at) : features.onMotionIntent?.(t, request, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
      return;
    case 'loadJob':
      t.decide(intent, (features.onLoadJob?.(t, request, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
      return;
    case 'startJob':
      t.decide(intent, (features.onStartJob?.(t, request, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
      return;
    case 'jobBreakpoints':
      t.decide(intent, (features.onJobBreakpoints?.(t, request.lines, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
      return;
    case 'settingsWrite':
      onSettingsWrite(t, request.key, request.value, matrix);
      return;
    case 'flash':
      onFlash(t, matrix);
      return;
    case 'probeZ':
    case 'probeZClose':
      t.decide(intent, (features.onProbeIntent?.(t, request, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
      return;
    default:
      t.decide(intent, deny(PHASE_1_NOT_HANDLED.reason, PHASE_1_NOT_HANDLED.remedy, `ROADMAP P1-02 (${t.config.release.name})`));
  }
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
    features.onMotionTimer?.(t, MOTION_DEPS, at);
    return;
  }
  if (id === 'job') {
    features.onJobTimer?.(t, JOB_DEPS, at);
    return;
  }
  if (id === 'probe') {
    features.onProbeTimer?.(t, at);
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
  if (missed.purpose === 'jobPrep') features.abandonLoad?.(t, at, `the controller did not answer the ${missed.token} read in time`);
  if (missed.purpose === 'lineMode') features.onLineModeAnswer?.(t, null, at);
  // A tool change's M5/M9 or a resume step unanswered: the job layer fails closed (independent review 2026-11-03, R6).
  if (missed.purpose === 'motion') features.onJobMotionTimeout?.(t, missed.line, at);
  if (missed.intent === 'alarmRestore') features.onAlarmRestoreMissed?.(t);
  if (missed.purpose === 'probeZ') features.onProbeMissed?.(t, missed);
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
      features.onFeedLimit?.(t, 'fs', event.fs, event.totalsShort);
      return;
    case 'FeedGapSummary':
      features.onFeedLimit?.(t, 'fg', event.fg, false);
      return;
    case 'FeedLimitEvent':
      features.onFeedLimit?.(t, 'fl', event.fl, false);
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
      if (features.onProbeAlarm?.(t, event, at)) return;
      enterFault(t, 'exceptionReport', 'integrity', `the board reported an exception (status ${event.st}): ${event.msg.slice(0, 80)}`, at);
      return;
    case 'ProbeReport':
      features.onProbeReport?.(t, event, at);
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
  if (r.footer.rev === 3 && t.s.job !== null) features.patchJob?.(t, { free: r.footer.field3 });
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
  return s.writing === null ? s.expected : [...s.expected, { ...s.writing, late: false }];
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
  if (r.footer.status === 0) {
    if (e.purpose === 'job') acknowledgeDwell(t, t.s.job?.lines[e.index as number]?.text);
    else if (e.purpose === 'motion' && e.token === 'gc') acknowledgeDwell(t, e.line);
  }
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
      if ((features.POLL_TOKENS ?? []).includes(e.token)) {
        const cycle = e.token === features.POLL_TOKENS?.[0] || t.s.polled === null ? { failed: false } : t.s.polled;
        t.set({ polled: ok ? { ...cycle, [e.token]: value as number } : { ...cycle, failed: true } });
      }
      noteHomingRead(t, e.token, r.footer.status, value); // S1: a home of 0 forgets the axes homed here
      if (e.token === 'home' && (t.s.base === 'IDLE_HOMED' || t.s.base === 'IDLE_UNHOMED')) t.set({ base: features.idleBase?.(t.s) ?? 'CONNECTED_UNKNOWN' });
      if (e.token === 'qr') observeDwellPoll(t, (features.completedPoll?.(t.s) ?? null), at);
      if (e.token === 'qr' && features.checkAlarm?.(t, at)) {
        features.onPollDone?.(t, at);
        features.onJobPoll?.(t, at);
        features.onProbePoll?.(t, at);
      }
      if (e.token === 'qr') t.set({ polled: null }); // the cycle has been judged: the next starts its own record
      return;
    }
    case 'motion':
      noteModeLine(t, e.line, r.footer.status);
      // OD-19 (S1): the G90 after a Clear alarm, on its own intent, whatever motion started meanwhile.
      if (e.intent === 'alarmRestore') {
        features.onAlarmRestoreAnswered?.(t, e.line, r.footer.status, at);
        return;
      }
      if (!features.onJobMotionAnswer?.(t, e.line, r.footer.status, at)) features.onMotionAnswer?.(t, e.line, r.footer.status, at);
      return;
    case 'job':
      features.onJobAnswer?.(t, e, r, at);
      return;
    case 'jobPrep':
      features.onJobPrepAnswer?.(t, e, r, at);
      return;
    case 'lineMode':
      features.onLineModeAnswer?.(t, r, at);
      return;
    case 'jobRuntime':
      features.onJobRuntimeAnswer?.(t, e, r, at);
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
      features.onProbeAnswer?.(t, e, r, at);
      return;
    case 'modes':
      onModesAnswer(t, e, r.footer.status === 0 ? r.r[e.token] : undefined);
      return;
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
      features.onJobPrepAnswer?.(t, entry, null, at);
      return;
    case 'lineMode':
      features.onLineModeAnswer?.(t, null, at);
      return;
    case 'jobRuntime':
      features.onJobRuntimeAnswer?.(t, entry, null, at);
      return;
    case 'modes':
      onModesAnswer(t, entry, undefined);
      return;
    case 'probeZ':
      features.onProbeGarbled?.(t, MOTION_DEPS, entry, at);
      return;
  }
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
  const reads = SEED_TOKENS.filter((tok) => isReadAllowed(dialect.id, tok, t.s.identity?.fb));
  t.set({ reports: { ...REPORTS_IDLE, phase: 'seeding' }, queue: [...t.s.queue, ...reads.map((token) => ({ token, purpose: 'seed' as const })), ...(features.probeSeedReads?.(t.s, t.config) ?? [])] });
  seedAnswered(t, null, 0);
}

/** A seed read is still to be written. (One line is in flight at a time: when a seed is answered, the next is still queued.) */
function isSeedOwed(s: SessionState): boolean {
  return s.queue.some((q) => q.purpose === 'seed');
}

function onSeedAnswer(t: Tx, e: PendingRead, r: Response, at: number): void {
  const value = r.r[e.token];
  t.set({ values: { ...t.s.values, [e.token]: { value: value ?? null, status: r.footer.status, at } } });
  noteModeRead(t, e.token, r.footer.status, value);
  noteHomingRead(t, e.token, r.footer.status, value); // S1: a home or hom of 0 forgets what was homed here
  if (r.footer.status === 0) mergeStateValue(t, e.token, value);
  // A read-back of `home` after a change keeps the idle base honest (homed or not).
  if (e.token === 'home' && (t.s.base === 'IDLE_HOMED' || t.s.base === 'IDLE_UNHOMED')) t.set({ base: features.idleBase?.(t.s) ?? 'CONNECTED_UNKNOWN' });
  seedAnswered(t, e, at);
}

/** One seed read is answered (or `null` after queueing them): runs its follow-up, and ends the connect-time read. */
function seedAnswered(t: Tx, e: PendingRead | null, at: number): void {
  if (e?.then === 'typedCheck') features.onTypedReadsIn?.(t, at);
  else if (e?.then !== undefined) features.onFollowUp?.(t, e.then, at);
  if (t.s.reports.phase !== 'seeding' || isSeedOwed(t.s)) return;
  const dialect = dialectOf(t.s);
  const applies = dialect !== null && t.config.release.reports === true && REPORT_DIALECTS.has(dialect.id) && features.motionCapable?.(t.s, t.config) && !t.s.overlays.includes('ORPHANED_MOTION');
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
  features.abandonProbe?.(t, 'stale', at);
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
    if (next.purpose === 'probeZ' && ownLine) features.onProbeLineDropped?.(t, next.line as string, s.live.lastRxAt as number);
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
    if (settingRefusal(dialect.id, w.key, w.value, s.values, s.identity?.fb) !== null) return undefined;
    return settingLine(w.key, w.value) ?? undefined;
  }
  /* c8 ignore stop */
  if (read.purpose === 'lineMode' && read.value !== undefined) return features.rxmLine?.(read.value === 1 ? 1 : 0);
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
  return getLineFor(dialect.id, read.token, s.identity?.fb);
}

const { initialState, dialectOf, matrixSnapshot, readableNow, enqAllowedNow, enqByte, linkUp, deny, settingWriteActive, isObject } = bindShared(deps);
const { onEnq, writeEnq, onRead } = bindReads(deps);
const { onSettingsWrite, finishSettingWrite, onGateAnswer, onSettingAnswer, onReadBackAnswer, interruptSettingWrite } = bindSettings(deps);
const { refuseBoot, onFlash, onBootGateAnswer, onBootWritten, interruptBootEntry } = bindBoot(deps);
const { onAckFault, onVerifyAnswer, refuseAck, enterFault, writeFeedhold } = bindFaults(deps);
const { resetToNotConnected, onOpened, startProbe, onLinkLost, onBanner } = bindConnect(deps);
const { advanceProbe, finishProbe, probeRecord, checkUnclassifiedResting, finishReading } = bindIdentify(deps);
const { mergeLive, withNumber, onStatusReport, mergeStateValue } = bindLive(deps);
Object.assign(deps, { initialState, dialectOf, matrixSnapshot, readableNow, enqAllowedNow, enqByte, reduce, onJobLineDropped, linkUp, deny, onIntent, onEnq, writeEnq, onRead, settingWriteActive, onSettingsWrite, finishSettingWrite, onGateAnswer, onSettingAnswer, onReadBackAnswer, interruptSettingWrite, refuseBoot, onFlash, onBootGateAnswer, onBootWritten, interruptBootEntry, onAckFault, writeFeedhold, resetToNotConnected, onOpened, startProbe, onLineWritten, answerTimeout, onLinkLost, onTimer, onInbound, onBanner, onResponse, isDataEntry, owedAnswers, consumeOwed, answers, onAnswer, advanceProbe, finishProbe, probeRecord, checkUnclassifiedResting, finishReading, onVerifyAnswer, refuseAck, onStatusReport, onGarbled, isObject, mergeLive, withNumber, startSeed, isSeedOwed, mergeStateValue, onSeedAnswer, seedAnswered, maybeConfigure, reportStepText, failReports, nextReportStep, numberValue, addChange, onReportAnswer, watchdogActive, watchdogMs, syncWatchdog, enterStale, silentWhileBusy, onWatchdog, askForLife, enterFault, pump, lineFor, MOTION_DEPS, JOB_DEPS });
return { READING_TOKENS, FULL_SESSION_FLOW_CONTROL, MOTION_READING_TOKENS, VERIFY_TOKENS, PROBE_TOKENS, initialState, dialectOf, matrixSnapshot, readableNow, enqAllowedNow, reduce, settingWriteActive, BOOT_LINE, probeRecord, LIVENESS_TOKEN };
}
