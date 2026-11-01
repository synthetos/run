/**
 * `cm_set_model_target()` axis modes and `cm_test_soft_limits()`, which read
 * the same in both pinned firmwares (@cite EN canonical_machine.c:482-554;
 * TG canonical_machine.c:430-498). Each model calls these with its own
 * settings; the citations in the models' behaviour register name both files.
 */
import '../marker.ts';
import { ModelGapError } from './common.ts';
import { DISABLE_SOFT_LIMIT, f32, fpEQ } from './float32.ts';
import { AXES, type Vec } from './motion.ts';

/** cmAxisMode (@cite EN canonical_machine.h:286-293; TG canonical_machine.h:510-517). */
export const AXIS_DISABLED = 0;
export const AXIS_STANDARD = 1;
export const AXIS_INHIBITED = 2;
export const AXIS_RADIUS = 3;
/** `cm_set_am()` limits: linear axes up to INHIBITED, rotary up to RADIUS. */
export const AXIS_MODE_MAX_LINEAR = AXIS_INHIBITED;
export const AXIS_MODE_MAX_ROTARY = AXIS_RADIUS;

const MM_PER_INCH = 25.4;

export interface TargetContext {
  readonly units: 'mm' | 'in';
  readonly distance: 'abs' | 'inc';
  /** Start (last accepted end point), machine coordinates. */
  readonly position: Vec;
  /** Active work offset per axis (zero under G53). */
  readonly offset: Vec;
  /** Setting reader (`xam`, `ara`, ...). */
  readonly num: (name: string) => number;
  readonly model: string;
}

/**
 * The target of one block. Per axis:
 * - no word, or the axis DISABLED: the target keeps the start position;
 * - X/Y/Z STANDARD or INHIBITED: the word in mm (G20 x 25.4), absolute plus
 *   the work offset, or added in G91; X/Y/Z in RADIUS mode (refused by
 *   `cm_set_am`, so only reachable by a test writing RAM) is ignored;
 * - A/B/C STANDARD or INHIBITED: the word in degrees, no unit conversion;
 * - A/B/C RADIUS: the word is a length in the current units, converted to
 *   degrees on the axis radius: `_to_millimeters(v) * 360 / (2 * M_PI * radius)`.
 * INHIBITED axes are computed like STANDARD; whether their motor turns is
 * below this model (positions are what the board reports).
 */
export function modelTarget(words: readonly (number | undefined)[], ctx: TargetContext): Vec {
  const toMm = (v: number): number => (ctx.units === 'in' ? v * MM_PER_INCH : v);
  return ctx.position.map((p, axis) => {
    const v = words[axis];
    const name = AXES[axis] as string;
    const mode = ctx.num(`${name}am`);
    if (v === undefined || mode === AXIS_DISABLED) return p;
    let value: number;
    if (axis < 3) {
      if (mode !== AXIS_STANDARD && mode !== AXIS_INHIBITED) return p;
      value = toMm(v);
    } else if (mode === AXIS_STANDARD || mode === AXIS_INHIBITED) {
      value = v;
    } else {
      const radius = ctx.num(`${name}ra`);
      // 360 / (2*pi*0) is inf on the board; what the planner then does is not modelled.
      if (!(radius > 0) || !Number.isFinite(radius)) throw new ModelGapError(`${ctx.model} ${name.toUpperCase()} radius mode with ${name}ra=${radius}`);
      value = (toMm(v) * 360) / (2 * Math.PI * radius);
    }
    return ctx.distance === 'abs' ? value + (ctx.offset[axis] as number) : p + value;
  }) as Vec;
}

/**
 * `cm_test_soft_limits()`: for every homed axis X..C, skip it when its travel
 * ends are fp_EQ, and test each end only when it is above DISABLE_SOFT_LIMIT.
 * Comparisons are on float32 values, as on the board. Returns true on a
 * soft-limit violation.
 */
export function softLimitExceeded(target: Vec, homed: readonly boolean[], num: (name: string) => number): boolean {
  for (let axis = 0; axis < AXES.length; axis++) {
    if (homed[axis] !== true) continue;
    const name = AXES[axis] as string;
    const min = f32(num(`${name}tn`));
    const max = f32(num(`${name}tm`));
    if (fpEQ(min, max)) continue;
    const t = f32(target[axis] as number);
    if (min > DISABLE_SOFT_LIMIT && t < min) return true;
    if (max > DISABLE_SOFT_LIMIT && t > max) return true;
  }
  return false;
}

/** The travel ends of one axis as the arc extent test reads them: null when the axis is skipped. */
export function softLimitEnds(axis: number, homed: readonly boolean[], num: (name: string) => number): { readonly min: number | null; readonly max: number | null } | null {
  const name = AXES[axis] as string;
  const min = f32(num(`${name}tn`));
  const max = f32(num(`${name}tm`));
  if (homed[axis] !== true || fpEQ(min, max)) return null;
  return { min: min > DISABLE_SOFT_LIMIT ? min : null, max: max > DISABLE_SOFT_LIMIT ? max : null };
}

/** `cm_set_am()` range check: true when the firmware refuses the value with INPUT_EXCEEDS_MAX_VALUE. */
export function axisModeTooLarge(key: string, value: number): boolean {
  const axis = AXES.indexOf(key[0] as 'x');
  return value > (axis < 3 ? AXIS_MODE_MAX_LINEAR : AXIS_MODE_MAX_ROTARY);
}
