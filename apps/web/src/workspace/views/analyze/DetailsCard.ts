/**
 * Analyze → Details (Advanced only; docs/design/ANALYZE.md §3, slice 1): the motion settings the time uses, per axis
 * with each value's source, what the model covers, and the AI picker, which is a demonstration and not the first
 * control anyone sees. Adds detail, never another truth or another safety policy.
 */
import { h, type ComponentChild } from 'preact';
import type { Evidence } from '@synthetos/advisor';
import { advisorEngine } from '../../advisorState.ts';
import type { MotionView } from '../../analysisState.ts';
import { plural, whole } from './format.ts';

function cell(e: Evidence<number>): ComponentChild {
  return h('td', null, e.value === null ? 'Not known' : `${whole(e.value)} mm/min`, h('small', { class: 'analyze-source' }, e.label));
}

export function DetailsCard({ view }: { readonly view: MotionView }): ComponentChild {
  const { report } = view;
  return h(
    'section',
    { class: 'panel analyze-card', 'data-analyze': 'details', 'aria-labelledby': 'analyze-details-title' },
    h('h2', { id: 'analyze-details-title' }, 'Details'),
    h(
      'table',
      { class: 'analyze-table', 'data-analyze': 'axis-settings' },
      h('caption', { class: 'fine' }, 'Motion settings. Read only. Pending changes in Board are not used.'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Axis'), h('th', { scope: 'col' }, 'Rapid speed'), h('th', { scope: 'col' }, 'Max feed'))),
      h('tbody', null, view.settings.map((s) => h('tr', { key: s.axis }, h('th', { scope: 'row' }, s.axis), cell(s.rapid), cell(s.feed)))),
    ),
    h('p', { class: 'fine', 'data-analyze': 'model' }, `Model: programmed speeds, no acceleration. ${plural(report.coverage.supported, 'event', 'events')} of ${whole(report.coverage.events)} modelled. ${plural(report.arcs, 'arc', 'arcs')}, measured exactly.`),
    h(
      'label',
      { class: 'analyze-engine' },
      h('span', null, 'Speed suggestions from'),
      h(
        'select',
        { 'data-action': 'advisor-engine', value: advisorEngine.value, onChange: (e: Event) => { advisorEngine.value = (e.currentTarget as HTMLSelectElement).value === 'mock-ai' ? 'mock-ai' : 'rules'; } },
        h('option', { value: 'rules' }, 'Built-in rules'),
        h('option', { value: 'mock-ai' }, 'AI (demonstration only)'),
      ),
      h('small', { class: 'fine' }, 'The demonstration calls no model. Its values are canned examples, not advice.'),
    ),
  );
}
