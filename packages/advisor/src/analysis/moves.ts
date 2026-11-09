/**
 * What one tape event is, for the report (docs/design/ANALYZE.md slice 1): a timed feed move, a rapid, or
 * something the analysis cannot time. Pure.
 */
import { TAPE_FLAG, TAPE_KIND, type ProgramTape } from './types.ts';

/** A feed move (G1/G2/G3) that moves X, Y or Z. */
export function isFeedMove(t: ProgramTape, e: number): boolean {
  const k = t.kinds[e];
  return (k === TAPE_KIND.LINE || k === TAPE_KIND.ARC) && ((t.flags[e] as number) & TAPE_FLAG.RAPID) === 0;
}

export function isRapid(t: ProgramTape, e: number): boolean {
  return t.kinds[e] === TAPE_KIND.LINE && ((t.flags[e] as number) & TAPE_FLAG.RAPID) !== 0;
}

export function isRotary(t: ProgramTape, e: number): boolean {
  return ((t.flags[e] as number) & TAPE_FLAG.ROTARY) !== 0;
}

/** Seconds of a feed move at its programmed feed, or null (no feed, a rotary move). */
export function feedSeconds(t: ProgramTape, e: number): number | null {
  const f = t.feed[e] as number;
  if (isRotary(t, e) || !(f > 0)) return null;
  return ((t.lengthMm[e] as number) / f) * 60;
}

/** Lines per second a feed move needs at its programmed feed (one sent line per move), or null. */
export function linesPerSecond(t: ProgramTape, e: number): number | null {
  const s = feedSeconds(t, e);
  return s === null || s <= 0 ? null : 1 / s;
}

/** Plunge (straight down), ramp (down while moving sideways) or cut. */
export function regimeKind(t: ProgramTape, e: number): 'plunge' | 'ramp' | 'cut' {
  const dx = t.delta[e * 3] as number;
  const dy = t.delta[e * 3 + 1] as number;
  const dz = t.delta[e * 3 + 2] as number;
  const xy = Math.hypot(dx, dy);
  if (dz < 0 && xy < 1e-9) return 'plunge';
  if (dz < 0 && -dz > 0.1 * Math.hypot(xy, dz)) return 'ramp';
  return 'cut';
}

/** The tape's value as `number | null` (NaN and the no-tool marker are null). */
export function known(v: number | undefined): number | null {
  return v === undefined || Number.isNaN(v) || v < 0 ? null : v;
}
