/**
 * Scene solids under a toolpath: the bed slab, the stock, a fixture plate
 * (an extruded outline with hole marks) and clamps, as plain boxes and
 * prisms in the same frame as the drawn path. The caller decides what they
 * mean and where they sit; this package only turns them into flat-shaded
 * triangles (renderer) or top-view outlines (svg).
 *
 * Shading is baked per face, as in a drafting illustration: the top face at
 * full tone, Y-facing sides a little darker, X-facing sides darker still.
 * Pure: the same solids give the same triangles.
 */
import type { Box3, Vec3 } from './segments.ts';

/** A colour as red, green, blue and alpha in 0..1. */
export type Rgba = readonly [number, number, number, number];

export type Pt2 = readonly [number, number];

export interface SceneBox {
  readonly kind: 'box';
  readonly min: Vec3;
  readonly max: Vec3;
  readonly color: Rgba;
  /** What the solid is, for the caller's own styling of the top-view fallback ("bed", "stock"); never interpreted here. */
  readonly tag?: string;
}

/** An outline extruded from `z0` up to `z1`; the outline may wind either way and may be concave. */
export interface ScenePrism {
  readonly kind: 'prism';
  readonly outline: readonly Pt2[];
  readonly z0: number;
  readonly z1: number;
  readonly color: Rgba;
  readonly tag?: string;
}

export type SceneSolid = SceneBox | ScenePrism;

/** A circle drawn as lines (a hole mark on a top face). */
export interface SceneRing {
  readonly center: Vec3;
  readonly radius: number;
  readonly color: Rgba;
}

export interface SceneLayers {
  readonly solids: readonly SceneSolid[];
  readonly rings: readonly SceneRing[];
}

/** Shade per face normal: top 1, bottom 0.55, Y faces 0.82, X faces 0.7. */
export const FACE_SHADE = Object.freeze({ top: 1, bottom: 0.55, y: 0.82, x: 0.7 });

/** Caps of an outline with more points than this are triangulated on a decimated copy (the sides keep every point). */
export const MAX_CAP_POINTS = 2000;

export interface SolidTriangles {
  /** X, Y, Z per vertex, three vertices per triangle. */
  readonly positions: Float32Array;
  /** R, G, B, A per vertex. */
  readonly colors: Float32Array;
}

function shaded(c: Rgba, k: number): Rgba {
  return [c[0] * k, c[1] * k, c[2] * k, c[3]];
}

function signedArea(poly: readonly Pt2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt2;
    const q = poly[(i + 1) % poly.length] as Pt2;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Ear clipping of a simple polygon (counter-clockwise), as triangle index triples. Degenerate input
 * (fewer than three points, or no ear found) yields what it can and stops; it never loops forever.
 */
export function triangulate(poly: readonly Pt2[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  if (signedArea(poly) < 0) idx.reverse();
  const out: number[] = [];
  const at = (k: number): Pt2 => poly[idx[k] as number] as Pt2;
  const cross = (o: Pt2, a: Pt2, b: Pt2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: Pt2, a: Pt2, b: Pt2, c: Pt2): boolean => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      guard++;
      const a = at((k + idx.length - 1) % idx.length);
      const b = at(k);
      const c = at((k + 1) % idx.length);
      if (cross(a, b, c) <= 0) continue;
      let ear = true;
      for (let m = 0; m < idx.length && ear; m++) {
        if (m === k || m === (k + idx.length - 1) % idx.length || m === (k + 1) % idx.length) continue;
        if (inside(at(m), a, b, c)) ear = false;
      }
      if (!ear) continue;
      out.push(idx[(k + idx.length - 1) % idx.length] as number, idx[k] as number, idx[(k + 1) % idx.length] as number);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0] as number, idx[1] as number, idx[2] as number);
  return out;
}

/** Every `stride`-th point of a long outline, so a cap stays cheap to triangulate. */
function capOutline(outline: readonly Pt2[]): readonly Pt2[] {
  if (outline.length <= MAX_CAP_POINTS) return outline;
  const stride = Math.ceil(outline.length / MAX_CAP_POINTS);
  return outline.filter((_, i) => i % stride === 0);
}

