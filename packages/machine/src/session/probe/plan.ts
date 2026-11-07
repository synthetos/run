/**
 * Probe Z: the owner's plan, checked against the hard limits (SAFETY §4.5c "Limits"; T-S128, T-S130). Pure.
 * Presets plus a custom value up to the maximum; the stop distance at the board's `zjh` may not exceed its limit.
 */
import { PROBE_LIMITS, probeMaxSeconds, probeStopMm } from './limits.ts';
import type { ProbePlan } from './types.ts';

function within(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** The plan, or why not, in plain words. Every value mm or mm/min. */
export function makePlan(thicknessMm: unknown, depthMm: unknown, feed: unknown, zjh: number | null): ProbePlan | string {
  const L = PROBE_LIMITS;
  if (!within(thicknessMm, L.thicknessMm.min, L.thicknessMm.max)) return `Plate thickness can be ${L.thicknessMm.min} to ${L.thicknessMm.max} mm.`;
  if (!within(depthMm, L.depthMm.min, L.depthMm.max)) return `Depth limit can be ${L.depthMm.min} to ${L.depthMm.max} mm.`;
  // Whole mm/min: the probe line's grammar writes F as a whole number, and L is worked out at the F that is sent.
  if (!within(feed, L.feed.min, L.feed.max) || !Number.isInteger(feed)) return `Probe feed can be ${L.feed.min} to ${L.feed.max} mm/min, in whole numbers.`;
  const stopMm = probeStopMm(feed, zjh);
  if (stopMm === null) return "Run can't work out how far Z will travel after contact: the board's Z jerk is not known.";
  if (stopMm > L.maxStopMm) return `Z would travel about ${stopMm.toFixed(2)} mm after contact at this feed, more than the ${L.maxStopMm} mm limit. Choose a slower feed.`;
  return { thicknessMm, depthMm, feed, stopMm, zeroZ: thicknessMm - stopMm, maxSeconds: probeMaxSeconds(depthMm, feed) };
}
