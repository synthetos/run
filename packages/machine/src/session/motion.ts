/**
 * The Phase 2 motion layer of the session reducer (owner 2026-11-02; SAFETY
 * §4.4, §4.5b, H50–H56; T-S89–T-S92).
 *
 * Pure functions over the reducer's transition (`MotionTx`): they read the
 * state, queue lines and realtime bytes as effects, and arm the `motion`
 * timer. Nothing here touches a port or a clock. The reducer calls them
 * only when the session's release allows motion; every intent has passed
 * the allow-matrix first, and every line and byte is checked again by the
 * write gate when it is written (writePolicy.ts).
 *
 * What runs here:
 * - **Jog** (H50): the session feeds short `G21 G91 G1` pieces, each at most
 *   `pieceMs` of travel at the jog feed, and only while the planner holds
 *   fewer than `lookahead` blocks (`qr`, polled after every piece). A step
 *   is one move of its whole distance (owner, 2026-11-09). A hold jog (no distance)
 *   needs a renewal from the page every `keepAliveMs`; without one it is
 *   released by the session itself.
 * - **Go to zero** (H53): `G53 G0 Z<safe>` first when X or Y move, then
 *   `G90 G0` to work zero, then Z; each line waits for polled idle.
 * - **Set zero**, **spindle and coolant**, **clear alarm**: single lines.
 * - **Ending a jog, Pause, Stop job** (H56): `!`, then polled reads until the
 *   hold is complete (or the machine is at rest) and every written line is
 *   answered, then `%` when anything is held or queued, then polled reads
 *   until the hold is gone and the planner is empty, then the closing lines
 *   (`M5`, `M9` for Stop job; `G90` and the units for a jog). A step that
 *   times out is W12 and FAULT. A Pause stops at the confirmed hold (HELD);
 *   Resume writes `~` and drains.
 *
 * Every decision about the machine uses polled `stat`, `hold`, `vel`, `qr`
 * (SAFETY §4.2), never the last status report and never the spindle and
 * coolant readouts. A decision reads the values of the poll cycle that
 * just completed (`SessionState.polled`), and only when every one of its
 * four reads was answered with status 0: a rejected, missing or damaged
 * answer makes the cycle count for nothing (independent review 2026-11-03,
 * R5; H56, H69). The shared live view (also fed by pushed reports) is for
 * display.
 *
 * Modes (independent review 2026-11-03, R1 and R2): a jog writes `G21` on
 * its own answered line before its first piece, because the firmware reads
 * F before it changes units in the same block; go to zero writes `G90 G21`
 * on its own answered line before its `G53 G0` move, because G53 keeps
 * G91 and G20, and puts the distance mode and units back at the end. What "back" means is read, never taken
 * from the live view: `unit` and `dist` GETs go out before the first line of either (modes.ts), because the
 * last pushed report can still show the previous jog's `G91` after its closing `G90` was answered.
 */

export { abandonMotion, checkAlarm } from './motion/alarms.ts';
export { onMotionAnswer } from './motion/answers.ts';
export { type MotionDeps, type MotionTx } from './motion/contract.ts';
export { clearMotionNotice, newCtx, queueMotionLine, requestPoll } from './motion/effects.ts';
export { onFollowUp, onMotionReport } from './motion/homing.ts';
export { onMotionIntent } from './motion/intents.ts';
export { sendTypedPiece } from './motion/jog.ts';
export { MOTION_LIMITS, POLL_TOKENS, TOOL_CHANGE_JOG_A, TOOL_CHANGE_ZERO } from './motion/limits.ts';
export { activeSystem, atRestPolled, completedPoll, heldPolled, idleBase, motionCapable, returnBase } from './motion/model.ts';
export { onPollDone } from './motion/polls.ts';
export { beginHold, motionStopApplies, onMotionStop } from './motion/stops.ts';
export { onMotionTimer } from './motion/timer.ts';
