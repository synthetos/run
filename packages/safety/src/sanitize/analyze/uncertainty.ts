import {
  ROTARY,
  stepErrorMm
} from '../geometry.ts';
import type { Axis } from '../types.ts';
import { type ModelContext } from './context.ts';
import { offsetUnc, workAfterSet } from './offsets.ts';

/**
   * The position bounds after the firmware moved `axis` (its model positions
   * already updated):
   * - `work`: to an absolute work target. The firmware's position is the
   *   word plus its offset, so the work position is the word up to one sum's
   *   rounding; the machine position inherits the offset's uncertainty.
   * - `machine`: to a machine target known to `targetUnc` (G53, a stored
   *   position): the work position inherits the offset's uncertainty.
   * - `incremental`: by a distance added to the firmware's own position: one
   *   more rounding on top of what was already uncertain (float32
   *   accumulation over a run of G91 moves).
   */
export function settle(ctx: ModelContext, ...[axis, kind, delta, targetUnc = 0]: [axis: Axis, kind: 'work' | 'machine' | 'incremental', delta: number, targetUnc?: number]): void {
  const m = ctx.machine[axis];
  const off = ctx.totalOffset(axis);
  const e = stepErrorMm(m ?? 0, delta, off ?? 0);
  if (kind === 'work') {
    ctx.uWork[axis] = e;
    ctx.uMachine[axis] = offsetUnc(ctx, axis) + e;
  } else if (kind === 'machine') {
    ctx.uMachine[axis] = targetUnc + e;
    ctx.uWork[axis] = ctx.uMachine[axis] + offsetUnc(ctx, axis);
  } else {
    ctx.uMachine[axis] += e;
    ctx.uWork[axis] += e;
  }
}

/** Adds `mm` to the bound on both positions of an axis (rounding the model did not follow). */
export function widen(ctx: ModelContext, axis: Axis, mm: number): void {
  ctx.uMachine[axis] += mm;
  ctx.uWork[axis] += mm;
}

/**
   * Sets the work position after G92 or G10 L20 made it read `value`: the
   * firmware derived the offset from its own position, so the work position
   * is `value` up to one sum's rounding (plus the stored tool offset's bound on
   * a rotary axis, see `#workAfterSet`).
   */
export function setWork(ctx: ModelContext, axis: Axis, value: number | null): void {
  const w = workAfterSet(ctx, axis, value);
  ctx.work[axis] = w;
  ctx.uWork[axis] = w === null ? Infinity : stepErrorMm(ctx.machine[axis] ?? 0, w) + (ROTARY.has(axis) ? ctx.uTool[axis] : 0);
}
