/**
 * The Phase 3 job layer of the session reducer: streaming a whole G-code file (owner 2026-11-02; SAFETY §4.4a,
 * H70-H78; T-S108-T-S115).
 *
 * Pure functions over the reducer's transition, like motion.ts: they read the state, queue lines and realtime
 * bytes as effects and arm the `job` timer. The reducer calls them only when the session's release has jobs;
 * every intent has passed the allow-matrix first, and every line and byte is checked again by the write gate
 * when it is written (writePolicy.ts).
 *
 * What runs here:
 * - **Load** (H73): the file text is sanitised HERE, in the worker, with the live board's limits, offsets and
 *   modes read for it (`jobPrep` reads), never the preview's offline model (SAFETY §4.7). The lines never leave
 *   the worker; the page sees a summary.
 * - **Start**: the page's confirmations are checked again (homed or C36, the work zero C31, the spindle C32),
 *   then PREAMBLE: the prep reads are taken again and the file is sanitised again with the board's current
 *   position, offsets, modes and limits (`checking`; a jog, an offset, a settings write or a mode change since the
 *   load would otherwise leave the checked lines stale: independent review 2026-11-03, R3), then the line mode is
 *   read and set to 1 if it is not (`{"rxm":1}`, its own reviewed intent, read back), the footer must then be
 *   revision 3 (line mode, `f[2]` the free line slots), the feed-limit window and the job flag are sent where the
 *   board has them, and the job runs.
 * - **Streaming** (H76): a line is written only while the last footer's free slots, less every job line still
 *   owed an answer, leave more than `reserve` slots for control lines (`!`, `~`, `%` and `{...}` lines are served
 *   first by the board). The answers to data lines come in order; a refused line (non-zero status) holds the job
 *   at that line (H70), whether it was running or already pausing or paused: only Stop job or "Skip line" (C33)
 *   resumes it (independent review 2026-11-03, R4). Feeding stops before a tool change (H74) and a breakpoint
 *   (H75), after a program stop line (H36), and the final M2/M30 is held back until every earlier line is
 *   answered (H35).
 * - **Tool change** (H74): drained, then `M5` and `M9` are written and must each be answered with status 0
 *   (`outputsOff`) before the card says the outputs are off (W37) and the change-ready state is offered; a refusal
 *   or a missing answer ends the job with "use your E-stop" (independent review 2026-11-03, R6). The return after
 *   the change runs in explicit absolute millimetres (`G90 G21` on its own answered line) and puts the job's
 *   distance mode and units back before the job goes on (R1).
 * - **Pause** is `!`, **Resume** is `~` and streaming goes on from where it was; **Stop job** is the motion
 *   layer's flush sequence (`!`, `%` once held, `M5`, `M9`), then "Stopped at line N" (W42).
 *
 * Every decision about the machine uses polled `stat`, `hold`, `vel`, `qr` (SAFETY §4.2) of the poll cycle that
 * just completed, and only when all four were answered with status 0 (independent review 2026-11-03, R5), never
 * the last status report; the reported `line` drives progress and the planner view only.
 */
import { mapStat, type Dialect, type Response } from '@synthetos/protocol';
import {
    c35,
    w37,
    w38,
    w39,
    w40,
    w43,
    type Decision,
    type Intent,
    type SentLine
} from '@synthetos/safety';
import { forgetBoardModes } from './boardModes.ts';
import { feedLimitWindow } from './feedLimit.ts';
import { type JobDeps, type JobLayerTx } from './job/contract.ts';
import { JOB_LIMITS } from './job/limits.ts';
import { sanitizeLive } from './job/model.ts';
import { feedAccountingSafe, feedLimitLine, feedLimitSupported, sendJobFlag } from './job/runtime.ts';
import { ALLOWED, dataSettled, deny, dialect, job, jobsCapable, numberOf, prepReads, queue, startFailed, writeRealtime } from './job/shared.ts';
import { ACTIVE_PHASES, failJob, jobActive, jobEvent, lastFileLine, patchJob } from './jobState.ts';
import { resumeTravel, travelStartRefusal } from './jobTravel.ts';
import { queueModeReads } from './modes.ts';
import { MOTION_LIMITS, activeSystem, atRestPolled, beginHold, completedPoll, heldPolled, idleBase, requestPoll } from './motion.ts';
import { ABSOLUTE_MM_LINE, motionLineKind, restoreLine, returnXYLine, safeZLine, spindleLine } from './motionLines.ts';
import type { Expected, JobReportSummary, JobState, PendingRead, PolledValues, SessionIntent, SessionState } from './types.ts';

