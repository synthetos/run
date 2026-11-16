import {
  BYTE,
  type Dialect
} from '@synthetos/protocol';
import { allowed, type Decision } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import { forgetBoardModes } from '../boardModes.ts';
import { forgetHomed } from '../homedAxes.ts';
import {
  type FaultCause,
  type FaultKind
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function onAckFault(t: Tx, matrix: Decision, deps: ReducerDeps): void {
  const { dialectOf, deny, VERIFY_TOKENS } = deps;
  const dialect = dialectOf(t.s);
  if (t.s.ackVerify !== null) {
    t.decide('ackFault', deny('The fault is already being verified.', 'Wait for the verification to finish.', 'SAFETY §3 FAULT exits'));
    return;
  }
  if (dialect === null || !VERIFY_TOKENS.every((tok) => isReadAllowed(dialect.id, tok, t.s.identity?.fb))) {
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

export function onVerifyAnswer(t: Tx, message: { token: string; value: number | undefined; }, deps: ReducerDeps): void {
  const { token, value } = message;
  const { refuseAck, dialectOf, startProbe } = deps;
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

export function refuseAck(t: Tx, why: string, _deps: ReducerDeps): void {
  t.cancel('verify');
  t.set({ ackVerify: null, queue: t.s.queue.filter((q) => q.purpose !== 'verify'), notices: { ...t.s.notices, ackFaultRefused: why } });
}

// --- FAULT ------------------------------------------------------------------
export function enterFault(t: Tx, message: { cause: FaultCause; kind: FaultKind; detail: string; at: number; }, deps: ReducerDeps): void {
  const { cause, kind, detail, at } = message;
  const { interruptSettingWrite, features, failReports, matrixSnapshot, writeFeedhold } = deps;
  interruptSettingWrite(t, 'a fault latched');
  features.abandonLoad?.(t, at, 'a fault latched');
  forgetBoardModes(t); // N5: what a FAULT (or a reset) left is not known until read again
  forgetHomed(t); // S1: a reset behind the FAULT may have unhomed the board
  if (t.s.reports.phase === 'seeding' || t.s.reports.phase === 'configuring' || t.s.reports.phase === 'pending') failReports(t, 'a fault latched');
  if (t.s.fault === null) t.set({ fault: { cause, kind, detail, at } });
  // A stop sequence of this session is what failed, or the board reset: no new stop is started for the job.
  // An `er` during a job comes with a controller alarm on edge-next, which has already flushed and turned the
  // outputs off (SAFETY §3 effect 3): no flush sequence is sent into an alarm.
  const jobStopUsable = faultStopUsable(t, cause);
  if (t.s.rxm.step !== null) t.set({ rxm: { ...t.s.rxm, step: null, footerExpect: null, detail: 'a fault latched' } });
  const wasMoving = (t.s.motion !== null && t.s.motion.phase !== 'held') || t.s.base === 'RUNNING';
  features.abandonMotion?.(t);
  features.abandonProbe?.(t, 'fault', at);
  t.addOverlay('FAULT');
  t.cancel('verify');
  // Stop feeding (SAFETY §3 FAULT entry effect 1). Lines already written may still be answered.
  t.set({ queue: [], ackVerify: null });
  const moving = faultMotion(t, wasMoving, deps);
  // Effect 2: the machine was moving, so hold it.
  if (moving && allowed(matrixSnapshot(t.s), 'feedhold', t.config.release).allowed) writeFeedhold(t);
  // Effects 3 and 4 for a job (Phase 3): end it with the flush sequence, at once or after the grace period.
  features.onJobFault?.(t, kind, detail, at, jobStopUsable);
}

export function writeFeedhold(t: Tx, deps: ReducerDeps): void {
  const { dialectOf } = deps;
  const byte = dialectOf(t.s)?.realtime.feedhold.byte ?? BYTE.FEEDHOLD;
  t.set({ sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name: 'feedhold', byte });
}

export function bindFaults(deps: ReducerDeps): Pick<ReducerDeps, 'onAckFault' | 'onVerifyAnswer' | 'refuseAck' | 'enterFault' | 'writeFeedhold'> {
  return {
    onAckFault: (t, matrix) => onAckFault(t, matrix, deps),
    onVerifyAnswer: (t, token, value) => onVerifyAnswer(t, { token: token, value: value }, deps),
    refuseAck: (t, why) => refuseAck(t, why, deps),
    enterFault: (...args: Parameters<ReducerDeps['enterFault']>) => enterFault(args[0], { cause: args[1], kind: args[2], detail: args[3], at: args[4] }, deps),
    writeFeedhold: (t) => writeFeedhold(t, deps),
  };
}

function faultStopUsable(t: Tx, cause: FaultCause): boolean {
  return t.s.motion?.reason !== 'stopJob' && t.s.job?.stopping !== true && cause !== 'stopNotConfirmed' && cause !== 'bannerAfterReady' && cause !== 'writeFailed' && cause !== 'exceptionReport';
}

function faultMotion(t: Tx, wasMoving: boolean, deps: ReducerDeps): boolean {
  const { MOTION_CLASSES } = deps;
  const live = t.s.live;
  return wasMoving || (live.vel !== undefined && live.vel !== 0) || (live.machineClass !== undefined && MOTION_CLASSES.has(live.machineClass));
}
