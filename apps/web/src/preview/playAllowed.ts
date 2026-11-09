/**
 * When Play preview may be offered (owner, 2026-11-09; SAFETY H15 and T-S41 amended, OD-25): never while a job of
 * this tab owns the machine, never while the board is in motion or holding motion (jogging, homing, running, held,
 * stopping, a program pause, motion this page did not send). With no board, or an idle one, it may. And the rapid
 * rate it plays rapids at: the machine profile's slowest of X and Y, when the profile has them. Pure.
 */

/** Session states with motion under way or queued: no Play. */
export const MOTION_STATES: ReadonlySet<string> = new Set(['JOGGING', 'HOMING', 'HELD', 'STOPPING_JOB', 'PREAMBLE', 'RUNNING', 'PROGRAM_PAUSED']);

export function playAllowedFor(jobActive: boolean, board: { readonly base: string; readonly overlays: readonly string[] } | null): boolean {
  if (jobActive) return false;
  if (board === null) return true;
  return !MOTION_STATES.has(board.base) && !board.overlays.includes('ORPHANED_MOTION');
}

export function playRapidOf(machine: { readonly axes?: { readonly x?: { readonly maxFeed?: number }; readonly y?: { readonly maxFeed?: number } } } | null): number | undefined {
  const x = machine?.axes?.x?.maxFeed;
  const y = machine?.axes?.y?.maxFeed;
  const r = x !== undefined && y !== undefined ? Math.min(x, y) : (x ?? y);
  return r !== undefined && r > 0 && Number.isFinite(r) ? r : undefined;
}
