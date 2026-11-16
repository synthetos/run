import {
  type Decision
} from '@synthetos/safety';
import { ACTIVE_PHASES, jobEvent, patchJob } from '../jobState.ts';
import { travelStartRefusal } from '../jobTravel.ts';
import type { JobState, SessionIntent, SessionState } from '../types.ts';
import { type JobLayerTx } from './contract.ts';
import { JOB_LIMITS } from './limits.ts';
import { ALLOWED, deny, jobsCapable, prepReads } from './shared.ts';

/** Start the loaded job (the matrix has allowed `startJob`: idle, no overlay). */
export function onStartJob(t: JobLayerTx, request: Extract<SessionIntent, { intent: 'startJob' }>, at: number): Decision {
  const s = t.s;
  const refusal = startRefusal(t);
  if (refusal !== null) return refusal;
  const j = s.job as JobState;
  const confirm = request.confirm;
  const confirmation = confirmStart(s, j, confirm);
  if (confirmation !== null) return confirmation;
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

function startRefusal(t: JobLayerTx): Decision | null {
  const s = t.s;
  if (!jobsCapable(s, t.config)) return deny('Jobs are not available with this release or this board.', 'Use the bench or staging build with an approved edge-next board.');
  const j = s.job;
  if (j === null || j.phase === 'loading') return deny('No job is loaded and checked.', 'Open a file and wait for the check.');
  if (j.phase === 'blocked' || j.report?.blocked === true) return deny('The check found something that stops this file.', 'Fix the file, or accept the offered changes.');
  if (j.phase !== 'ready' && j.phase !== 'done' && j.phase !== 'stopped' && j.phase !== 'failed') return deny('This job is already running.', 'Use Pause or Stop job.');
  if (startBusy(s)) return deny('The machine is busy.', 'Wait until it is idle.');
  if (s.reports.phase === 'seeding' || s.reports.phase === 'pending' || s.reports.phase === 'configuring') return deny('The connection is still being set up.', 'Wait a moment.');
  return null;
}

function startBusy(s: SessionState): boolean {
  return s.motion !== null || s.rxm.step !== null || s.queue.length > 0 || s.expected.some((e) => !e.late) || s.writing !== null;
}

function confirmStart(s: SessionState, j: JobState, confirm: Extract<SessionIntent, { intent: 'startJob' }>['confirm']): Decision | null {
  if (typeof confirm !== 'object' || confirm === null) return deny('The start needs its confirmations.', 'Go through Check, Set zero and Start.');
  if (s.live.home !== 1 && confirm.unhomed !== true) return deny('The machine is not homed.', 'Home the machine, or confirm that you have checked it (C36).');
  if (confirm.workZero !== true) return deny("The job's work zero is not confirmed.", 'Check the work zero against your plan (C31).');
  if (j.report?.startsSpindle === true && confirm.spindle !== true) return deny('This job starts the spindle.', 'Confirm the spindle start (C32).');
  const travel = travelStartRefusal(j.report, confirm.travel);
  if (travel !== null) return deny(travel, 'Check that the job fits the machine, then confirm C40.');
  return null;
}
