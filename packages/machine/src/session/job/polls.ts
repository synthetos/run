import { mapStat } from '@synthetos/protocol';
import { ACTIVE_PHASES, jobEvent, lastFileLine, patchJob } from '../jobState.ts';
import { MOTION_LIMITS, atRestPolled, beginHold, completedPoll, heldPolled, requestPoll } from '../motion.ts';
import type { JobState, PolledValues, SessionState } from '../types.ts';
import { type JobDeps, type JobLayerTx } from './contract.ts';
import { JOB_LIMITS } from './limits.ts';
import { stopReached } from './outputs.ts';
import { nextResumeStep } from './resume.ts';
import { dataSettled, dialect, job, writeRealtime } from './shared.ts';

function planner(s: SessionState): number {
  return dialect(s).limits.plannerBlocks;
}

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
  switch (j.phase) {
    case 'draining':
    case 'ending': {
      pollDrain(t, p, at);
      return;
    }
    case 'pausing':
    case 'refused': {
      pollPause(t, p, at);
      return;
    }
    case 'resuming': {
      pollResume(t, p, at);
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
  if (s.overlays.includes('STALE') && s.stale !== null && streamingPhase(j) && at - s.stale.at >= JOB_LIMITS.staleFaultMs) {
    deps.fault(t, 'staleWhileRunning', 'liveness', `no reports from the controller for ${Math.round((at - s.stale.at + s.stale.silentForMs) / 1000)} s while the job ran`, at);
    return;
  }
  if (j.phase === 'running') {
    requestPoll(t);
    t.arm('job', JOB_LIMITS.runPollMs);
    return;
  }
  if (quietPhase(j)) {
    if (j.phase === 'checking' || j.phase === 'preparing') t.arm('job', JOB_LIMITS.drainPollMs);
    return;
  }
  requestPoll(t);
  t.arm('job', JOB_LIMITS.drainPollMs);
}

function pollDrain(t: JobLayerTx, p: PolledValues, at: number): void {
  const s = t.s;
  const j = job(s);
  const confirm = (ok: boolean): number => (ok ? j.confirmed + 1 : 0);
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

function pollPause(t: JobLayerTx, p: PolledValues, at: number): void {
  const s = t.s;
  const j = job(s);
  const confirm = (ok: boolean): number => (ok ? j.confirmed + 1 : 0);
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

function pollResume(t: JobLayerTx, p: PolledValues, at: number): void {
  const s = t.s;
  const j = job(s);
  const confirm = (ok: boolean): number => (ok ? j.confirmed + 1 : 0);
  const confirmed = confirm(atRestPolled(s, p) && dataSettled(s));
  patchJob(t, { confirmed });
  if (confirmed < MOTION_LIMITS.confirmations) {
    requestPoll(t);
    return;
  }
  nextResumeStep(t, at);
  return;
}

function streamingPhase(j: JobState): boolean {
  return (j.phase === 'running' || j.phase === 'draining' || j.phase === 'ending');
}

function quietPhase(j: JobState): boolean {
  return j.phase === 'outputsOff' || j.phase === 'toolChange' || j.phase === 'breakpoint' || j.phase === 'programStop' || j.phase === 'paused' || j.phase === 'checking' || j.phase === 'preparing';
}