export { feedLimitWindow, foldFeedLimit, parseFeedMove, parseFeedSummary } from './feedLimit.ts';
export { type JobDeps, type JobLayerTx } from './job/contract.ts';
export { JOB_DIALECTS, JOB_LIMITS, JOB_PREP_TOKENS } from './job/limits.ts';
export { abandonLoad, onJobPrepAnswer, onLoadJob, textHash } from './job/load.ts';
export { liveMotion, liveStart, sanitizeLive } from './job/model.ts';
export { FEED_ACCOUNTING_MIN_FB, feedAccountingSafe, feedLimitLine, feedLimitSupported, jobFlagLine, jobFlagSupported, onFeedLimit, onJobRuntimeAnswer } from './job/runtime.ts';
export { jobsCapable } from './job/shared.ts';



/** The exact line-mode lines (H77): the write gate admits only these, only for the step in progress. */
export function rxmLine(value: 0 | 1): string {
  return `{"rxm":${value}}`;
}


function planner(s: SessionState): number {
  return dialect(s).limits.plannerBlocks;
}


// --- Start --------------------------------------------------------------------------------------------------

/** Start the loaded job (the matrix has allowed `startJob`: idle, no overlay). */
export function onStartJob(t: JobLayerTx, request: Extract<SessionIntent, { intent: 'startJob' }>, at: number): Decision {
  const s = t.s;
  if (!jobsCapable(s, t.config)) return deny('Jobs are not available with this release or this board.', 'Use the bench or staging build with an approved edge-next board.');
  const j = s.job;
  if (j === null || j.phase === 'loading') return deny('No job is loaded and checked.', 'Open a file and wait for the check.');
  if (j.phase === 'blocked' || j.report?.blocked === true) return deny('The check found something that stops this file.', 'Fix the file, or accept the offered changes.');
  if (j.phase !== 'ready' && j.phase !== 'done' && j.phase !== 'stopped' && j.phase !== 'failed') return deny('This job is already running.', 'Use Pause or Stop job.');
  if (s.motion !== null || s.rxm.step !== null || s.queue.length > 0 || s.expected.some((e) => !e.late) || s.writing !== null) return deny('The machine is busy.', 'Wait until it is idle.');
  if (s.reports.phase === 'seeding' || s.reports.phase === 'pending' || s.reports.phase === 'configuring') return deny('The connection is still being set up.', 'Wait a moment.');
  const confirm = request.confirm;
  if (typeof confirm !== 'object' || confirm === null) return deny('The start needs its confirmations.', 'Go through Check, Set zero and Start.');
  if (s.live.home !== 1 && confirm.unhomed !== true) return deny('The machine is not homed.', 'Home the machine, or confirm that you have checked it (C36).');
  if (confirm.workZero !== true) return deny("The job's work zero is not confirmed.", 'Check the work zero against your plan (C31).');
  if (j.report?.startsSpindle === true && confirm.spindle !== true) return deny('This job starts the spindle.', 'Confirm the spindle start (C32).');
  const travel = travelStartRefusal(j.report, confirm.travel);
  if (travel !== null) return deny(travel, 'Check that the job fits the machine, then confirm C40.');
  const breakpoints = cleanBreakpoints(request.breakpoints);
  if (breakpoints === null) return deny('The breakpoints are not valid.', 'Set them again.');
  // A fresh run (the first, or again after done, stopped or failed): the board's values are read again and the
  // file is checked again with them before anything is sent (R3): the lines checked at load may be stale after a
  // jog, an offset, a settings write or a mode change, and the earlier run itself changed the modal state.
  t.set({
    base: 'PREAMBLE',
    queue: [...s.queue, ...prepReads(s)],
    job: {
      ...j,
      phase: 'checking',
      next: 0,
      acked: 0,
      free: null,
      breakpoints,
      passed: null,
      stop: null,
      confirmed: 0,
      refused: null,
      toolChange: null,
      resumeSteps: [],
      startedAt: at,
      endedAt: null,
      pauseAt: null,
      message: null,
      rxmFrom: null,
      jobFlag: null,
      feedLimit: null,
      faultStopAt: null,
      stopping: false,
      startModes: { needs: [], modes: [], written: false }, // decided again with the values read now (jobModes.ts)
      ...(typeof confirm.travel === 'string' ? { travelConfirmed: confirm.travel } : {}),
      events: j.events,
    },
  });
  jobEvent(t, at, 'info', `Started ${j.name}: checking every line again with this board's current position, offsets, modes and limits.`);
  t.arm('job', JOB_LIMITS.drainPollMs);
  return ALLOWED;
}


