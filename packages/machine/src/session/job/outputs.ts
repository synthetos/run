import {
  w37,
  w43,
  type SentLine
} from '@synthetos/safety';
import { jobEvent, patchJob } from '../jobState.ts';
import { queueModeReads } from '../modes.ts';
import { idleBase } from '../motion.ts';
import type { JobReportSummary, JobState } from '../types.ts';
import { type JobLayerTx } from './contract.ts';
import { feedLimitLine } from './runtime.ts';
import { dataSettled, job, queue, startFailed } from './shared.ts';

/**
 * A motion line of the job layer was answered: a tool change's `M5` or `M9` (`outputsOff`, R6), or a resume step.
 * A refused shutdown line fails the job closed (the outputs may still be on); a refused resume step ends the
 * resume (the job stays at the tool change). Returns false when the answer is not the job layer's.
 */
export function onJobMotionAnswer(t: JobLayerTx, line: string | undefined, status: number, at: number): boolean {
  const j = t.s.job;
  if (j === null) return false;
  // OD-19: the start-modes line; its read-back decides, a refusal ends the start at once.
  if (j.phase === 'checking') {
    if (status !== 0) startFailed(t, at, `The job did not start: the controller refused ${String(line)} (status ${status}).`);
    return true;
  }
  if (j.phase === 'outputsOff') {
    if (status !== 0) {
      outputsOffFailed(t, at, `the controller refused ${String(line)} (status ${status})`);
      return true;
    }
    // Both M5 and M9 answered with status 0 (one line at a time, in order): now the card may say they are off.
    if (dataSettled(t.s)) changeReady(t, at);
    return true;
  }
  if (j.phase !== 'resuming') return false;
  if (status !== 0) {
    patchJob(t, { phase: 'toolChange', resumeSteps: [], passed: null });
    jobEvent(t, at, 'error', `The controller refused ${String(line)} (status ${status}); the job is still at the tool change.`);
  }
  return true;
}

/** A motion line of the job layer went unanswered (the answer timer, `readAnswerMs`): fail closed (R6). */
export function onJobMotionTimeout(t: JobLayerTx, line: string | undefined, at: number): void {
  const j = t.s.job;
  if (j === null) return;
  if (j.phase === 'checking') {
    startFailed(t, at, `The job did not start: the controller did not answer ${String(line)} in time.`);
    return;
  }
  if (j.phase === 'outputsOff') {
    outputsOffFailed(t, at, `the controller did not answer ${String(line)} in time`);
    return;
  }
  if (j.phase === 'resuming') {
    t.set({ queue: t.s.queue.filter((q) => q.purpose !== 'motion') });
    patchJob(t, { phase: 'toolChange', resumeSteps: [], passed: null });
    jobEvent(t, at, 'error', `The controller did not answer ${String(line)} in time; the job is still at the tool change.`);
  }
}

/** The spindle or coolant could not be confirmed off at a tool change (R6): the job ends, the outputs may be on. */
function outputsOffFailed(t: JobLayerTx, at: number, why: string): void {
  const j = job(t.s);
  const line = j.lines[(j.toolChange as NonNullable<JobState['toolChange']>).index]?.sourceLine ?? 0;
  const text = `The job ended at the tool change at line ${line}: ${why}. The spindle and coolant may still be on: use your E-stop or the controller's own stop.`;
  t.cancel('job');
  t.set({ queue: t.s.queue.filter((q) => q.purpose !== 'motion'), base: idleBase(t.s), notices: { ...t.s.notices, adviseEstop: true } });
  patchJob(t, { phase: 'failed', message: text, endedAt: at, toolChange: null, stop: null });
  jobEvent(t, at, 'error', text);
}

/** `M5` and `M9` are answered (R6): the tool-change card (W37) and its Resume, jog and Z re-zero are offered. */
function changeReady(t: JobLayerTx, at: number): void {
  const j = job(t.s);
  const tc = j.toolChange as NonNullable<JobState['toolChange']>;
  patchJob(t, { phase: 'toolChange', message: w37() });
  jobEvent(t, at, 'toolchange', `Spindle and coolant off (M5 and M9 answered). Tool change at line ${j.lines[tc.index]?.sourceLine ?? 0}${tc.tool === null ? '' : `: T${tc.tool}`}.`, j.lines[tc.index]?.sourceLine);
}

export function stopReached(t: JobLayerTx, at: number, stop: NonNullable<JobState['stop']>): void {
  const s = t.s;
  const j = job(s);
  t.cancel('job');
  if (stop.kind === 'end') {
    if (j.feedLimit !== null) {
      queue(t, { token: 'rt', purpose: 'jobRuntime', line: feedLimitLine(0) });
      if (t.s.rtLeaves.includes('fg')) queue(t, { token: 'rt', purpose: 'jobRuntime', line: '{"rt":{"fg":0}}' });
    }
    // A job is sanitised before it can start, so its report exists.
    const end = (j.report as JobReportSummary).endState;
    const outputs = end.spindle === 'off' && !end.mist && !end.flood ? 'spindle and coolant commanded off' : `spindle ${end.spindle === 'off' ? 'off' : 'ON'}, coolant ${end.mist || end.flood ? 'ON' : 'off'} (commanded)`;
    const text = `Job finished: ${j.lines.length} lines, ${outputs}.`;
    t.set({ base: idleBase(s) });
    patchJob(t, { phase: 'done', message: text, endedAt: at, stop: null });
    jobEvent(t, at, 'info', text);
    return;
  }
  const line = (j.lines[stop.index] as SentLine).sourceLine;
  t.set({ base: 'PROGRAM_PAUSED' });
  if (stop.kind === 'toolChange') {
    const tc = (j.lines[stop.index] as SentLine).toolChange as NonNullable<SentLine['toolChange']>;
    // H74: the spindle and coolant go off before anyone reaches in. The card says so (W37) only once M5 and M9
    // are each answered with status 0 (`outputsOff`, R6); a refusal or a missing answer ends the job closed.
    // The job's units and distance mode, read at rest after every line of the job was answered and before M5, so
    // they are known when the card comes (modes.ts): the last pushed report may predate the job's last mode change.
    queueModeReads(t, 'toolChange');
    queue(t, { token: 'gc', purpose: 'motion', line: 'M5', intent: 'spindleOffNow' });
    queue(t, { token: 'gc', purpose: 'motion', line: 'M9', intent: 'spindleOffNow' });
    patchJob(t, {
      phase: 'outputsOff',
      message: `Tool change at line ${line}: turning the spindle and coolant off (M5, M9). Wait for the card.`,
      toolChange: { index: stop.index, ...tc, at: { ...s.live.mpo }, units: undefined, dist: undefined, stoppedAt: at },
    });
    jobEvent(t, at, 'toolchange', `Tool change at line ${line}${tc.tool === null ? '' : `: T${tc.tool}`}: sending M5 and M9.`, line);
    return;
  }
  if (stop.kind === 'breakpoint') {
    const text = `${w43({ line })}${s.live.spe === 1 ? ' · spindle still on' : ''}`;
    patchJob(t, { phase: 'breakpoint', message: text });
    jobEvent(t, at, 'info', text, line);
    return;
  }
  const text = `Program stop at line ${line}: the spindle and coolant may still be running.`;
  patchJob(t, { phase: 'programStop', message: text });
  jobEvent(t, at, 'warn', text, line);
}
