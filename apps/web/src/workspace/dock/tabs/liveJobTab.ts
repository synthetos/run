/** The dock's Live job tab: what the status reports say now, the feed of the last 60 s, and the job's events. */
import { h, type ComponentChild } from 'preact';
import { DIALECTS } from '@synthetos/protocol';
import { Dro } from '../../../machine-ui/Dro.ts';
import { connected, type WorkspaceModel } from '../../model.ts';
import { uiLevel } from '../../jobWorkflow.ts';
import { num } from '../../status.ts';
import { duration as durationText, feedReport, feedShareLine, jobUi, PHASE_TEXT, starving } from '../../jobUi.ts';
import { emptyQueueText, liveEventText, liveLineLabel } from '../../liveWords.ts';
import { reportsNotes } from '../../reportsNotice.ts';
import { usePublishNotes } from '../../notes/usePublishNotes.ts';
import type { DockContext, DockTab } from '../dockTab.ts';

const PHASE_LABEL = (phase: string): string => PHASE_TEXT[phase] ?? phase;

const STAT_TEXT: Readonly<Record<string, string>> = {
  initializing: 'Starting up',
  idle: 'Idle',
  programStop: 'Program stopped',
  end: 'Program ended',
  running: 'Running',
  held: 'Held',
  probing: 'Probing',
  homing: 'Homing',
  jogging: 'Jogging',
  softAlarm: 'Soft alarm',
  alarm: 'Alarm',
  shutdown: 'Shutdown',
  panic: 'Panic',
  interlock: 'Interlock',
  unknown: 'Unknown',
};

