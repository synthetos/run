/**
 * Orbit camera math (column-major 4x4 matrices, as WebGL expects). Z is up,
 * as on a CNC machine. Pure functions only: the renderer owns the state.
 */
import type { Box3, Vec3 } from './segments.ts';

export type Mat4 = Float32Array;

export interface Orbit {
  /** Point the camera looks at. */
  readonly target: Vec3;
  /** Distance from the target. */
  readonly distance: number;
  /** Rotation about Z, radians. */
  readonly azimuth: number;
  /** Angle above the XY plane, radians, clamped to (-pi/2, pi/2). */
  readonly elevation: number;
}

const LIMIT = Math.PI / 2 - 1e-3;

/**
 * The default view: from the front-right, above, looking at the box centre, fitting the whole box.
 * Without `aspect` the whole bounding sphere fits the vertical field of view (loose). With `aspect`
 * (width / height) the box's corners are fitted tightly so the box fills `fill` of the view (0.8 by
 * default) in whichever direction is tighter.
 */
export function fitOrbit(box: Box3 | null, fovY: number = Math.PI / 4, aspect?: number, fill = 0.8): Orbit {
  const azimuth = -Math.PI / 4;
  const elevation = Math.PI / 5;
  if (box === null) return { target: [0, 0, 0], distance: 100, azimuth, elevation };
  const c: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const r = Math.max(1e-3, Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2);
  if (aspect === undefined || !(aspect > 0) || !(fill > 0)) return { target: c, distance: r / Math.sin(fovY / 2) * 1.05, azimuth, elevation };
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);
  const f: Vec3 = [ce * Math.cos(azimuth), ce * Math.sin(azimuth), se];
  const right: Vec3 = [-Math.sin(azimuth), Math.cos(azimuth), 0];
  const up: Vec3 = [-se * Math.cos(azimuth), -se * Math.sin(azimuth), ce];
  const ty = Math.tan(fovY / 2) * fill;
  const tx = ty * aspect;
  let d = 1e-3;
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        const v: Vec3 = [x - c[0], y - c[1], z - c[2]];
        const dot = (a: Vec3): number => v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
        const toward = dot(f);
        d = Math.max(d, toward + Math.abs(dot(right)) / tx, toward + Math.abs(dot(up)) / ty);
      }
    }
  }
  // Keep the camera outside the box, whatever its shape.
  return { target: c, distance: Math.max(d, r * 1.05), azimuth, elevation };
}

export function eye(o: Orbit): Vec3 {
  const ce = Math.cos(o.elevation);
  return [
    o.target[0] + o.distance * ce * Math.cos(o.azimuth),
    o.target[1] + o.distance * ce * Math.sin(o.azimuth),
    o.target[2] + o.distance * Math.sin(o.elevation),
  ];
}

export function rotate(o: Orbit, dAzimuth: number, dElevation: number): Orbit {
  return { ...o, azimuth: o.azimuth + dAzimuth, elevation: Math.max(-LIMIT, Math.min(LIMIT, o.elevation + dElevation)) };
}

export function zoom(o: Orbit, factor: number): Orbit {
  if (!(factor > 0)) return o;
  return { ...o, distance: Math.max(1e-3, o.distance * factor) };
}

/** Moves the target in the view plane by (dx, dy) fractions of the view height. */
export function pan(o: Orbit, dx: number, dy: number, fovY: number = Math.PI / 4): Orbit {
  const h = 2 * o.distance * Math.tan(fovY / 2);
  const right: Vec3 = [-Math.sin(o.azimuth), Math.cos(o.azimuth), 0];
  const up: Vec3 = [
    -Math.sin(o.elevation) * Math.cos(o.azimuth),
    -Math.sin(o.elevation) * Math.sin(o.azimuth),
    Math.cos(o.elevation),
  ];
  return {
    ...o,
    target: [
      o.target[0] - (right[0] * dx - up[0] * dy) * h,
      o.target[1] - (right[1] * dx - up[1] * dy) * h,
      o.target[2] - (right[2] * dx - up[2] * dy) * h,
    ],
  };
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function lookAt(from: Vec3, to: Vec3, up: Vec3 = [0, 0, 1]): Mat4 {
  let zx = from[0] - to[0], zy = from[1] - to[1], zz = from[2] - to[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * from[0] + xy * from[1] + xz * from[2]);
  m[13] = -(yx * from[0] + yy * from[1] + yz * from[2]);
  m[14] = -(zx * from[0] + zy * from[1] + zz * from[2]);
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** Projection times view for an orbit and a viewport aspect ratio. */
export function viewProjection(o: Orbit, aspect: number, fovY: number = Math.PI / 4): Mat4 {
  const near = Math.max(1e-3, o.distance / 1000);
  const far = o.distance * 1000;
  return multiply(perspective(fovY, aspect, near, far), lookAt(eye(o), o.target));
}

/** Applies a matrix to a point and divides by w (clip to normalised device coordinates). */
export function project(m: Mat4, p: Vec3): Vec3 {
  const x = (m[0] as number) * p[0] + (m[4] as number) * p[1] + (m[8] as number) * p[2] + (m[12] as number);
  const y = (m[1] as number) * p[0] + (m[5] as number) * p[1] + (m[9] as number) * p[2] + (m[13] as number);
  const z = (m[2] as number) * p[0] + (m[6] as number) * p[1] + (m[10] as number) * p[2] + (m[14] as number);
  const w = (m[3] as number) * p[0] + (m[7] as number) * p[1] + (m[11] as number) * p[2] + (m[15] as number);
  return [x / w, y / w, z / w];
}
