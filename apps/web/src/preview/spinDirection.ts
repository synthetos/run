/**
 * Which way the board says the spindle turns, for the 3D marker (owner, 2026-11-10: "the spindle spins the bit"):
 * on (`spe` 1, or `spc` 1 or 2) and clockwise (M3: `spc` 1, or `spd` 0) is 1; counter-clockwise (M4: `spc` 2, or
 * `spd` 1) is -1; off, unknown, or on in a direction the board does not report is 0, so the bit never turns a
 * way nobody knows. Pure.
 */
import type { SpinDirection } from '@synthetos/gcode-view';

export interface SpindleReport {
  readonly spe?: unknown;
  readonly spc?: unknown;
  readonly spd?: unknown;
}

export function spinDirection(live: SpindleReport | null | undefined): SpinDirection {
  if (live == null) return 0;
  const on = typeof live.spe === 'number' ? live.spe === 1 : live.spc === 1 || live.spc === 2;
  if (!on) return 0;
  if (live.spc === 1) return 1;
  if (live.spc === 2) return -1;
  if (live.spd === 0) return 1;
  if (live.spd === 1) return -1;
  return 0;
}
