import type { Decision } from '@synthetos/safety';
import { allowed } from '@synthetos/safety';
import { PROBE_CLOSED } from '../inactiveFeatures.ts';
import {
  type SessionIntent
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function onIntent(t: Tx, message: { request: SessionIntent; at: number; }, deps: ReducerDeps): void {
  const { request, at } = message;
  const { matrixSnapshot, features } = deps;
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
  if (onIntentFamily1(t, { request, at, matrix, intent }, deps)) return;
  if (onIntentFamily2(t, { request, at, matrix, intent }, deps)) return;
  onIntentFamily3(t, { request, at, matrix, intent }, deps);
}

export function bindIntents(deps: ReducerDeps): Pick<ReducerDeps, 'onIntent'> {
  return {
    onIntent: (t, request, at) => onIntent(t, { request: request, at: at }, deps),
  };
}

interface IntentMessage { request: SessionIntent; at: number; matrix: Decision; intent: SessionIntent['intent']; }

function onIntentConnect(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'connect'; }>; }, deps: ReducerDeps): void {
  const { request, matrix, intent } = message;
  const { features, initialState } = deps;

  const epoch = t.s.epoch + 1;
  t.s = { ...initialState(), epoch, unknownOnNextConnect: t.s.unknownOnNextConnect || request.unknown === true, timerSeq: t.s.timerSeq, probeZ: features.probeCarried?.(t.s.probeZ) ?? PROBE_CLOSED };
  t.set({ base: 'PORT_REQUEST', port: request.port, expectedDeviceId: request.expectedDeviceId });
  t.emit({ kind: 'acquireTransport', epoch, port: request.port });
  t.decide(intent, matrix);
  return;

}

function onIntentDisconnect(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'disconnect'; }>; }, deps: ReducerDeps): void {
  const { matrix, intent } = message;
  const { resetToNotConnected } = deps;

  const epoch = t.s.epoch;
  t.cancelAll();
  t.emit({ kind: 'close', epoch });
  resetToNotConnected(t, t.s.unknownOnNextConnect);
  t.decide(intent, matrix);
  return;

}

function onIntentFeedhold(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'feedhold' | 'stopJob' | 'spindleOffNow'; }>; }, deps: ReducerDeps): void {
  const { request, at, matrix, intent } = message;
  const { features, writeFeedhold } = deps;

  // Phase 3 (SAFETY §4.4a): during a job, Pause holds the job (`!`, streaming stops) and Stop job runs the
  // flush sequence for it. Spindle off at a stop point where nothing is queued sends M5/M9 alone.
  if (jobPauseRequest(request) && features.onJobPause?.(t, at)) {
    t.decide(intent, matrix);
    return;
  }
  const atStopPoint = atJobStopPoint(t);
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

function onIntentAckFault(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'ackFault'; }>; }, deps: ReducerDeps): void {
  const { matrix } = message;
  const { onAckFault } = deps;

  onAckFault(t, matrix);
  return;
}

function onIntentAcknowledgeLost(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'acknowledgeLost'; }>; }, deps: ReducerDeps): void {
  const { matrix, intent } = message;
  const { resetToNotConnected } = deps;

  resetToNotConnected(t, true);
  t.decide(intent, matrix);
  return;
}

function onIntentEnq(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'enq'; }>; }, deps: ReducerDeps): void {
  const { matrix } = message;
  const { onEnq } = deps;

  onEnq(t, matrix);
  return;
}

function onIntentRead(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'read'; }>; }, deps: ReducerDeps): void {
  const { request, matrix } = message;
  const { onRead } = deps;

  onRead(t, request.tokens, matrix);
  return;
}

function onIntentJog(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'jog' | 'goToZero' | 'setWorkZero' | 'home' | 'setMachinePosition' | 'tempOffset' | 'selectCoordSystem' | 'spindleOn' | 'clearAlarm' | 'resume' | 'positionVerify' | 'typedMove'; }>; }, deps: ReducerDeps): void {
  const { request, at, intent } = message;
  const { features, settingWriteActive, deny } = deps;

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
  startRequestedMotion(t, message, deps);
}

