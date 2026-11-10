/**
 * One planner block from one move, as mp_aline() builds it (@cite TinyG 450.02 plan_line.c mp_aline,
 * _calc_move_times, _get_junction_vmax; motor_time.c st_get_move_time): the move time (feed, axis rates and the
 * motor pulse-rate limit), the jerk of the jerk-limiting axis, the cruise, entry and exit limits, and the
 * feed-limit tags. Pure.
 */
import { EPSILON, EXACT_STOP_OFF, FREQUENCY_DDA, JERK_MATCH_PRECISION, JERK_MULTIPLIER, MIN_BLOCK_TIME, STRAIGHT_JUNCTION } from './constants.ts';
import { targetVelocity, type Zoid } from './trapezoid.ts';
import type { PlannerAxisName, PlannerProfile } from './types.ts';

const AXES: readonly PlannerAxisName[] = ['X', 'Y', 'Z'];
/** The firmware stores single-precision floats: rounding there decides ties such as equal entry and exit. */
export const f32 = Math.fround;

export type Vec3 = readonly [number, number, number];

/** Tag bits (feedlimit.h). */
export const TAG = Object.freeze({ AXIS_CAP: 0x01, JUNCTION: 0x02, EXACT_STOP: 0x04, SHORT: 0x08, MIN_SEGMENT: 0x10 });

export interface MoveBlock extends Zoid {
  readonly type: 'aline';
  readonly n: number;
  readonly kind: 'feed' | 'rapid' | 'arc-seg';
  readonly unit: Vec3;
  readonly jerk: number;
  entryVmax: number;
  exitVmax: number;
  brakingVelocity: number;
  replannable: boolean;
  readonly tags: number;
}

export interface OtherBlock {
  readonly type: 'command' | 'dwell';
  readonly n: number;
  /** Dwell seconds. */
  readonly seconds: number;
}

export type QueuedBlock = MoveBlock | OtherBlock;

/** The planner's cached jerk terms (mm.jerk, mm.recip_jerk, mm.cbrt_jerk): reused while the jerk is within 1000. */
export interface JerkCache {
  jerk: number;
  recipJerk: number;
  cbrtJerk: number;
}

export interface MoveInput {
  readonly n: number;
  readonly kind: 'feed' | 'rapid' | 'arc-seg';
  readonly delta: Vec3;
  /** mm/min (feeds). */
  readonly feed: number;
  readonly exactStop: boolean;
}

/** The move time in minutes and whether an axis's rate (not F) set it. */
export function moveTime(profile: PlannerProfile, move: MoveInput): { readonly minutes: number; readonly axisCapped: boolean } {
  const rapid = move.kind === 'rapid';
  const xyz = rapid ? 0 : Math.hypot(...move.delta) / move.feed;
  let max = 0;
  let motor = 0;
  AXES.forEach((a, i) => {
    const d = Math.abs(move.delta[i] as number);
    const axis = profile.axes[a];
    max = Math.max(max, d / (rapid ? axis.vm : axis.fr));
    if (axis.stepsPerUnit !== undefined) motor = Math.max(motor, d * axis.stepsPerUnit * (1 / (60 * FREQUENCY_DDA * 0.9)));
  });
  max = Math.max(max, motor);
  const capped = max > xyz;
  return { minutes: capped ? max : xyz, axisCapped: !rapid && capped };
}

/** The corner speed limit between two directions (Sonny's algorithm with per-axis junction deviation), in float32. */
export function junctionVmax(profile: PlannerProfile, a: Vec3, b: Vec3): number {
  let cos = f32(-f32(a[0] * b[0]));
  cos = f32(cos - f32(a[1] * b[1]));
  cos = f32(cos - f32(a[2] * b[2]));
  if (cos < -0.99) return STRAIGHT_JUNCTION;
  if (cos > 0.99) return 0;
  const delta = (v: Vec3): number => {
    let sum = 0;
    AXES.forEach((ax, i) => {
      sum = f32(sum + f32(f32((v[i] as number) * profile.axes[ax].jd) ** 2));
    });
    return f32(Math.sqrt(sum));
  };
  const d = f32(f32(delta(a) + delta(b)) / 2);
  const sinHalf = f32(Math.sqrt(f32(f32(1 - cos) / 2)));
  const radius = f32(f32(d * sinHalf) / f32(1 - sinHalf));
  const v2 = f32(radius * profile.ja);
  return f32(Math.sqrt(Math.max(0, v2))); // never negative for a valid junction deviation and acceleration
}

