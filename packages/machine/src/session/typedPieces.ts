/**
 * Bookkeeping of a typed move's pieces and raise (OD-31), for the motion layer's feeder. The motion layer feeds the
 * pieces like a hold jog's (at most `lookahead` in the planner, counted from `qr`), so these helpers only say what is
 * left, what was dropped by a hold, and what a hold leaves to put back.
 *
 * Pure. No other session module is imported here, so the motion layer can call it without a cycle.
 */
import { restoreLine } from './motionLines.ts';
import type { MotionCtx, PendingRead, TypedMoveCtx } from './types.ts';

/** The typed move of `ctx`; a typed motion always carries it. */
function typedOf(ctx: MotionCtx): TypedMoveCtx {
  return ctx.typed as TypedMoveCtx;
}

/** A typed move with its raise done (or none) and pieces still to queue. */
export function piecesLeft(ctx: MotionCtx): boolean {
  if (ctx.op !== 'typed') return false;
  const typed = typedOf(ctx);
  return typed.raised && typed.next < typed.pieces.length;
}

/** The next piece to queue, and the typed move with it counted. */
export function takePiece(ctx: MotionCtx): { readonly line: string; readonly typed: TypedMoveCtx } {
  const typed = typedOf(ctx);
  return { line: typed.pieces[typed.next] as string, typed: { ...typed, next: typed.next + 1 } };
}

/**
 * A hold dropped the motion lines still waiting in the queue: pieces among them are counted back, so a Resume after
 * Pause queues them again (the ones written wait in the planner behind the hold).
 */
export function afterHold(ctx: MotionCtx, queue: readonly PendingRead[]): MotionCtx {
  if (ctx.op !== 'typed') return ctx;
  const typed = typedOf(ctx);
  // Motion lines always carry their line; a raise line is not a piece and is not counted.
  const dropped = queue.filter((q) => q.purpose === 'motion' && typed.pieces.includes(q.line as string)).length;
  return { ...ctx, typed: { ...typed, next: typed.next - dropped } };
}

/** The raise was confirmed by polled idle: the pieces may go. */
export function raiseDone(ctx: MotionCtx): MotionCtx {
  return { ...ctx, typed: { ...typedOf(ctx), raised: true } };
}

/** A typed move whose raise was started and not finished: the closing line that puts the board's modes back, or none. */
export function raiseRestore(ctx: MotionCtx): readonly string[] {
  if (ctx.op !== 'typed') return [];
  const typed = typedOf(ctx);
  return typed.raise.length > 0 && !typed.raised ? [restoreLine(ctx.units, ctx.dist)] : [];
}
