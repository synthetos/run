/**
 * Tool profiles (docs/design/tool-sim.md, "Tool profile"): the lower surface
 * of a cutter as the height above its tip at a radius, and the outline and
 * wireframe of the 3D tool marker, at true size. Pure.
 *
 * This package does not know the tool library: `ToolShape` is its own small
 * input, and the app maps its tool records onto it. Lengths are mm, angles
 * degrees. The tip is at the origin and the tool points down -Z, so the
 * marker is drawn by moving the origin to the reported or planned position.
 */
import { ringSegments } from './scene.ts';
import type { Vec3 } from './segments.ts';

/** The tip shapes the profile knows: V covers V-bits, engravers and chamfer mills. */
export type ToolTip = 'flat' | 'ball' | 'bull-nose' | 'v' | 'drill';

export interface ToolShape {
  readonly tip: ToolTip;
  /** Cutting diameter. */
  readonly diameter: number;
  /** Flute length, from the tip. */
  readonly fluteLength: number;
  /** Shank diameter. */
  readonly shank: number;
  /** Length drawn above the tip: the stickout, or the overall length. */
  readonly length: number;
  /** Bull-nose corner radius (at most the cutting radius). */
  readonly cornerRadius?: number;
  /** V: the included angle. */
  readonly vAngle?: number;
  /** V: the flat width at the tip. */
  readonly tipWidth?: number;
  /** Drill: the point angle. */
  readonly pointAngle?: number;
}

const DEG = Math.PI / 180;

/** A V-bit or drill angle as a usable included angle: (0, 180) degrees, else the fallback. */
function angleOf(a: number | undefined, fallback: number): number {
  return a !== undefined && Number.isFinite(a) && a > 0 && a < 180 ? a : fallback;
}

/** Half of the included angle's cotangent: how fast the cone rises per mm of radius. */
function rise(includedDeg: number): number {
  return 1 / Math.tan((includedDeg / 2) * DEG);
}

/**
 * The tool's lower surface at radius r from its axis, as height above the tip (0 ≤ r ≤ D/2; r is clamped):
 * flat 0; ball R − √(R² − r²); bull-nose 0 to R − c, then the corner; V 0 to w/2, then (r − w/2)/tan(α/2);
 * drill r/tan(β/2).
 */
export function profileHeight(shape: ToolShape, r: number): number {
  const R = shape.diameter / 2;
  const x = Math.min(Math.max(0, r), R);
  switch (shape.tip) {
    case 'flat':
      return 0;
    case 'ball':
      return R - Math.sqrt(Math.max(0, R * R - x * x));
    case 'bull-nose': {
      const c = Math.min(Math.max(0, shape.cornerRadius ?? 0), R);
      const flat = R - c;
      if (x <= flat) return 0;
      const d = x - flat;
      return c - Math.sqrt(Math.max(0, c * c - d * d));
    }
    case 'v': {
      const half = Math.min(Math.max(0, shape.tipWidth ?? 0), shape.diameter) / 2;
      return x <= half ? 0 : (x - half) * rise(angleOf(shape.vAngle, 90));
    }
    case 'drill':
      return x * rise(angleOf(shape.pointAngle, 118));
  }
}

/** The height above the tip where the tool reaches its full cutting diameter. */
export function tipHeight(shape: ToolShape): number {
  return profileHeight(shape, shape.diameter / 2);
}

/** Radii at which the tip shape is sampled for the outline: its kinks plus even steps along any curve. */
function tipRadii(shape: ToolShape, steps: number): number[] {
  const R = shape.diameter / 2;
  switch (shape.tip) {
    case 'flat':
      return [0, R];
    case 'ball':
      return Array.from({ length: steps + 1 }, (_, i) => R * Math.sin((i / steps) * (Math.PI / 2)));
    case 'bull-nose': {
      const c = Math.min(Math.max(0, shape.cornerRadius ?? 0), R);
      const flat = R - c;
      return [0, ...Array.from({ length: steps + 1 }, (_, i) => flat + c * Math.sin((i / steps) * (Math.PI / 2)))];
    }
    case 'v': {
      const half = Math.min(Math.max(0, shape.tipWidth ?? 0), shape.diameter) / 2;
      return half > 0 ? [0, half, R] : [0, R];
    }
    case 'drill':
      return [0, R];
  }
}

/**
 * The tool's outline in one half-plane, from the tip on the axis up to the top of the shank, as [radius, height]
 * points: the tip shape, the flutes at the cutting diameter, then the shank.
 */
export function toolOutline(shape: ToolShape, steps = 6): Array<readonly [number, number]> {
  const R = shape.diameter / 2;
  const out: Array<readonly [number, number]> = [];
  for (const r of tipRadii(shape, steps)) {
    const p = [r, profileHeight(shape, r)] as const;
    const last = out[out.length - 1];
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  const fluteTop = Math.max(shape.fluteLength, tipHeight(shape));
  const top = Math.max(shape.length, fluteTop);
  const shankR = shape.shank > 0 ? shape.shank / 2 : R;
  if (fluteTop > tipHeight(shape)) out.push([R, fluteTop]);
  if (shankR !== R) out.push([shankR, fluteTop]);
  if (top > fluteTop) out.push([shankR, top]);
  return out;
}

/** The marker's wireframe with its tip at the origin: rings at each outline kink and profile lines at `angles` angles. */
export function toolWireframe(shape: ToolShape, angles = 8): Array<readonly [Vec3, Vec3]> {
  const outline = toolOutline(shape);
  const out: Array<readonly [Vec3, Vec3]> = [];
  const R = Math.max(shape.diameter / 2, shape.shank / 2);
  for (const [r, z] of outline) {
    if (r <= 0) continue;
    const pts = ringSegments({ center: [0, 0, z], radius: r, color: [0, 0, 0, 0] }, r < R / 3 ? 12 : 24);
    for (let i = 0; i + 1 < pts.length; i += 2) out.push([pts[i] as Vec3, pts[i + 1] as Vec3]);
  }
  for (let k = 0; k < angles; k++) {
    const a = (k / angles) * 2 * Math.PI;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    for (let i = 0; i + 1 < outline.length; i++) {
      const [r0, z0] = outline[i] as readonly [number, number];
      const [r1, z1] = outline[i + 1] as readonly [number, number];
      out.push([[r0 * cx, r0 * cy, z0], [r1 * cx, r1 * cy, z1]]);
    }
  }
  return out;
}
