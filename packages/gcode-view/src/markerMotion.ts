/**
 * Smooth motion for the drawn tool marker between machine reports. Pure: the caller passes the clock.
 *
 * A board reports its position a few times a second (TinyG `si` 250 ms). Drawing each report as it comes
 * makes the tool jump. Instead the drawn marker moves in a straight line from where it is drawn now to
 * the newest reported position, over about the time between the last two reports, then stops.
 *
 * It only interpolates toward the latest report and never extrapolates past it, so the drawing is never
 * ahead of the machine: it lags the newest report by at most one report interval (clamped to
 * MAX_DURATION_MS). Any text readout of the position should show the report itself, not this.
 *
 * It snaps (no animation) when there is no drawn position yet, when the marker comes back after being
 * hidden, when the step is longer than SNAP_DISTANCE (a re-zero, a new file, a jump in reports), and when
 * the person asked for reduced motion.
 */
import type { Vec3 } from './segments.ts';

/** A step longer than this (drawing units, mm) is drawn at once: it is not a move to animate. */
export const SNAP_DISTANCE = 50;
/** The animation lasts about one report interval, clamped to this range (ms). */
export const MIN_DURATION_MS = 100;
export const MAX_DURATION_MS = 400;

/** One straight move of the drawn marker toward the latest report. */
export interface MarkerMotion {
  /** Where the marker was drawn when the report came. */
  readonly from: Vec3;
  /** The latest reported position: the move ends here and never goes past it. */
  readonly to: Vec3;
  /** When the move started (the report's arrival), ms. */
  readonly start: number;
  /** How long the move lasts, ms; 0 is a snap. */
  readonly duration: number;
}

/** The time between two reports as an animation length, clamped to MIN..MAX_DURATION_MS. */
export function clampDuration(intervalMs: number): number {
  if (!Number.isFinite(intervalMs)) return MAX_DURATION_MS;
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, intervalMs));
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Where the marker is drawn at `now`: on the segment from `from` to `to`, never past `to`. */
export function positionAt(m: MarkerMotion, now: number): Vec3 {
  if (m.duration <= 0) return m.to;
  const t = Math.min(1, Math.max(0, (now - m.start) / m.duration));
  if (t === 1) return m.to;
  return [m.from[0] + (m.to[0] - m.from[0]) * t, m.from[1] + (m.to[1] - m.from[1]) * t, m.from[2] + (m.to[2] - m.from[2]) * t];
}

/** True once the move has reached its target (no more frames needed). */
export function settled(m: MarkerMotion, now: number): boolean {
  return m.duration <= 0 || now >= m.start + m.duration;
}

/**
 * The move for a new report `target` arriving at `now`, given the move in progress (`prev`, null when no
 * marker is drawn). Null when the marker is hidden.
 */
export function nextMotion(prev: MarkerMotion | null, target: Vec3 | null, now: number, reducedMotion: boolean): MarkerMotion | null {
  if (target === null) return null;
  const snap: MarkerMotion = { from: target, to: target, start: now, duration: 0 };
  if (prev === null || reducedMotion) return snap;
  const drawn = positionAt(prev, now);
  if (distance(drawn, target) > SNAP_DISTANCE) return snap;
  return { from: drawn, to: target, start: now, duration: clampDuration(now - prev.start) };
}
