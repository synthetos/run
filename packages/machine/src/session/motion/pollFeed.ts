import { raiseDone } from '../typedPieces.ts';
import type { MotionCtx } from '../types.ts';
import { type MotionTx, type PollContext } from './contract.ts';
import { queueLine, requestPoll, setMotion } from './effects.ts';
import { finish } from './endings.ts';
import { feeding, feedMore, sendTypedPiece } from './jog.ts';
import { MOTION_LIMITS } from './limits.ts';
import { atRestPolled, motionLinesSettled, planner } from './model.ts';

export function pollFeed(t: MotionTx, { ctx, s, p }: PollContext): void {
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

export function pollDrain(t: MotionTx, at: number, { ctx, s, p, confirm }: PollContext): void {
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
