/**
 * Probe Z: the small steps the other probe modules share (state patches, queued lines and reads, the result).
 * Pure functions over the reducer's transition, like the motion layer (motion.ts `MotionTx`).
 */
import type { Intent } from '@synthetos/safety';
import { idleBase, type MotionTx } from '../motion.ts';
import { probeLine, restoreLine } from '../motionLines.ts';
import { noteAlarmEnded } from '../alarmRestore.ts';
import type { PendingRead, SessionState } from '../types.ts';
import { PROBE_LIMITS } from './limits.ts';
import { probeRunning, type ProbeRun, type ProbeZState } from './state.ts';
import type { ProbeOutcome, ProbePlan } from './types.ts';

export type ProbeTx = MotionTx;

/** The session's own time limits around the probe (besides the shared PROBE_LIMITS), ms. */
export const RUN_LIMITS = Object.freeze({
  /** The zero, its EEPROM wait, its read-back and putting the modes back must finish within this. */
  zeroStepsMs: 5_000,
  /** After ^D, its ALARM 207 is the probe's for this long (it normally comes within milliseconds). */
  killGraceMs: 2_000,
});

const PROBE_INTENT: Intent = 'probeZ';

export function setProbe(t: ProbeTx, patch: Partial<ProbeZState>): void {
  t.set({ probeZ: { ...t.s.probeZ, ...patch } });
}

export function setRun(t: ProbeTx, patch: Partial<ProbeRun>): void {
  t.set({ probeZ: { ...t.s.probeZ, run: { ...(t.s.probeZ.run as ProbeRun), ...patch } } });
}

/** The next input read and check, `inputPollMs` from now. */
export function tick(t: ProbeTx): void {
  t.arm('probe', PROBE_LIMITS.inputPollMs);
}

/** A probe entry waiting, being written, or owed an answer (not timed out). */
export function probePending(s: SessionState, match: (e: PendingRead) => boolean): boolean {
  const own = (e: PendingRead): boolean => e.purpose === 'probeZ' && match(e);
  return s.queue.some(own) || (s.writing !== null && own(s.writing)) || s.expected.some((e) => !e.late && own(e));
}

export function queueRead(t: ProbeTx, token: string): void {
  t.set({ queue: [...t.s.queue, { token, purpose: 'probeZ' }] });
}

/** A probe line (G-code, answered as data); the write gate checks its exact bytes again. */
export function queueLine(t: ProbeTx, line: string): void {
  t.set({ queue: [...t.s.queue, { token: 'gc', purpose: 'probeZ', line, intent: PROBE_INTENT }] });
}

/** The run's `G38.2`, from the plan it was started with. */
export function runProbeLine(plan: ProbePlan): string {
  return probeLine(plan.depthMm, plan.feed);
}

/** During a run: the `G38.2` has gone to the transport (queued once, no longer waiting); it may run, whatever comes next. */
export function probeWritten(s: SessionState): boolean {
  const line = runProbeLine(s.probeZ.plan as ProbePlan);
  return (s.probeZ.run as ProbeRun).sent && !s.queue.some((q) => q.purpose === 'probeZ' && q.line === line);
}

/** The zero has gone to the transport (or further): it may be set, and only its read-back says whether it is. */
export function zeroWritten(s: SessionState): boolean {
  const zero = s.probeZ.run?.zero ?? null;
  return zero !== null && (zero !== 'line' || !s.queue.some((q) => q.purpose === 'probeZ' && q.line !== undefined));
}

/** Lines of the probe not written yet never go out (Pause, Stop job, an outcome). */
export function dropQueuedLines(t: ProbeTx): void {
  t.set({ queue: t.s.queue.filter((q) => !(q.purpose === 'probeZ' && q.line !== undefined)) });
}

/**
 * Puts back the units and distance mode the board had, then shows `outcome` once that is answered. Only when that
 * can be sent: never after Pause or Stop job (nothing follows a stop) and never into an alarm (the board refuses
 * lines); then the outcome is shown at once, and the next probe's own `G21` and `G91` line set the modes again.
 */
export function restoreThen(t: ProbeTx, outcome: ProbeOutcome, at: number): void {
  const run = t.s.probeZ.run as ProbeRun;
  if (run.stopped !== null || t.s.base === 'ALARM') {
    finish(t, outcome, at);
    return;
  }
  setRun(t, { pending: outcome, zero: 'restore' });
  queueLine(t, restoreLine(run.units, run.dist));
}

/** The outcome after Pause or Stop job, which always wins: nothing is zeroed after either (H90 mitigation 3). */
export function stopOutcome(r: ProbeRun): ProbeOutcome | null {
  if (r.stopped === 'stopJob') return { kind: 'stopJob', status: 207 };
  if (r.stopped === 'pause') return { kind: 'paused' };
  return null;
}

/** Writes `!` (Pause) or ^D (Stop job, Spindle off) for the probe; checked again by the write gate. */
export function writeStop(t: ProbeTx, which: 'feedhold' | 'kill', intent: Intent, byte: number): void {
  t.set({ sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name: which, byte, intent });
}

/** The write gate: a probe line goes out only while its run is in progress and no Pause or Stop job was pressed. */
export function probeLineAllowed(s: SessionState): boolean {
  return s.probeZ.run !== null && s.probeZ.run.stopped === null && probeRunning(s.probeZ.step);
}

/**
 * The probe is over: the result, with the plate still out. Unsent probe lines and reads are dropped, the input poll
 * stops, and a base this probe moved to JOGGING returns to idle, or to ALARM when the board's alarm ended it (its
 * `er` comes before the report that says stat 2, and the probe never shows idle in between).
 */
export function finish(t: ProbeTx, outcome: ProbeOutcome, at: number, alarmed = false): void {
  const wasRunning = probeRunning(t.s.probeZ.step);
  // OD-19: an alarm that ended a probe whose G21 went out left G91 G21: Clear alarm puts G90 back (alarmRestore.ts).
  const run = t.s.probeZ.run;
  if (run !== null && run.checked && (alarmed || t.s.base === 'ALARM')) noteAlarmEnded(t, run.units);
  t.set({ queue: t.s.queue.filter((q) => q.purpose !== 'probeZ') });
  // A later alarm (203, 250, 220, 207) is no longer this probe's: it is handled as any other.
  setProbe(t, { step: 'result', outcome, run: null, touchAt: null, passedAt: null, anchor: null, alarmExpected: false });
  t.cancel('probe');
  if (wasRunning && t.s.base === 'JOGGING') t.set({ base: alarmed ? 'ALARM' : idleBase(t.s) });
  t.emit({ kind: 'log', text: `probe Z: ${outcome.kind} at ${Math.round(at)} ms` });
}
