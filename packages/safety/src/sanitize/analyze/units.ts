import {
  ROTARY,
  travelBoundMm
} from '../geometry.ts';
import type { Axis, RotaryAxis } from '../types.ts';
import { AXES, AXIS_MODE_DISABLED, AXIS_MODE_RADIUS } from '../types.ts';
import { type ModelContext } from './context.ts';
import { INCH_MM } from './tables.ts';

/** mm per program unit of a linear word, or null when the units are unknown. */
export function unitScale(units: 'G20' | 'G21' | null): number | null {
  return units === null ? null : units === 'G20' ? INCH_MM : 1;
}

/**
   * mm (or degrees) per program unit of a move target on an axis, or null
   * when it depends on something unknown. A rotary axis in radius mode reads
   * the word in linear units and turns it into degrees (@cite EN
   * canonical_machine.c:517-521 `_calc_ABC`; TG the same); every other
   * rotary mode reads degrees.
   */
export function scale(ctx: ModelContext, axis: Axis, units: 'G20' | 'G21' | null): number | null {
  if (!ROTARY.has(axis)) return unitScale(units);
  const cfg = ctx._motion.rotary[axis as RotaryAxis];
  /* c8 ignore next -- a move word on an axis of unknown mode is blocked before any target is computed (#rotaryUnknown) */
  if (cfg === undefined) return null;
  if (cfg.mode !== AXIS_MODE_RADIUS) return 1;
  const u = unitScale(units);
  const r = cfg.radiusMm;
  return u === null || r === undefined ? null : (u * 360) / (2 * Math.PI * r);
}

/**
   * mm (or degrees) per program unit of an offset word (G10, G92, G43.1).
   * Offsets never use the radius conversion. EN stores rotary offsets as
   * written, in degrees (@cite EN canonical_machine.c:1054, :1206, :1609);
   * 440.21 applies `_to_millimeters` to every axis, so a rotary offset under
   * G20 is scaled by 25.4 (@cite TG canonical_machine.c:669, :788-789), which
   * the dialect states as `rotaryOffsetsUseUnits`.
   */
export function offsetScale(ctx: ModelContext, axis: Axis, units: 'G20' | 'G21' | null): number | null {
  if (ROTARY.has(axis) && !ctx._job.rotaryOffsetsUseUnits) return 1;
  return unitScale(units);
}

/**
   * Physical mm of travel per model unit on an axis (mm on X/Y/Z, degrees on
   * A/B/C), or null when there is no known conversion (SAFETY §4.3 H1: the
   * overrun distance is a true bound, so degrees never count as mm).
   * - Linear axes: 1.
   * - Radius mode: the firmware turns linear units into degrees at `ra`
   *   (@cite EN canonical_machine.c:515-521; TG canonical_machine.c:430-440),
   *   so one degree is π ra / 180 mm of surface travel at that radius.
   * - Disabled: the axis is skipped when the target is set, so its position
   *   does not change (@cite EN canonical_machine.c:548-549; TG
   *   canonical_machine.c:457). Its motor still follows its position: after
   *   inhibited mode it can be driven out to it (the remainder of the
   *   inhibited-axis finding, not visible in any read).
   * - Standard: degrees with no physical radius known, so unknown.
   * - Inhibited: the kinematics force the absolute joint to 0 (@cite EN
   *   kinematics.c:59; TG kinematics.c:63), so a motor away from 0 can move
   *   by an amount the model does not know: unknown.
   */
export function mmPerUnit(ctx: ModelContext, axis: Axis): number | null {
  if (!ROTARY.has(axis)) return 1;
  const cfg = ctx._motion.rotary[axis as RotaryAxis];
  if (cfg === undefined) return null;
  if (cfg.mode === AXIS_MODE_RADIUS) return cfg.radiusMm === undefined ? null : (Math.PI * cfg.radiusMm) / 180;
  if (cfg.mode === AXIS_MODE_DISABLED) return 0;
  return null;
}

/** The true travel bound of a move by these model-unit deltas, mm, or null (see `travelBoundMm`). */
export function motionBound(ctx: ModelContext, delta: Readonly<Partial<Record<Axis, number>>>): number | null {
  return travelBoundMm(AXES.map((a) => ({ axis: a, delta: delta[a] ?? 0, mmPerUnit: mmPerUnit(ctx, a) })));
}

/** Whether a word on this axis needs the program units to be modelled as a move target. */
export function needsUnits(ctx: ModelContext, axis: Axis): boolean {
  return !ROTARY.has(axis) || ctx._motion.rotary[axis as RotaryAxis]?.mode === AXIS_MODE_RADIUS;
}
