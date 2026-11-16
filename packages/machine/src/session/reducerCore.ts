import { bindAnswers } from './reducers/answers.ts';
import { bindInbound } from './reducers/inbound.ts';
import { bindTimers } from './reducers/timers.ts';
import { bindWriting } from './reducers/writing.ts';
import { bindWatchdog } from './reducers/watchdog.ts';
import { bindReports } from './reducers/reports.ts';
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
type ReadValueLike = { readonly value: JsonValue | null; readonly status: number } | undefined;

const { initialState, dialectOf, matrixSnapshot, readableNow, enqAllowedNow, enqByte, linkUp, deny, settingWriteActive, isObject } = bindShared(deps);
const { onEnq, writeEnq, onRead } = bindReads(deps);
const { onSettingsWrite, finishSettingWrite, onGateAnswer, onSettingAnswer, onReadBackAnswer, interruptSettingWrite } = bindSettings(deps);
const { refuseBoot, onFlash, onBootGateAnswer, onBootWritten, interruptBootEntry } = bindBoot(deps);
const { onAckFault, onVerifyAnswer, refuseAck, enterFault, writeFeedhold } = bindFaults(deps);
const { resetToNotConnected, onOpened, startProbe, onLinkLost, onBanner } = bindConnect(deps);
const { advanceProbe, finishProbe, probeRecord, checkUnclassifiedResting, finishReading } = bindIdentify(deps);
const { mergeLive, withNumber, onStatusReport, mergeStateValue } = bindLive(deps);
const { startSeed, isSeedOwed, onSeedAnswer, seedAnswered, maybeConfigure, reportStepText, failReports, nextReportStep, numberValue, addChange, onReportAnswer } = bindReports(deps);
const { watchdogActive, watchdogMs, syncWatchdog, enterStale, silentWhileBusy, onWatchdog, askForLife } = bindWatchdog(deps);
const { onLineWritten, answerTimeout, pump, lineFor } = bindWriting(deps);
const { onTimer } = bindTimers(deps);
const { onInbound } = bindInbound(deps);
const { onResponse, isDataEntry, owedAnswers, consumeOwed, answers, onAnswer } = bindAnswers(deps);
Object.assign(deps, { initialState, dialectOf, matrixSnapshot, readableNow, enqAllowedNow, enqByte, reduce, onJobLineDropped, linkUp, deny, onIntent, onEnq, writeEnq, onRead, settingWriteActive, onSettingsWrite, finishSettingWrite, onGateAnswer, onSettingAnswer, onReadBackAnswer, interruptSettingWrite, refuseBoot, onFlash, onBootGateAnswer, onBootWritten, interruptBootEntry, onAckFault, writeFeedhold, resetToNotConnected, onOpened, startProbe, onLineWritten, answerTimeout, onLinkLost, onTimer, onInbound, onBanner, onResponse, isDataEntry, owedAnswers, consumeOwed, answers, onAnswer, advanceProbe, finishProbe, probeRecord, checkUnclassifiedResting, finishReading, onVerifyAnswer, refuseAck, onStatusReport, onGarbled, isObject, mergeLive, withNumber, startSeed, isSeedOwed, mergeStateValue, onSeedAnswer, seedAnswered, maybeConfigure, reportStepText, failReports, nextReportStep, numberValue, addChange, onReportAnswer, watchdogActive, watchdogMs, syncWatchdog, enterStale, silentWhileBusy, onWatchdog, askForLife, enterFault, pump, lineFor, MOTION_DEPS, JOB_DEPS });
return { READING_TOKENS, FULL_SESSION_FLOW_CONTROL, MOTION_READING_TOKENS, VERIFY_TOKENS, PROBE_TOKENS, initialState, dialectOf, matrixSnapshot, readableNow, enqAllowedNow, reduce, settingWriteActive, BOOT_LINE, probeRecord, LIVENESS_TOKEN };
}
