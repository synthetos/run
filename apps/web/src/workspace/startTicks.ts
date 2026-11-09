/**
 * Which start confirmations the job card asks (owner, 2026-11-08: "One box when both apply"). C36 is asked when the
 * board is not homed; C40 when the travel could not be confirmed (OD-24). When both apply because a move leaves the
 * travel of an axis whose position is not known, they are one box: C40's sentence, which names the line and the
 * axis, followed by C36's, so nothing C36 asserts (not homed, soft limits may not protect it, where every axis is) is
 * lost; the one tick confirms both. When C40 is asked because something could not be read, the two stay apart.
 *
 * Pure.
 */
export type StartTick = 'c36' | 'c40' | 'c40c36';

export function startTicks(homed: boolean, travel: { readonly kind: 'outside' | 'unchecked' } | null): readonly StartTick[] {
  if (!homed && travel?.kind === 'outside') return ['c40c36'];
  return [...(homed ? [] : (['c36'] as const)), ...(travel === null ? [] : (['c40'] as const))];
}
