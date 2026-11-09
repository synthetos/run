/**
 * Analyze → Summary (docs/design/ANALYZE.md §3, slice 1): how long at programmed speeds, how far, how many lines, and
 * where the job stops for the operator. Each value names its source. Never an ETA: acceleration is not included, and
 * a manual stop adds time nobody can know.
 */
import { h, type ComponentChild } from 'preact';
import type { Evidence } from '@synthetos/advisor';
import type { MotionView } from '../../analysisState.ts';
import { mm, plural, sourceText, time, whole } from './format.ts';

function row(label: string, value: string, source: string | null, key: string): ComponentChild {
  return h('div', { key, 'data-fact': key }, h('dt', null, label), h('dd', null, value, source === null ? null : h('small', { class: 'analyze-source', 'data-source': '' }, source)));
}

function timed(e: Evidence<number>): string {
  return e.value === null ? 'Not timed' : time(e.value);
}

export function stopsText(changes: number, pauses: number): string | null {
  const parts = [changes > 0 ? plural(changes, 'tool change', 'tool changes') : null, pauses > 0 ? plural(pauses, 'pause', 'pauses') : null].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : parts.join(', ');
}

export function SummaryCard({ view }: { readonly view: MotionView }): ComponentChild {
  const { report, time: t } = view;
  const stops = stopsText(report.toolChangeLines.length, report.stopLines.length);
  return h(
    'section',
    { class: 'panel analyze-card', 'data-analyze': 'summary', 'aria-labelledby': 'analyze-summary-title' },
    h('h2', { id: 'analyze-summary-title' }, 'Summary'),
    h('p', { class: 'analyze-headline', 'data-analyze': 'time' }, t.totalSeconds === null ? 'Time not known yet' : `About ${time(t.totalSeconds)}`),
    h('p', { class: 'fine' }, 'At programmed speeds. Acceleration not included.', stops === null ? '' : ` Plus ${stops}. Run cannot know how long you take.`),
    h(
      'dl',
      { class: 'facts analyze-facts' },
      row('Feed moves', timed(t.feedSeconds), sourceText(t.feedSeconds), 'feed-time'),
      row('Rapids', timed(t.rapidSeconds), report.rapidDeltas.length === 0 && report.untimedRapids === 0 ? null : sourceText(t.rapidSeconds), 'rapid-time'),
      report.dwells === 0 ? null : row('Dwells', `${time(t.dwellSeconds.value ?? 0)} in ${plural(report.dwells, 'dwell', 'dwells')}`, null, 'dwells'),
      row('Cutting distance', mm(report.feedMm.value ?? 0), null, 'feed-mm'),
      row('Rapid distance', mm(report.rapidMm.value ?? 0), null, 'rapid-mm'),
      row('Lines', whole(report.lines), null, 'lines'),
    ),
    t.missing.length === 0 ? null : h('ul', { class: 'analyze-missing', 'data-analyze': 'missing' }, t.missing.map((m) => h('li', { key: m }, m))),
    report.coverage.reasons.length === 0 ? null : h('ul', { class: 'analyze-coverage warn-text', 'data-analyze': 'coverage' }, report.coverage.reasons.map((m) => h('li', { key: m }, m))),
  );
}
