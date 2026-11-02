/**
 * The bed/work grid under a preview: a square grid in the XY plane at the
 * bottom of the drawn extent, so the drawing always has a scale and a floor.
 *
 * It covers the work envelope (the machine travel, when the caller knows it)
 * or else the path's extent, padded and always including the origin. Steps
 * are "nice" (1, 2 or 5 × 10ⁿ mm) so the larger side has 10 to 25 cells; a
 * major line falls on every 10 mm-like multiple (every 5 cells for a 2-step,
 * every 10 for a 1- or 5-step), counted from the origin so X0 and Y0 are
 * major lines.
 *
 * Pure: the same boxes give the same grid.
 */
import type { Box3 } from './segments.ts';

export interface GridLayout {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Height of the grid plane. */
  readonly z: number;
  /** Cell size. */
  readonly step: number;
  /** A line at k·step is major when k is a multiple of this. */
  readonly majorEvery: number;
}

/** Most cells along the larger side. */
export const GRID_MAX_CELLS = 25;

/** The smallest 1, 2 or 5 × 10ⁿ that is at least `raw` (> 0). */
export function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) {
    const s = m * base;
    if (s >= raw * (1 - 1e-9)) return s;
  }
  /* c8 ignore next -- 10 · base is always ≥ raw */
  return 10 * base;
}

function finiteBox(b: Box3 | null): b is Box3 {
  return b !== null && [...b.min, ...b.max].every((v) => Number.isFinite(v)) && b.max[0] >= b.min[0] && b.max[1] >= b.min[1];
}

/** The grid for a path box and an envelope (either may be null); null when there is nothing to stand on. */
export function gridLayout(path: Box3 | null, envelope: Box3 | null): GridLayout | null {
  const p = finiteBox(path) ? path : null;
  const e = finiteBox(envelope) ? envelope : null;
  if (p === null && e === null) return null;
  let x0: number, y0: number, x1: number, y1: number;
  if (e !== null) {
    [x0, y0] = [e.min[0], e.min[1]];
    [x1, y1] = [e.max[0], e.max[1]];
  } else {
    const b = p as Box3;
    const pad = Math.max(5, (b.max[0] - b.min[0]) * 0.1, (b.max[1] - b.min[1]) * 0.1);
    x0 = Math.min(0, b.min[0] - pad);
    y0 = Math.min(0, b.min[1] - pad);
    x1 = Math.max(0, b.max[0] + pad);
    y1 = Math.max(0, b.max[1] + pad);
  }
  const span = Math.max(x1 - x0, y1 - y0, 1e-6);
  const step = niceStep(span / GRID_MAX_CELLS);
  const mantissa = Math.round(step / 10 ** Math.floor(Math.log10(step)));
  const majorEvery = mantissa === 2 ? 5 : 10;
  const snapDown = (v: number): number => Math.floor(v / step + 1e-9) * step;
  const snapUp = (v: number): number => Math.ceil(v / step - 1e-9) * step;
  const zs = [p?.min[2], e?.min[2]].filter((v): v is number => v !== undefined);
  return { x0: snapDown(x0), y0: snapDown(y0), x1: snapUp(x1), y1: snapUp(y1), z: Math.min(...zs), step, majorEvery };
}

export interface GridLine {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  readonly major: boolean;
}

/** The grid's lines: parallel to Y at each X step, then parallel to X at each Y step. */
export function gridLines(g: GridLayout): GridLine[] {
  const out: GridLine[] = [];
  const nx = Math.round((g.x1 - g.x0) / g.step);
  const ny = Math.round((g.y1 - g.y0) / g.step);
  const kx0 = Math.round(g.x0 / g.step);
  const ky0 = Math.round(g.y0 / g.step);
  for (let i = 0; i <= nx; i++) {
    const k = kx0 + i;
    const x = k * g.step;
    out.push({ a: [x, g.y0], b: [x, g.y1], major: k % g.majorEvery === 0 });
  }
  for (let j = 0; j <= ny; j++) {
    const k = ky0 + j;
    const y = k * g.step;
    out.push({ a: [g.x0, y], b: [g.x1, y], major: k % g.majorEvery === 0 });
  }
  return out;
}
