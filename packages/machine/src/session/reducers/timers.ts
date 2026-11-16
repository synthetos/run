import {
  MAX_PROBE_RESTARTS,
  type Expected,
  type TimerId
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function onTimer(t: Tx, message: { id: TimerId; at: number; }, deps: ReducerDeps): void {
  const { id, at } = message;
  const { onWatchdog, features, MOTION_DEPS, JOB_DEPS, VERIFY_TOKENS } = deps;
  if (id === 'settle') {
    settleTimer(t, at, deps);
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
  answerTimer(t, at, deps);
}

export function bindTimers(deps: ReducerDeps): Pick<ReducerDeps, 'onTimer'> {
  return {
    onTimer: (t, id, at) => onTimer(t, { id: id, at: at }, deps),
  };
}

function settleTimer(t: Tx, at: number, deps: ReducerDeps): void {
  const { enterFault, startProbe } = deps;
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

function answerTimer(t: Tx, at: number, deps: ReducerDeps): void {

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
  missedSetting(t, missed, deps);
  missedWork(t, { missed, at }, deps);
  finishTimeout(t, { missed, at }, deps);
}

function missedSetting(t: Tx, missed: Expected, deps: ReducerDeps): void {
  const { finishSettingWrite, refuseBoot } = deps;
  if (missed.purpose === 'gate') finishSettingWrite(t, 'refused', `Not written: the board did not answer the ${missed.token} read in time.`);
  if (missed.purpose === 'bootGate') refuseBoot(t, `the board did not answer the ${missed.token} read in time`);
  if (missed.purpose === 'setting') finishSettingWrite(t, 'unconfirmed', 'The board did not answer the write in time. It may or may not hold the new value; read it back before trusting it.');
  if (missed.purpose === 'readback') finishSettingWrite(t, 'mismatch', 'Written (status 0), but the read-back was not answered in time.');

}

function missedWork(t: Tx, message: { missed: Expected; at: number; }, deps: ReducerDeps): void {
  const { missed, at } = message;
  const { features } = deps;
  if (missed.purpose === 'jobPrep') features.abandonLoad?.(t, at, `the controller did not answer the ${missed.token} read in time`);
  if (missed.purpose === 'lineMode') features.onLineModeAnswer?.(t, null, at);
  // A tool change's M5/M9 or a resume step unanswered: the job layer fails closed (independent review 2026-11-03, R6).
  if (missed.purpose === 'motion') features.onJobMotionTimeout?.(t, missed.line, at);
  if (missed.intent === 'alarmRestore') features.onAlarmRestoreMissed?.(t);
  if (missed.purpose === 'probeZ') features.onProbeMissed?.(t, missed);

}

function finishTimeout(t: Tx, message: { missed: Expected; at: number; }, deps: ReducerDeps): void {
  const { missed, at } = message;
  const { failReports, enterStale, finishReading } = deps;
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
