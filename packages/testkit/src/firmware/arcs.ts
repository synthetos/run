/**
 * Center-format G17 arc geometry, one function per firmware.
 *
 * The two firmwares disagree on near-coincident end points, so each has its
 * own transcription of `_compute_arc()`; neither borrows the other's rule, and
 * neither borrows the sanitiser's arc helper (Codex batch 14 #1):
 *
 * - edge-next compares the end point with the start POSITION by position
 *   (fp_EQ on each plane axis) and runs a full circle when they coincide; it
 *   alarms when the resulting angular travel is fp_ZERO
 *   (@cite EN plan_arc.c:320-350).
 * - 440.21 compares the end ANGLE with the start angle (fp_EQ) and treats
 *   equal angles as zero angular travel (@cite TG plan_arc.c:276-303); the
 *   caller then refuses a zero-length arc with 201 (@cite TG plan_arc.c:165-167).
 *
 * The AVR build computes in float32, so operands and the intermediates the
 * branches test are rounded with `f32` (float32.ts). `atan2`, `sin` and
 * `hypot` are taken in double and rounded once: libm's float versions can
 * differ by an ulp, which only matters exactly at a branch boundary.
 */
import '../marker.ts';
import { TWO_PI_F, f32, fpEQ, fpZERO } from './float32.ts';
import type { ArcPath, Vec } from './motion.ts';

export interface ArcInput {
  /** Start position (machine coordinates, mm/degrees). */
  readonly from: Vec;
  /** Resolved target (cm_set_model_target). */
  readonly to: Vec;
  /** I and J in mm (already unit-converted). */
  readonly i: number;
  readonly j: number;
  readonly clockwise: boolean;
  /** No X and no Y word in the block. */
  readonly fullCircle: boolean;
  /** Turns added by the P word (firmware-specific defaulting is the caller's). */
  readonly rotations: number;
}

export type ArcResult =
  | { readonly ok: true; readonly path: ArcPath }
  | { readonly ok: false; readonly status: 'ARC_HAS_IMPOSSIBLE_CENTER_POINT' | 'ARC_ENDPOINT_IS_STARTING_POINT' | 'ARC_SPECIFICATION_ERROR' };

/** `ARC_RADIUS_ERROR_MAX`, `ARC_RADIUS_ERROR_MIN` (@cite EN plan_arc.h:35-37; TG plan_arc.h:25-27). */
const ARC_RADIUS_ERROR_MAX = f32(1.0);
const ARC_RADIUS_ERROR_MIN = f32(0.005);
const EN_ARC_RADIUS_TOLERANCE = f32(0.05); // @cite EN plan_arc.h:37
const TG_ARC_RADIUS_TOLERANCE = f32(0.001); // @cite TG plan_arc.h:27

interface Common {
  readonly p0: number;
  readonly p1: number;
  readonly radius: number;
  readonly end0: number;
  readonly end1: number;
  readonly err: number;
  readonly theta: number;
}

function common(a: ArcInput): Common {
  const p0 = f32(a.from[0]);
  const p1 = f32(a.from[1]);
  const t0 = f32(a.to[0]);
  const t1 = f32(a.to[1]);
  const i = f32(a.i);
  const j = f32(a.j);
  // arc.radius = hypotf(-offset0, -offset1); end = target - position - offset
  const radius = f32(Math.hypot(i, j));
  const end0 = f32(f32(t0 - p0) - i);
  const end1 = f32(f32(t1 - p1) - j);
  const err = Math.abs(f32(f32(Math.hypot(end0, end1)) - radius));
  // atan2(-offset0, -offset1): an I or J of +0 gives -0, which puts the start angle at -pi, not +pi.
  const theta = f32(Math.atan2(-i, -j));
  return { p0, p1, radius, end0, end1, err, theta };
}

