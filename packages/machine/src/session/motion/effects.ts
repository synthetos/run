import { type Decision, type Intent } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import { restartDwellWait } from '../dwell.ts';
import {
  CLEAR_LINE
} from '../motionLines.ts';
import type { ChangeKind, FollowUp, JogAxis, MotionCtx, PendingRead, SessionBase, SessionState } from '../types.ts';
import { type MotionTx } from './contract.ts';
import { ALLOWED, MOTION_LIMITS, POLL_TOKENS } from './limits.ts';
import { dialect } from './model.ts';

export function queueLine(t: MotionTx, line: string, intent: Intent): void {
  // Built here, from the grammar's own builders; the write gate checks the exact bytes again.
  const token = line === CLEAR_LINE ? 'clear' : 'gc';
  const entry: PendingRead = { token, purpose: 'motion', line, intent };
  t.set({ queue: [...t.s.queue, entry] });
}

/** A typed move's line (H91, typedMove.ts): queued like every motion line; the write gate admits only that exact line. */
export function queueMotionLine(t: MotionTx, line: string, intent: Intent): void {
  queueLine(t, line, intent);
}

export function writeRealtime(t: MotionTx, name: 'feedhold' | 'flush' | 'resume', intent: Intent): void {
  restartDwellWait(t);
  const realtime = dialect(t.s).realtime;
  const byte = name === 'feedhold' ? realtime.feedhold.byte : name === 'flush' ? (realtime.flush as { readonly byte: number }).byte : realtime.resume.byte;
  t.set({ sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name, byte, intent });
}

export function message(t: MotionTx, kind: NonNullable<SessionState['notices']['motion']>['kind'], text: string, at: number): void {
  t.set({ notices: { ...t.s.notices, motion: { kind, text, at } } });
}

/** The single read-back after run changed a value (amendment 2026-11-02), through the read allowlist. */
export function readBack(t: MotionTx, tokens: readonly string[], then?: FollowUp): void {
  const d = dialect(t.s);
  const reads: PendingRead[] = tokens.filter((tok) => isReadAllowed(d.id, tok)).map((token) => ({ token, purpose: 'seed' as const }));
  const last = reads.at(-1);
  if (then !== undefined && last !== undefined) reads[reads.length - 1] = { ...last, then };
  t.set({ queue: [...t.s.queue, ...reads] });
}

/** Asks for one poll cycle unless one is already waiting or owed. */
export function requestPoll(t: MotionTx): void {
  const s = t.s;
  const pending = s.queue.some((q) => q.purpose === 'poll') || s.writing?.purpose === 'poll' || s.expected.some((e) => e.purpose === 'poll' && !e.late);
  if (pending) return;
  t.set({ queue: [...s.queue, ...POLL_TOKENS.map((token) => ({ token, purpose: 'poll' as const }))] });
}

export function tick(t: MotionTx): void {
  t.arm('motion', MOTION_LIMITS.pollMs);
}

export function setMotion(t: MotionTx, patch: Partial<MotionCtx>): void {
  t.set({ motion: { ...(t.s.motion as MotionCtx), ...patch } });
}

/**
 * The last motion result ("Stopped: queue cleared…", "Jog stopped…") goes when the next action starts (first-time
 * walk C25): a jog, a go to zero, a homing, a change or a job. Words only.
 */
export function clearMotionNotice(t: { s: SessionState; set(patch: Partial<SessionState>): void }): void {
  if (t.s.notices.motion === undefined) return;
  const { motion: _done, ...rest } = t.s.notices;
  t.set({ notices: rest });
}

export function newCtx(s: SessionState, op: MotionCtx['op']): MotionCtx {
  // A Stop job from CONNECTED_UNKNOWN (UNKNOWN overlay, or a FAULT) returns there; a jog or Z re-zero during a
  // job's tool change (Phase 3) returns to PROGRAM_PAUSED; everything else to idle.
  const returnTo: SessionBase = s.base === 'CONNECTED_UNKNOWN' || s.base === 'PROGRAM_PAUSED' ? s.base : 'IDLE_UNHOMED';
  // The modes are never taken from the live view (pushed reports lag): a jog, go to zero and a stop read them (modes.ts).
  return { op, phase: 'feed', jog: null, steps: [], reason: null, confirmed: 0, deadline: null, units: undefined, dist: undefined, returnTo, refusal: null, holdPolls: 0, queued: 0 };
}

/**
 * A change that moves nothing (G10 L20, G92, G92.1, G28.3, G54..G59): the line, then polled idle (two reads), then
 * its single read-back. The base stays where it is; the motion context only keeps other motion out meanwhile.
 */
export function startChange(t: MotionTx, ...[change, line, intent, axes = []]: [change: ChangeKind, line: string, intent: Intent, axes?: readonly JogAxis[]]): Decision {
  const retried = change === 'setZero' || change === 'selectCoord' ? { line, attempts: 1, retryAt: null } : {};
  t.set({ motion: { ...newCtx(t.s, 'change'), phase: 'drain', change, axes: [...axes], returnTo: t.s.base, ...retried } });
  clearMotionNotice(t);
  queueLine(t, line, intent);
  requestPoll(t);
  tick(t);
  return ALLOWED;
}

export function changeNotice(t: MotionTx, kind: 'done' | 'refused' | 'failed', text: string, at: number): void {
  t.set({ notices: { ...t.s.notices, change: { kind, text, at } } });
}
