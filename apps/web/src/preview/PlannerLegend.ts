/**
 * The planner view's legend while a job runs (owner, 2026-11-10: "path colour by planner state during a job, so
 * starving is visible at a glance"). The lines keep their tool colours; the states differ in strength and pattern,
 * so they read without colour vision: done faint, the executing line in the live colour, in the planner at full
 * strength (amber while starving), waiting for the board's acknowledgement in fine dashes, not sent dimmed.
 * Read only: it shows what the board reported, and sends nothing.
 */
import { h, type ComponentChild } from 'preact';

/** A short stroke drawn the way the state's lines are. */
function Stroke({ kind }: { readonly kind: 'done' | 'exec' | 'planner' | 'waiting' | 'unsent' }): ComponentChild {
  const style = kind === 'exec' ? { stroke: 'var(--live)' } : { stroke: 'currentColor', opacity: kind === 'done' ? 0.25 : kind === 'unsent' ? 0.5 : 1 };
  return h('svg', { class: 'tool-swatch', viewBox: '0 0 16 8', 'aria-hidden': 'true' }, h('line', { x1: 0, y1: 4, x2: 16, y2: 4, 'stroke-width': kind === 'planner' || kind === 'exec' ? 3 : 2, ...(kind === 'waiting' ? { 'stroke-dasharray': '2.5 2' } : {}), style }));
}

const ENTRIES = [
  ['done', 'Done'],
  ['exec', 'Executing'],
  ['planner', 'In the planner'],
  ['waiting', 'Waiting for the board'],
  ['unsent', 'Not sent'],
] as const;

export function PlannerLegend(): ComponentChild {
  return h(
    'span',
    { class: 'tool-legend planner-legend', role: 'group', 'aria-label': 'Job progress', 'data-scene': 'planner-legend' },
    ENTRIES.map(([kind, text]) => h('span', { key: kind, class: 'tool-legend-entry', 'data-planner-legend': kind }, h(Stroke, { kind }), h('span', null, text))),
  );
}
