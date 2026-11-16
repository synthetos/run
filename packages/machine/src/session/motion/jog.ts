import { type Decision } from '@synthetos/safety';
import { queueModeReads } from '../modes.ts';
import {
  UNITS_LINE,
  jogLine,
  type MotionAxisLetter
} from '../motionLines.ts';
import { piecesLeft, takePiece } from '../typedPieces.ts';
import type { JogFeed, MotionCtx, SessionIntent, SessionState } from '../types.ts';
import { type MotionTx } from './contract.ts';
import { clearMotionNotice, newCtx, queueLine, requestPoll, setMotion, tick } from './effects.ts';
import { ALLOWED, JOG_AXES, LETTER, MOTION_LIMITS, TOOL_CHANGE_JOG_A } from './limits.ts';
import { deny, motionLinesSettled, precondition, validAxes } from './model.ts';

export function onJog(t: MotionTx, request: Extract<SessionIntent, { readonly intent: 'jog' }>, at: number, s: SessionState): Decision {
  if ('renew' in request) {
    return renewJog(t, s, at);
  }
  const pre = precondition(s);
  if (pre !== undefined) return pre;
  const { axes, distanceMm, feed } = request;
  if (!validAxes(axes)) return deny('A jog names one or more of X, Y, Z and A, each + or −.', 'Choose an axis.');
  // Review N2 (2026-11-08): Resume returns X, Y and Z to where the job stopped, never A.
  if (s.job?.phase === 'toolChange' && axes.a !== undefined) return deny(TOOL_CHANGE_JOG_A, 'Jog X, Y or Z, or stop the job.');
  if (invalidJogFeed(feed)) return deny(`Jog speed must be 1 to ${MOTION_LIMITS.maxFeed} mm/min.`, 'Choose another jog speed.');
  if (invalidJogDistance(distanceMm)) {
    return deny(`A jog step is 0.001 to ${MOTION_LIMITS.maxStepMm} mm.`, 'Choose another step.');
  }
  // OD (owner, 2026-11-09): a step is one move, so it runs smoothly instead of braking between pieces. A hold
  // jog keeps short pieces, so a lost release or link is bounded by the lookahead (H50, H54).
  const pieceMm = distanceMm !== null ? distanceMm : Math.max(0.001, (feed / 60) * (MOTION_LIMITS.pieceMs / 1000));
  const jog: JogFeed = { axes: { ...axes }, remainingMm: distanceMm, feed, pieceMm, renewedAt: at };
  t.set({ motion: { ...newCtx(s, 'jog'), jog }, base: 'JOGGING' });
  clearMotionNotice(t);
  // The board's own units and distance mode, answered before anything of the jog changes them (modes.ts).
  queueModeReads(t, 'motion');
  // Millimetres first, on a line of its own that is answered before the first piece goes out (R2): the
  // board may be in inches (a job, another sender), and the firmware reads a piece's F before its G21.
  queueLine(t, UNITS_LINE, 'jog');
  sendPiece(t);
  requestPoll(t);
  tick(t);
  return ALLOWED;
}

function renewJog(t: MotionTx, s: SessionState, at: number): Decision {
  const jog = s.motion?.jog;
  if (jog === null || jog === undefined || jog.remainingMm !== null || s.motion?.phase !== 'feed') return deny('No hold jog is running.', 'Nothing to do.');
  setMotion(t, { jog: { ...jog, renewedAt: at } });
  return ALLOWED;
}

function invalidJogFeed(feed: number): boolean { return typeof feed !== 'number' || !Number.isFinite(feed) || feed < 1 || feed > MOTION_LIMITS.maxFeed; }

function invalidJogDistance(distanceMm: number | null): boolean { return distanceMm !== null && (typeof distanceMm !== 'number' || !Number.isFinite(distanceMm) || distanceMm < 0.001 || distanceMm > MOTION_LIMITS.maxStepMm); }

/** Sends the next jog piece when fewer than the lookahead are believed queued and nothing is being written. */
export function feedMore(t: MotionTx): void {
  const ctx = t.s.motion as MotionCtx;
  if (ctx.queued < MOTION_LIMITS.lookahead && motionLinesSettled(t.s)) {
    if (ctx.op === 'typed') sendTypedPiece(t);
    else sendPiece(t);
  }
}

/** OD-31: queues the next piece of a typed move, counted in the planner like a jog piece. */
export function sendTypedPiece(t: MotionTx): void {
  const ctx = t.s.motion as MotionCtx;
  const { line, typed } = takePiece(ctx);
  queueLine(t, line, 'typedMove');
  setMotion(t, { typed, queued: ctx.queued + 1 });
}

/** More to feed: a jog's distance (or a hold jog), or a typed move's pieces (OD-31). */
export function feeding(ctx: MotionCtx): boolean {
  return ctx.op === 'typed' ? piecesLeft(ctx) : moreToFeed(ctx.jog as JogFeed);
}

function moreToFeed(jog: JogFeed): boolean {
  return jog.remainingMm === null || jog.remainingMm > 1e-9;
}

function sendPiece(t: MotionTx): void {
  const ctx = t.s.motion as MotionCtx;
  const jog = ctx.jog as JogFeed;
  const d = jog.remainingMm === null ? jog.pieceMm : Math.min(jog.pieceMm, jog.remainingMm);
  const move: Partial<Record<MotionAxisLetter, number>> = {};
  for (const axis of JOG_AXES) {
    const sign = jog.axes[axis];
    if (sign !== undefined) move[LETTER[axis]] = sign * d;
  }
  queueLine(t, jogLine(move, jog.feed), 'jog');
  setMotion(t, { jog: { ...jog, remainingMm: jog.remainingMm === null ? null : Math.max(0, jog.remainingMm - d) }, queued: ctx.queued + 1 });
}
