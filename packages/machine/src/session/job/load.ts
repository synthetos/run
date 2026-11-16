import { type Response } from '@synthetos/protocol';
import {
  type Decision,
  type SanitizeResult,
  type SentLine
} from '@synthetos/safety';
import { noteModeRead } from '../boardModes.ts';
import { startModesStep, startNeeds } from '../jobModes.ts';
import { jobActive, jobEvent, patchJob } from '../jobState.ts';
import { travelOf, travelStartRefusal, withTravel } from '../jobTravel.ts';
import { clearMotionNotice, idleBase } from '../motion.ts';
import type { JobReportSummary, JobState, PendingRead, SessionIntent } from '../types.ts';
import { type JobLayerTx } from './contract.ts';
import { JOB_LIMITS } from './limits.ts';
import { sanitizeLive } from './model.ts';
import { ALLOWED, deny, job, jobsCapable, prepReads, queue, startFailed } from './shared.ts';

/** FNV-1a (32 bit) of the text, as 8 hex digits: an identity for the page to compare, not a security hash. */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freezeDeep((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

/** Load or unload a job (the matrix has allowed `loadJob`). */
export function onLoadJob(t: JobLayerTx, request: Extract<SessionIntent, { intent: 'loadJob' }>, at: number): Decision {
  const s = t.s;
  if (!jobsCapable(s, t.config)) return deny('Jobs are not available with this release or this board.', 'Use the bench or staging build with an approved edge-next board.');
  if (jobActive(s)) return deny('A job is running.', 'Stop or finish it first.');
  if (s.motion !== null || s.rxm.step !== null || s.queue.some((q) => q.purpose === 'jobPrep')) return deny('The machine is busy.', 'Wait until it is idle.');
  if (s.base !== 'IDLE_UNHOMED' && s.base !== 'IDLE_HOMED' && s.base !== 'CONNECTED_UNKNOWN') return deny('A job is loaded only while the machine is idle.', 'Wait until the machine is idle.');
  if (request.job === null) {
    t.set({ job: null });
    return ALLOWED;
  }
  const { name, text, c22 } = request.job;
  const refusal = fileRefusal(name, text);
  if (refusal !== null) return refusal;
  const id = (s.job?.id ?? 0) + 1;
  t.set({ job: emptyJob(id, name, text, c22 === true), queue: [...s.queue, ...prepReads(s)] });
  jobEvent(t, at, 'info', `Loaded ${name}: checking every line with this board's limits and offsets.`);
  return ALLOWED;
}

function emptyJob(id: number, name: string, text: string, c22: boolean): JobState {
  return {
    id,
    name,
    hash: textHash(text),
    bytes: text.length,
    phase: 'loading',
    source: { text, c22 },
    lines: [],
    secondsFrom: [],
    report: null,
    next: 0,
    acked: 0,
    free: null,
    breakpoints: [],
    passed: null,
    stop: null,
    confirmed: 0,
    refused: null,
    toolChange: null,
    resumeSteps: [],
    startedAt: null,
    endedAt: null,
    pauseAt: null,
    message: null,
    events: [],
    rxmFrom: null,
    jobFlag: null,
    feedLimit: null,
    faultStopAt: null,
    stopping: false,
  };
}

/** One prep read was answered (or arrived damaged: `r` null). When the last is in, the file is sanitised. */
export function onJobPrepAnswer(t: JobLayerTx, e: PendingRead, r: Response | null, at: number): void {
  const value = r === null ? null : (r.r[e.token] ?? null);
  t.set({ values: { ...t.s.values, [e.token]: { value, status: r === null ? -1 : r.footer.status, at } } });
  noteModeRead(t, e.token, r === null ? -1 : r.footer.status, value);
  if (t.s.queue.some((q) => q.purpose === 'jobPrep')) return;
  if (t.s.job?.phase === 'loading') finishLoad(t, at);
  else if (t.s.job?.phase === 'checking') finishCheck(t, at);
}

/**
 * The prep reads were dropped (a timeout, a fault, a lost link): a load fails with nothing sanitised; a Start's
 * re-check (R3) ends the job before anything was sent.
 */
export function abandonLoad(t: JobLayerTx, at: number, why: string): void {
  const j = t.s.job;
  if (j === null || (j.phase !== 'loading' && j.phase !== 'checking')) return;
  t.set({ queue: t.s.queue.filter((q) => q.purpose !== 'jobPrep') });
  if (j.phase === 'checking') {
    startFailed(t, at, `The job did not start: the file could not be checked again (${why}).`);
    return;
  }
  patchJob(t, { phase: 'blocked', message: `The file could not be checked: ${why}.` });
  jobEvent(t, at, 'error', `The file could not be checked: ${why}.`);
}

function summary(result: SanitizeResult): JobReportSummary {
  const counts = { block: 0, warn: 0, change: 0, info: 0 };
  for (const e of result.report.entries) counts[e.severity]++;
  const speeds = new Set<number>();
  let startsSpindle = false;
  for (const l of result.lines) {
    if (!/\bM0*[34](?!\d|\.)/.test(l.body)) continue;
    startsSpindle = true;
    const m = /S\s*([0-9.]+)/i.exec(l.body);
    if (m !== null) speeds.add(Number(m[1]));
  }
  return {
    blocked: result.report.blocked,
    counts,
    blocks: result.report.entries.filter((e) => e.severity === 'block').slice(0, 8).map((e) => ({ line: e.line, message: e.message })),
    splits: result.report.splits.length,
    longestMoveSeconds: result.report.longestMoveSeconds,
    endState: result.report.endState,
    toolChanges: result.lines.filter((l) => l.toolChange !== undefined).map((l) => l.sourceLine),
    startsSpindle,
    speeds: [...speeds].slice(0, 8),
    seconds: result.lines.reduce((sum, l) => sum + (l.motion?.seconds ?? 0), 0),
  };
}

/** Sanitises the job's source with the values just read and stores the lines, the report and the time estimates. */
function sanitizeInto(t: JobLayerTx): { readonly result: SanitizeResult; readonly report: JobReportSummary } {
  const j = job(t.s);
  const result = sanitizeLive(t.s, j.source.text, j.source.c22);
  // OD-24: the travel check against the board's soft limits (travelCheck.ts).
  const report = withTravel(summary(result), travelOf(t.s, result));
  const secondsFrom: number[] = new Array<number>(result.lines.length + 1).fill(0);
  for (let i = result.lines.length - 1; i >= 0; i--) secondsFrom[i] = (secondsFrom[i + 1] as number) + ((result.lines[i] as SentLine).motion?.seconds ?? 0);
  patchJob(t, { lines: freezeDeep([...result.lines]), secondsFrom: Object.freeze(secondsFrom), report });
  return { result, report };
}

function checkedText(result: SanitizeResult, report: JobReportSummary): string {
  return report.blocked
    ? `Checked with this board's values: ${report.counts.block} ${report.counts.block === 1 ? 'finding stops' : 'findings stop'} this file.`
    : `Checked with this board's values: ${result.lines.length} lines to send${report.toolChanges.length > 0 ? `, ${report.toolChanges.length} tool ${report.toolChanges.length === 1 ? 'change' : 'changes'}` : ''}.`;
}

function finishLoad(t: JobLayerTx, at: number): void {
  const { result, report } = sanitizeInto(t);
  // OD-19: what Start will write for the modes the preview assumes, shown at the check (decided again at Start).
  patchJob(t, { phase: report.blocked ? 'blocked' : 'ready', startModes: { needs: startNeeds(t.s, result.lines), modes: [], written: false } });
  jobEvent(t, at, report.blocked ? 'error' : 'info', checkedText(result, report));
}

/**
 * The prep reads taken at Start are in (R3): the file is sanitised again with the board's values as they are now.
 * What the check found stops the start; otherwise the line mode is checked next (PREAMBLE goes on).
 */
function finishCheck(t: JobLayerTx, at: number): void {
  // OD-19: the modes the preview assumes, written and read back first when the file relies on them (jobModes.ts).
  const modes = startModesStep(t, at, prepReads(t.s));
  if (modes.kind === 'wait') return;
  if (modes.kind === 'refused') {
    startFailed(t, at, modes.text);
    return;
  }
  // OD-24 (review M1): the values this check uses, kept for the Resume re-check after a Z re-zero.
  patchJob(t, { startValues: t.s.values });
  const { result, report } = sanitizeInto(t);
  if (report.blocked) {
    t.cancel('job');
    t.set({ base: idleBase(t.s) });
    patchJob(t, { phase: 'blocked', startedAt: null, message: `The job did not start. ${checkedText(result, report)}` });
    jobEvent(t, at, 'error', `The job did not start. ${checkedText(result, report)}`);
    return;
  }
  // OD-24: a travel finding that appears only now (the board as read at Start) needs the C40 the Start did not carry.
  const travel = travelStartRefusal(report, t.s.job?.travelConfirmed);
  if (travel !== null) {
    startFailed(t, at, `The job did not start. ${travel}`);
    return;
  }
  jobEvent(t, at, 'info', `${checkedText(result, report)} Checking the line mode.`);
  t.set({ rxm: { ...t.s.rxm, step: { kind: 'read', purpose: 'job', value: 1 }, detail: null } });
  patchJob(t, { phase: 'preparing' });
  clearMotionNotice(t);
  queue(t, { token: 'rxm', purpose: 'lineMode' });
  t.arm('job', JOB_LIMITS.drainPollMs);
}

function fileRefusal(name: string, text: string): Decision | null {
  if (typeof name !== 'string' || name.trim() === '' || name.length > 200) return deny('The file needs a name.', 'Open the file again.');
  if (typeof text !== 'string' || text.length === 0) return deny('The file is empty.', 'Open another file.');
  if (text.length > JOB_LIMITS.maxBytes) return deny(`The file is larger than ${JOB_LIMITS.maxBytes / 1024 / 1024} MB.`, 'Split the job.');
  return null;
}
