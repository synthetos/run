import { bindIntents } from './reducers/intents.ts';
import { bindGarbled } from './reducers/garbled.ts';
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
const { onGarbled } = bindGarbled(deps);
const { onIntent } = bindIntents(deps);
Object.assign(deps, { initialState, dialectOf, matrixSnapshot, readableNow, enqAllowedNow, enqByte, reduce, onJobLineDropped, linkUp, deny, onIntent, onEnq, writeEnq, onRead, settingWriteActive, onSettingsWrite, finishSettingWrite, onGateAnswer, onSettingAnswer, onReadBackAnswer, interruptSettingWrite, refuseBoot, onFlash, onBootGateAnswer, onBootWritten, interruptBootEntry, onAckFault, writeFeedhold, resetToNotConnected, onOpened, startProbe, onLineWritten, answerTimeout, onLinkLost, onTimer, onInbound, onBanner, onResponse, isDataEntry, owedAnswers, consumeOwed, answers, onAnswer, advanceProbe, finishProbe, probeRecord, checkUnclassifiedResting, finishReading, onVerifyAnswer, refuseAck, onStatusReport, onGarbled, isObject, mergeLive, withNumber, startSeed, isSeedOwed, mergeStateValue, onSeedAnswer, seedAnswered, maybeConfigure, reportStepText, failReports, nextReportStep, numberValue, addChange, onReportAnswer, watchdogActive, watchdogMs, syncWatchdog, enterStale, silentWhileBusy, onWatchdog, askForLife, enterFault, pump, lineFor, MOTION_DEPS, JOB_DEPS });
return { READING_TOKENS, FULL_SESSION_FLOW_CONTROL, MOTION_READING_TOKENS, VERIFY_TOKENS, PROBE_TOKENS, initialState, dialectOf, matrixSnapshot, readableNow, enqAllowedNow, reduce, settingWriteActive, BOOT_LINE, probeRecord, LIVENESS_TOKEN };
}
