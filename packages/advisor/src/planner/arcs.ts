/**
 * Arc segmentation as the firmware does it (@cite TinyG 450.02 plan_arc.c _compute_arc, _estimate_arc_time,
 * cm_arc_callback): the fewest chords that meet the chordal tolerance and the 10 ms minimum segment time, each
 * chord a separate planner block at the arc's feed. Pure.
 */
import { MICROSECONDS_PER_MINUTE, MIN_ARC_SEGMENT_USEC } from './constants.ts';
import { f32, type Vec3 } from './block.ts';
import type { PlannerAxisName, PlannerProfile } from './types.ts';

/** Plane index → [axis 0, axis 1, linear axis] (G17 X Y Z, G18 Z X Y, G19 Y Z X; plan_arc.c, E029). */
const PLANE_AXES: readonly (readonly [number, number, number])[] = [[0, 1, 2], [2, 0, 1], [1, 2, 0]];
const NAMES: readonly PlannerAxisName[] = ['X', 'Y', 'Z'];

export interface ArcShape {
  readonly plane: number;
  readonly radius: number;
  readonly theta: number;
  readonly travel: number;
  readonly linear: number;
}

/** The chords of an arc, as relative moves, at feed `feed` (mm/min). */
export function arcSegments(profile: PlannerProfile, arc: ArcShape, feed: number): Vec3[] {
  const [a0, a1, lin] = PLANE_AXES[arc.plane] as readonly [number, number, number];
  // In float32, as the firmware computes them: the segment count is a floor, and rounding decides the edge cases.
  const r = f32(arc.radius);
  const planar = f32(f32(arc.travel) * r);
  const length = f32(Math.hypot(planar, Math.abs(arc.linear)));
  let arcTime = f32(length / f32(feed));
  arcTime = Math.max(arcTime, f32(Math.abs(planar / profile.axes[NAMES[a0] as PlannerAxisName].fr)));
  arcTime = Math.max(arcTime, f32(Math.abs(planar / profile.axes[NAMES[a1] as PlannerAxisName].fr)));
  if (Math.abs(arc.linear) > 0) arcTime = Math.max(arcTime, f32(Math.abs(arc.linear / profile.axes[NAMES[lin] as PlannerAxisName].fr)));
  const forTime = f32(arcTime * (MICROSECONDS_PER_MINUTE / MIN_ARC_SEGMENT_USEC));
  const ct = f32(profile.ct);
  const forChord = f32(length / f32(Math.sqrt(f32(f32(4 * ct) * f32(f32(2 * r) - ct)))));
  const segments = Math.max(1, Math.floor(Math.min(forChord, forTime)));
  const stepTheta = arc.travel / segments;
  const stepLinear = arc.linear / segments;
  const out: Vec3[] = [];
  let theta = arc.theta;
  let p0 = 0;
  let p1 = 0;
  // Centre relative to the start: the start sits at (sin θ, cos θ)·r from it.
  const c0 = -Math.sin(theta) * arc.radius;
  const c1 = -Math.cos(theta) * arc.radius;
  for (let k = 0; k < segments; k++) {
    theta += stepTheta;
    const n0 = c0 + Math.sin(theta) * arc.radius;
    const n1 = c1 + Math.cos(theta) * arc.radius;
    const d: [number, number, number] = [0, 0, 0];
    d[a0] = n0 - p0;
    d[a1] = n1 - p1;
    d[lin] = stepLinear;
    out.push(d);
    p0 = n0;
    p1 = n1;
  }
  return out;
}
