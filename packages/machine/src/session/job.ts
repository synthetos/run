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
import { mapStat } from '@synthetos/protocol';
import {
    w40
} from '@synthetos/safety';
import { type JobDeps, type JobLayerTx } from './job/contract.ts';
import { JOB_LIMITS } from './job/limits.ts';
import { stopReached } from './job/outputs.ts';
import { nextResumeStep } from './job/resume.ts';
import { dataSettled, dialect, job, jobsCapable, writeRealtime } from './job/shared.ts';
import { ACTIVE_PHASES, failJob, jobActive, jobEvent, lastFileLine, patchJob } from './jobState.ts';
import { MOTION_LIMITS, atRestPolled, beginHold, completedPoll, heldPolled, idleBase, requestPoll } from './motion.ts';
import type { JobState, PolledValues, SessionState } from './types.ts';

export { feedLimitWindow, foldFeedLimit, parseFeedMove, parseFeedSummary } from './feedLimit.ts';
export { type JobDeps, type JobLayerTx } from './job/contract.ts';
export { JOB_DIALECTS, JOB_LIMITS, JOB_PREP_TOKENS } from './job/limits.ts';
export { maybeRestoreLineMode, onLineModeAnswer, onLineModeMemory, rxmLine, rxmTarget } from './job/lineMode.ts';
export { abandonLoad, onJobPrepAnswer, onLoadJob, textHash } from './job/load.ts';
export { liveMotion, liveStart, sanitizeLive } from './job/model.ts';
export { onJobMotionAnswer, onJobMotionTimeout } from './job/outputs.ts';
export { onJobPause, onJobResume } from './job/resume.ts';
export { FEED_ACCOUNTING_MIN_FB, feedAccountingSafe, feedLimitLine, feedLimitSupported, jobFlagLine, jobFlagSupported, onFeedLimit, onJobRuntimeAnswer } from './job/runtime.ts';
export { jobsCapable } from './job/shared.ts';
export { onJobBreakpoints, onStartJob, queuedLine } from './job/start.ts';
export { jobInFlight, onJobAnswer, pumpJob, slotRoom, statusMeaning } from './job/streaming.ts';



function planner(s: SessionState): number {
  return dialect(s).limits.plannerBlocks;
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
