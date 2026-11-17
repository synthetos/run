/**
 * The run wordmark (docs/superpowers/specs/2026-11-16-first-run-design.md §4, owner's option C): a monoline
 * lowercase "run" whose n is a toolpath arc move. The r and u are ink; the n's stem is a dashed ink rapid, its arch
 * the blue feed move, ending in the blue tool. Drawn as Preact SVG elements, never markup strings. The geometry is
 * exported so the icon generator draws the same shape.
 */
import { h, type ComponentChild } from 'preact';

export const WORDMARK_GEOMETRY = Object.freeze({
  viewBox: '-2 2 66 46',
  stroke: 3.4,
  r: 'M4 40V16M4 25a9 9 0 0 1 9-9',
  u: 'M20 16v16a8 8 0 0 0 16 0V16M36 16v24',
  nStem: 'M44 40V16',
  nArch: 'M44 24a8 8 0 0 1 16 0v16',
  tool: { cx: 60, cy: 40, r: 3.4 },
  dash: '0.01 7.14',
});

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
