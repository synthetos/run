import { type Response } from '@synthetos/protocol';
import {
  w39,
  type Decision
} from '@synthetos/safety';
import { forgetBoardModes } from '../boardModes.ts';
import { feedLimitWindow } from '../feedLimit.ts';
import { jobActive, jobEvent, patchJob } from '../jobState.ts';
import { idleBase } from '../motion.ts';
import type { SessionState } from '../types.ts';
import { type JobLayerTx } from './contract.ts';
import { JOB_LIMITS } from './limits.ts';
import { feedAccountingSafe, feedLimitLine, feedLimitSupported, sendJobFlag } from './runtime.ts';
import { ALLOWED, deny, jobsCapable, numberOf, queue } from './shared.ts';

/** The exact line-mode lines (H77): the write gate admits only these, only for the step in progress. */
export function rxmLine(value: 0 | 1): string {
  return `{"rxm":${value}}`;
}

/** The page told the session what it remembers of this board's line mode (null: nothing). */
/**
 * What this browser remembers of the board (H77): `remembered` is the value Run found before it changed the
 * board's rxm and has not put back yet (a pending record), or null when there is no such record. With no record,
 * the board's rxm is left exactly as found (edge-next's factory default is rxm 1).
 */
export function onLineModeMemory(t: JobLayerTx, remembered: unknown): Decision {
  if (remembered !== null && remembered !== 0 && remembered !== 1) return deny('The remembered line mode must be 0, 1 or nothing.', 'Nothing to do.');
  const rxm = t.s.rxm;
  // A job prepared in this session already knows the board's own value: it wins over the page's memory.
  if (remembered === null || rxm.restore !== null) t.set({ rxm: { ...rxm, memoryKnown: true } });
  else t.set({ rxm: { ...rxm, memoryKnown: true, restore: remembered, pending: true } });
  return ALLOWED;
}

/** The value to put back when no job runs, or null when nothing should be written: only what Run itself changed. */
export function rxmTarget(s: SessionState): 0 | 1 | null {
  if (!s.rxm.pending || s.rxm.restore === null) return null;
  return s.rxm.restore === 1 ? 1 : 0;
}

/**
 * Outside a job, a board in line mode (footer revision 3) whose remembered value is character mode is put back
 * (H77): after the job ends, and at connect after a crash left it in line mode. Started only from a quiet,
 * idle state with nothing else in progress.
 */
export function maybeRestoreLineMode(t: JobLayerTx, allowedNow: boolean): void {
  const s = t.s;
  if (restoreBlocked(s, t.config, allowedNow) || restoreBusy(s) || restoreLoading(s)) return;
  if (s.footerRev === 2) {
    settleLineModeRecord(t);
    return;
  }
  if (s.footerRev !== 3) return;
  const target = rxmTarget(s);
  if (target === null || target === 1) {
    if (s.rxm.memoryKnown && !s.rxm.leftAsFound) {
      // No record in this browser that Run changed this board: its line mode is its owner's choice.
      t.set({ rxm: { ...s.rxm, leftAsFound: true } });
      t.emit({ kind: 'log', text: 'line mode: the board is in line mode (rxm 1, footer revision 3) outside a job; no record here that Run changed it, so it is left as found' });
    }
    return;
  }
  t.set({ rxm: { ...s.rxm, step: { kind: 'write', purpose: 'restore', value: 0 }, footerExpect: 2, detail: null } });
  queue(t, { token: 'rxm', purpose: 'lineMode', value: 0 });
  t.emit({ kind: 'log', text: 'line mode: Run set this board to line mode and has not put it back yet; putting back rxm 0 (saved on the board)' });
}

/**
 * A pending record on a board that is already in character mode (footer revision 2) outside a job: someone put it
 * back, or the job's write never took. Nothing is written; the record is cleared.
 */
function settleLineModeRecord(t: JobLayerTx): void {
  const s = t.s;
  if (!s.rxm.pending) return;
  t.set({ rxm: { ...s.rxm, pending: false } });
  t.emit({ kind: 'log', text: 'line mode: the board is already in character mode (rxm 0); the record that Run changed it is cleared' });
}

/** The line-mode read, write or read-back was answered. */
export function onLineModeAnswer(t: JobLayerTx, r: Response | null, at: number): void {
  const s = t.s;
  const step = s.rxm.step;
  /* c8 ignore next -- a lineMode line is queued only with its step set, and the step ends only with its answer */
  if (step === null) return;
  const value = r === null ? undefined : numberOf(r.r['rxm']);
  const status = r === null ? -1 : r.footer.status;
  if (step.kind === 'write') {
    if (status !== 0) {
      lineModeFailed(t, at, `the controller refused rxm ${step.value} (status ${status})`);
      return;
    }
    t.set({ rxm: { ...s.rxm, step: { ...step, kind: 'readback' }, footerExpect: null } });
    queue(t, { token: 'rxm', purpose: 'lineMode' });
    return;
  }
  if (step.kind === 'read') {
    readLineMode(t, { value, status }, at);
    return;
  }
  // Read-back.
  if (status !== 0 || value !== step.value) {
    lineModeFailed(t, at, `rxm reads back ${value ?? 'nothing'} (status ${status}), not ${step.value}`);
    return;
  }
  const from = step.value === 1 ? 0 : 1;
  t.set({ rxm: { ...t.s.rxm, step: null, current: value, changed: { kind: step.purpose, from, to: step.value } } });
  t.emit({ kind: 'log', text: `line mode: rxm ${from} → ${step.value}, read back (saved on the board)` });
  if (step.purpose === 'restore') {
    t.set({ rxm: { ...t.s.rxm, pending: false, leftAsFound: false } });
    if (t.s.job !== null) jobEvent(t, at, 'info', `Line mode put back: rxm ${step.value} (saved on the board).`);
    return;
  }
  jobEvent(t, at, 'info', w39());
  lineModeReady(t, at);
}

