/**
 * The run wordmark (docs/superpowers/specs/2026-11-16-first-run-design.md §4, owner's option C): a monoline
 * lowercase "run" whose n is a toolpath arc move. The r and u are ink; the n's stem is a dashed ink rapid, its arch
 * the blue feed move, ending in the blue tool. Drawn as Preact SVG elements, never markup strings. The geometry lives
 * in wordmarkGeometry.ts so the icon generator and the standalone SVGs draw the same shape.
 */
import { h, type ComponentChild } from 'preact';
import { WORDMARK_GEOMETRY } from './wordmarkGeometry.ts';

export { WORDMARK_GEOMETRY };

const LINE = { fill: 'none', 'stroke-width': WORDMARK_GEOMETRY.stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

export function RunWordmark(props: { readonly height: number; readonly label?: string }): ComponentChild {
  const g = WORDMARK_GEOMETRY;
  return h(
    'svg',
    { viewBox: g.viewBox, height: props.height, role: 'img', 'aria-label': props.label ?? 'run', focusable: 'false' },
    h('path', { ...LINE, d: g.r, stroke: 'currentColor' }),
    h('path', { ...LINE, d: g.u, stroke: 'currentColor' }),
    h('path', { ...LINE, d: g.nStem, stroke: 'currentColor', 'stroke-dasharray': g.dash }),
    h('path', { ...LINE, d: g.nArch, stroke: 'var(--blue)' }),
    h('circle', { cx: g.tool.cx, cy: g.tool.cy, r: g.tool.r, fill: 'var(--blue)', stroke: 'none' }),
  );
}
