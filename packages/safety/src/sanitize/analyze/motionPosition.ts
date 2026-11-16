import { extendTo } from '../extent.ts';
import {
  ROTARY
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import type { Axis } from '../types.ts';
import { AXES } from '../types.ts';
import { type ModelContext } from './context.ts';
import { scale } from './units.ts';

/** Moves by known deltas: both positions follow, unknowns stay unknown. The caller settles the bounds (`#settle`). */
export function moveBy(ctx: ModelContext, delta: Readonly<Partial<Record<Axis, number>>>): void {
  for (const a of AXES) {
    const d = delta[a];
    if (d === undefined) continue;
    const m = ctx.machine[a];
    const w = ctx.work[a];
    ctx.machine[a] = m === null ? null : m + d;
    ctx.work[a] = w === null ? null : w + d;
  }
  ctx._extent = extendTo(ctx._extent, ctx.machine);
}

/** Forgets the positions of the axes these words name. */
export function forget(ctx: ModelContext, axisWords: readonly Word[]): void {
  for (const w of axisWords) {
    ctx.work[w.letter as Axis] = null;
    ctx.machine[w.letter as Axis] = null;
    ctx.uWork[w.letter as Axis] = Infinity;
    ctx.uMachine[w.letter as Axis] = Infinity;
  }
}

/** Forgets X, Y and Z (an arc that could not be modelled may have moved any of them). */
export function forgetLinear(ctx: ModelContext): void {
  for (const a of AXES) {
    if (ROTARY.has(a)) continue;
    ctx.work[a] = null;
    ctx.machine[a] = null;
    ctx.uWork[a] = Infinity;
    ctx.uMachine[a] = Infinity;
  }
}

/**
   * The largest absolute machine coordinate, work coordinate or work offset
   * on these axes (mm), widened by how uncertain the machine coordinate is,
   * or null when a machine coordinate is unknown. It sizes the float32
   * rounding band of an arc (geometry.ts `positionErrorMm`).
   */
export function planeMagnitude(ctx: ModelContext, axes: readonly Axis[]): number | null {
  let max = 0;
  for (const a of axes) {
    const m = ctx.machine[a];
    if (m === null) return null;
    max = Math.max(max, Math.abs(m) + ctx.uMachine[a], Math.abs(ctx.work[a] ?? 0), Math.abs(ctx.totalOffset(a) ?? 0));
  }
  return max;
}

/** The delta (mm or degrees) an axis word asks for, or null when it depends on something unknown. */
export function modelDelta(ctx: ModelContext, ...[axis, value, units, distance]: [axis: Axis, value: number, units: 'G20' | 'G21' | null, distance: 'G90' | 'G91' | null]): number | null {
  const sc = scale(ctx, axis, units);
  if (sc === null || distance === null) return null;
  if (distance === 'G91') return value * sc;
  const w = ctx.work[axis];
  return w === null ? null : value * sc - w;
}
