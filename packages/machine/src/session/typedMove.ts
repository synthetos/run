/**
 * Typed moves: the session side of the terminal (H91, owner 2026-11-09; docs/design/terminal-typed-moves.md).
 *
 * The rule: a typed line goes through the same path as the button that does the same thing. A typed G0/G1/G2/G3/G4
 * is a motion of the motion layer (op `typed`), so Pause and Stop job end it with the same hold and flush sequence
 * as a jog (beginHold), an alarm ends it, and its end is confirmed by two polled reads at rest, as for go to zero.
 *
 * 1. The intent (matrix: idle, no overlay, a motion release; reducer: no settings write, no job, no tool change;
 *    motion layer: nothing else moving) carries the line. It is parsed again here (safety typedLine.ts): a page bug cannot
 *    widen what is sent.
 * 2. Check reads, as for a job's Start: the board's units and distance mode (modes.ts, as a jog reads them, so a
 *    Stop job puts back the right units), then the job's prep reads, the feed in effect and the homing state.
 *    Nothing is sent meanwhile (phase `check`; Pause and Stop job end it here too).
 * 3. When every check read is in, the line is checked like a one-line job (typedTravel.ts): the sanitiser, the
 *    queued-motion ceiling, the travel. A refusal or a travel finding the user has not confirmed ends it with the
 *    reason (the notice carries the finding for Home / Move anyway / Cancel). A board that does not answer within
 *    `checkMs` ends it too.
 * 4. OD-31: a G0 that moves X or Y while Z is low is asked about first (typedLowZ.ts): Raise sends go to zero's
 *    safe-Z lines before the move, each confirmed by polled idle.
 * 5. Otherwise the line is written as its pieces (typedTravel.ts; one piece when short), fed like a hold jog: while
 *    fewer than `lookahead` are in the planner (motion.ts), so the queue stays within the ceiling and the planner
 *    does not brake between them. The write gate admits only those exact lines, only from `typedMove`. Then the
 *    motion drains: two polled reads at rest, then done.
 *
 * Modes are never put back behind the user's back: a typed G91 or G20 stays (the job start rule, OD-19, writes the
 * job's own modes at Start). Stop job keeps its own closing lines (§4.4).
 *
 * Pure functions over the reducer's transition.
 */
import { isReadAllowed } from '@synthetos/schema';
import { parseTypedLine, type Decision } from '@synthetos/safety';
import type { Dialect } from '@synthetos/protocol';
import { JOB_PREP_TOKENS } from './job.ts';
import { MOTION_LIMITS, clearMotionNotice, newCtx, queueMotionLine, requestPoll, returnBase, sendTypedPiece, type MotionTx } from './motion.ts';
import { queueModeReads } from './modes.ts';
import { LOW_Z_TEXT, raiseLines, typedLowZ } from './typedLowZ.ts';
import { typedNotice } from './typedNotice.ts';
import { findingWords, typedCheck } from './typedTravel.ts';
import type { MotionCtx, PendingRead, SessionIntent, SessionState, TypedMoveCtx } from './types.ts';

export const TYPED_LIMITS = Object.freeze({
  /** Every check read must be answered within this, ms; otherwise nothing is sent. */
  checkMs: 5000,
});

/** The check reads: the job's prep reads (not the line mode), the feed in effect and the homing state. */
export const TYPED_CHECK_TOKENS: readonly string[] = Object.freeze([...JOB_PREP_TOKENS.filter((t) => t !== 'rxm'), 'feed', 'hom', 'home']);

const ALLOWED: Decision = Object.freeze({ allowed: true });

function deny(reason: string, remedy: string): Decision {
  return { allowed: false, reason, remedy, citation: 'SAFETY H91' };
}

/** The check tokens this board can read (a motion exists only on a classified board). */
function checkTokens(s: SessionState): readonly string[] {
  const id = (s.dialect as Dialect).id;
  return TYPED_CHECK_TOKENS.filter((tok) => isReadAllowed(id, tok));
}

