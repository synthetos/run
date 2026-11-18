/**
 * The geometry of the run wordmark (docs/superpowers/specs/2026-11-16-first-run-design.md §4): a monoline lowercase
 * "run", x-height 24, baseline y = 40, stroke 3.4, round caps and joins. The n is an arc move: a dashed rapid up the
 * left stem, the blue feed arch and right stem, the blue tool at the end.
 *
 * The single source of these numbers. Imports nothing: the Preact component, the standalone SVG generator and the
 * procedural icon renderer in tools/gates all read it, and tests check they agree.
 */
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

export type WordmarkGeometry = typeof WORDMARK_GEOMETRY;
