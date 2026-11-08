/**
 * Small, shared pieces of the Phase 3 job layer (SAFETY §4.4a): what counts as an active job, and the few job
 * updates the motion layer makes when a stop sequence ends, an alarm stops the machine or the link goes. Kept
 * apart from job.ts so that motion.ts and job.ts can both use them without an import cycle.
 *
 * Pure functions over the reducer's transition; nothing here touches a port or a clock.
 */
import { w42 } from '@synthetos/safety';
import type { SentLine } from '@synthetos/safety';
import type { JobEvent, JobPhase, JobState, SessionEffect, SessionState, TimerId } from './types.ts';

/** The transition, as the job layer uses it (the reducer's `Tx`). */
export interface JobTx {
  s: SessionState;
  set(patch: Partial<SessionState>): void;
  emit(effect: SessionEffect): void;
  arm(id: TimerId, ms: number): void;
  cancel(id: TimerId): void;
}

/** Phases in which a job owns the machine: no other motion, no settings write, no disconnect. */
export const ACTIVE_PHASES: ReadonlySet<JobPhase> = new Set(['checking', 'preparing', 'running', 'draining', 'ending', 'pausing', 'paused', 'refused', 'outputsOff', 'toolChange', 'breakpoint', 'programStop', 'resuming']);

/** Most events a job keeps (the Live job tab shows them). */
export const MAX_JOB_EVENTS = 60;

export function jobActive(s: SessionState): boolean {
  return s.job !== null && ACTIVE_PHASES.has(s.job.phase);
}

export function patchJob(t: JobTx, patch: Partial<JobState>): void {
  t.set({ job: { ...(t.s.job as JobState), ...patch } });
}

export function jobEvent(t: JobTx, at: number, kind: JobEvent['kind'], text: string, line?: number): void {
  const job = t.s.job as JobState;
  const event: JobEvent = line === undefined ? { t: at, kind, text } : { t: at, kind, text, line };
  patchJob(t, { events: [...job.events, event].slice(-MAX_JOB_EVENTS) });
}

/**
 * The last line the board took: its number among the lines sent (`n`, 0 before any) and its file line (or the
 * first line before any), for "Stopped at line N" and the job card's frozen progress after a stop.
 */
export function lastTaken(job: JobState, executing: number | undefined): { readonly n: number; readonly line: number } {
  if (executing !== undefined && executing >= 1 && executing <= job.lines.length) return { n: executing, line: (job.lines[executing - 1] as SentLine).sourceLine };
  const byAnswer = job.acked > 0 ? job.lines[job.acked - 1]?.sourceLine : job.lines[0]?.sourceLine;
  return { n: job.acked, line: byAnswer ?? 0 };
}

/** The file line of the last line the board took (or the first line before any), for "Stopped at line N". */
export function lastFileLine(job: JobState, executing: number | undefined): number {
  return lastTaken(job, executing).line;
}

/**
 * Every job line still owed an answer is marked late: after `%` (the board drops its line buffers), an alarm
 * (the board rejects them one by one) or a fault, their answers may or may not come. A late answer is consumed;
 * a later data answer drops the late ones before it.
 */
export function forgetJobLines(t: JobTx): void {
  if (!t.s.expected.some((e) => e.purpose === 'job' && !e.late)) return;
  t.set({ expected: t.s.expected.map((e) => (e.purpose === 'job' ? { ...e, late: true } : e)) });
}

/** A stop sequence (Stop job, Spindle off, a fault) finished for this job: queue cleared, spindle and coolant off. */
export function jobStopped(t: JobTx, at: number): void {
  const job = t.s.job;
  if (job === null || !(ACTIVE_PHASES.has(job.phase) || job.stopping)) return;
  const taken = job.stoppedAt ?? lastTaken(job, t.s.live.line);
  const line = taken.line;
  const text = w42({ line });
  t.cancel('job');
  if (job.phase === 'failed') {
    patchJob(t, { stopping: false, message: `${job.message ?? 'The job ended.'} ${text}.`, endedAt: job.endedAt ?? at, faultStopAt: null, stoppedAt: taken });
  } else {
    patchJob(t, { phase: 'stopped', stopping: false, message: text, endedAt: at, faultStopAt: null, stoppedAt: taken });
  }
  jobEvent(t, at, 'warn', text, line);
}

/** The job ended without a stop sequence of its own (an alarm, a reset, a lost link). */
export function failJob(t: JobTx, at: number, text: string): void {
  const job = t.s.job;
  if (job === null || !ACTIVE_PHASES.has(job.phase)) return;
  const taken = lastTaken(job, t.s.live.line);
  const line = taken.line;
  t.cancel('job');
  patchJob(t, { phase: 'failed', message: text, endedAt: at, resumeSteps: [], stoppedAt: taken });
  forgetJobLines(t);
  jobEvent(t, at, 'error', text, line);
}
