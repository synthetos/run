/**
 * Arc tessellation and exact bounds (ROADMAP TB-02, old P1-03).
 *
 * The arc itself comes from the sanitiser's firmware model (`modelArc` in
 * @synthetos/safety), so the preview draws the arc preflight checked
 * (T-S1). EN parameterisation (@cite EN plan_arc.c:91-92, :305): a point at
 * angle φ is `centre + (r·sin φ, r·cos φ)` on (plane axis 0, plane axis 1),
 * with φ running from `theta` by `travel` (clockwise positive).
 */
import type { ArcModel } from '@synthetos/safety';

/** Default chord tolerance, mm (TOOLS_PLAN §6.2). */
export const DEFAULT_CHORD_MM = 0.01;

/** The angle step that keeps the chord error of a radius-`r` arc within `tol`. */
function maxStep(radius: number, tol: number): number {
  if (radius <= tol) return Math.PI; // the whole circle lies within the tolerance of its centre
  return 2 * Math.acos(1 - tol / radius);
}

/** How many chords the arc needs for chord error ≤ `tol`. At least one. */
export function arcSegments(arc: Pick<ArcModel, 'radius' | 'travel'>, tol: number): number {
  return Math.max(1, Math.ceil(Math.abs(arc.travel) / maxStep(arc.radius, tol)));
}

/** A point on the arc in start-relative plane coordinates. */
export function arcPoint(arc: Pick<ArcModel, 'radius' | 'c0' | 'c1'>, phi: number): readonly [number, number] {
  return [arc.c0 + arc.radius * Math.sin(phi), arc.c1 + arc.radius * Math.cos(phi)];
}

/**
 * Start-relative points after the start: `segments` points, the last at
 * the arc's end angle, each as (plane 0, plane 1, fraction of the move).
 */
export function tessellateArc(arc: ArcModel, segments: number): Array<readonly [number, number, number]> {
  const out: Array<readonly [number, number, number]> = [];
  for (let i = 1; i <= segments; i++) {
    const f = i / segments;
    const [p0, p1] = arcPoint(arc, arc.theta + arc.travel * f);
    out.push([p0, p1, f]);
  }
  return out;
}

/**
 * The exact axis-aligned box of the arc in start-relative plane coordinates:
 * the start, the end and every quadrant crossing the sweep passes (φ = kπ/2).
 */
export function arcBox(arc: ArcModel): { readonly min: readonly [number, number]; readonly max: readonly [number, number] } {
  const lo = Math.min(arc.theta, arc.theta + arc.travel);
  const hi = Math.max(arc.theta, arc.theta + arc.travel);
  const end = arcPoint(arc, arc.theta + arc.travel);
  const min: [number, number] = [Math.min(0, end[0]), Math.min(0, end[1])];
  const max: [number, number] = [Math.max(0, end[0]), Math.max(0, end[1])];
  const half = Math.PI / 2;
  for (let k = Math.ceil(lo / half); k * half <= hi; k++) {
    const [p0, p1] = arcPoint(arc, k * half);
    min[0] = Math.min(min[0], p0);
    min[1] = Math.min(min[1], p1);
    max[0] = Math.max(max[0], p0);
    max[1] = Math.max(max[1], p1);
  }
  return { min, max };
}
