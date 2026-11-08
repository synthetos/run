/**
 * Picking scene solids: a ray from the camera through a point on the canvas, intersected with the boxes
 * and prisms of a scene, giving the nearest solid's tag. It reads geometry only; what a tag means is the
 * caller's. Pure functions.
 */
import { eye, type Orbit } from './camera.ts';
import type { Pt2, SceneSolid } from './scene.ts';
import type { Vec3 } from './segments.ts';

export interface Ray {
  readonly origin: Vec3;
  /** Unit length. */
  readonly dir: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * The ray through normalised device coordinates (`nx`, `ny` in -1..1, Y up) of an orbit view, with the same
 * camera as `viewProjection` (Z up, vertical field of view `fovY`).
 */
export function rayThrough(o: Orbit, aspect: number, nx: number, ny: number, fovY: number = Math.PI / 4): Ray {
  const from = eye(o);
  const f = unit(sub(o.target, from));
  const right = unit(cross(f, [0, 0, 1]));
  const up = cross(right, f);
  const t = Math.tan(fovY / 2);
  const sx = nx * t * aspect;
  const sy = ny * t;
  return { origin: from, dir: unit([f[0] + right[0] * sx + up[0] * sy, f[1] + right[1] * sx + up[1] * sy, f[2] + right[2] * sx + up[2] * sy]) };
}

/** Distance along the ray to a solid's surface, or null when it misses (or the solid is behind). */
export function hitSolid(ray: Ray, s: SceneSolid): number | null {
  return s.kind === 'box' ? hitBox(ray, s.min, s.max) : hitPrism(ray, s.outline, s.z0, s.z1);
}

/** The nearest tagged solid the ray hits, or null. */
export function pickSolid(ray: Ray, solids: readonly SceneSolid[]): { readonly tag: string; readonly distance: number } | null {
  let best: { tag: string; distance: number } | null = null;
  for (const s of solids) {
    if (s.tag === undefined) continue;
    const d = hitSolid(ray, s);
    if (d !== null && (best === null || d < best.distance)) best = { tag: s.tag, distance: d };
  }
  return best;
}

/** Slab test. */
function hitBox(ray: Ray, min: Vec3, max: Vec3): number | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = ray.origin[i] as number;
    const d = ray.dir[i] as number;
    const lo = min[i] as number;
    const hi = max[i] as number;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (t1 < t0 || t1 < 0) return null;
  return t0 >= 0 ? t0 : t1;
}

/** The caps (in the outline) and each side wall (a vertical quad on an edge). */
function hitPrism(ray: Ray, outline: readonly Pt2[], z0: number, z1: number): number | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  let best: number | null = null;
  const take = (t: number): void => { if (t >= 0 && (best === null || t < best)) best = t; };
  if (Math.abs(dz) > 1e-12) {
    for (const z of [z0, z1]) {
      const t = (z - oz) / dz;
      if (t >= 0 && insideOutline([ox + dx * t, oy + dy * t], outline)) take(t);
    }
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Pt2;
    const b = outline[(i + 1) % outline.length] as Pt2;
    // Solve origin + t·dir = a + u·(b − a) in XY.
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den;
    const u = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
    if (u < 0 || u > 1) continue;
    const z = oz + dz * t;
    if (z >= Math.min(z0, z1) && z <= Math.max(z0, z1)) take(t);
  }
  return best;
}

/** Even-odd point in polygon. */
function insideOutline(p: Pt2, poly: readonly Pt2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt2;
    const b = poly[j] as Pt2;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/** A press and release count as a click only if the pointer travelled less than this many CSS pixels between them (never an orbit drag). */
export const CLICK_SLOP_PX = 4;
