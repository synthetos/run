import { onClearAnswered } from '../alarmRestore.ts';
import type { MotionCtx } from '../types.ts';
import { type MotionTx } from './contract.ts';
import { changeNotice, message, readBack, setMotion } from './effects.ts';
import { complete } from './endings.ts';
import { feeding, feedMore } from './jog.ts';
import { MOTION_LIMITS } from './limits.ts';
import { motionLinesSettled, returnBase } from './model.ts';
import { beginHold } from './stops.ts';

/** A motion line was answered. A non-zero status ends the motion (the board refused it). */
export function onMotionAnswer(t: MotionTx, line: string | undefined, status: number, at: number): void {
  const ctx = t.s.motion;
  // OD-19: a Clear alarm answered with status 0 sends the G90 a noted alarm asks for (its answer is routed on its own
  // intent in the reducer, alarmRestore.ts).
  onClearAnswered(t, line, status);
  if (retryableOffset(ctx, line, status)) {
    return retryOffset(t, ctx, line, at);
  }
  if (status !== 0) {
    const meaning = t.s.dialect?.status.get(status)?.meaning;
    const text = `The controller refused ${String(line)}${meaning === undefined ? '' : `: ${meaning}`} (status ${status}).`;
    if (ctx !== null && (ctx.op === 'change' || (ctx.op === 'home' && ctx.phase === 'homing'))) {
      // Nothing was started: end without a hold, and say why.
      t.set({ motion: null, base: returnBase(ctx, t.s), queue: t.s.queue.filter((q) => q.purpose !== 'motion' && q.purpose !== 'poll') });
      t.cancel('motion');
      changeNotice(t, 'refused', text, at);
      if (ctx.op === 'home') readBack(t, ['hom', 'home']);
      return;
    }
    if (ctx === null) {
      message(t, 'refused', text, at);
    } else {
      setMotion(t, { refusal: ctx.refusal ?? text });
      if (ctx.phase === 'feed' || ctx.phase === 'drain') beginHold(t, 'refused', at);
    }
  }
  continueAfterAnswer(t, status, at);
}

function retryOffset(t: MotionTx, ctx: MotionCtx & { readonly attempts: number }, line: string | undefined, at: number): void {
  if (ctx.attempts < MOTION_LIMITS.offsetAttempts) {
    // Status 13 (buffer full) on an offset write: wait, then write the same line again (bug hunt 2026-11-02).
    t.emit({ kind: 'log', text: `offset: the controller refused ${String(line)} with status 13 (buffer full), attempt ${ctx.attempts} of ${MOTION_LIMITS.offsetAttempts}; writing it again in ${MOTION_LIMITS.offsetRetryMs} ms` });
    setMotion(t, { retryAt: at + MOTION_LIMITS.offsetRetryMs, confirmed: 0 });
    return;
  }
  t.emit({ kind: 'log', text: `offset: the controller refused ${String(line)} with status 13 (buffer full) ${ctx.attempts} times; not written` });
  t.set({ motion: null, base: returnBase(ctx, t.s), queue: t.s.queue.filter((q) => q.purpose !== 'motion' && q.purpose !== 'poll') });
  t.cancel('motion');
  changeNotice(t, 'refused', `The controller refused ${String(line)} ${ctx.attempts} times (status 13, its buffer was full). Nothing was changed: try again in a moment.`, at);
  return;
}

function retryableOffset(ctx: MotionCtx | null, line: string | undefined, status: number): ctx is MotionCtx & { readonly attempts: number } { return status === 13 && ctx !== null && ctx.op === 'change' && ctx.line === line && ctx.attempts !== undefined; }

function continueAfterAnswer(t: MotionTx, status: number, at: number): void {

  const now = t.s.motion;
  // A piece was taken: top the planner up at once rather than waiting for the next poll (no stutter).
  if (status === 0 && now !== null && now.phase === 'feed' && (now.jog !== null || now.op === 'typed') && feeding(now)) feedMore(t);
  if (now !== null && now.phase === 'finish' && motionLinesSettled(t.s)) complete(t, at);
}