/** The Live job tab: what the status reports say now, and the feed of the last 60 s. Honest when nothing runs. */
function LivePane({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  // What Run changed in the board's reporting at connect (W35, W36, W44) is in the Notes tab.
  usePublishNotes('reports', reportsNotes(view));
  if (view === null || !connected(view) || view.message === null) {
    return h('div', { class: 'live-empty', 'data-live': 'empty' }, h('strong', null, 'Connect to see live job data.'), h('p', null, 'State, feed and progress reported by the controller.'));
  }
  const advanced = uiLevel.value.value === 'advanced';
  const s = view.message.snapshot;
  const live = s.live;
  const dialect = DIALECTS.find((d) => d.id === s.classification?.dialectId);
  const blocks = dialect?.limits.plannerBlocks ?? null;
  const samples = view.samples;
  const maxFeed = Math.max(1, ...samples.map((x) => Math.max(x.feed ?? 0, x.vel ?? 0)));
  const tEnd = view.now;
  const pts = samples.filter((x) => x.vel !== null).map((x) => `${(300 - ((tEnd - x.t) / 60_000) * 300).toFixed(1)},${(68 - ((x.vel as number) / maxFeed) * 64).toFixed(1)}`);
  const feedPts = samples.filter((x) => x.feed !== null).map((x) => `${(300 - ((tEnd - x.t) / 60_000) * 300).toFixed(1)},${(68 - ((x.feed as number) / maxFeed) * 64).toFixed(1)}`);
  const qr = typeof live.qr === 'number' ? live.qr : null;
  const ui = jobUi(view);
  const job = ui.job !== null && ui.job.startedAt !== null ? ui.job : null;
  const starve = starving(s, blocks);
  const feed = feedReport(job?.feedLimit ?? null);
  const finished = job !== null && !ui.active;
  return h(
    'div',
    { class: 'live-grid', 'data-live': 'connected' },
    h(
      'div',
      { class: 'live-progress' },
      h('span', { class: 'live-big', 'data-live': 'stat' }, live.machineClass === undefined ? 'Unknown' : (STAT_TEXT[live.machineClass] ?? live.machineClass)),
      job === null
        ? h('span', { class: 'live-sub', 'data-live': 'line' }, typeof live.line === 'number' ? `Line ${num(live.line)} reported` : 'No line reported')
        : h('span', { class: 'live-sub', 'data-live': 'line' }, job.executing === null ? `${num(job.acked)} of ${num(job.total)} lines answered` : `File line ${num(job.executing.line)} · ${num(job.executing.n)} of ${num(job.total)}`),
      job === null
        ? h('p', { class: 'fine' }, view.message.jobs === true ? 'No job is running. Start one from the job card above.' : 'Running jobs is not enabled in this build.')
        : h(
            'p',
            { class: 'fine', 'data-live': 'job-time' },
            `${PHASE_LABEL(job.phase)} · elapsed ${ui.elapsedMs === null ? 'unknown' : durationText(ui.elapsedMs / 1000)} · about ${durationText(job.remainingSeconds)} left (estimate)`,
          ),
    ),
    h(
      'div',
      { class: 'live-feed' },
      h('div', { class: 'live-head' }, h('span', null, 'Feed: actual and programmed'), h('strong', { 'data-live': 'feed' }, `${live.vel === undefined ? 'Unknown' : num(live.vel)} / ${live.feed === undefined ? 'Unknown' : num(live.feed)}`)),
      h(
        'svg',
        { class: 'feed-chart', viewBox: '0 0 300 70', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Actual velocity over the last 60 seconds against programmed feed' },
        feedPts.length > 1 ? h('polyline', { class: 'prog', points: feedPts.join(' ') }) : null,
        pts.length > 1 ? h('polyline', { class: 'act', points: pts.join(' ') }) : null,
      ),
      h('div', { class: 'live-head' }, h('span', null, 'Queue space available'), h('strong', { 'data-live': 'qr' }, qr === null ? 'Unknown' : blocks === null ? String(qr) : `${qr} of ${blocks}`)),
      blocks === null || qr === null ? null : h('div', { class: `qr-meter${starve ? ' starving' : ''}`, 'data-live': 'planner-gauge', 'data-starving': starve ? 'true' : 'false', 'aria-hidden': 'true' }, Array.from({ length: blocks }, (_, i) => h('i', { key: String(i), class: i < blocks - qr ? 'used' : undefined }))),
      job === null ? null : h('p', { class: `fine${starve ? ' warn-text' : ''}`, 'data-live': 'queued' }, `Queued on the controller: about ${durationText(job.queuedSeconds)} of motion${job.queuedBoundMm === null ? '' : `, at most ${Math.round(job.queuedBoundMm)} mm`}${starve ? '. Observational: the planner ran out of motion while cutting; the cause is not reported by this firmware.' : '.'}`),
      feed === null
        ? null
        : h(
            'div',
            { class: 'live-feedlimit', 'data-live': 'feed-limit', 'data-feed-state': finished ? 'summary' : 'live' },
            // The executing move, as the firmware last pushed it (rate-limited, coalesced: what it said, not a measurement).
            finished || feed.move === null
              ? null
              : h('p', { class: 'feed-move', 'data-feed': 'move' }, feed.move.pct === null ? 'Feed move' : h('strong', null, `${feed.move.pct}% of the programmed feed`), feed.move.causes === '' ? '' : ` · ${feed.move.causes}`),
            finished
              ? h(
                  'div',
                  { class: 'feed-summary', 'data-feed': 'summary' },
                  h('p', null, `Cut for ${durationText(feed.cuttingS)} over ${Math.round(feed.cuttingMm)} mm${feed.short ? ' (at least: the board says its totals are short)' : ''}.`),
                  feedShareLine(feed.job) === null ? h('p', { class: 'fine' }, 'The feed was held at the programmed value.') : h('p', { class: 'fine' }, `Below the programmed feed: ${feedShareLine(feed.job) as string}.`),
                  feed.notes.length === 0 ? null : h('ul', { class: 'feed-notes' }, feed.notes.map((n, i) => h('li', { key: String(i) }, n))),
                )
              : feed.recent === null && feed.job.length === 0
                ? null
                : h('p', { class: 'fine', 'data-feed': 'shares' }, `Below the programmed feed${feed.recent === null ? '' : ' (last interval)'}: ${feedShareLine(feed.recent ?? feed.job) ?? 'nothing above 2%'}.`),
            feed.unsupported ? h('p', { class: 'fine' }, 'This firmware sends its feed summaries in a format this build does not read.') : null,
          ),
    ),
    h(
      'ol',
      { class: 'live-stream', 'aria-live': 'polite', 'data-live': 'events' },
      ...(job === null ? [] : [...job.events].reverse().slice(0, 30).map((e, i) => h('li', { key: `e${i}`, class: `ev-${e.kind}`, 'data-event': e.kind }, h('time', null, liveLineLabel(e.line, advanced)), h('span', null, liveEventText(e.text, advanced))))),
      h('li', null, h('time', null, 'now'), h('span', null, s.overlays.includes('READ_ONLY') ? 'Read only: Run watches the status reports and writes nothing.' : 'Watching the status reports.')),
      typeof live.qr === 'number' && blocks !== null && live.qr === blocks ? h('li', null, h('time', null, 'now'), h('span', null, emptyQueueText(advanced))) : null,
    ),
    // Advanced: what Run changed in the board's reporting at connect (W35, W36, W44) and where the Position numbers
    // come from (moved here from the Position panel, owner 2026-11-09).
    advanced ? h('div', { class: 'live-dro' }, h(Dro, { message: view.message, elapsedMs: view.now - view.receivedAt })) : null,
  );
}

function LiveTabPane({ ctx }: { readonly ctx: DockContext; readonly active: boolean }): ComponentChild {
  return h(LivePane, { model: ctx.model });
}

export const liveJobTab: DockTab = {
  id: 'live',
  label: 'Live job',
  paneClass: 'live',
  available: () => true,
  Pane: LiveTabPane,
  dot: (ctx) => {
    const live = ctx.model?.live.value ?? null;
    return live !== null && connected(live);
  },
};