function onIntentLoadJob(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'loadJob'; }>; }, deps: ReducerDeps): void {
  const { request, at, intent } = message;
  const { features, deny } = deps;

  t.decide(intent, (features.onLoadJob?.(t, request, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
  return;
}

function onIntentStartJob(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'startJob'; }>; }, deps: ReducerDeps): void {
  const { request, at, intent } = message;
  const { features, deny } = deps;

  t.decide(intent, (features.onStartJob?.(t, request, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
  return;
}

function onIntentJobBreakpoints(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'jobBreakpoints'; }>; }, deps: ReducerDeps): void {
  const { request, at, intent } = message;
  const { features, deny } = deps;

  t.decide(intent, (features.onJobBreakpoints?.(t, request.lines, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
  return;
}

function onIntentSettingsWrite(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'settingsWrite'; }>; }, deps: ReducerDeps): void {
  const { request, matrix } = message;
  const { onSettingsWrite } = deps;

  onSettingsWrite(t, request.key, request.value, matrix);
  return;
}

function onIntentFlash(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'flash'; }>; }, deps: ReducerDeps): void {
  const { matrix } = message;
  const { onFlash } = deps;

  onFlash(t, matrix);
  return;
}

function onIntentProbeZ(t: Tx, message: Omit<IntentMessage, 'request'> & { request: Extract<SessionIntent, { intent: 'probeZ' | 'probeZClose'; }>; }, deps: ReducerDeps): void {
  const { request, at, intent } = message;
  const { features, deny } = deps;

  t.decide(intent, (features.onProbeIntent?.(t, request, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
  return;
}

function onIntentOther(t: Tx, message: IntentMessage, deps: ReducerDeps): void {
  const { intent } = message;
  const { deny, PHASE_1_NOT_HANDLED } = deps;

  t.decide(intent, deny(PHASE_1_NOT_HANDLED.reason, PHASE_1_NOT_HANDLED.remedy, `ROADMAP P1-02 (${t.config.release.name})`));
}

function onIntentFamily1(t: Tx, message: IntentMessage, deps: ReducerDeps): boolean {
  const { request } = message;
  switch (request.intent) {
    case 'connect':
      onIntentConnect(t, { ...message, request }, deps);
      return true;
    case 'disconnect':
      onIntentDisconnect(t, { ...message, request }, deps);
      return true;
    case 'feedhold':
    case 'stopJob':
    case 'spindleOffNow':
      onIntentFeedhold(t, { ...message, request }, deps);
      return true;
    case 'ackFault':
      onIntentAckFault(t, { ...message, request }, deps);
      return true;
    case 'acknowledgeLost':
      onIntentAcknowledgeLost(t, { ...message, request }, deps);
      return true;
    case 'enq':
      onIntentEnq(t, { ...message, request }, deps);
      return true;
    case 'read':
      onIntentRead(t, { ...message, request }, deps);
      return true;
  }
  return false;
}

function onIntentFamily2(t: Tx, message: IntentMessage, deps: ReducerDeps): boolean {
  const { request } = message;
  switch (request.intent) {
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
      onIntentJog(t, { ...message, request }, deps);
      return true;
  }
  return false;
}

function onIntentFamily3(t: Tx, message: IntentMessage, deps: ReducerDeps): boolean {
  const { request } = message;
  switch (request.intent) {
    case 'loadJob':
      onIntentLoadJob(t, { ...message, request }, deps);
      return true;
    case 'startJob':
      onIntentStartJob(t, { ...message, request }, deps);
      return true;
    case 'jobBreakpoints':
      onIntentJobBreakpoints(t, { ...message, request }, deps);
      return true;
    case 'settingsWrite':
      onIntentSettingsWrite(t, { ...message, request }, deps);
      return true;
    case 'flash':
      onIntentFlash(t, { ...message, request }, deps);
      return true;
    case 'probeZ':
    case 'probeZClose':
      onIntentProbeZ(t, { ...message, request }, deps);
      return true;
    default:
      onIntentOther(t, { ...message, request }, deps);
      return true;
  }
}

function atJobStopPoint(t: Tx): boolean {
  return t.s.job !== null && (t.s.job.phase === 'toolChange' || t.s.job.phase === 'breakpoint' || t.s.job.phase === 'programStop') && t.s.motion === null;
}

function startRequestedMotion(t: Tx, message: Parameters<typeof onIntentJog>[1], deps: ReducerDeps): void {
  const { request, at, intent } = message;
  const { features, deny } = deps;
  // H91: a typed move is a motion of the motion layer, started by its own module (typedMove.ts).
  t.decide(intent, (request.intent === 'typedMove' ? features.startTypedMove?.(t, request, at) : features.onMotionIntent?.(t, request, at)) ?? deny('This session only updates firmware.', 'Use the signed-in workspace for machine control.', 'SAFETY §4.8'));
  return;
}

function jobPauseRequest(request: SessionIntent): boolean {
  return request.intent === 'feedhold' && !('release' in request);
}
