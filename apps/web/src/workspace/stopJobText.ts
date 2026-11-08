/**
 * What Stop job does, in one place (first-time walk 2026-11-08, S4), so the strip's tooltip and the Safety view
 * never disagree. It depends on the release the session runs (SAFETY §4.4 and its Phase 2 amendment):
 *
 * - with motion control (the session's motion flag), Stop job runs the flush sequence: `!`, `%` once held,
 *   `M5`, `M9`, then "Stopped: queue cleared, spindle and coolant off" (W42 in a job);
 * - on a read-only connection (Phase 1, no motion), every session answers Stop job with `!` only: a feedhold.
 */

/** What Stop job does on a read-only connection, said plainly next to the button. */
export const STOP_JOB_PHASE1 = 'In this release Stop job sends a feedhold, like Pause, and leaves the spindle as it is. Use your E-stop to remove power.';

/** What Stop job does with motion control (SAFETY §4.4, Phase 2 amendment). */
export const STOP_JOB_PHASE2 = 'Stops motion, clears the queue, and turns the spindle and coolant off. Not an emergency stop: use your E-stop to remove power.';

/** The Safety view's paragraph about Stop job, for the connection it has now (or both cases when none). */
export function stopJobSafetyText(connected: boolean, motion: boolean): string {
  if (connected && motion) return `On the machine connected now, Stop job stops motion, clears the queue, and turns the spindle and coolant off. It is not an emergency stop: use your E-stop to remove power.`;
  if (connected) return 'On the machine connected now (a read-only connection), Stop job sends a feedhold, like Pause. On TinyG a feedhold does not stop the spindle or coolant: use your E-stop to remove power.';
  return 'What Stop job does depends on the connection. When this page can move the machine, Stop job stops motion, clears the queue, and turns the spindle and coolant off. On a read-only connection it sends a feedhold, like Pause, which on TinyG does not stop the spindle or coolant. Neither is an emergency stop: use your E-stop to remove power.';
}