/** The flat-shaded triangles of one solid. */
export function solidTriangles(solid: SceneSolid): SolidTriangles {
  const pos: number[] = [];
  const col: number[] = [];
  const tri = (a: Vec3, b: Vec3, c: Vec3, color: Rgba): void => {
    pos.push(...a, ...b, ...c);
    col.push(...color, ...color, ...color);
  };
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Rgba): void => {
    tri(a, b, c, color);
    tri(a, c, d, color);
  };
  if (solid.kind === 'box') {
    const [x0, y0, z0] = solid.min;
    const [x1, y1, z1] = solid.max;
    const c = solid.color;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], shaded(c, FACE_SHADE.top));
    quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], shaded(c, FACE_SHADE.bottom));
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], shaded(c, FACE_SHADE.y));
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], shaded(c, FACE_SHADE.y));
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shaded(c, FACE_SHADE.x));
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], shaded(c, FACE_SHADE.x));
    return { positions: new Float32Array(pos), colors: new Float32Array(col) };
  }
  const o = solid.outline;
  const n = o.length;
  if (n < 3) return { positions: new Float32Array(0), colors: new Float32Array(0) };
  const ccw = signedArea(o) >= 0;
  for (let i = 0; i < n; i++) {
    const a = o[i] as Pt2;
    const b = o[(i + 1) % n] as Pt2;
    // Side tone by how much the face looks along X (darker) or Y.
    const nx = Math.abs(b[1] - a[1]);
    const ny = Math.abs(b[0] - a[0]);
    const len = Math.hypot(nx, ny) || 1;
    const k = FACE_SHADE.y + (FACE_SHADE.x - FACE_SHADE.y) * (nx / len);
    const color = shaded(solid.color, k);
    const p: Vec3 = [a[0], a[1], solid.z0];
    const q: Vec3 = [b[0], b[1], solid.z0];
    const r: Vec3 = [b[0], b[1], solid.z1];
    const s: Vec3 = [a[0], a[1], solid.z1];
    if (ccw) quad(p, q, r, s, color);
    else quad(s, r, q, p, color);
  }
  const cap = capOutline(o);
  const tris = triangulate(cap);
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = cap[tris[i] as number] as Pt2;
    const b = cap[tris[i + 1] as number] as Pt2;
    const c = cap[tris[i + 2] as number] as Pt2;
    tri([a[0], a[1], solid.z1], [b[0], b[1], solid.z1], [c[0], c[1], solid.z1], shaded(solid.color, FACE_SHADE.top));
    tri([a[0], a[1], solid.z0], [c[0], c[1], solid.z0], [b[0], b[1], solid.z0], shaded(solid.color, FACE_SHADE.bottom));
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col) };
}

/** The ring as line segments (pairs of points), `n` around. */
export function ringSegments(ring: SceneRing, n = 24): Vec3[] {
  const out: Vec3[] = [];
  const [cx, cy, cz] = ring.center;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    out.push([cx + ring.radius * Math.cos(a0), cy + ring.radius * Math.sin(a0), cz], [cx + ring.radius * Math.cos(a1), cy + ring.radius * Math.sin(a1), cz]);
  }
  return out;
}

/** The box around every solid and ring, or null for an empty scene. */
export function sceneBounds(scene: SceneLayers | null): Box3 | null {
  if (scene === null) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const take = (x: number, y: number, z: number): void => {
    if (x < (min[0] as number)) min[0] = x;
    if (y < (min[1] as number)) min[1] = y;
    if (z < (min[2] as number)) min[2] = z;
    if (x > (max[0] as number)) max[0] = x;
    if (y > (max[1] as number)) max[1] = y;
    if (z > (max[2] as number)) max[2] = z;
  };
  for (const s of scene.solids) {
    if (s.kind === 'box') {
      take(...s.min);
      take(...s.max);
    } else {
      for (const [x, y] of s.outline) {
        take(x, y, s.z0);
        take(x, y, s.z1);
      }
    }
  }
  for (const r of scene.rings) {
    take(r.center[0] - r.radius, r.center[1] - r.radius, r.center[2]);
    take(r.center[0] + r.radius, r.center[1] + r.radius, r.center[2]);
  }
  if (!Number.isFinite(min[0] as number)) return null;
  return { min: [min[0] as number, min[1] as number, min[2] as number], max: [max[0] as number, max[1] as number, max[2] as number] };
}

/** The union of boxes, ignoring nulls; null when all are. */
export function unionBox(...boxes: readonly (Box3 | null)[]): Box3 | null {
  let out: Box3 | null = null;
  for (const b of boxes) {
    if (b === null) continue;
    out = out === null ? b : { min: [Math.min(out.min[0], b.min[0]), Math.min(out.min[1], b.min[1]), Math.min(out.min[2], b.min[2])], max: [Math.max(out.max[0], b.max[0]), Math.max(out.max[1], b.max[1]), Math.max(out.max[2], b.max[2])] };
  }
  return out;
}

/** A box moved by an offset. */
export function offsetBox(box: Box3 | null, offset: Vec3): Box3 | null {
  if (box === null) return null;
  return { min: [box.min[0] + offset[0], box.min[1] + offset[1], box.min[2] + offset[2]], max: [box.max[0] + offset[0], box.max[1] + offset[1], box.max[2] + offset[2]] };
}
