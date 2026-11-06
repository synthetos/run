/**
 * Float32 arithmetic as the TinyG firmware does it.
 *
 * TinyG runs on an AVR (xmega) where avr-gcc's `double` is 32 bits, so every
 * `float` and `double` in canonical_machine.c and plan_arc.c is an IEEE
 * single. The comparison macros are (@cite EN util.h:183-197, the same in TG):
 *
 *   #define EPSILON    ((float)0.00001)
 *   #define fp_EQ(a,b) (fabs(a-b) < EPSILON)
 *   #define fp_ZERO(a) (fabs(a) < EPSILON)
 *
 * A model that compares JavaScript doubles instead reports two values as
 * distinct that the firmware treats as equal (for example 1000 and
 * 1000.00003, which are the same float32). These helpers round each operand
 * and each intermediate to float32 the way the C expression does.
 */
import '../marker.ts';

export const f32 = Math.fround;

/** `(float)0.00001`. */
export const EPSILON = f32(0.00001);

/** `2*M_PI` with a 32-bit double. */
export const TWO_PI_F = f32(2 * Math.PI);

/** `fp_EQ(a,b)`: `fabs(a-b) < EPSILON` on float operands. */
export function fpEQ(a: number, b: number): boolean {
  return Math.abs(f32(f32(a) - f32(b))) < EPSILON;
}

/** `fp_ZERO(a)`: `fabs(a) < EPSILON`. */
export function fpZERO(a: number): boolean {
  return Math.abs(f32(a)) < EPSILON;
}

/** `DISABLE_SOFT_LIMIT` (@cite EN canonical_machine.h:45; TG canonical_machine.h:50). */
export const DISABLE_SOFT_LIMIT = -1000000;
