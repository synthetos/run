/**
 * Which start confirmations the job card asks (owner, 2026-11-08: "One box when both apply"). C36 is asked when the
 * board is not homed; C40 when the travel could not be confirmed (OD-24). When both apply because a move leaves the
 * travel of an axis whose position is not known, they are one box, C41 (owner, 2026-11-09: "yes use shorter words"):
 * it names the first move past travel and says what C36 asserts; the one tick confirms both. When C40 is asked
 * because something could not be read, the two stay apart.
 *
 * Pure.
 */
import { c41 } from '@synthetos/safety';

type C41Past = Omit<Parameters<typeof c41>[0], 'line'>;

export type StartTick = 'c36' | 'c40' | 'c41';

export function startTicks(homed: boolean, travel: { readonly kind: 'outside' | 'unchecked'; readonly past?: unknown } | null): readonly StartTick[] {
  if (!homed && travel?.kind === 'outside' && travel.past !== undefined) return ['c41'];
  return [...(homed ? [] : (['c36'] as const)), ...(travel === null ? [] : (['c40'] as const))];
}

/** C41's text for the travel finding it is shown for (the first move past travel, and how many more). */
export function c41Text(finding: { readonly line: number | null; readonly past?: C41Past } | null | undefined): string {
  const past = finding?.past as C41Past;
  return c41({ ...past, line: finding?.line as number });
}
