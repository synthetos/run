/**
 * How a typed move ended, in plain words for the terminal (H91, owner 2026-11-09). Pause and Stop job also keep their
 * own words in the motion notice; this one names the line.
 *
 * Pure functions over the reducer's transition. No other session module is imported here, so the motion layer can
 * call them without a cycle.
 */
import type { MotionCtx, SessionState, TypedMoveNotice } from './types.ts';

interface NoticeTx {
  s: SessionState;
  set(patch: Partial<SessionState>): void;
}

export const TYPED_TEXT = Object.freeze({
  done: 'Done.',
  stopped: 'Stopped before the move finished.',
  notSent: 'Not sent: stopped before the move started.',
  alarm: 'The controller alarmed and stopped the move.',
  noAnswer: 'Not sent: the board did not answer the check reads in time.',
});

/** Sets the typed-move notice. */
export function typedNotice(t: NoticeTx, notice: TypedMoveNotice): void {
  t.set({ notices: { ...t.s.notices, typed: notice } });
}

/**
 * The notice for a typed move that `complete` ended: done, refused by the board, or stopped (a Pause before the line
 * went out, Stop job, a refusal of another kind). A Pause after the line went out ends here only once the move ran
 * (resumed, or at rest): that is done.
 */
export function typedEnded(t: NoticeTx, ctx: MotionCtx, at: number): void {
  const typed = ctx.typed;
  /* c8 ignore next -- a typed motion always carries its line */
  if (typed === undefined) return;
  const line = typed.line;
  if (ctx.refusal !== null) return typedNotice(t, { kind: 'refused', line, text: ctx.refusal, at });
  if (!typed.sent) return typedNotice(t, { kind: 'stopped', line, text: TYPED_TEXT.notSent, at });
  // Done only when every piece was queued and the move came to rest (OD-31: a Pause at rest between pieces is not).
  if ((ctx.reason === null || ctx.reason === 'pause') && typed.next >= typed.pieces.length) return typedNotice(t, { kind: 'done', line, text: TYPED_TEXT.done, at });
  typedNotice(t, { kind: 'stopped', line, text: TYPED_TEXT.stopped, at });
}

/** An alarm ended a typed move: before its line went out, or while it ran. */
export function typedAlarmed(t: NoticeTx, ctx: MotionCtx, at: number): void {
  /* c8 ignore next -- a typed motion always carries its line */
  if (ctx.typed === undefined) return;
  typedNotice(t, { kind: 'stopped', line: ctx.typed.line, text: ctx.typed.sent ? TYPED_TEXT.alarm : TYPED_TEXT.notSent, at });
}

/** The check reads of a typed move were not all answered in time: nothing was sent. */
export function typedCheckTimedOut(t: NoticeTx, ctx: MotionCtx, at: number): void {
  /* c8 ignore next -- a typed motion always carries its line */
  if (ctx.typed === undefined) return;
  typedNotice(t, { kind: 'refused', line: ctx.typed.line, text: TYPED_TEXT.noAnswer, at });
}