/** Starts a typed move the matrix, the reducer and the motion layer's preconditions have allowed. */
export function startTypedMove(t: MotionTx, request: Extract<SessionIntent, { intent: 'typedMove' }>, at: number): Decision {
  const s = t.s;
  if (s.motion !== null) return deny('Another move is still running.', 'Wait for it to finish, or use Pause or Stop job.');
  const parsed = parseTypedLine(request.line);
  if (!parsed.ok) return deny(parsed.reason, parsed.remedy);
  const travel = typeof request.travel === 'string' ? request.travel : null;
  const lowZ = request.lowZ === 'raise' || request.lowZ === 'asTyped' ? request.lowZ : null;
  const typed: TypedMoveCtx = { line: parsed.value.line, travel, askedAt: at, sent: false, pieces: [], next: 0, lowZ, raise: [], raised: true };
  t.set({ motion: { ...newCtx(s, 'typed'), phase: 'check', typed, deadline: at + TYPED_LIMITS.checkMs }, base: 'JOGGING' });
  clearMotionNotice(t);
  if (t.s.notices.typed !== undefined) {
    const { typed: _last, ...rest } = t.s.notices;
    t.set({ notices: rest });
  }
  // As a jog: the board's own units and distance mode first (a Stop job puts back the units read here).
  queueModeReads(t, 'motion');
  const tokens = checkTokens(t.s);
  const reads: PendingRead[] = tokens.map((token, i) => ({ token, purpose: 'seed', ...(i === tokens.length - 1 ? { then: 'typedCheck' as const } : {}) }));
  t.set({ queue: [...t.s.queue, ...reads] });
  t.arm('motion', TYPED_LIMITS.checkMs);
  return ALLOWED;
}

/** Every check read was answered after the move started (an older answer is another move's). */
function readsFresh(s: SessionState, askedAt: number): boolean {
  return checkTokens(s).every((tok) => (s.values[tok]?.at ?? -Infinity) >= askedAt);
}

function end(t: MotionTx, ctx: MotionCtx): void {
  t.set({ motion: null, base: returnBase(ctx, t.s) });
  t.cancel('motion');
}

/** The last check read was answered: check the line, then send it or end with the reason. */
export function onTypedReadsIn(t: MotionTx, at: number): void {
  const ctx = t.s.motion;
  if (ctx === null || ctx.op !== 'typed' || ctx.phase !== 'check') return;
  const typed = ctx.typed as TypedMoveCtx;
  if (!readsFresh(t.s, typed.askedAt)) return;
  const check = typedCheck(t.s, typed.line);
  if (check.kind === 'refused') {
    end(t, ctx);
    typedNotice(t, { kind: 'refused', line: typed.line, text: check.text, at });
    return;
  }
  if (check.kind === 'confirm' && typed.travel !== check.finding.text) {
    end(t, ctx);
    typedNotice(t, { kind: 'confirm', line: typed.line, text: `Run can't check this move against the travel: ${findingWords(check.finding)}.`, at, travel: check.finding });
    return;
  }
  // OD-31: a G0 that moves X or Y with Z low is asked about first; Raise only where go to zero's safe Z is known.
  const question = typedLowZ(t.s, (parseTypedLine(typed.line) as Extract<ReturnType<typeof parseTypedLine>, { ok: true }>).value, ctx.units, ctx.dist);
  if (question !== null && (typed.lowZ === null || (typed.lowZ === 'raise' && !question.raise))) {
    end(t, ctx);
    typedNotice(t, { kind: 'lowZ', line: typed.line, text: LOW_Z_TEXT.question, at, lowZ: question });
    return;
  }
  const raise = question !== null && typed.lowZ === 'raise' ? raiseLines(question, ctx.units as number, ctx.dist as number) : [];
  const ready: TypedMoveCtx = { ...typed, sent: true, pieces: check.pieces, next: 0, raise, raised: raise.length === 0 };
  if (raise.length > 0) {
    // Go to zero's raise first, each line confirmed by polled idle (drain), then the pieces (motion.ts).
    t.set({ motion: { ...ctx, phase: 'drain', confirmed: 0, deadline: null, typed: ready, steps: raise.slice(1) } });
    queueMotionLine(t, raise[0] as string, 'typedMove');
  } else {
    t.set({ motion: { ...ctx, phase: 'feed', confirmed: 0, deadline: null, queued: 0, typed: ready } });
    sendTypedPiece(t);
  }
  requestPoll(t);
  t.arm('motion', MOTION_LIMITS.pollMs);
}

/**
 * True while a typed move's lines may go out: it passed its check and is feeding, draining, or holding for a Pause
 * (a piece already handed over may still be written; it waits in the planner behind the hold). Never after the
 * flush (`%` waits for every written line to be answered) and never once the move has ended.
 */
export function typedSendingIn(state: SessionState): boolean {
  const ctx = state.motion;
  // A typed motion always carries its line (startTypedMove).
  return ctx !== null && ctx.op === 'typed' && (ctx.phase === 'feed' || ctx.phase === 'drain' || ctx.phase === 'hold') && (ctx.typed as TypedMoveCtx).sent;
}

/**
 * True when `line` is exactly one the typed move is sending: a raise line (OD-31) or a piece already queued (the
 * write gate's typed kind, writePolicy.ts).
 */
export function typedLineWritableIn(state: SessionState, line: string): boolean {
  if (!typedSendingIn(state)) return false;
  const typed = (state.motion as MotionCtx).typed as TypedMoveCtx;
  return typed.raise.includes(line) || typed.pieces.slice(0, typed.next).includes(line);
}