/** A job is being prepared and nobody has stopped it. */
function preparing(s: SessionState): boolean {
  return s.job !== null && s.job.phase === 'preparing' && !s.job.stopping;
}

function lineModeFailed(t: JobLayerTx, at: number, why: string): void {
  const step = t.s.rxm.step;
  t.set({ rxm: { ...t.s.rxm, step: null, footerExpect: null, detail: why } });
  t.emit({ kind: 'log', text: `line mode: ${why}` });
  if (step?.purpose === 'job' && preparing(t.s)) {
    // Nothing was streamed: the job did not start. A changed rxm is put back by the restore that follows.
    t.cancel('job');
    t.set({ base: idleBase(t.s) });
    patchJob(t, { phase: 'failed', message: `The job did not start: line mode could not be confirmed (${why}).`, endedAt: at });
    jobEvent(t, at, 'error', `The job did not start: line mode could not be confirmed (${why}).`);
  }
}

/** Line mode is set: the footer must say so (revision 3) before a single job line goes out. */
function lineModeReady(t: JobLayerTx, at: number): void {
  if (preparing(t.s) && t.s.footerRev !== 3) {
    lineModeFailed(t, at, `the controller's footer is revision ${t.s.footerRev ?? 'unknown'}, not 3 (line mode)`);
    return;
  }
  t.set({ rxm: { ...t.s.rxm, step: null } });
  // Stopped while the line mode was being set: the job does not start (a changed rxm is put back afterwards).
  if (!preparing(t.s)) return;
  // The feed-limit window (accepted only at quiescence: the machine is idle now) and the job flag, where the board has them.
  // N66 (holds could leave the motors a step off) is fixed from fb 450.02: feed accounting is on there, and on
  // earlier builds only where a release turns it on (Release.feedAccounting, set by no shipped release).
  if ((t.config.release.feedAccounting === true || feedAccountingSafe(t.s)) && feedLimitSupported(t.s)) {
    queue(t, { token: 'rt', purpose: 'jobRuntime', line: feedLimitLine(JOB_LIMITS.feedLimitS) });
    patchJob(t, { feedLimit: feedLimitWindow(JOB_LIMITS.feedLimitS) });
    if (t.s.rtLeaves.includes('fg')) queue(t, { token: 'rt', purpose: 'jobRuntime', line: '{"rt":{"fg":1}}' });
  }
  sendJobFlag(t, 1);
  t.set({ base: 'RUNNING' });
  forgetBoardModes(t); // OD-19: the job's own lines and its M2/M30 set them; read again after the job (jobOffsets.ts)
  patchJob(t, { phase: 'running' });
  jobEvent(t, at, 'info', 'Streaming in line mode.');
  t.arm('job', JOB_LIMITS.runPollMs);
}

function restoreBlocked(s: SessionState, config: JobLayerTx['config'], allowedNow: boolean): boolean {
  if (!allowedNow || s.rxm.step !== null || !jobsCapable(s, config) || jobActive(s) || s.motion !== null) return true;
  if (s.reports.phase === 'seeding' || s.reports.phase === 'pending' || s.reports.phase === 'configuring') return true;
  return false;
}

function restoreBusy(s: SessionState): boolean {
  if (s.queue.length > 0 || s.writing !== null || s.expected.some((e) => !e.late) || s.settingWrite?.phase === 'gate' || s.settingWrite?.phase === 'writing' || s.settingWrite?.phase === 'readback') return true;
  return false;
}

function restoreLoading(s: SessionState): boolean {
  if (s.job?.phase === 'loading' || s.job?.phase === 'checking') return true;
  return false;
}

function readLineMode(t: JobLayerTx, answer: { value: number | undefined; status: number }, at: number): void {
  const s = t.s;
  const { value, status } = answer;
  // Job preparation: the board's own value is what is put back when the job ends.
  if (status !== 0 || value === undefined) {
    lineModeFailed(t, at, `the rxm read failed (status ${status})`);
    return;
  }
  // A pending record (Run changed this board on an earlier link and never put it back) keeps its own value.
  t.set({ rxm: { ...s.rxm, current: value, restore: s.rxm.pending ? s.rxm.restore : value === 1 ? 1 : 0, memoryKnown: true } });
  patchJob(t, { rxmFrom: value });
  if (value === 1) {
    lineModeReady(t, at);
    return;
  }
  // Stopped while the rxm read was answered: nothing more is written for the job.
  if (!preparing(t.s)) return;
  // Pending from here: if this tab goes away mid-job, the next connect from this browser puts the value back.
  t.set({ rxm: { ...t.s.rxm, step: { kind: 'write', purpose: 'job', value: 1 }, footerExpect: 3, pending: true } });
  queue(t, { token: 'rxm', purpose: 'lineMode', value: 1 });
  return;
}
