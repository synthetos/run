/**
 * The deterministic feeds and speeds formulas (MACHINING_ASSISTANT §5.2.1 to
 * §5.2.3). Pure functions of their arguments; callers validate inputs.
 */
import type { ChiploadData, Range } from '@synthetos/library';

export type SpindleLimit = 'spindle-max' | 'tool-max' | 'spindle-min';

export interface SpindleSpeed {
  /** The speed to use, clamped to the spindle's range and the tool's maximum. */
  readonly rpm: number;
  /** `vc·1000 / (π·D)` before clamping. */
  readonly ideal: number;
  readonly limitedBy: SpindleLimit | null;
}

/**
 * §5.2.1: `n = vc·1000 / (π·D)`, clamped to the spindle's range and the
 * tool's maximum. Small tools on routers usually hit the maximum.
 */
export function spindleSpeed(vc: number, diameter: number, spindle: { readonly minRpm: number; readonly maxRpm: number }, toolMaxRpm?: number): SpindleSpeed {
  const ideal = (vc * 1000) / (Math.PI * diameter);
  const toolCaps = toolMaxRpm !== undefined && toolMaxRpm < spindle.maxRpm;
  const max = toolCaps ? toolMaxRpm : spindle.maxRpm;
  if (ideal > max) return { rpm: max, ideal, limitedBy: toolCaps ? 'tool-max' : 'spindle-max' };
  if (ideal < spindle.minRpm) return { rpm: spindle.minRpm, ideal, limitedBy: 'spindle-min' };
  return { rpm: ideal, ideal, limitedBy: null };
}

/** Surface speed, m/min, at a spindle speed: `vc = π·D·n / 1000`. */
export function surfaceSpeed(rpm: number, diameter: number): number {
  return (Math.PI * diameter * rpm) / 1000;
}

/**
 * The chipload range (mm/tooth) for a tool diameter: `factor · D`, or the
 * curve interpolated linearly between its points and held at its ends.
 */
export function chiploadRange(data: ChiploadData, diameter: number): Range {
  if (data.kind === 'factor') return { min: data.min * diameter, max: data.max * diameter };
  const points = data.points;
  const first = points[0] as (typeof points)[number];
  const last = points[points.length - 1] as (typeof points)[number];
  if (diameter <= first.d) return { min: first.min, max: first.max };
  if (diameter >= last.d) return { min: last.min, max: last.max };
  const i = points.findIndex((p) => p.d >= diameter);
  const a = points[i - 1] as (typeof points)[number];
  const b = points[i] as (typeof points)[number];
  const t = (diameter - a.d) / (b.d - a.d);
  return { min: a.min + t * (b.min - a.min), max: a.max + t * (b.max - a.max) };
}

/**
 * §5.2.2 radial chip thinning: for `ae < D/2` the programmed chipload must be
 * `fz · D / (2·√(D·ae − ae²))` to cut a chip `fz` thick. Returns that factor
 * (1 at or above half the diameter).
 */
export function chipThinningFactor(diameter: number, ae: number): number {
  if (ae >= diameter / 2) return 1;
  return diameter / (2 * Math.sqrt(diameter * ae - ae * ae));
}

/** §5.2.3: `vf = n · z · fz_prog`, mm/min. */
export function feedRate(rpm: number, flutes: number, fzProgrammed: number): number {
  return rpm * flutes * fzProgrammed;
}

/** The chipload a feed gives at a spindle speed: `fz = vf / (n · z)`. */
export function chiploadAt(feed: number, rpm: number, flutes: number): number {
  return feed / (rpm * flutes);
}

/** A value `t` of the way from `range.min` to `range.max` (0, 0.5, 1 for the three levels). */
export function lerp(range: Range, t: number): number {
  return range.min + t * (range.max - range.min);
}
