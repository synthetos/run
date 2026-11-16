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
import { STOP_TEXT } from '@synthetos/safety';

import { mapStat } from '@synthetos/protocol';









import { forgetJobLines } from './jobState.ts';


import { raiseDone } from './typedPieces.ts';

import { checkAlarm } from './motion/alarms.ts';
import { type MotionTx } from './motion/contract.ts';
import { message, queueLine, readBack, requestPoll, setMotion, writeRealtime } from './motion/effects.ts';
import { finish } from './motion/endings.ts';
import { feedMore, feeding, sendTypedPiece } from './motion/jog.ts';
import { MOTION_LIMITS } from './motion/limits.ts';
import { atRestPolled, completedPoll, dialect, heldPolled, motionLinesSettled, planner } from './motion/model.ts';
import type { MotionCtx } from './types.ts';

export { abandonMotion, checkAlarm } from './motion/alarms.ts';
export { onMotionAnswer } from './motion/answers.ts';
export { type MotionDeps, type MotionTx } from './motion/contract.ts';
export { clearMotionNotice, newCtx, queueMotionLine, requestPoll } from './motion/effects.ts';
export { onFollowUp, onMotionReport } from './motion/homing.ts';
export { onMotionIntent } from './motion/intents.ts';
export { sendTypedPiece } from './motion/jog.ts';
export { MOTION_LIMITS, POLL_TOKENS, TOOL_CHANGE_JOG_A, TOOL_CHANGE_ZERO } from './motion/limits.ts';
export { activeSystem, atRestPolled, completedPoll, heldPolled, idleBase, motionCapable, returnBase } from './motion/model.ts';
export { beginHold, motionStopApplies, onMotionStop } from './motion/stops.ts';
export { onMotionTimer } from './motion/timer.ts';



// --- Polls, answers, timer --------------------------------------------------------

/** One poll cycle was answered (after `qr`). */
export function onPollDone(t: MotionTx, at: number): void {
  const ctx = t.s.motion;
  if (ctx === null || !checkAlarm(t, at)) return;
  const s = t.s;
  const p = completedPoll(s);
  if (p === null) {
    // A read of this cycle was rejected, damaged or missing: it confirms nothing, whatever the live view says (R5;
    // H56, H69). Count from zero again; the hold and flush deadlines still run (W12 and FAULT on a silent board).
    setMotion(t, { confirmed: 0 });
    if (ctx.phase !== 'homing') requestPoll(t); // homing polls again from its own check timer
    return;
  }
  const confirm = (ok: boolean): number => (ok ? ctx.confirmed + 1 : 0);
  switch (ctx.phase) {
    case 'feed': {
      // OD-31: a typed move resumed after a Pause feeds again; the base leaves HELD at the first poll after `~`, as in drain.
      if (s.base === 'HELD') t.set({ base: 'JOGGING' });
      // Every piece written before this poll's `qr` is counted in it (lines are answered in order).
      // Pieces still waiting are not in `qr` yet: count them too. (Nothing is being written: this runs as `qr`
      // is answered, before the next line goes out.)
      const unwritten = s.queue.filter((q) => q.purpose === 'motion').length;
      setMotion(t, { queued: planner(s) - p.qr + unwritten });
      if (feeding(ctx)) {
        feedMore(t);
      } else {
        setMotion(t, { phase: 'drain', confirmed: 0 });
      }
      requestPoll(t);
      return;
    }
    case 'drain': {
      if (s.base === 'HELD') t.set({ base: 'JOGGING' });
      // An offset write waiting to be written again (status 13) is not settled yet.
      const confirmed = confirm(atRestPolled(s, p) && motionLinesSettled(s) && (ctx.retryAt ?? null) === null);
      if (confirmed < MOTION_LIMITS.confirmations) {
        setMotion(t, { confirmed });
        requestPoll(t);
        return;
      }
      const [next, ...rest] = ctx.steps;
      if (next !== undefined) {
        setMotion(t, { steps: rest, confirmed: 0 });
        queueLine(t, next, ctx.op === 'typed' ? 'typedMove' : 'goToZero'); // go to zero's steps, or a typed move's raise (OD-31)
        requestPoll(t);
        return;
      }
      // OD-31: a typed move's raise is confirmed at rest: its pieces go now.
      if (ctx.op === 'typed' && !(ctx.typed as NonNullable<MotionCtx['typed']>).raised) {
        t.set({ motion: { ...raiseDone(ctx), phase: 'feed', confirmed: 0, queued: 0 } });
        sendTypedPiece(t);
        requestPoll(t);
        return;
      }
      finish(t, at);
      return;
    }
    case 'hold': {
      const held = heldPolled(s, p);
      // `!` is ignored while nothing moves (a line still being parsed, the planner's start-up): if the board is
      // moving with no hold in progress, send it again (SAFETY §4.4 Pause step 6).
      // The first cycle may have been asked before the `!` was written, so only later cycles count.
      if (ctx.holdPolls > 0 && p.hold === 0 && p.vel !== 0) writeRealtime(t, 'feedhold', ctx.reason === 'stopJob' ? 'stopJob' : 'feedhold');
      setMotion(t, { holdPolls: ctx.holdPolls + 1 });
      const confirmed = confirm((held || atRestPolled(s, p)) && motionLinesSettled(s));
      if (confirmed < MOTION_LIMITS.confirmations) {
        setMotion(t, { confirmed });
        requestPoll(t);
        return;
      }
      if (ctx.reason === 'pause') {
        if (held) {
          setMotion(t, { phase: 'held', confirmed: 0, deadline: null });
          t.set({ base: 'HELD' });
          t.cancel('motion');
          message(t, 'paused', STOP_TEXT.paused, at);
        } else {
          message(t, 'paused', STOP_TEXT.pausedIdle, at);
          finish(t, at);
        }
        return;
      }
      if (held || p.qr !== planner(s)) {
        writeRealtime(t, 'flush', ctx.reason === 'stopJob' ? 'stopJob' : 'feedhold');
        // `%` drops the board's line buffers: job lines still owed may never be answered (Phase 3).
        forgetJobLines(t);
        setMotion(t, { phase: 'flush', confirmed: 0, deadline: at + MOTION_LIMITS.stopStepMs });
        requestPoll(t);
        return;
      }
      finish(t, at);
      return;
    }
    case 'homing': {
      const resting = atRestPolled(s, p) && motionLinesSettled(s);
      const cls = mapStat(dialect(s), p.stat);
      const seen = ctx.seen === true || cls === 'homing' || p.vel !== 0;
      const confirmed = confirm(resting);
      // Done after two polled reads at rest, once the cycle was seen running (or three in a row: it ended unseen).
      if (confirmed < MOTION_LIMITS.confirmations || (!seen && confirmed < MOTION_LIMITS.confirmations + 1)) {
        setMotion(t, { confirmed, seen });
        if (confirmed > 0) requestPoll(t);
        return;
      }
      setMotion(t, { phase: 'readback', confirmed: 0, seen });
      t.cancel('motion');
      readBack(t, ['hom', 'mpo', 'pos', 'ofs', 'home'], 'homed');
      return;
    }
    case 'flush': {
      const confirmed = confirm(p.hold === 0 && p.qr === planner(s) && motionLinesSettled(s));
      if (confirmed < MOTION_LIMITS.confirmations) {
        setMotion(t, { confirmed });
        requestPoll(t);
        return;
      }
      t.set({ dwellWait: null }); // two polls confirm the requested flush; its timer is cancelled
      finish(t, at);
      return;
    }
    /* c8 ignore next 2 -- held and finish stop the poll timer, so no poll cycle completes in them */
    default:
      return;
  }
}