function cleanBreakpoints(lines: unknown): readonly number[] | null {
  if (!Array.isArray(lines) || lines.length > JOB_LIMITS.maxBreakpoints) return null;
  if (!lines.every((l) => typeof l === 'number' && Number.isInteger(l) && l >= 1)) return null;
  return Object.freeze([...new Set(lines as number[])].sort((a, b) => a - b));
}


/** The window's breakpoints, any time (they take effect only on lines not yet sent, H75). */
export function onJobBreakpoints(t: JobLayerTx, lines: unknown, at: number): Decision {
  const j = t.s.job;
  if (j === null) return deny('No job is loaded.', 'Open a file first.');
  const clean = cleanBreakpoints(lines);
  if (clean === null) return deny('The breakpoints are not valid.', 'Set them again.');
  patchJob(t, { breakpoints: clean });
  if (ACTIVE_PHASES.has(j.phase)) {
    const queued = clean.filter((line) => queuedLine(j, line));
    if (queued.length > 0) jobEvent(t, at, 'warn', `Line ${queued.join(', ')} is already queued on the controller, so a breakpoint there cannot stop the job.`, queued[0]);
  }
  return ALLOWED;
}


/** True when file line `line` was already sent (and not yet passed): a breakpoint on it cannot be honoured (H75, W41). */
export function queuedLine(j: JobState, line: number): boolean {
  const sent = j.lines.slice(0, j.next);
  return sent.some((l) => l.sourceLine === line);
}


// --- Line mode (H77) ----------------------------------------------------------------------------------------

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
  if (!allowedNow || s.rxm.step !== null || !jobsCapable(s, t.config) || jobActive(s) || s.motion !== null) return;
  if (s.reports.phase === 'seeding' || s.reports.phase === 'pending' || s.reports.phase === 'configuring') return;
  if (s.queue.length > 0 || s.writing !== null || s.expected.some((e) => !e.late) || s.settingWrite?.phase === 'gate' || s.settingWrite?.phase === 'writing' || s.settingWrite?.phase === 'readback') return;
  if (s.job?.phase === 'loading' || s.job?.phase === 'checking') return;
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


