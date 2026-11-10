/**
 * The jerk-limited trapezoid of one block (@cite TinyG 450.02 plan_zoid.c mp_calculate_trapezoid,
 * mp_get_target_length, mp_get_target_velocity). Velocities in mm/min, lengths in mm, times in minutes. The cases
 * and their order follow the firmware exactly, including its degraded head-only and tail-only cases and the
 * single-segment shortcuts, because those are what the machine runs. Pure.
 */
import { EPSILON, MIN_SEGMENT_TIME_PLUS_MARGIN, NOM_SEGMENT_TIME, TRAPEZOID_ITERATION_ERROR_PERCENT } from './constants.ts';

/** The jerk terms a block plans with (the planner caches them; they can lag the block's own jerk slightly). */
export interface JerkTerms {
  readonly recipJerk: number;
  readonly cbrtJerk: number;
}

/** A block's plan inputs and outputs. */
export interface Zoid extends JerkTerms {
  length: number;
  cruiseVmax: number;
  deltaVmax: number;
  entryVelocity: number;
  cruiseVelocity: number;
  exitVelocity: number;
  headLength: number;
  bodyLength: number;
  tailLength: number;
  naiiveMoveTime: number;
}

const notZero = (v: number): boolean => Math.abs(v) > EPSILON;
const isZero = (v: number): boolean => Math.abs(v) < EPSILON;

/** Distance to change speed between `vi` and `vf` at the block's jerk (the firmware's "old formula"). */
export function targetLength(vi: number, vf: number, z: JerkTerms): number {
  const dv = Math.abs(vi - vf);
  return dv * Math.sqrt(dv * z.recipJerk);
}

/** Speed reached from `vi` over `length` at the block's jerk (no Newton iterations, as the firmware builds it). */
export function targetVelocity(vi: number, length: number, z: JerkTerms): number {
  return length ** 0.66666666 * z.cbrtJerk + vi;
}

/** Plans `z` in place from its entry, cruise (= cruise_vmax) and exit velocities. */
export function calculateTrapezoid(z: Zoid): void {
  const tolerance = Math.max(2, z.entryVelocity / 100); // TRAPEZOID_VELOCITY_TOLERANCE
  const minHead = (): number => MIN_SEGMENT_TIME_PLUS_MARGIN * (z.cruiseVelocity + z.entryVelocity);
  const minTail = (): number => MIN_SEGMENT_TIME_PLUS_MARGIN * (z.cruiseVelocity + z.exitVelocity);
  const minBody = (): number => MIN_SEGMENT_TIME_PLUS_MARGIN * z.cruiseVelocity;
  const body = (): void => {
    z.bodyLength = z.length;
    z.headLength = 0;
    z.tailLength = 0;
  };

  z.naiiveMoveTime = (2 * z.length) / (z.entryVelocity + z.exitVelocity);
  if (z.naiiveMoveTime < MIN_SEGMENT_TIME_PLUS_MARGIN) {
    z.cruiseVelocity = z.length / MIN_SEGMENT_TIME_PLUS_MARGIN;
    z.exitVelocity = Math.max(0, Math.min(z.cruiseVelocity, z.entryVelocity - z.deltaVmax));
    body();
    return;
  }
  if (z.naiiveMoveTime <= NOM_SEGMENT_TIME) {
    if (notZero(z.entryVelocity)) {
      z.cruiseVelocity = z.entryVelocity;
      z.exitVelocity = z.entryVelocity;
    } else {
      z.cruiseVelocity = z.deltaVmax / 2;
      z.exitVelocity = z.deltaVmax;
    }
    body();
    return;
  }
  if (z.cruiseVelocity - z.entryVelocity < tolerance && z.cruiseVelocity - z.exitVelocity < tolerance) {
    body();
    return;
  }
  z.bodyLength = 0;
  const minimumLength = targetLength(z.entryVelocity, z.exitVelocity, z);
  if (z.length <= minimumLength + minBody()) {
    if (z.entryVelocity > z.exitVelocity) {
      if (z.length < minimumLength) z.entryVelocity = targetVelocity(z.exitVelocity, z.length, z);
      z.cruiseVelocity = z.entryVelocity;
      z.tailLength = z.length;
      z.headLength = 0;
      return;
    }
    if (z.entryVelocity < z.exitVelocity) {
      if (z.length < minimumLength) z.exitVelocity = targetVelocity(z.entryVelocity, z.length, z);
      z.cruiseVelocity = z.exitVelocity;
      z.headLength = z.length;
      z.tailLength = 0;
      return;
    }
  }
  z.headLength = targetLength(z.entryVelocity, z.cruiseVelocity, z);
  z.tailLength = targetLength(z.exitVelocity, z.cruiseVelocity, z);
  if (z.headLength < minHead()) z.headLength = 0;
  if (z.tailLength < minTail()) z.tailLength = 0;
  if (z.length < z.headLength + z.tailLength) {
    if (Math.abs(z.entryVelocity - z.exitVelocity) < tolerance) {
      z.headLength = z.length / 2;
      z.tailLength = z.headLength;
      z.cruiseVelocity = Math.min(z.cruiseVmax, targetVelocity(z.entryVelocity, z.headLength, z));
      if (z.headLength < minHead()) {
        body();
        z.cruiseVelocity = (z.entryVelocity + z.cruiseVelocity) / 2;
        z.entryVelocity = z.cruiseVelocity;
        z.exitVelocity = z.cruiseVelocity;
      }
      return;
    }
    let computed = z.cruiseVmax;
    do {
      z.cruiseVelocity = computed;
      z.headLength = targetLength(z.entryVelocity, z.cruiseVelocity, z);
      z.tailLength = targetLength(z.exitVelocity, z.cruiseVelocity, z);
      if (z.headLength > z.tailLength) {
        z.headLength = (z.headLength / (z.headLength + z.tailLength)) * z.length;
        computed = targetVelocity(z.entryVelocity, z.headLength, z);
      } else {
        z.tailLength = (z.tailLength / (z.headLength + z.tailLength)) * z.length;
        computed = targetVelocity(z.exitVelocity, z.tailLength, z);
      }
    } while (Math.abs(z.cruiseVelocity - computed) / computed > TRAPEZOID_ITERATION_ERROR_PERCENT);
    z.cruiseVelocity = computed;
    z.headLength = targetLength(z.entryVelocity, z.cruiseVelocity, z);
    z.tailLength = z.length - z.headLength;
    if (z.headLength < minHead()) {
      z.tailLength = z.length;
      z.headLength = 0;
    }
    if (z.tailLength < minTail()) {
      z.headLength = z.length;
      z.tailLength = 0;
    }
    return;
  }
  z.bodyLength = z.length - z.headLength - z.tailLength;
  if (z.bodyLength < minBody() && notZero(z.bodyLength)) {
    if (notZero(z.headLength)) {
      if (notZero(z.tailLength)) {
        z.headLength += z.bodyLength / 2;
        z.tailLength += z.bodyLength / 2;
      } else z.headLength += z.bodyLength;
    } else z.tailLength += z.bodyLength;
    z.bodyLength = 0;
  } else if (isZero(z.headLength) && isZero(z.tailLength) && notZero(z.entryVelocity)) {
    z.cruiseVelocity = z.entryVelocity;
  }
}
