import {
  ROTARY
} from '../geometry.ts';
import type { Axis, Wcs } from '../types.ts';
import { AXES } from '../types.ts';
import { type ModelContext } from './context.ts';
import { type Pos, type Unc } from './positions.ts';

/**
   * Work offset in force on an axis: coordinate system + G92 (if applied) +
   * the applied tool offset, or null. This is the offset the firmware adds to
   * a target, not its display convention.
   */
export function totalOffset(ctx: ModelContext, axis: Axis): number | null {
  if (ctx.wcs === null) return null;
  const w = ctx.wcsOffsets[ctx.wcs][axis];
  const g = g92Part(ctx, axis);
  const t = appliedTool(ctx, axis);
  return w === null || g === null || t === null ? null : w + g + t;
}

/**
   * The tool offset added to a target on this axis. EN adds it to X, Y and Z
   * only: the A/B/C loop of `cm_set_model_target` uses the coordinate offset
   * alone (@cite EN canonical_machine.c:536-539 vs :556-563), although G43.1
   * stores A/B/C values (@cite EN canonical_machine.c:1609, E155), which G92
   * and G10 L20 still subtract (@cite EN canonical_machine.c:1055-1061, :1205-1206).
   */
export function appliedTool(ctx: ModelContext, axis: Axis): number | null {
  return ROTARY.has(axis) ? 0 : ctx.toolOffset[axis];
}

/**
   * The work position on `axis` right after G92 or G10 L20 (on the active
   * system) set it to `value`: the firmware subtracts the stored tool offset on
   * every axis but applies it only to X, Y and Z, so a rotary axis reads
   * `value` + its stored tool offset (null when either is unknown).
   */
export function workAfterSet(ctx: ModelContext, axis: Axis, value: number | null): number | null {
  if (value === null || !ROTARY.has(axis)) return value;
  const t = ctx.toolOffset[axis];
  return t === null ? null : value + t;
}

/** The G92 part of the work offset on an axis, or null when it is not known whether G92 applies. */
export function g92Part(ctx: ModelContext, axis: Axis): number | null {
  if (ctx.g92Active === null) return null;
  return ctx.g92Active ? ctx.g92[axis] : 0;
}

/**
   * Bound on the error of the work offset in force on an axis (`totalOffset`):
   * the sum of its parts' bounds. Infinite when the offset is unknown.
   */
export function offsetUnc(ctx: ModelContext, axis: Axis): number {
  if (ctx.wcs === null || ctx.g92Active === null) return Infinity;
  return ctx.uWcs[ctx.wcs][axis] + (ctx.g92Active ? ctx.uG92[axis] : 0) + (ROTARY.has(axis) ? 0 : ctx.uTool[axis]);
}

/** The bound on the G92 part of the work offset on an axis. */
export function g92PartUnc(ctx: ModelContext, axis: Axis): number {
  if (ctx.g92Active === null) return Infinity;
  return ctx.g92Active ? ctx.uG92[axis] : 0;
}

/** Selects a coordinate system (G54..G59, or the default at program end). */
export function selectWcs(ctx: ModelContext, next: Wcs | null): void {
  const prev = ctx.wcs;
  if (next === prev) return;
  ctx.wcs = next;
  for (const a of AXES) {
    const before = prev === null ? null : ctx.wcsOffsets[prev][a];
    const after = next === null ? null : ctx.wcsOffsets[next][a];
    const unc = (prev === null ? Infinity : ctx.uWcs[prev][a]) + (next === null ? Infinity : ctx.uWcs[next][a]);
    shift(ctx, a, before === null || after === null ? null : before - after, unc);
  }
}

/** Sets whether G92 offsets apply, and to what with which bounds (null keeps them). */
export function setG92(ctx: ModelContext, active: boolean, offsets: Pos | null, unc: Unc | null): void {
  const before = AXES.map((a) => g92Part(ctx, a));
  const beforeUnc = AXES.map((a) => g92PartUnc(ctx, a));
  ctx.g92Active = active;
  if (offsets !== null) ctx.g92 = offsets;
  if (unc !== null) ctx.uG92 = unc;
  AXES.forEach((a, i) => {
    const b = before[i] as number | null;
    const after = g92Part(ctx, a);
    shift(ctx, a, b === null || after === null ? null : b - after, (beforeUnc[i] as number) + g92PartUnc(ctx, a));
  });
}

/**
   * After the work offset on `axis` changed by `change` (old part minus new
   * part; null when unknown): the machine did not move, so the work position
   * moves by the change. Where the machine position and the new offset are
   * both known, the work position is recomputed from them instead.
   * `changeUnc` bounds the error of the change (the old and new parts' bounds).
   */
export function shift(ctx: ModelContext, axis: Axis, change: number | null, changeUnc: number): void {
  const m = ctx.machine[axis];
  const t = ctx.totalOffset(axis);
  const w = ctx.work[axis];
  if (m !== null && t !== null) {
    ctx.work[axis] = m - t;
    ctx.uWork[axis] = ctx.uMachine[axis] + offsetUnc(ctx, axis);
  } else if (change === 0 && changeUnc === 0) return;
  else {
    ctx.work[axis] = w !== null && change !== null ? w + change : null;
    ctx.uWork[axis] += changeUnc;
  }
}