// --- Streaming (H76) ----------------------------------------------------------------------------------------

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
  const j = s.job;
  if (j === null || j.phase !== 'running' || s.base !== 'RUNNING' || !allowedNow || s.footerRev !== 3) return;
  if (s.expected.some((e) => !e.late && e.purpose !== 'job') || s.writing !== null || s.queue.some((q) => q.purpose === 'motion')) return;
  let next = j.next;
  let room = slotRoom(s);
  const written: Expected[] = [];
  let sentLines = s.sent.lines;
  let stop: JobState['stop'] = null;
  while (next < j.lines.length) {
    const line = j.lines[next] as SentLine;
    if (j.passed !== next && line.toolChange !== undefined) {
      stop = { kind: 'toolChange', index: next };
      break;
    }
    if (j.passed !== next && isBreakpoint(j, next)) {
      stop = { kind: 'breakpoint', index: next };
      break;
    }
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


// --- Pause, resume ------------------------------------------------------------------------------------------

/** Pause (`!`) during a job. Returns false when the job layer does not handle it (the caller sends `!` alone). */
export function onJobPause(t: JobLayerTx, at: number): boolean {
  const j = t.s.job;
  if (j === null || !jobsCapable(t.s, t.config) || t.s.motion !== null) return false;
  if (j.phase !== 'running' && j.phase !== 'draining' && j.phase !== 'ending') return false;
  pauseJob(t, at, 'pause');
  return true;
}


function pauseJob(t: JobLayerTx, at: number, why: 'pause' | 'refused'): void {
  writeRealtime(t, 'feedhold', 'feedhold');
  t.set({ notices: { ...t.s.notices, pauseRequestedAt: at } });
  patchJob(t, { phase: why === 'refused' ? 'refused' : 'pausing', confirmed: 0, pauseAt: at });
  if (why === 'pause') jobEvent(t, at, 'info', 'Pause: feedhold sent.');
  requestPoll(t);
  t.arm('job', JOB_LIMITS.drainPollMs);
}


/** Resume a paused or stopped job (the matrix has allowed `resume`: HELD or PROGRAM_PAUSED, no overlay). */
export function onJobResume(t: JobLayerTx, request: Extract<SessionIntent, { intent: 'resume' }>, at: number): Decision {
  const s = t.s;
  const j = s.job;
  /* c8 ignore next -- the reducer calls this only for an active job */
  if (j === null) return deny('No job is paused.', 'Nothing to do.');
  if (s.rxm.step !== null || s.expected.some((e) => !e.late && e.purpose !== 'job')) return deny('The controller is still answering.', 'Wait a moment.');
  const held = s.live.hold !== undefined && s.live.hold !== 0;
  switch (j.phase) {
    case 'paused':
    case 'programStop': {
      if (held) writeRealtime(t, 'resume', 'jobLine');
      continueJob(t, at, 'Resumed.');
      return ALLOWED;
    }
    case 'refused': {
      if (request.skip !== true) return deny('A line was refused.', 'Use Stop job, or skip the line and continue (C33).');
      if (j.confirmed < 2 && j.pauseAt !== null) return deny('The hold is not confirmed yet.', 'Wait a moment.');
      if (held) writeRealtime(t, 'resume', 'jobLine');
      patchJob(t, { refused: null });
      continueJob(t, at, 'Skipped the refused line and resumed.');
      return ALLOWED;
    }
    case 'breakpoint': {
      patchJob(t, { passed: (j.stop as NonNullable<JobState['stop']>).index });
      continueJob(t, at, 'Resumed from the breakpoint.');
      return ALLOWED;
    }
    case 'toolChange':
      return resumeToolChange(t, request, at);
    default:
      return deny('The job is not paused.', 'Wait for the pause to complete.');
  }
}


function continueJob(t: JobLayerTx, at: number, text: string): void {
  sendJobFlag(t, 1);
  t.set({ base: 'RUNNING', notices: { ...t.s.notices, motion: { kind: 'resumed', text: 'Resumed', at } } });
  forgetBoardModes(t); // N5: the job's own lines run again (after a tool change the jog and the return set them meanwhile)
  patchJob(t, { phase: 'running', stop: null, confirmed: 0, pauseAt: null, message: null });
  jobEvent(t, at, 'info', text);
  t.arm('job', JOB_LIMITS.runPollMs);
}


/**
 * After a manual tool change (H74, C34): back to where the job stopped at a safe height if the machine was moved,
 * the spindle (and coolant) again when the file does not restart it (C35), then the M6 line itself, then on.
 */
function resumeToolChange(t: JobLayerTx, request: Extract<SessionIntent, { intent: 'resume' }>, at: number): Decision {
  const s = t.s;
  const j = s.job as JobState;
  const tc = j.toolChange as NonNullable<JobState['toolChange']>;
  // OD-24: offsets read again since the stop (the Z re-zero): the rest of the job is checked against the travel again,
  // from the values read at Start with only the re-zeroed Z offset changed (jobTravel.ts).
  const travel = resumeTravel(s, j, activeSystem(s), (state) => sanitizeLive(state, j.source.text, j.source.c22));
  if (travel.refusal !== null) return deny(travel.refusal, 'Use Stop job to end the job.');
  if (travel.note !== null) jobEvent(t, at, 'warn', travel.note);
  const steps: { line: string; intent: Intent }[] = [];
  const here = s.live.mpo;
  const back = tc.at;
  const moved = (['x', 'y', 'z'] as const).some((a) => back[a] !== undefined && (here[a] === undefined || Math.abs((here[a] as number) - (back[a] as number)) > JOB_LIMITS.returnToleranceMm));
  if (moved) {
    if (here.z === undefined || back.x === undefined || back.y === undefined || back.z === undefined) return deny('The machine position is not known.', 'Wait for the position to be reported.');
    // Explicit absolute millimetres on their own answered line first (R1): G53 keeps G91 and G20, under which the
    // "safe" Z would be a distance (down) or inches. Then the job's own modes are put back before it goes on.
    steps.push(
      { line: ABSOLUTE_MM_LINE, intent: 'resume' },
      { line: safeZLine(Math.max(here.z, back.z)), intent: 'resume' },
      { line: returnXYLine(back.x, back.y), intent: 'resume' },
      { line: restoreLine(tc.units, tc.dist), intent: 'resume' },
    );
  }
  const restart = tc.spindle !== 'off' && !tc.restartsSpindle;
  if (restart) {
    if (request.spindleRestart !== true || tc.speed === null) {
      return deny(tc.speed === null ? 'The spindle was on, but its speed is not known.' : c35({ direction: tc.spindle === 'cw' ? 'M3' : 'M4', rpm: tc.speed }), tc.speed === null ? 'Stop the job and restart it from a line that sets the speed.' : 'Confirm the spindle restart (C35).');
    }
    steps.push({ line: spindleLine(tc.spindle as 'cw', tc.speed), intent: 'resume' });
  }
  if (tc.mist) steps.push({ line: 'M7', intent: 'resume' });
  if (tc.flood) steps.push({ line: 'M8', intent: 'resume' });
  if (steps.some((x) => motionLineKind(x.line) === undefined)) return deny('The way back is out of range.', 'Stop the job.');
  if (moved && (tc.dist === undefined || tc.units === undefined)) return deny("The job's distance mode or units are not known, so they cannot be put back after the return.", 'Stop the job.');
  patchJob(t, { phase: 'resuming', resumeSteps: steps, passed: tc.index, confirmed: 0 });
  jobEvent(t, at, 'toolchange', `Resuming after the tool change${steps.length > 0 ? `: ${steps.map((x) => x.line).join(', ')}` : ''}.`, (s.job as JobState).lines[tc.index]?.sourceLine);
  nextResumeStep(t, at);
  return ALLOWED;
}


function nextResumeStep(t: JobLayerTx, at: number): void {
  const j = job(t.s);
  const [first, ...rest] = j.resumeSteps;
  if (first === undefined) {
    continueJob(t, at, 'Resumed after the tool change.');
    return;
  }
  patchJob(t, { resumeSteps: rest, confirmed: 0 });
  queue(t, { token: 'gc', purpose: 'motion', line: first.line, intent: first.intent });
  requestPoll(t);
  t.arm('job', JOB_LIMITS.drainPollMs);
}


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


// --- Polls and timer ----------------------------------------------------------------------------------------

/** At rest at a program stop: stat 3 or 4 (EN M0 holds with `hold` 6), nothing moving, planner empty (H36). */
function drainedAtBarrier(s: SessionState, p: PolledValues): boolean {
  const cls = mapStat(dialect(s), p.stat);
  return s.dwellWait == null && (cls === 'programStop' || cls === 'end' || cls === 'idle') && p.vel === 0 && p.qr === planner(s);
}


/** One poll cycle was answered (after `qr`), with no motion of the motion layer running. */
export function onJobPoll(t: JobLayerTx, at: number): void {
  const s = t.s;
  const j = s.job;
  if (j === null || !ACTIVE_PHASES.has(j.phase) || s.motion !== null) return;
  const p = completedPoll(s);
  if (p === null) {
    // A read of this cycle was rejected, damaged or missing: it confirms nothing, whatever the live view says (R5).
    if (j.phase === 'draining' || j.phase === 'ending' || j.phase === 'pausing' || j.phase === 'refused' || j.phase === 'resuming') {
      patchJob(t, { confirmed: 0 });
      requestPoll(t);
    }
    return;
  }
  const confirm = (ok: boolean): number => (ok ? j.confirmed + 1 : 0);
  switch (j.phase) {
    case 'draining':
    case 'ending': {
      const stop = j.stop as NonNullable<JobState['stop']>;
      const answered = j.acked >= j.next;
      const rest = stop.kind === 'barrier' ? drainedAtBarrier(s, p) : atRestPolled(s, p);
      const confirmed = confirm(answered && rest);
      patchJob(t, { confirmed });
      if (confirmed < MOTION_LIMITS.confirmations) {
        requestPoll(t);
        return;
      }
      stopReached(t, at, stop);
      return;
    }
    case 'pausing':
    case 'refused': {
      // The hold is complete, or the machine is at rest (nothing was moving): the job is paused at this line.
      // A `!` that landed before the cycle started is dropped, and a dwell reads vel 0: only a resting machine is at rest.
      const confirmed = confirm(heldPolled(s, p) || (atRestPolled(s, p) && j.acked >= j.next));
      patchJob(t, { confirmed });
      if (confirmed < MOTION_LIMITS.confirmations) {
        // `!` is dropped while no cycle runs yet (a line still parsing): send it again once a cycle has started.
        if (p.hold === 0 && !atRestPolled(s, p)) writeRealtime(t, 'feedhold', 'feedhold');
        if (j.pauseAt !== null && at - j.pauseAt > JOB_LIMITS.pauseNoAnswerMs && s.notices.motion?.kind !== 'failed') {
          t.set({ notices: { ...t.s.notices, motion: { kind: 'failed', text: "No answer from the board yet: use your E-stop if it's still moving", at } } });
        }
        requestPoll(t);
        return;
      }
      t.cancel('job');
      t.set({ base: 'HELD', notices: { ...t.s.notices, motion: { kind: 'paused', text: s.live.spe === 1 ? 'Paused · spindle still on' : 'Paused', at } } });
      if (j.phase === 'pausing') {
        patchJob(t, { phase: 'paused', message: s.live.spe === 1 ? 'Paused · spindle still on' : 'Paused' });
        jobEvent(t, at, 'info', 'Paused.', lastFileLine(j, s.live.line));
      }
      return;
    }
    case 'resuming': {
      const confirmed = confirm(atRestPolled(s, p) && dataSettled(s));
      patchJob(t, { confirmed });
      if (confirmed < MOTION_LIMITS.confirmations) {
        requestPoll(t);
        return;
      }
      nextResumeStep(t, at);
      return;
    }
    default:
      // running: the planner gauge's `qr` is now known, and a fresh f[2] came with the poll answers.
      return;
  }
}


function stopReached(t: JobLayerTx, at: number, stop: NonNullable<JobState['stop']>): void {
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


/** The `job` timer: the next poll, the STALE limit and the liveness grace period. */
export function onJobTimer(t: JobLayerTx, deps: JobDeps, at: number): void {
  const s = t.s;
  const j = s.job;
  if (j === null) return;
  if (j.faultStopAt !== null) {
    if (at >= j.faultStopAt && !j.stopping) {
      // SAFETY §3 effect 4: nobody stopped the job during the grace period: stop it with the spindle off.
      patchJob(t, { faultStopAt: null, stopping: true });
      beginHold(t, 'stopJob', at);
      return;
    }
    t.arm('job', Math.max(1, j.faultStopAt - at));
    return;
  }
  if (!ACTIVE_PHASES.has(j.phase)) return;
  if (s.overlays.includes('STALE') && s.stale !== null && (j.phase === 'running' || j.phase === 'draining' || j.phase === 'ending') && at - s.stale.at >= JOB_LIMITS.staleFaultMs) {
    deps.fault(t, 'staleWhileRunning', 'liveness', `no reports from the controller for ${Math.round((at - s.stale.at + s.stale.silentForMs) / 1000)} s while the job ran`, at);
    return;
  }
  if (j.phase === 'running') {
    requestPoll(t);
    t.arm('job', JOB_LIMITS.runPollMs);
    return;
  }
  if (j.phase === 'outputsOff' || j.phase === 'toolChange' || j.phase === 'breakpoint' || j.phase === 'programStop' || j.phase === 'paused' || j.phase === 'checking' || j.phase === 'preparing') {
    if (j.phase === 'checking' || j.phase === 'preparing') t.arm('job', JOB_LIMITS.drainPollMs);
    return;
  }
  requestPoll(t);
  t.arm('job', JOB_LIMITS.drainPollMs);
}


// --- Endings -------------------------------------------------------------------------------------------------

/** Stop job / Spindle off during a job: the motion layer's flush sequence; this marks the job as stopping. */
export function onJobStop(t: JobLayerTx, at: number): boolean {
  const j = t.s.job;
  if (j === null || !ACTIVE_PHASES.has(j.phase) || !jobsCapable(t.s, t.config)) return false;
  if (j.phase === 'checking' || (j.phase === 'preparing' && t.s.rxm.step?.kind === 'write')) {
    // Nothing was sent: the re-check's reads are dropped (R3), or the line-mode write is being answered (the EEPROM
    // stall) and is let finish; the job will not start.
    // OD-19: and the start-modes line, if it has not gone out yet.
    if (j.phase === 'checking') t.set({ queue: t.s.queue.filter((q) => q.purpose !== 'jobPrep' && q.intent !== 'jobModes') });
    patchJob(t, { phase: 'stopped', message: 'Stopped before the first line: nothing was sent.', endedAt: at });
    t.set({ base: idleBase(t.s) });
    t.cancel('job');
    return true;
  }
  patchJob(t, { stopping: true, faultStopAt: null, resumeSteps: [] });
  t.cancel('job');
  if (t.s.motion?.reason === 'stopJob') return false; // already stopping: the motion layer re-sends `!`
  beginHold(t, 'stopJob', at);
  return true;
}


/** The board reset during the job (H72): everything queued is gone. */
export function onJobReset(t: JobLayerTx, at: number): void {
  if (!jobActive(t.s)) return;
  const j = job(t.s);
  failJob(t, at, w40({ line: lastFileLine(j, t.s.live.line) }));
  t.set({ expected: t.s.expected.filter((e) => e.purpose !== 'job') });
}


/** The link dropped during the job (H71). */
export function onJobLinkLost(t: JobLayerTx, at: number): void {
  if (!jobActive(t.s)) return;
  failJob(t, at, `The connection was lost at line ${lastFileLine(job(t.s), t.s.live.line)}. The machine may keep running what it had queued.`);
}


/**
 * A FAULT latched during the job. Integrity: end it at once with the flush sequence (SAFETY §3 effect 3; the
 * maintainer's sequence in Phase 3, ^D stays unused). Liveness: the grace period, then the same (effect 4).
 */
export function onJobFault(t: JobLayerTx, kind: 'integrity' | 'liveness', detail: string, at: number, linkUsable: boolean): void {
  if (!jobActive(t.s)) return;
  const j = job(t.s);
  const line = lastFileLine(j, t.s.live.line);
  failJob(t, at, `The job ended at line ${line}: ${detail}.`);
  if (!linkUsable) return;
  if (kind === 'liveness') {
    patchJob(t, { faultStopAt: at + JOB_LIMITS.faultGraceMs });
    t.arm('job', JOB_LIMITS.faultGraceMs);
    return;
  }
  patchJob(t, { stopping: true });
  beginHold(t, 'stopJob', at);
}
