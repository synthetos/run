/**
 * Where a line takes the machine, in machine coordinates (OD-24, owner 2026-11-08; SAFETY H3): the smallest box per
 * axis that holds every point the modelled move passes through, for the travel check against `tn`/`tm`. Straight
 * moves are bounded by their end points (each leg of G28/G30 too); an arc adds the points where its circle turns
 * along each plane axis inside its sweep. An axis whose position is not known is null: the check then says it could
 * not check that axis, never passes it.
 *
 * Millimetres on X, Y and Z, degrees on A, B and C, as the model holds them. Pure.
 */
import type { ArcModel, Plane } from './geometry.ts';
import { PLANES } from './geometry.ts';
import { AXES, type Axis } from './types.ts';

/** One axis's range, or null when its position is not known. */
export type AxisRange = { readonly min: number; readonly max: number } | null;
/** A line's box in machine coordinates; axes the line did not move keep their position as a zero-width range. */
export type MoveExtent = Readonly<Record<Axis, AxisRange>>;

type Pos = Readonly<Record<Axis, number | null>>;

/** The box of one position. */
export function extentAt(p: Pos): MoveExtent {
  const out = {} as Record<Axis, AxisRange>;
  for (const a of AXES) {
    const v = p[a];
    out[a] = v === null ? null : { min: v, max: v };
  }
  return out;
}

/** `e` grown to hold `p` (an unknown coordinate makes its axis unknown). */
export function extendTo(e: MoveExtent, p: Pos): MoveExtent {
  const out = {} as Record<Axis, AxisRange>;
  for (const a of AXES) {
    const r = e[a];
    const v = p[a];
    out[a] = r === null || v === null ? null : { min: Math.min(r.min, v), max: Math.max(r.max, v) };
  }
  return out;
}

/**
 * The plane points an arc reaches beyond its ends, start-relative (mm): where sin or cos of the angle is ±1 inside
 * the sweep (the arc model's convention: a point at angle φ is `c0 + r·sin φ`, `c1 + r·cos φ`, CW travel positive).
 */
export function arcTurningPoints(arc: ArcModel): readonly (readonly [number, number])[] {
  const from = Math.min(arc.theta, arc.theta + arc.travel);
  const to = Math.max(arc.theta, arc.theta + arc.travel);
  const out: [number, number][] = [];
  const first = Math.ceil(from / (Math.PI / 2));
  for (let k = first; k * (Math.PI / 2) <= to && out.length < 4; k++) {
    const phi = k * (Math.PI / 2);
    out.push([arc.c0 + arc.radius * Math.sin(phi), arc.c1 + arc.radius * Math.cos(phi)]);
  }
  return out;
}

/** `e` grown to hold the turning points of `arc`, which starts at machine position `start` in `plane`. */
export function extendByArc(e: MoveExtent, start: Pos, plane: Plane, arc: ArcModel): MoveExtent {
  const p = PLANES[plane];
  let out = e;
  for (const [d0, d1] of arcTurningPoints(arc)) {
    const s0 = start[p.a0];
    const s1 = start[p.a1];
    out = extendTo(out, { ...start, [p.a0]: s0 === null ? null : s0 + d0, [p.a1]: s1 === null ? null : s1 + d1 });
  }
  return out;
}
