/**
 * Analyze → Details (Advanced only; docs/design/ANALYZE.md §3, slice 1): the machine speeds the time uses, with
 * their source, and the line-density histogram. When nothing has been read, one line says how to fix that instead
 * of a table of unknowns.
 */
import { h, type ComponentChild } from 'preact';
import type { Evidence } from '@synthetos/advisor';
import type { MotionView } from '../../analysisState.ts';
import { plural, whole } from './format.ts';

function cell(e: Evidence<number>): ComponentChild {
  return h('td', null, e.value === null ? '—' : `${whole(e.value)} mm/min`, e.value === null ? null : h('small', { class: 'analyze-source' }, e.label));
}

export function DetailsCard({ view }: { readonly view: MotionView }): ComponentChild {
  const { report } = view;
  const known = view.settings.some((s) => s.rapid.value !== null || s.feed.value !== null);
  const most = Math.max(1, ...report.density.buckets.map((b) => b.lines));
  return h(
    'section',
    { class: 'panel analyze-details', 'data-analyze': 'details', 'aria-labelledby': 'analyze-details-title' },
    h('h2', { id: 'analyze-details-title' }, 'Details'),
    known
      ? h(
          'table',
          { class: 'analyze-table', 'data-analyze': 'axis-settings' },
          h('caption', { class: 'fine' }, 'Machine speeds used for the rapids. Read only.'),
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Axis'), h('th', { scope: 'col' }, 'Rapid speed'), h('th', { scope: 'col' }, 'Max feed'))),
          h('tbody', null, view.settings.map((s) => h('tr', { key: s.axis }, h('th', { scope: 'row' }, s.axis), cell(s.rapid), cell(s.feed)))),
        )
      : h('p', { 'data-analyze': 'axis-settings' }, "Connect to read your machine's speeds. The time estimate will improve."),
    h('h3', null, 'Move rate'),
    h(
      'table',
      { class: 'analyze-table', 'data-analyze': 'histogram' },
      h('caption', { class: 'fine' }, `How many lines per second each cutting move needs at its feed. Over ${whole(report.density.threshold.value ?? 0)} counts as dense (a guess until the connection is measured).`),
      h('tbody', null, report.density.buckets.map((b) => h('tr', { key: b.label }, h('th', { scope: 'row' }, b.label), h('td', { class: 'num' }, whole(b.lines)), h('td', { class: 'analyze-bar-cell', 'aria-hidden': 'true' }, h('span', { class: 'analyze-bar', style: { width: `${(b.lines / most) * 100}%` } }))))),
    ),
    h('p', { class: 'fine', 'data-analyze': 'model' }, `Times use programmed speeds, so they are lower bounds. ${plural(report.coverage.supported, 'line', 'lines')} of ${whole(report.coverage.events)} modelled. Arcs are measured exactly.`),
  );
}
