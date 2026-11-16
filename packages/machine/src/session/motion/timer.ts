import { typedCheckTimedOut } from '../typedNotice.ts';
import type { MotionCtx } from '../types.ts';
import { type MotionDeps, type MotionTx } from './contract.ts';
import { message, queueLine, requestPoll, setMotion, tick } from './effects.ts';
import { MOTION_LIMITS } from './limits.ts';
import { returnBase } from './model.ts';
import { beginHold } from './stops.ts';

/** The `motion` timer: keep-alive, deadlines, and the next poll. */
export function onMotionTimer(t: MotionTx, deps: MotionDeps, at: number): void {
  // Armed only while a motion is in a polling phase: complete, abandon, held and finish cancel it.
  const ctx = t.s.motion as MotionCtx;
  if (stopExpired(ctx, at)) {
    const what = ctx.phase === 'hold' ? 'did not report the hold' : 'did not report an empty queue after the flush';
    t.set({ motion: null, base: returnBase(ctx, t.s), queue: t.s.queue.filter((q) => q.purpose !== 'motion' && q.purpose !== 'poll') });
    message(t, 'failed', 'Stop not confirmed: use your E-stop.', at);
    deps.fault(t, 'stopNotConfirmed', 'integrity', `the controller ${what} within ${MOTION_LIMITS.stopStepMs / 1000} s`, at);
    return;
  }
  if (ctx.phase === 'check') {
    // A typed move's check reads were not all answered in time (H91): nothing was sent.
    t.set({ motion: null, base: returnBase(ctx, t.s) });
    typedCheckTimedOut(t, ctx, at);
    return;
  }
  if (ctx.retryAt !== undefined && ctx.retryAt !== null && at >= ctx.retryAt && ctx.line !== undefined) {
    setMotion(t, { retryAt: null, attempts: (ctx.attempts as number) + 1, confirmed: 0 });
    queueLine(t, ctx.line, ctx.change === 'setZero' ? 'setWorkZero' : 'selectCoordSystem');
    requestPoll(t);
    tick(t);
    return;
  }
  if (ctx.phase === 'homing') {
    // The fallback check: a pushed report may have been missed (only one is pending at a time).
    requestPoll(t);
    t.arm('motion', MOTION_LIMITS.homingCheckMs);
    return;
  }
  const jog = ctx.jog;
  if (jog !== null && jog.remainingMm === null && ctx.phase === 'feed' && at - jog.renewedAt > MOTION_LIMITS.keepAliveMs) {
    beginHold(t, 'keepalive', at);
    return;
  }
  requestPoll(t);
  tick(t);
}

function stopExpired(ctx: MotionCtx, at: number): boolean { return (ctx.phase === 'hold' || ctx.phase === 'flush') && ctx.deadline !== null && at > ctx.deadline; }