/** The length of a move and its unit vector, in float32 as the firmware computes them. */
export function geometry(delta: Vec3): { readonly length: number; readonly unit: Vec3 } {
  let square = 0;
  for (const d of delta) square = f32(square + f32(d * d));
  const length = f32(Math.sqrt(square));
  return { length, unit: [f32(delta[0] / length), f32(delta[1] / length), f32(delta[2] / length)] };
}

/**
 * The block for `move`, or null when the firmware drops it as too short in time (STAT_MINIMUM_TIME_MOVE; the
 * position is not advanced, so its travel joins the next move). `previousUnit` is the direction the new block
 * corners from, `afterMove` whether a queued move precedes it (the junction tag), `runEntry` the speed the
 * minimum-time check assumes at entry (the oldest queued block's, as the firmware reads it).
 */
export function makeBlock(profile: PlannerProfile, move: MoveInput, cache: JerkCache, previousUnit: Vec3, afterMove: boolean, runEntry: number): MoveBlock | null {
  const { length, unit } = geometry(move.delta);
  if (length < EPSILON) return null;
  const time = moveTime(profile, move);
  if (time.minutes < MIN_BLOCK_TIME) {
    const deltaVelocity = length ** 0.66666666 * cache.cbrtJerk;
    if ((2 * length) / (2 * runEntry + deltaVelocity) < MIN_BLOCK_TIME) return null;
  }
  let maxC = 0;
  let jerkAxis = 0;
  AXES.forEach((a, i) => {
    if (Math.abs(move.delta[i] as number) > 0) {
      const c = ((move.delta[i] as number) ** 2 / length ** 2) * (1 / (profile.axes[a].jm * JERK_MULTIPLIER));
      if (c > maxC) {
        maxC = c;
        jerkAxis = i;
      }
    }
  });
  const jerk = (profile.axes[AXES[jerkAxis] as PlannerAxisName].jm * JERK_MULTIPLIER) / Math.abs(unit[jerkAxis] as number);
  if (!(cache.jerk > 0) || Math.abs(jerk - cache.jerk) > JERK_MATCH_PRECISION) {
    cache.jerk = jerk;
    cache.recipJerk = 1 / jerk;
    cache.cbrtJerk = Math.cbrt(jerk);
  }
  let tags = (move.exactStop ? TAG.EXACT_STOP : 0) | (time.axisCapped ? TAG.AXIS_CAP : 0);
  const exactStop = move.exactStop ? 0 : EXACT_STOP_OFF;
  const cruiseVmax = length / time.minutes;
  const junction = junctionVmax(profile, previousUnit, unit);
  const corner = junction < cruiseVmax;
  let entryVmax = corner ? junction : cruiseVmax;
  if (exactStop < entryVmax) entryVmax = exactStop;
  if (corner && afterMove) tags |= TAG.JUNCTION;
  const z = { recipJerk: cache.recipJerk, cbrtJerk: cache.cbrtJerk };
  const deltaVmax = targetVelocity(0, length, z);
  return {
    type: 'aline',
    n: move.n,
    kind: move.kind,
    unit,
    jerk,
    recipJerk: cache.recipJerk,
    cbrtJerk: cache.cbrtJerk,
    length,
    cruiseVmax,
    deltaVmax,
    entryVmax,
    exitVmax: Math.min(cruiseVmax, entryVmax + deltaVmax, exactStop),
    brakingVelocity: deltaVmax,
    replannable: !move.exactStop,
    tags,
    entryVelocity: 0,
    cruiseVelocity: 0,
    exitVelocity: 0,
    headLength: 0,
    bodyLength: 0,
    tailLength: 0,
    naiiveMoveTime: 0,
  };
}
