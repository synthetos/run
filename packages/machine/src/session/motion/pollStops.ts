import { STOP_TEXT } from '@synthetos/safety';
import { forgetJobLines } from '../jobState.ts';
import { type MotionTx, type PollContext } from './contract.ts';
import { message, requestPoll, setMotion, writeRealtime } from './effects.ts';
import { finish } from './endings.ts';
import { MOTION_LIMITS } from './limits.ts';
import { atRestPolled, heldPolled, motionLinesSettled, planner } from './model.ts';

export function pollHold(t: MotionTx, at: number, { ctx, s, p, confirm }: PollContext): void {
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

export function pollFlush(t: MotionTx, at: number, { s, p, confirm }: PollContext): void {
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
