import { type Dialect, type Response } from '@synthetos/protocol';
import {
  w38,
  type SentLine
} from '@synthetos/safety';
import { ACTIVE_PHASES, jobEvent, patchJob } from '../jobState.ts';
import { requestPoll } from '../motion.ts';
import type { Expected, JobState, PendingRead, SessionState } from '../types.ts';
import { type JobLayerTx } from './contract.ts';
import { JOB_LIMITS } from './limits.ts';
import { pauseJob } from './resume.ts';
import { sendJobFlag } from './runtime.ts';
import { dialect } from './shared.ts';

/** Job lines still owed an answer (not late). */
export function jobInFlight(s: SessionState): number {
  let n = 0;
  for (const e of s.expected) if (e.purpose === 'job' && !e.late) n++;
  return n;
}

/** Free line slots there are room for now: the last footer's free count less every line still owed. */
export function slotRoom(s: SessionState): number {
  const free = s.job?.free;
  return free === null || free === undefined ? 0 : free - jobInFlight(s);
}

function isBreakpoint(j: JobState, index: number): boolean {
  const line = j.lines[index] as SentLine;
  if (!j.breakpoints.includes(line.sourceLine)) return false;
  // Only at the first sent line of that file line (a split move is one file line).
  return index === 0 || (j.lines[index - 1] as SentLine).sourceLine !== line.sourceLine;
}

/**
 * Writes job lines while the slots allow (the reducer calls it at the end of every transition). Never more than
 * the free slots less the reserve; never while a non-job line is owed (one control line at a time, and data lines
 * stay in order); stops before a tool change and a breakpoint, after a program stop line; holds the final M2/M30
 * back until every earlier line is answered (H35).
 */
export function pumpJob(t: JobLayerTx, allowedNow: boolean): void {
  const s = t.s;
  const j = s.job as JobState;
  if (!canPump(s, allowedNow)) return;
  let next = j.next;
  let room = slotRoom(s);
  const written: Expected[] = [];
  let sentLines = s.sent.lines;
  let stop: JobState['stop'] = null;
  while (next < j.lines.length) {
    const line = j.lines[next] as SentLine;
    stop = stopBefore(j, next, line);
    if (stop !== null) break;
    if (line.holdback && (j.acked < next || written.length > 0)) break;
    if (room <= JOB_LIMITS.reserve) break;
    sentLines++;
    t.emit({ kind: 'writeLine', epoch: s.epoch, seq: sentLines, token: 'job', line: line.text, intent: 'jobLine', index: next });
    written.push({ token: 'job', purpose: 'job', index: next, late: false });
    room--;
    next++;
    if (line.barrier) {
      stop = { kind: 'barrier', index: next - 1 };
      break;
    }
  }
  if (written.length > 0) t.set({ expected: [...t.s.expected, ...written], sent: { ...t.s.sent, lines: sentLines } });
  if (next !== j.next) patchJob(t, { next });
  if (stop === null && next >= j.lines.length) stop = { kind: 'end', index: j.lines.length - 1 };
  if (stop !== null) beginDrain(t, stop);
}

/** Feeding stopped before (or after) a stop point: wait for every answer and two polled reads at rest. */
function beginDrain(t: JobLayerTx, stop: NonNullable<JobState['stop']>): void {
  // The job flag goes off before run's own deliberate stops and after the last line (feed-limit step 3).
  sendJobFlag(t, 0);
  patchJob(t, { phase: stop.kind === 'end' ? 'ending' : 'draining', stop, confirmed: 0 });
  requestPoll(t);
  t.arm('job', JOB_LIMITS.drainPollMs);
}

/** A job line was answered (data answers come in order). */
export function onJobAnswer(t: JobLayerTx, e: PendingRead, r: Response, at: number): void {
  const j = t.s.job;
  /* c8 ignore next -- job lines are owed only while their job exists (a new load or connect clears them) */
  if (j === null) return;
  const index = e.index as number;
  // (The free slots of its footer were taken by the reducer, as for every revision 3 answer.)
  patchJob(t, { acked: Math.max(j.acked, index + 1) });
  if (r.footer.status === 0 || !ACTIVE_PHASES.has(j.phase)) return;
  // H70: a refused line. Nothing after it is sent; the job is held at that line until the user decides.
  const line = j.lines[index] as SentLine;
  const status = r.footer.status;
  const meaning = statusMeaning(dialect(t.s), status);
  const text = w38({ line: line.sourceLine, status, meaning });
  jobEvent(t, at, 'error', text, line.sourceLine);
  if (j.refused !== null) return;
  patchJob(t, { refused: { index, status, text: line.body }, message: text });
  if (j.stopping) return;
  if (j.phase === 'pausing' || j.phase === 'paused') {
    // The refusal arrived during a Pause (R4): the hold already asked for (or confirmed) is the refusal's hold,
    // and the job is `refused` from here, so a plain Resume is denied until the line is skipped (C33) or the job
    // is stopped, and the page keeps the refusal card.
    patchJob(t, { phase: 'refused' });
    return;
  }
  pauseJob(t, at, 'refused');
}

/** Plain words for a status code (W38). */
export function statusMeaning(d: Dialect, status: number): string {
  const entry = d.status.get(status);
  if (entry === undefined) return 'an error';
  if (entry.meaning !== undefined) return entry.meaning;
  switch (entry.statusClass) {
    case 'softLimit':
      return 'outside the soft limits';
    case 'mcodeUnsupported':
      return 'an M code this firmware does not support';
    case 'notAccepted':
      return 'not accepted now';
    case 'overlong':
      return 'the line is too long';
    case 'rejectedAlarm':
    case 'rejectedShutdown':
    case 'rejectedPanic':
      return 'the controller is in alarm';
    case 'bufferFull':
      return 'the line or its answer was damaged';
    default:
      return entry.name.toLowerCase().replace(/_/g, ' ');
  }
}

function canPump(s: SessionState, allowedNow: boolean): boolean {
  const j = s.job;
  if (j === null || j.phase !== 'running' || s.base !== 'RUNNING' || !allowedNow || s.footerRev !== 3) return false;
  if (s.expected.some((e) => !e.late && e.purpose !== 'job') || s.writing !== null || s.queue.some((q) => q.purpose === 'motion')) return false;
  return true;
}

function stopBefore(j: JobState, next: number, line: SentLine): JobState['stop'] {
  if (j.passed !== next && line.toolChange !== undefined) {
    return { kind: 'toolChange', index: next };
  }
  if (j.passed !== next && isBreakpoint(j, next)) {
    return { kind: 'breakpoint', index: next };
  }
  return null;
}
