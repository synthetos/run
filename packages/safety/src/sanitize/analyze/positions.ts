import type { Axis } from '../types.ts';
import { AXES } from '../types.ts';

export type Pos = Record<Axis, number | null>;

/**
 * Per-axis bound (mm, or degrees) on how far the firmware's float32 value
 * may be from the model's value of the matching `Pos`. Only meaningful where
 * that value is known; an unknown value has an infinite bound.
 */
export type Unc = Record<Axis, number>;

export function uncOf(p: Pos, bound: (axis: Axis, value: number) => number): Unc {
  const u = { X: Infinity, Y: Infinity, Z: Infinity, A: Infinity, B: Infinity, C: Infinity };
  for (const a of AXES) {
    const v = p[a];
    if (v !== null) u[a] = bound(a, v);
  }
  return u;
}

export function exactUnc(): Unc {
  return { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 };
}

export function emptyPos(): Pos {
  return { X: null, Y: null, Z: null, A: null, B: null, C: null };
}

export function posFrom(values: Readonly<Partial<Record<Axis, number>>> | undefined): Pos {
  const p = emptyPos();
  if (values === undefined) return p;
  for (const a of AXES) {
    const v = values[a];
    if (v !== undefined && Number.isFinite(v)) p[a] = v;
  }
  return p;
}

export function zeroPos(): Pos {
  return { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 };
}
