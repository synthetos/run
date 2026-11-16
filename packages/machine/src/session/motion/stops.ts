import { STOP_TEXT, type Decision } from '@synthetos/safety';
import { queueModeReads } from '../modes.ts';
import { afterHold, piecesLeft } from '../typedPieces.ts';
import type { HoldReason, MotionCtx, SessionConfig, SessionIntent, SessionState } from '../types.ts';
import { type MotionTx } from './contract.ts';
import { message, newCtx, queueLine, requestPoll, tick, writeRealtime } from './effects.ts';
import { ALLOWED, MOTION_LIMITS, STOPPABLE } from './limits.ts';
import { deny, motionCapable } from './model.ts';

/** True when a Stop job, Pause or Spindle off in this state is handled here instead of Phase 1's `!` alone. */
export function motionStopApplies(s: SessionState, config: SessionConfig): boolean {
  return motionCapable(s, config) && STOPPABLE.has(s.base) && !s.overlays.includes('ORPHANED_MOTION') && !s.overlays.includes('LOST');
}

/** Starts the hold step of a stop or release (SAFETY §4.4 Phase 2 steps 1–3). */
export function beginHold(t: MotionTx, reason: HoldReason, at: number): void {
  const s = t.s;
  const stop = reason === 'stopJob';
  writeRealtime(t, 'feedhold', stop ? 'stopJob' : 'feedhold');
  // Stop feeding: unsent pieces and steps never go out.
  const queue = t.s.queue.filter((q) => q.purpose !== 'motion');
  // OD-31: a typed move's pieces still waiting are counted back, so Resume queues them again.
  const ctx = s.motion === null ? newCtx(s, 'stop') : afterHold(s.motion, t.s.queue);
  t.set({
    queue,
    motion: { ...ctx, phase: 'hold', reason, jog: null, steps: [], confirmed: 0, deadline: at + MOTION_LIMITS.stopStepMs, holdPolls: 0 },
    ...(stop ? { base: 'STOPPING_JOB' as const } : {}),
  });
  // A stop with no motion of ours (a job's Stop job, a Stop job from idle) reads the units it puts back with its
  // closing G90 (§4.4 step 5), answered ahead of the polls that confirm the hold, so before any `%` (modes.ts).
  if (s.motion === null) queueModeReads(t, 'motion');
  requestPoll(t);
  tick(t);
}

/**
 * Pause, Stop job, Spindle off and a hold jog's release in a motion session. Returns false when the
 * request is not handled here (the caller falls back to the Phase 1 `!`).
 */
export function onMotionStop(t: MotionTx, request: SessionIntent, at: number): boolean {
  if (!motionStopApplies(t.s, t.config)) return false;
  const ctx = t.s.motion;
  if (request.intent === 'feedhold') {
    return feedholdRequest(t, request, at, ctx);
  }
  if (request.intent === 'stopJob') {
    if (ctx !== null && ctx.reason === 'stopJob') writeRealtime(t, 'feedhold', 'stopJob');
    else beginHold(t, 'stopJob', at);
    return true;
  }
  // spindleOffNow (the reducer passes only the stop class here).
  if (ctx !== null) {
    // Something of ours is moving or held: M5 would queue behind it, so end it like Stop job (§4.4).
    if (ctx.reason !== 'stopJob') beginHold(t, 'stopJob', at);
    return true;
  }
  const outputs = 'outputs' in request ? request.outputs : undefined;
  if (outputs !== 'coolant') queueLine(t, 'M5', 'spindleOffNow');
  if (outputs !== 'spindle') queueLine(t, 'M9', 'spindleOffNow');
  return true;
}

function feedholdRequest(t: MotionTx, request: Extract<SessionIntent, { readonly intent: 'feedhold' }>, at: number, ctx: MotionCtx | null): boolean {
  if ('release' in request) {
    if (ctx !== null && ctx.jog !== null && ctx.jog.remainingMm === null && ctx.phase === 'feed') beginHold(t, 'release', at); // a hold jog is fed until released
    return true;
  }
  if (ctx !== null && ctx.phase === 'homing') {
    // Pause during homing ends it (hold, then flush): a homing cycle is not resumed (amendment 2026-11-02).
    beginHold(t, 'homeAbort', at);
    return true;
  }
  // A typed move still being checked (H91) ends here too, so its line never goes out after a Pause.
  if (ctx !== null && (ctx.phase === 'feed' || ctx.phase === 'drain' || ctx.phase === 'check')) {
    beginHold(t, 'pause', at);
    return true;
  }
  return false; // nothing of ours is moving: `!` alone, as in Phase 1
}

export function onResume(t: MotionTx, at: number, s: SessionState): Decision {
  const ctx = s.motion;
  // A motion context exists only in a motion-capable session.
  if (ctx === null || ctx.phase !== 'held') return deny('Resume is only for a hold of motion this session sent.', 'Use Stop job to end it.');
  writeRealtime(t, 'resume', 'resume');
  // The base stays HELD until the first poll after `~`: the write gate checks `~` against the resume row
  // (HELD only) when the byte is written, after this transition.
  // OD-31: a typed move with pieces left goes on feeding them after the hold, as a job does.
  t.set({ motion: { ...ctx, phase: piecesLeft(ctx) ? 'feed' : 'drain', jog: null, confirmed: 0, deadline: null } });
  message(t, 'resumed', STOP_TEXT.resumed, at);
  requestPoll(t);
  tick(t);
  return ALLOWED;
}
