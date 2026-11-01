/**
 * Move modelling and long-move splitting (SAFETY §4.3 "Ceiling", §4.7 step
 * 6a, T-S64).
 *
 * A feed move's modelled duration is its path length over
 * `v_eff = min(F, fr) × k`; a rapid's is over `vm × k`. TinyG limits feed
 * moves by the axis feed rate maximum `fr` and only rapids by the velocity
 * maximum `vm` (@cite EN plan_line.c:349-353 `_calc_move_times`; TG the
 * same). `fr` and `vm` are the smallest board value among the axes that
 * move, so the model never assumes a move faster than its slowest axis
 * allows (the firmware takes the longest per-axis time, which is never
 * above length / min(fr)); a smaller `v_eff` gives a longer modelled time and
 * shorter sub-segments, so every simplification here errs towards more
 * splitting.
 *
 * Arcs follow the firmware arc code where it decides geometry: the centre
 * from I/J/K or R (@cite EN plan_arc.c:454-493), the angular travel with
 * rotations and full circles (@cite EN plan_arc.c:300-345), and the plane
 * axis order, including G18 as (Z, X) (@cite EN plan_arc.c:158-172).
 *
 * The firmware decides an arc's travel in float32 with fp_EQ (`fabs(a-b) <
 * (float)0.00001`, @cite EN util.h:134-139; TG util.h:113-125), and the two
 * dialects test different things (`DialectJobGcode.arcCoincidence`): EN
 * compares the end POSITION with the start on both plane axes and runs a full
 * circle when they are equal (@cite EN plan_arc.c:320-341); TG compares the
 * end ANGLE with the start angle and treats equal angles as zero travel plus
 * P turns (@cite TG plan_arc.c:276-303). Double precision cannot reproduce
 * either test near its boundary, so every such decision is made with an error
 * band that bounds the float32 rounding from the machine coordinates' size:
 * clearly inside or clearly outside is modelled, anything in the band is
 * refused as ambiguous (Codex P0-10 #1).
 */
import type { Axis, MotionModel } from './types.ts';

/** Endpoint rounding (SAFETY §4.7 step 6a): 0.0001 mm, 0.00001 in, and 0.0001° for rotary axes. */
export const DECIMALS = Object.freeze({ mm: 4, in: 5, rotary: 4 });

/** Most sub-segments one line may become. Beyond this the move is a preflight block. */
export const MAX_SEGMENTS = 10_000;

/**
 * Shortest sub-segment (mm, chord in the arc plane for arcs). Far above the
 * rounding step, so a sub-arc can never round to coincident endpoints, which
 * EN would run as a full circle (@cite EN plan_arc.c:322-329).
 */
export const MIN_SEGMENT_MM = 0.01;

/** How far a sub-arc's end radius may differ from its start radius after rounding (mm). */
export const ARC_CONTINUITY_MM = 0.001;

/** How far a sub-arc's travel, as the firmware will compute it, may differ from the intended travel (radians). */
export const ARC_TRAVEL_TOLERANCE_RAD = 1e-3;

export const ROTARY: ReadonlySet<Axis> = new Set<Axis>(['A', 'B', 'C']);

export type DurationResult =
  | { readonly kind: 'ok'; readonly seconds: number }
  /** No usable limit for `axis`: `vm` for a rapid, `fr` for a feed move. */
  | { readonly kind: 'noVelocity'; readonly axis: Axis; readonly limit: 'vm' | 'fr' };

/** The report text for a missing limit. */
export function noVelocityMessage(d: Extract<DurationResult, { kind: 'noVelocity' }>): string {
  return d.limit === 'vm'
    ? `no maximum velocity (vm) is known for axis ${d.axis}`
    : `no feed rate maximum (fr) is known for axis ${d.axis}`;
}

/**
 * Modelled duration of a move of `lengthMm` along `moving` axes: a feed move
 * at `min(feedMmPerMin, fr)`, or a rapid at `vm` when `feedMmPerMin` is null.
 */
