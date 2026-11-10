/**
 * C30's work-zero value in plain words (owner via lead, 2026-11-10): where the job cuts from, not a coordinate dump.
 * The registered C30 text is unchanged; only the value passed in. The board's numbers go under Details.
 * - the job uses the machine's work zero, or the board's zero matches the plan: the plan's words (placeWords);
 * - a saved plan that matches: "the work zero you saved";
 * - otherwise the job cuts from the board's own zero, so it says that, and that it is not the plan's when known.
 * Pure.
 */
import type { ZeroPoint } from '../jobUi.ts';
import { zeroText } from '../jobUi.ts';
import { placeWords, type RunZeroCheck, type SetupPlan } from '../zeroPlan.ts';

/** `established`: the machine position is set, so a setup plan can be compared with the board. */
export function c30ZeroWords(board: ZeroPoint | null, zero: RunZeroCheck, setup: SetupPlan | null, established: boolean): string {
  if (board === null) return 'not read';
  if (zero.state === 'match') return zero.source === 'setup' && setup !== null ? placeWords(setup) : 'the work zero you saved';
  if (zero.source === 'none') return 'the board’s work zero';
  return zero.state === 'differs' && (zero.source === 'saved' || established) ? 'the board’s work zero, not your plan’s' : 'the board’s work zero';
}

/** The board's numbers, for C30's Details. */
export function c30ZeroNumbers(board: ZeroPoint | null): string | null {
  return board === null ? null : `Work zero on the board: ${zeroText(board)}.`;
}
