import {
  c35,
  type Decision,
  type Intent
} from '@synthetos/safety';
import { forgetBoardModes } from '../boardModes.ts';
import { jobEvent, patchJob } from '../jobState.ts';
import { resumeTravel } from '../jobTravel.ts';
import { activeSystem, requestPoll } from '../motion.ts';
import { ABSOLUTE_MM_LINE, motionLineKind, restoreLine, returnXYLine, safeZLine, spindleLine } from '../motionLines.ts';
import type { JobState, SessionIntent, SessionState } from '../types.ts';
import { type JobLayerTx } from './contract.ts';
import { JOB_LIMITS } from './limits.ts';
import { sanitizeLive } from './model.ts';
import { sendJobFlag } from './runtime.ts';
import { ALLOWED, deny, job, jobsCapable, queue, writeRealtime } from './shared.ts';

/** Pause (`!`) during a job. Returns false when the job layer does not handle it (the caller sends `!` alone). */
export function onJobPause(t: JobLayerTx, at: number): boolean {
  const j = t.s.job;
  if (j === null || !jobsCapable(t.s, t.config) || t.s.motion !== null) return false;
  if (j.phase !== 'running' && j.phase !== 'draining' && j.phase !== 'ending') return false;
  pauseJob(t, at, 'pause');
  return true;
}

export function pauseJob(t: JobLayerTx, at: number, why: 'pause' | 'refused'): void {
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
  const returnRefusal = appendReturnSteps(steps, here, tc, moved);
  if (returnRefusal !== null) return returnRefusal;
  const spindleRefusal = appendSpindleSteps(steps, tc, request);
  if (spindleRefusal !== null) return spindleRefusal;
  if (tc.mist) steps.push({ line: 'M7', intent: 'resume' });
  if (tc.flood) steps.push({ line: 'M8', intent: 'resume' });
  if (steps.some((x) => motionLineKind(x.line) === undefined)) return deny('The way back is out of range.', 'Stop the job.');
  if (moved && (tc.dist === undefined || tc.units === undefined)) return deny("The job's distance mode or units are not known, so they cannot be put back after the return.", 'Stop the job.');
  patchJob(t, { phase: 'resuming', resumeSteps: steps, passed: tc.index, confirmed: 0 });
  jobEvent(t, at, 'toolchange', `Resuming after the tool change${steps.length > 0 ? `: ${steps.map((x) => x.line).join(', ')}` : ''}.`, (s.job as JobState).lines[tc.index]?.sourceLine);
  nextResumeStep(t, at);
  return ALLOWED;
}

export function nextResumeStep(t: JobLayerTx, at: number): void {
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

function appendReturnSteps(steps: { line: string; intent: Intent }[], here: SessionState['live']['mpo'], tc: NonNullable<JobState['toolChange']>, moved: boolean): Decision | null {
  const back = tc.at;
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
  return null;
}

function appendSpindleSteps(steps: { line: string; intent: Intent }[], tc: NonNullable<JobState['toolChange']>, request: Extract<SessionIntent, { intent: 'resume' }>): Decision | null {
  const restart = tc.spindle !== 'off' && !tc.restartsSpindle;
  if (restart) {
    if (request.spindleRestart !== true || tc.speed === null) {
      return deny(tc.speed === null ? 'The spindle was on, but its speed is not known.' : c35({ direction: tc.spindle === 'cw' ? 'M3' : 'M4', rpm: tc.speed }), tc.speed === null ? 'Stop the job and restart it from a line that sets the speed.' : 'Confirm the spindle restart (C35).');
    }
    steps.push({ line: spindleLine(tc.spindle as 'cw', tc.speed), intent: 'resume' });
  }
  return null;
}