export function moveSeconds(
  moving: readonly Axis[],
  lengthMm: number,
  feedMmPerMin: number | null,
  motion: MotionModel,
): DurationResult {
  if (lengthMm === 0) return { kind: 'ok', seconds: 0 };
  const rapid = feedMmPerMin === null;
  const table = rapid ? motion.maxVelocity : motion.feedrateMax;
  let limit = Infinity;
  for (const axis of moving) {
    const v = table[axis];
    if (v === undefined || !(v > 0) || !Number.isFinite(v)) return { kind: 'noVelocity', axis, limit: rapid ? 'vm' : 'fr' };
    limit = Math.min(limit, v);
  }
  const v = rapid ? limit : Math.min(feedMmPerMin, limit);
  return { kind: 'ok', seconds: (lengthMm / (v * motion.k)) * 60 };
}

/** Formats a number with at most `decimals` places, no trailing zeros, no exponent and no `-0`. */
export function formatNumber(value: number, decimals: number): string {
  let s = value.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** Rounds to `decimals` places, the way `formatNumber` prints. */
export function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

// ---------------------------------------------------------------------------
// Straight moves
// ---------------------------------------------------------------------------

/** One axis of a straight move, in the units the line is written in. */
export interface LinearAxis {
  readonly axis: Axis;
  /** Program value of the start, needed only for absolute moves. */
  readonly start: number;
  /** Program-unit delta of the whole move. */
  readonly delta: number;
  /** The word's text as written, used unchanged for the final endpoint of an absolute move. */
  readonly written: string;
  /** mm per program unit (25.4 under G20; 1 under G21 and for rotary axes). */
  readonly scale: number;
  readonly decimals: number;
}

export interface Segment {
  /** Axis (and, for arcs, offset) words of this sub-segment, e.g. `X10.5`. */
  readonly words: readonly string[];
  readonly lengthMm: number;
  readonly seconds: number;
}

export type SplitResult =
  | { readonly kind: 'ok'; readonly segments: readonly Segment[] }
  | { readonly kind: 'impossible'; readonly detail: string };

function lengthOf(deltasMm: readonly number[]): number {
  return Math.hypot(...deltasMm);
}

/**
 * Sub-segments are sized against this fraction of the ceiling, so a line the
 * sanitiser wrote is never re-split when its own output is sanitised again
 * (T-S1 idempotence) however the floating-point arithmetic rounds.
 */
export const SPLIT_BUDGET = 0.999;

/**
 * Splits a straight move into the fewest sub-segments whose modelled
 * duration, recomputed from the rounded endpoints actually written, stays
 * within the ceiling. Straight moves are divided exactly; an incremental
 * move's sub-deltas are differences of rounded cumulative positions, so they
 * add up to the original delta (SAFETY §4.7 step 6a).
 */
export function splitLinear(
  axes: readonly LinearAxis[],
  absolute: boolean,
  feedMmPerMin: number | null,
  totalSeconds: number,
  motion: MotionModel,
): SplitResult {
  const moving = axes.filter((a) => a.delta !== 0).map((a) => a.axis);
  const budget = motion.ceilingSeconds * SPLIT_BUDGET;
  const totalMm = lengthOf(axes.map((a) => a.delta * a.scale));
  let n = Math.max(2, Math.ceil(totalSeconds / budget));
  for (; n <= MAX_SEGMENTS; n++) {
    if (totalMm / n < MIN_SEGMENT_MM) break;
    const segments: Segment[] = [];
    let ok = true;
    // Program-unit position after the previous sub-segment, as written.
    let previous = axes.map((a) => (absolute ? a.start : 0));
    for (let k = 1; k <= n; k++) {
      const last = k === n;
      const base = (a: LinearAxis): number => (absolute ? a.start : 0);
      const position = axes.map((a) => (last ? base(a) + a.delta : roundTo(base(a) + (a.delta * k) / n, a.decimals)));
      const words = axes.map((a, i) => {
        const here = position[i] as number;
        const before = previous[i] as number;
        if (absolute) return last ? `${a.axis}${a.written}` : `${a.axis}${formatNumber(here, a.decimals)}`;
        const places = last ? Math.max(a.decimals, decimalsIn(a.written)) : a.decimals;
        return `${a.axis}${formatNumber(here - before, places)}`;
      });
      const lengthMm = lengthOf(axes.map((a, i) => ((position[i] as number) - (previous[i] as number)) * a.scale));
      const d = moveSeconds(moving, lengthMm, feedMmPerMin, motion);
      /* c8 ignore next -- the caller has already modelled the whole move, so every moving axis has a velocity */
      if (d.kind !== 'ok') return { kind: 'impossible', detail: `no velocity for axis ${d.axis}` };
      if (d.seconds > budget) {
        ok = false;
        break;
      }
      segments.push({ words, lengthMm, seconds: d.seconds });
      previous = position;
    }
    if (ok) return { kind: 'ok', segments };
  }
  return { kind: 'impossible', detail: 'the move would need sub-segments shorter than the split tolerance allows' };
}

function decimalsIn(text: string): number {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

// ---------------------------------------------------------------------------
// Arcs
// ---------------------------------------------------------------------------

/** Plane axes in EN order (axis 0, axis 1, linear) and their offset letters. */
export const PLANES = Object.freeze({
  G17: { a0: 'X', a1: 'Y', lin: 'Z', o0: 'I', o1: 'J' },
  G18: { a0: 'Z', a1: 'X', lin: 'Y', o0: 'K', o1: 'I' },
  G19: { a0: 'Y', a1: 'Z', lin: 'X', o0: 'J', o1: 'K' },
} as const);

export type Plane = keyof typeof PLANES;

/** An arc in start-relative millimetres, as the firmware would see it. */
export interface ArcInput {
  readonly clockwise: boolean;
  /** Target relative to the start: plane axis 0, plane axis 1, linear axis (mm). */
  readonly d0: number;
  readonly d1: number;
  readonly dLin: number;
  /** Centre relative to the start (centre format), or null for R format. */
  readonly centre: { readonly c0: number; readonly c1: number } | null;
  /** R (mm, signed) for R format. */
  readonly radius: number | null;
  /** True when neither plane axis is on the line (a centre-format full circle). */
  readonly noPlaneEndpoint: boolean;
  /** P rotations, or null. */
  readonly rotations: number | null;
  /** What the firmware compares to decide a coincident arc (`DialectJobGcode.arcCoincidence`). */
  readonly coincidence: 'position' | 'angle';
  /**
   * The largest absolute machine coordinate, work coordinate or work offset
   * (mm) on the two plane axes at the start. It sizes the float32 rounding
   * band (`positionErrorMm`).
   */
  readonly magnitudeMm: number;
}

export interface ArcModel {
  readonly radius: number;
  /** Centre relative to the start (mm). */
  readonly c0: number;
  readonly c1: number;
  /** EN start angle: atan2 of the start seen from the centre, measured from axis 1 towards axis 0. */
  readonly theta: number;
  /** Signed angular travel (CW positive, as EN). */
  readonly travel: number;
  readonly lengthMm: number;
  /**
   * The largest coordinate magnitude anywhere on the arc (mm): the start
   * magnitude plus the end point and diameter. Sub-arcs are re-checked with
   * the rounding band it gives.
   */
  readonly pathMagnitudeMm: number;
}

export type ArcModelResult =
  | { readonly kind: 'ok'; readonly arc: ArcModel }
  /** The firmware would refuse the arc. */
  | { readonly kind: 'invalid'; readonly detail: string }
  /** The firmware's float32 decision cannot be predicted: it lies within the rounding band. */
  | { readonly kind: 'ambiguous'; readonly detail: string };

/** fp_EQ's EPSILON, `(float)0.00001` (@cite EN util.h:134-139; TG util.h:113-125). */
export const FP_EPSILON = Math.fround(0.00001);

/**
 * Relative bound on the float32 rounding of a coordinate the firmware
 * computes (mm per mm of magnitude). One float32 rounding is at most 2^-24 of
 * the value; a target passes through a handful (the word, the unit
 * conversion, the offset sum, the stored position), so 2^-20 (sixteen
 * roundings) is a deliberate over-estimate.
 */
export const F32_RELATIVE_ERROR = 2 ** -20;

/** Absolute floor of the position error (mm), for coordinates near zero. */
export const F32_ABSOLUTE_ERROR_MM = 1e-9;

/** Absolute angle error (radians) of float32 atan2 and its operands near pi: about eight float32 ulps at pi. */
export const F32_ANGLE_ERROR = 2 ** -19;

/** An R-format arc's chord must be at least this many position errors, so float32 cannot turn its centre. */
export const R_CHORD_ERRORS = 100;

/**
 * Bound on the float32 error of the start and end coordinates of an arc
 * (mm), from the start magnitude and the end point's distance from it.
 */
export function positionErrorMm(magnitudeMm: number, d0: number, d1: number): number {
  return F32_RELATIVE_ERROR * (magnitudeMm + Math.abs(d0) + Math.abs(d1)) + F32_ABSOLUTE_ERROR_MM;
}

/** fp_EQ of a firmware difference whose exact value is within `err` of `delta`: equal, not equal, or undecidable. */
function fpEq(delta: number, err: number): 'eq' | 'ne' | 'band' {
  const d = Math.abs(delta);
  if (d + err < FP_EPSILON) return 'eq';
  if (d - err >= FP_EPSILON) return 'ne';
  return 'band';
}

export type TravelResult =
  | { readonly kind: 'ok'; readonly travel: number }
  | { readonly kind: 'invalid'; readonly detail: string }
  | { readonly kind: 'ambiguous'; readonly detail: string };

/** One arc in start-relative mm as the firmware decides its travel: end point and centre in the plane. */
export interface TravelInput {
  readonly coincidence: 'position' | 'angle';
  readonly clockwise: boolean;
  /** True for a centre-format (I/J/K) arc, false for R format (whose centre the caller derived). */
  readonly centreFormat: boolean;
  readonly d0: number;
  readonly d1: number;
  readonly c0: number;
  readonly c1: number;
  readonly radius: number;
  /** Whole turns from P (0 when absent). */
  readonly rotations: number;
  readonly positionErrorMm: number;
}

/**
 * Angular travel of an arc that has a plane end point, as the dialect's
 * float32 code decides it, or why it cannot be predicted.
 *
 * - EN, centre format: both plane end points fp_EQ to the start is a full
 *   circle in the arc's direction (@cite EN plan_arc.c:324-329); otherwise
 *   the atan2 travel, and a travel that is fp_ZERO alarms (@cite EN
 *   plan_arc.c:347-350).
 * - TG: start and end angles fp_EQ (compared as atan2 returns them, not
 *   modulo 2π) is zero travel (@cite TG plan_arc.c:285-286); otherwise the
 *   atan2 travel. P turns are then added by direction (@cite TG
 *   plan_arc.c:298-303).
 * - R format on both: the radius path skips EN's position test (@cite EN
 *   plan_arc.c:325), and end points equal on the plane axes give the radius
 *   code a zero divisor (@cite EN `_compute_arc_offsets_from_radius`), so an
 *   R arc must have clearly separate plane end points.
 */
export function arcTravel(t: TravelInput): TravelResult {
  const err = t.positionErrorMm;
  const ambiguous = (why: string): TravelResult => ({ kind: 'ambiguous', detail: why });
  const e0 = fpEq(t.d0, err);
  const e1 = fpEq(t.d1, err);
  if (!t.centreFormat) {
    if (e0 !== 'ne' && e1 !== 'ne') return ambiguous('its end point is within float32 rounding of its start, which the firmware cannot turn into a radius arc');
    if (Math.hypot(t.d0, t.d1) < R_CHORD_ERRORS * err) return ambiguous('its end points are too close for the firmware to place the R-format centre reliably in float32');
  }
  const position = t.coincidence === 'position' && t.centreFormat;
  const turn = (travel: number): number => travel + (t.clockwise ? 1 : -1) * 2 * Math.PI * t.rotations;
  if (position && e0 === 'eq' && e1 === 'eq') return { kind: 'ok', travel: turn(0) + (t.clockwise ? 2 : -2) * Math.PI };
  if (position && e0 !== 'ne' && e1 !== 'ne') return ambiguous('its end point is within float32 rounding of the firmware\'s coincident-end-point test, which would make it a full circle');
  const thetaStart = Math.atan2(-t.c0, -t.c1);
  const thetaEnd = Math.atan2(t.d0 - t.c0, t.d1 - t.c1);
  let travel = thetaEnd - thetaStart;
  // Distance of the end angle from the start angle, modulo a turn: where the direction corrections switch.
  const gap = Math.abs(travel - 2 * Math.PI * Math.round(travel / (2 * Math.PI)));
  const angleErr = (4 * err) / t.radius + F32_ANGLE_ERROR;
  if (gap < FP_EPSILON + angleErr) {
    const nearCut = Math.PI - Math.abs(thetaStart) < angleErr || Math.PI - Math.abs(thetaEnd) < angleErr;
    if (t.coincidence === 'angle' && t.centreFormat && gap + angleErr < FP_EPSILON && !nearCut) {
      const zero = turn(0);
      return zero === 0
        ? { kind: 'invalid', detail: 'its start and end angles are equal to the firmware, so it has no angular travel' }
        : { kind: 'ok', travel: zero };
    }
    return ambiguous('its end angle is within float32 rounding of its start angle, where the firmware\'s direction test can go either way');
  }
  if (t.clockwise) {
    if (travel <= 0) travel += 2 * Math.PI;
  } else if (travel > 0) {
    travel -= 2 * Math.PI;
  }
  return { kind: 'ok', travel: turn(travel) };
}

/** Smallest R the firmware accepts (MIN_ARC_RADIUS, @cite EN plan_arc.h). */
const MIN_ARC_RADIUS_MM = 0.1;

/**
 * The arc the firmware would run, or why it would refuse it. A centre whose
 * start and end radii differ by more than max(0.005 mm, 0.1 % of the radius)
 * is refused here: EN alarms above its own tolerance and TG's test is
 * inverted (@cite TG plan_arc.c:262-264), so the strictest common rule is used.
 */
export function modelArc(input: ArcInput): ArcModelResult {
  let c0: number;
  let c1: number;
  let radius: number;
  if (input.centre === null) {
    const r = input.radius as number;
    if (Math.abs(r) < MIN_ARC_RADIUS_MM) return { kind: 'invalid', detail: 'the arc radius is below the firmware minimum' };
    const x = input.d0;
    const y = input.d1;
    const chord = Math.hypot(x, y);
    if (chord === 0) return { kind: 'invalid', detail: 'an R-format arc needs an end point different from its start' };
    const disc = 4 * r * r - chord * chord;
    if (disc < -1e-6) return { kind: 'invalid', detail: 'the arc radius is smaller than half the distance between its end points' };
    let h = disc > 0 ? -Math.sqrt(disc) / chord : 0;
    if (!input.clockwise) h = -h;
    if (r < 0) h = -h;
    c0 = (x - y * h) / 2;
    c1 = (y + x * h) / 2;
    radius = Math.abs(r);
  } else {
    c0 = input.centre.c0;
    c1 = input.centre.c1;
    if (c0 === 0 && c1 === 0) return { kind: 'invalid', detail: 'the arc offsets are missing or zero' };
    radius = Math.hypot(c0, c1);
  }
  const end0 = input.d0 - c0;
  const end1 = input.d1 - c1;
  const err = Math.abs(Math.hypot(end0, end1) - radius);
  if (err > Math.max(0.005, radius * 0.001)) {
    return { kind: 'invalid', detail: `the arc end point is ${formatNumber(err, 4)} mm off the circle through its start` };
  }
  const theta = Math.atan2(-c0, -c1);
  const fullCircle = input.centre !== null && input.noPlaneEndpoint;
  const positionError = positionErrorMm(input.magnitudeMm, input.d0, input.d1);
  let travel: number;
  if (fullCircle) {
    // No plane end point: P turns, one by default (@cite EN plan_arc.c:200-212, :340-344; TG plan_arc.c:276-280).
    const rotations = input.rotations ?? 1;
    travel = 2 * Math.PI * rotations * (input.clockwise ? 1 : -1);
  } else {
    const t = arcTravel({
      coincidence: input.coincidence,
      clockwise: input.clockwise,
      centreFormat: input.centre !== null,
      d0: input.d0,
      d1: input.d1,
      c0,
      c1,
      radius,
      rotations: input.rotations ?? 0,
      positionErrorMm: positionError,
    });
    if (t.kind !== 'ok') return t;
    travel = t.travel;
  }
  if (travel === 0) return { kind: 'invalid', detail: 'the arc has no movement' };
  const lengthMm = Math.hypot(travel * radius, Math.abs(input.dLin));
  const pathMagnitudeMm = input.magnitudeMm + Math.abs(input.d0) + Math.abs(input.d1) + 2 * radius;
  return { kind: 'ok', arc: { radius, c0, c1, theta, travel, lengthMm, pathMagnitudeMm } };
}

/** How an arc's sub-segments are written. */
export interface ArcWriting {
  readonly plane: Plane;
  readonly absolute: boolean;
  /** G90.1: I/J/K are the centre in work coordinates, not offsets from the start. */
  readonly absoluteCentre: boolean;
  /**
   * Program values of the start on plane axis 0, axis 1 and the linear axis,
   * or null where unknown. Required (non-null) on the plane axes for an
   * absolute move or G90.1, and on the linear axis for an absolute helix.
   */
  readonly start0: number | null;
  readonly start1: number | null;
  readonly startLin: number | null;
  /** mm per program unit, and decimals. */
  readonly scale: number;
  readonly decimals: number;
  /** Final endpoint words as written (absolute moves), or the program-unit deltas (incremental). */
  readonly written: { readonly a0: string; readonly a1: string; readonly lin: string };
  /** Whether the linear axis is written at all. */
  readonly linearMoves: boolean;
}

/**
 * Splits an arc into sub-arcs of at most a quarter turn each, with
 * recomputed I/J/K (an R-format arc is re-expressed as I/J/K), endpoints
 * rounded to the step in `DECIMALS`, and continuity re-checked: each
 * sub-arc's start and end radius must agree, and the travel the firmware
 * will compute from the written numbers, with the dialect's float32
 * coincidence rule (`arcTravel`), must equal the intended travel
 * (SAFETY §4.7 step 6a).
 *
 * The start is read only where it is written: on both plane axes of an
 * absolute move (and the linear axis when it moves), and for G90.1 centres.
 * The caller has refused the arc when such a start is unknown; it is never
 * assumed (Codex P0-10 #2).
 */
export function splitArc(
  arc: ArcModel,
  input: ArcInput,
  writing: ArcWriting,
  feedMmPerMin: number,
  totalSeconds: number,
  motion: MotionModel,
): SplitResult {
  const p = PLANES[writing.plane];
  const moving: Axis[] = [p.a0, p.a1];
  if (input.dLin !== 0) moving.push(p.lin);
  const s = writing.scale;
  const dec = writing.decimals;
  const budget = motion.ceilingSeconds * SPLIT_BUDGET;
  const lastPlaces = Math.max(dec, decimalsIn(writing.written.a0), decimalsIn(writing.written.a1), decimalsIn(writing.written.lin));
  const required = (v: number | null): number => {
    /* c8 ignore next -- the caller blocks an arc whose written start is unknown (Codex P0-10 #2) */
    if (v === null) throw new Error('splitArc: a start that must be written is unknown');
    return v;
  };
  const centreFrame = writing.absolute || writing.absoluteCentre;
  const start0 = centreFrame ? required(writing.start0) : 0;
  const start1 = centreFrame ? required(writing.start1) : 0;
  // Positions are in the frame the words are written in: absolute program values, or relative to the start.
  const base0 = writing.absolute ? start0 : 0;
  const base1 = writing.absolute ? start1 : 0;
  const baseLin = writing.absolute && writing.linearMoves ? required(writing.startLin) : 0;
  const centre0 = base0 + arc.c0 / s;
  const centre1 = base1 + arc.c1 / s;
  let n = Math.max(2, Math.ceil(totalSeconds / budget), Math.ceil(Math.abs(arc.travel) / (Math.PI / 2)));
  for (; n <= MAX_SEGMENTS; n++) {
    const chord = 2 * arc.radius * Math.sin(Math.abs(arc.travel) / n / 2);
    if (chord < MIN_SEGMENT_MM) break;
    const segments: Segment[] = [];
    let ok = true;
    let prev0 = base0;
    let prev1 = base1;
    let prevLin = baseLin;
    for (let k = 1; k <= n; k++) {
      const last = k === n;
      const angle = arc.theta + (arc.travel * k) / n;
      const e0 = last ? base0 + input.d0 / s : roundTo(centre0 + (Math.sin(angle) * arc.radius) / s, dec);
      const e1 = last ? base1 + input.d1 / s : roundTo(centre1 + (Math.cos(angle) * arc.radius) / s, dec);
      const eLin = last ? baseLin + input.dLin / s : roundTo(baseLin + (input.dLin * k) / n / s, dec);
      // I/J/K as written: the centre in work coordinates (G90.1), or the offset from this sub-arc's start.
      const o0 = writing.absoluteCentre ? roundTo(start0 + arc.c0 / s, dec) : roundTo(centre0 - prev0, dec);
      const o1 = writing.absoluteCentre ? roundTo(start1 + arc.c1 / s, dec) : roundTo(centre1 - prev1, dec);
      // The centre the firmware will use, in the same frame as the positions.
      const k0 = writing.absoluteCentre ? o0 - start0 + base0 : prev0 + o0;
      const k1 = writing.absoluteCentre ? o1 - start1 + base1 : prev1 + o1;
      const rStart = Math.hypot(prev0 - k0, prev1 - k1) * s;
      const rEnd = Math.hypot(e0 - k0, e1 - k1) * s;
      const intendedErr = last ? Math.abs(Math.hypot(input.d0 - arc.c0, input.d1 - arc.c1) - arc.radius) : 0;
      // The travel the firmware will compute for this sub-arc from the numbers written, with its float32 rules.
      const firmware = arcTravel({
        coincidence: input.coincidence,
        clockwise: input.clockwise,
        centreFormat: true,
        d0: (e0 - prev0) * s,
        d1: (e1 - prev1) * s,
        c0: (k0 - prev0) * s,
        c1: (k1 - prev1) * s,
        radius: rStart,
        rotations: 0,
        positionErrorMm: positionErrorMm(arc.pathMagnitudeMm, 0, 0),
      });
      const travel = firmware.kind === 'ok' ? firmware.travel : NaN;
      const chordWritten = Math.hypot(e0 - prev0, e1 - prev1) * s;
      if (
        !(Math.abs(travel - arc.travel / n) <= ARC_TRAVEL_TOLERANCE_RAD) ||
        Math.abs(rEnd - rStart) > ARC_CONTINUITY_MM + intendedErr ||
        chordWritten < MIN_SEGMENT_MM
      ) {
        return { kind: 'impossible', detail: 'a sub-arc fails the continuity check after rounding' };
      }
      const lengthMm = Math.hypot(travel * rStart, (eLin - prevLin) * s);
      const d = moveSeconds(moving, lengthMm, feedMmPerMin, motion);
      /* c8 ignore next -- the caller has already modelled the whole arc, so every moving axis has a velocity */
      if (d.kind !== 'ok') return { kind: 'impossible', detail: `no velocity for axis ${d.axis}` };
      if (d.seconds > budget) {
        ok = false;
        break;
      }
      const words: string[] = [];
      if (writing.absolute) {
        words.push(last ? `${p.a0}${writing.written.a0}` : `${p.a0}${formatNumber(e0, dec)}`);
        words.push(last ? `${p.a1}${writing.written.a1}` : `${p.a1}${formatNumber(e1, dec)}`);
        if (writing.linearMoves) words.push(last ? `${p.lin}${writing.written.lin}` : `${p.lin}${formatNumber(eLin, dec)}`);
      } else {
        const places = last ? lastPlaces : dec;
        words.push(`${p.a0}${formatNumber(e0 - prev0, places)}`);
        words.push(`${p.a1}${formatNumber(e1 - prev1, places)}`);
        if (writing.linearMoves) words.push(`${p.lin}${formatNumber(eLin - prevLin, places)}`);
      }
      words.push(`${p.o0}${formatNumber(o0, dec)}`, `${p.o1}${formatNumber(o1, dec)}`);
      segments.push({ words, lengthMm, seconds: d.seconds });
      prev0 = e0;
      prev1 = e1;
      prevLin = eLin;
    }
    if (ok) return { kind: 'ok', segments };
  }
  return { kind: 'impossible', detail: 'the arc would need sub-arcs shorter than the split tolerance allows' };
}
