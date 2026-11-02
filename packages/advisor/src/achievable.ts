/**
 * Achievable-feed prediction for one operation (MACHINING_ASSISTANT §5.2.5,
 * the predictive half of autotune). AN ESTIMATE, and labelled as one in its
 * result (`estimate: true`).
 *
 * The model is a small planner sketch, documented here so its limits are
 * plain. It is not the firmware's planner:
 *
 * 1. The path is a polyline of cutting moves. Zero-length steps are dropped.
 *    The operation starts and ends at rest.
 * 2. **Junctions.** The speed through the corner between two segments is
 *    limited by the junction-deviation (centripetal) model used by grbl and
 *    g2core: with `θ` the angle between the incoming and outgoing
 *    directions and `s = sin(θ/2)` taken from the reversed incoming
 *    direction, `v = √(a·δ·s / (1 − s))`. A straight continuation is not
 *    limited; a full reversal stops.
 * 3. **Ramps.** A speed change from `u` to `w` follows a jerk-limited
 *    S-curve capped at the acceleration (TinyG style): time
 *    `2·√(|w−u|/J)` when `|w−u| <= a²/J`, otherwise `|w−u|/a + a/J`; without
 *    a jerk value, constant acceleration, `|w−u|/a`. The distance is the
 *    mean speed times the time (the S-curve is symmetric).
 * 4. A backward pass and a forward pass lower every junction speed to what
 *    the neighbouring segment lengths allow; each segment then peaks at the
 *    highest speed (up to F) it can reach and still leave at its exit speed.
 *
 * It ignores per-axis limits, arcs (pass them as polylines), the planner's
 * finite look-ahead and streaming starvation (the live estimator sees that).
 * The machine fingerprint of §6.6 will tune it later.
 */
import type { MotionCaps, Point3 } from './types.ts';

export interface AchievableFeed {
  readonly estimate: true;
  readonly programmedFeed: number;
  /** Path length over time: what the operation averages, mm/min. */
  readonly averageFeed: number;
  /** The highest speed any segment reaches, mm/min. */
  readonly peakFeed: number;
  /** `averageFeed / programmedFeed`. */
  readonly fraction: number;
  readonly lengthMm: number;
  readonly seconds: number;
  readonly segments: number;
  readonly model: string;
}

export type AchievableResult = { readonly ok: true; readonly value: AchievableFeed } | { readonly ok: false; readonly reason: string };

export const ACHIEVABLE_MODEL = 'planner sketch: junction deviation, jerk-limited ramps capped at the acceleration, start and end at rest';

const BISECTION_STEPS = 64;
const MIN_SEGMENT_MM = 1e-9;

function finitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Time to change speed from u to w (mm/s). */
function rampTime(u: number, w: number, motion: MotionCaps): number {
  const dv = Math.abs(w - u);
  const { accel, jerk } = motion;
  if (jerk === undefined) return dv / accel;
  return dv <= (accel * accel) / jerk ? 2 * Math.sqrt(dv / jerk) : dv / accel + accel / jerk;
}

function rampLength(u: number, w: number, motion: MotionCaps): number {
  return ((u + w) / 2) * rampTime(u, w, motion);
}

/** The highest v in [lo, hi] with `fits(v)`, given `fits(lo)`. */
function highest(lo: number, hi: number, fits: (v: number) => boolean): number {
  if (fits(hi)) return hi;
  let a = lo;
  let b = hi;
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (a + b) / 2;
    if (fits(mid)) a = mid;
    else b = mid;
  }
  return a;
}

function junctionSpeed(inDir: Point3, outDir: Point3, motion: MotionCaps): number {
  const cos = -(inDir[0] * outDir[0] + inDir[1] * outDir[1] + inDir[2] * outDir[2]);
  const s = Math.sqrt(Math.max(0, 0.5 * (1 - cos)));
  if (1 - s <= 1e-12) return Number.POSITIVE_INFINITY;
  return Math.sqrt((motion.accel * motion.junctionDeviation * s) / (1 - s));
}

export function predictAchievableFeed(path: readonly Point3[], programmedFeed: number, motion: MotionCaps): AchievableResult {
  if (!finitePositive(programmedFeed)) return { ok: false, reason: 'The programmed feed must be a positive number.' };
  if (!finitePositive(motion.accel) || (motion.jerk !== undefined && !finitePositive(motion.jerk))) {
    return { ok: false, reason: 'The acceleration and jerk must be positive numbers.' };
  }
  if (!(Number.isFinite(motion.junctionDeviation) && motion.junctionDeviation >= 0)) return { ok: false, reason: 'The junction deviation must be zero or more.' };
  if (!path.every((p) => p.length === 3 && p.every((c) => Number.isFinite(c)))) return { ok: false, reason: 'Every path point must be three finite coordinates.' };

  const lengths: number[] = [];
  const dirs: Point3[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Point3;
    const b = path[i] as Point3;
    const d: Point3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < MIN_SEGMENT_MM) continue;
    lengths.push(len);
    dirs.push([d[0] / len, d[1] / len, d[2] / len]);
  }
  const n = lengths.length;
  if (n === 0) return { ok: false, reason: 'The path has no length.' };

  const vF = programmedFeed / 60;
  // Junction speeds j[0..n]: rest at both ends.
  const j = new Array<number>(n + 1).fill(0);
  for (let k = 1; k < n; k++) j[k] = Math.min(vF, junctionSpeed(dirs[k - 1] as Point3, dirs[k] as Point3, motion));
  const maxFrom = (v0: number, len: number): number => highest(v0, vF, (v) => rampLength(v0, v, motion) <= len);
  for (let k = n - 1; k >= 1; k--) j[k] = Math.min(j[k] as number, maxFrom(j[k + 1] as number, lengths[k] as number));
  for (let k = 1; k < n; k++) j[k] = Math.min(j[k] as number, maxFrom(j[k - 1] as number, lengths[k - 1] as number));

  let seconds = 0;
  let peak = 0;
  for (let k = 0; k < n; k++) {
    const u = j[k] as number;
    const w = j[k + 1] as number;
    const len = lengths[k] as number;
    const v = highest(Math.max(u, w), vF, (x) => rampLength(u, x, motion) + rampLength(x, w, motion) <= len);
    const ramps = rampLength(u, v, motion) + rampLength(v, w, motion);
    seconds += rampTime(u, v, motion) + rampTime(v, w, motion) + Math.max(0, len - ramps) / v;
    peak = Math.max(peak, v);
  }
  const lengthMm = lengths.reduce((s, l) => s + l, 0);
  const averageFeed = (lengthMm / seconds) * 60;
  return {
    ok: true,
    value: Object.freeze({
      estimate: true,
      programmedFeed,
      averageFeed,
      peakFeed: peak * 60,
      fraction: averageFeed / programmedFeed,
      lengthMm,
      seconds,
      segments: n,
      model: ACHIEVABLE_MODEL,
    }),
  };
}