function build(a: ArcInput, c: Common, sweep: number): ArcPath {
  const linear = (a.to[2] as number) - (a.from[2] as number);
  const planar = sweep * c.radius;
  return {
    kind: 'arc',
    from: a.from,
    to: a.to,
    axis0: 0,
    axis1: 1,
    linearAxis: 2,
    // center = position - sin/cos(theta) * radius (@cite EN plan_arc.c:373-374; TG plan_arc.c:326-327)
    center0: (a.from[0] as number) - Math.sin(c.theta) * c.radius,
    center1: (a.from[1] as number) - Math.cos(c.theta) * c.radius,
    radius: c.radius,
    theta: c.theta,
    sweep,
    length: Math.hypot(planar, Math.abs(linear)),
  };
}

/**
 * edge-next `_compute_arc()` for a center-format arc (@cite EN plan_arc.c:291-377).
 * Both failures are alarms in the firmware (`cm_alarm_P`).
 */
export function enComputeArc(a: ArcInput): ArcResult {
  const c = common(a);
  if (c.err > ARC_RADIUS_ERROR_MAX || (c.err > ARC_RADIUS_ERROR_MIN && c.err > f32(c.radius * EN_ARC_RADIUS_TOLERANCE))) {
    return { ok: false, status: 'ARC_HAS_IMPOSSIBLE_CENTER_POINT' };
  }
  let travel: number;
  if (!a.fullCircle) {
    travel = f32(f32(Math.atan2(c.end0, c.end1)) - c.theta);
    // Coincident center-format end points: compare positions, not angles (@cite EN plan_arc.c:324-329)
    if (fpEQ(a.to[0] as number, c.p0) && fpEQ(a.to[1] as number, c.p1)) travel = a.clockwise ? TWO_PI_F : -TWO_PI_F;
    else if (a.clockwise) {
      if (travel <= 0) travel = f32(travel + TWO_PI_F);
    } else if (travel > 0) travel = f32(travel - TWO_PI_F);
    travel = travel >= 0 ? f32(travel + f32(TWO_PI_F * a.rotations)) : f32(travel - f32(TWO_PI_F * a.rotations));
  } else {
    const rotations = a.clockwise ? a.rotations : -a.rotations;
    travel = f32(TWO_PI_F * rotations);
  }
  // Trap zero movement arcs (@cite EN plan_arc.c:347-350)
  if (fpZERO(travel)) return { ok: false, status: 'ARC_ENDPOINT_IS_STARTING_POINT' };
  return { ok: true, path: build(a, c, travel) };
}

/**
 * 440.21 `_compute_arc()` for a G17 center-format arc (@cite TG plan_arc.c:243-330).
 * The radius check returns ARC_SPECIFICATION_ERROR (not an alarm). A zero
 * length result is the caller's 201 (@cite TG plan_arc.c:165-167).
 */
export function tgComputeArc(a: ArcInput): ArcResult {
  const c = common(a);
  // Transcribed as written, including `err < ARC_RADIUS_ERROR_MIN` (@cite TG plan_arc.c:262-267)
  if (c.err > ARC_RADIUS_ERROR_MAX || (c.err < ARC_RADIUS_ERROR_MIN && c.err > f32(c.radius * TG_ARC_RADIUS_TOLERANCE))) {
    return { ok: false, status: 'ARC_SPECIFICATION_ERROR' };
  }
  let rotations = a.rotations;
  let travel: number;
  if (a.fullCircle) {
    travel = 0;
    if (fpZERO(rotations)) rotations = 1; // @cite TG plan_arc.c:276-280
  } else {
    let thetaEnd = f32(Math.atan2(c.end0, c.end1));
    // Equal ANGLES are zero angular travel (@cite TG plan_arc.c:285-286)
    if (fpEQ(thetaEnd, c.theta)) travel = 0;
    else {
      if (thetaEnd < c.theta) thetaEnd = f32(thetaEnd + TWO_PI_F); // g18_correction is 1 in G17
      travel = f32(thetaEnd - c.theta);
      if (!a.clockwise) travel = f32(travel - TWO_PI_F);
    }
  }
  // Rotations by direction, not by sign (@cite TG plan_arc.c:298-303)
  travel = a.clockwise ? f32(travel + f32(TWO_PI_F * rotations)) : f32(travel - f32(TWO_PI_F * rotations));
  return { ok: true, path: build(a, c, travel) };
}
