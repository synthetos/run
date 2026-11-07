/**
 * Probe Z limits and the stop distance (SAFETY §4.5c, H90). Pure; shared by the session, which enforces them, and
 * the page, which offers them. Presets plus a custom value up to a hard maximum (owner, 2026-11-07).
 */

export const PROBE_LIMITS = Object.freeze({
  thicknessMm: Object.freeze({ min: 0.1, max: 50 }),
  depthMm: Object.freeze({ presets: Object.freeze([3, 5, 10] as const), default: 5, min: 1, max: 15 }),
  feed: Object.freeze({ presets: Object.freeze([25, 50] as const), default: 25, min: 10, max: 100 }),
  /** The calculated stop distance may not exceed this. */
  maxStopMm: 0.25,
  /** The touch test pass lapses after this. */
  touchValidMs: 120_000,
  /** The probe input is read this often while the touch test, Ready or the probe runs. */
  inputPollMs: 150,
  /** Margin on the time limit for the probe's report. */
  reportMarginMs: 5_000,
  /** Wait after the zero's reply before the read-back (EEPROM; firmware issue #298). */
  zeroSettleMs: 250,
});

/** Reaction time after contact before the hold starts (firmware maintainer, from source). */
const REACTION_S = 0.005;

/**
 * Calculated stop distance in mm after contact at `feed` mm/min with the board's `zjh`: a normal hold from feed at
 * the probe jerk, `F·√(F / (zjh·10⁶))`, plus the reaction time at feed. Null when `zjh` is not a positive number.
 */
export function probeStopMm(feed: number, zjh: number | null): number | null {
  if (zjh === null || !Number.isFinite(zjh) || zjh <= 0 || !Number.isFinite(feed) || feed <= 0) return null;
  return feed * Math.sqrt(feed / (zjh * 1e6)) + (feed / 60) * REACTION_S;
}

/** The time limit for the report, in seconds: the depth at the feed, plus the margin. */
export function probeMaxSeconds(depthMm: number, feed: number): number {
  return (depthMm / feed) * 60 + PROBE_LIMITS.reportMarginMs / 1000;
}
