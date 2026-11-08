/**
 * The Run job card while a job runs or after it ended (SAFETY §4.4a): progress, elapsed and remaining time
 * (estimates), the line executing, actual against programmed feed, and Pause, Resume and Stop job, which are
 * never gated.
 *
 * While the job is paused, Resume sits at the top of the card, under the phase, with the spindle's state in
 * words (first-time walk 2026-11-08, B2): at the bottom of the narrow card it was below the fold. It sends the
 * same session request as the machine strip's Resume; the session decides it again.
 *
 * A job that ended early (Stop job, Spindle off, a fault) holds its progress and line where the board was when it
 * ended, and the bar says Stopped (first-time walk 2026-11-08, S7): the board's later reports used to move it on
 * to the last line queued, so a stopped job read "100 %" and "34 of 34".
 */
import { h, type ComponentChild } from 'preact';
import { STOP_TEXT, w2Label } from '@synthetos/safety';
import { signalText } from '../../shell/signal.ts';
import type { WorkspaceModel } from '../model.ts';
import { duration, jobUi, PHASE_TEXT, type JobSnapshot } from '../jobUi.ts';

/** Pause and Stop job: the same calls as the machine strip's buttons (never gated; absent in the prerendered page). */
export interface StopHooks {
  readonly onPause?: () => void;
  readonly onStopJob?: () => void;
}

/** True while the job can still move the machine (Pause and Stop job are shown). */
export function jobActive(job: JobSnapshot): boolean {
  return !['ready', 'blocked', 'loading', 'done', 'stopped', 'failed'].includes(job.phase);
}

/** The paused job's Resume row, at the top of the card. */
function resumeRow(spindleOn: boolean, onResume: () => void): ComponentChild {
  return h(
    'div',
    { class: 'job-resume-row', 'data-job': 'resume-row', role: 'status' },
    h('span', null, spindleOn ? STOP_TEXT.pausedSpindleOn : STOP_TEXT.paused),
    h('button', { type: 'button', class: 'small primary', 'data-machine-control': 'resume', onClick: onResume }, 'Resume'),
  );
}

/** Progress, time, the line, the feed, and Pause / Resume / Stop job (never gated). */
export function JobStatus({ model, onPause, onStopJob }: { readonly model: WorkspaceModel | null } & StopHooks): ComponentChild {
  const view = model?.live.value ?? null;
  const ui = jobUi(view);
  const job = ui.job;
  const actions = model?.actions.value ?? null;
  if (job === null || job.startedAt === null) return null;
  const s = ui.snapshot;
  // A job that ended early holds where it ended: the board's later reports never move the card (S7).
  const stopped = (job.phase === 'stopped' || job.phase === 'failed') && job.stoppedAt !== null ? job.stoppedAt : null;
  const at = stopped ?? job.executing;
  const done = at === null ? job.acked : at.n;
  const pct = job.total === 0 ? 0 : Math.min(100, Math.round((done / job.total) * 100));
  const feed = s?.live.feed;
  const vel = s?.live.vel;
  const resume = job.phase === 'paused' && actions?.job !== undefined ? () => void actions.job?.({ op: 'resume', skip: false, spindleRestart: false }) : null;
  return h(
    'section',
    { class: `job-status phase-${job.phase}`, 'data-job': 'status', 'data-phase': job.phase, 'aria-label': 'Job' },
    // The section is the size container (job-status.css); this grid inside it is what the width rearranges.
    h(
      'div',
      { class: 'job-status-grid' },
      h('div', { class: 'job-status-head' }, h('strong', { 'data-job': 'phase' }, PHASE_TEXT[job.phase] ?? job.phase), h('span', { class: 'job-pct', 'data-job': 'pct' }, stopped === null ? `${pct}%` : `stopped at ${pct}%`)),
      resume === null ? null : resumeRow(s?.live.spe === 1, resume),
      h('div', { class: `job-progress${stopped === null ? '' : ' stopped'}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, ...(stopped === null ? {} : { 'aria-valuetext': `Stopped at ${pct}%`, 'data-stopped': 'true' }) }, h('i', { style: { width: `${pct}%` } })),
      h(
        'dl',
        { class: 'job-facts' },
        h('div', null, h('dt', null, 'Line'), h('dd', { 'data-job': 'line' }, stopped !== null ? `stopped at file line ${stopped.line} (${stopped.n} of ${job.total})` : at === null ? `${job.acked} of ${job.total} answered` : `file line ${at.line} (${at.n} of ${job.total})`)),
        h('div', null, h('dt', null, 'Elapsed'), h('dd', { 'data-job': 'elapsed' }, ui.elapsedMs === null ? 'Not started' : duration(ui.elapsedMs / 1000))),
        h('div', null, h('dt', null, 'Remaining'), h('dd', { 'data-job': 'remaining' }, jobActive(job) ? `about ${duration(job.remainingSeconds)} (estimate)` : 'Not running')),
        h('div', null, h('dt', null, 'Feed, actual / programmed'), h('dd', { 'data-job': 'feed' }, `${typeof vel === 'number' ? Math.round(vel) : 'unknown'} / ${typeof feed === 'number' ? Math.round(feed) : 'unknown'} mm/min`)),
      ),
      job.message === null ? null : h('p', { class: `job-message${job.phase === 'failed' ? ' danger' : ''}`, 'data-job': 'message', role: job.phase === 'failed' ? 'alert' : 'status' }, ...signalText(job.message)),
      jobActive(job)
        ? h(
            'div',
            { class: 'job-controls' },
            h('button', { type: 'button', class: 'small', 'data-machine-control': 'job-pause', title: 'Feedhold: decelerates and pauses motion', ...(onPause === undefined ? { disabled: true } : { onClick: onPause }) }, w2Label()),
            h('button', { type: 'button', class: 'small danger', 'data-machine-control': 'job-stop', ...(onStopJob === undefined ? { disabled: true } : { onClick: onStopJob }) }, STOP_TEXT.stopJob),
          )
        : null,
    ),
  );
}
