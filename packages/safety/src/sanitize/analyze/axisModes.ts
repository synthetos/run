import {
  ROTARY,
  formatNumber
} from '../geometry.ts';
import type { Axis, RotaryAxis } from '../types.ts';
import { AXIS_MODE_DISABLED, AXIS_MODE_RADIUS, type AxisMode } from '../types.ts';
import { type ModelContext } from './context.ts';
import { block, type Finding, type LineAnalysis } from './contract.ts';

/** The live axis mode, or undefined when it is not known. */
export function modeOf(ctx: ModelContext, axis: Axis): AxisMode | undefined {
  return ROTARY.has(axis) ? ctx._motion.rotary[axis as RotaryAxis]?.mode : ctx._motion.linear[axis as 'X' | 'Y' | 'Z'];
}

/**
   * A block for a move word on a linear axis the firmware does not move as a
   * length: unknown mode, disabled (the word is ignored), or radius mode
   * (refused by `cm_set_am` on X/Y/Z, and ignored by `cm_set_model_target`
   * if present) (@cite EN canonical_machine.c:531-545; TG canonical_machine.c:444-454).
   */
export function linearModeFinding(ctx: ModelContext, axis: Axis): Finding | null {
  if (ROTARY.has(axis)) return null;
  const mode = modeOf(ctx, axis);
  const name = `${axis.toLowerCase()}am`;
  if (mode === undefined) return block('unknown-state', `the axis mode (${name}) of ${axis} is not known, so a move on ${axis} cannot be modelled`);
  if (mode === AXIS_MODE_DISABLED) return block('axis-mode', `${axis} is disabled (${name}=0): TinyG ignores ${axis} words, so this move would not run as written`);
  if (mode === AXIS_MODE_RADIUS) return block('axis-mode', `${axis} reads radius mode (${name}=3), which TinyG refuses on a linear axis; it ignores ${axis} words in that mode`);
  return null;
}

/** The block for motion while an inhibited (or possibly inhibited) axis may hold its motor away from step 0. */
export function jointRiskFinding(ctx: ModelContext): Finding | null {
  if (ctx._jointRisk.length === 0) return null;
  const parts = ctx._jointRisk.map((a) => {
    const mode = modeOf(ctx, a);
    const m = ctx.machine[a];
    const where = m === null ? 'its position is not known' : `it reads ${formatNumber(m, 3)}`;
    return mode === undefined ? `${a} (axis mode not known, so it may be inhibited; ${where})` : `${a} (inhibited; ${where})`;
  });
  return block(
    'inhibited-axis',
    `TinyG drives an inhibited axis's motor to step 0 on the next move of any axis, by an amount no overrun bound covers: ${parts.join(', ')}. Motion stays blocked until every such axis reads 0`,
  );
}

/** A motion line's bound with the residual of inhibited axes that read 0 added (`#jointResidualMm`). */
export function withJointResidual(ctx: ModelContext, bound: number | null): number | null {
  const r = ctx._jointResidualMm;
  return bound === null || r === null ? null : bound + r;
}

/** Every bound of an accepted motion line, with the inhibited-axis residual. */
export function chargeJointResidual(ctx: ModelContext, motion: LineAnalysis['motion']): LineAnalysis['motion'] {
  if (motion === null || ctx._jointResidualMm === 0) return motion;
  if (motion.kind === 'single') return { ...motion, boundMm: withJointResidual(ctx, motion.boundMm) };
  return { ...motion, segments: motion.segments.map((seg) => ({ ...seg, boundMm: withJointResidual(ctx, seg.boundMm) })) };
}

/**
   * A block for a move word on a rotary axis whose mode or radius is not
   * known: the word could be degrees or linear units, and a radius-mode axis
   * turns 360 / (2π × ra) degrees per mm (about 57× at ra = 1).
   */
export function rotaryUnknown(ctx: ModelContext, axis: Axis): Finding | null {
  if (!ROTARY.has(axis)) return null;
  const cfg = ctx._motion.rotary[axis as RotaryAxis];
  if (cfg === undefined) {
    return block('unknown-state', `the axis mode (${axis.toLowerCase()}am) of ${axis} is not known, so a move on ${axis} cannot be modelled`);
  }
  if (cfg.mode === AXIS_MODE_RADIUS && cfg.radiusMm === undefined) {
    return block('unknown-state', `${axis} is in radius mode but its radius (${axis.toLowerCase()}ra) is not known, so a move on ${axis} cannot be modelled`);
  }
  return null;
}
