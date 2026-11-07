/**
 * Probe Z: the stops and the link (SAFETY §4.5c "Stops", H90; T-S131). Pause writes `!` and Stop job or Spindle off
 * writes ^D, never gated; once either is pressed no probe line goes out (the write gate refuses them, common.ts
 * probeLineAllowed). A lost or STALE link, a FAULT, a dropped line or a damaged answer ends the run saying what is known.
 */
import type { MotionDeps } from '../motion.ts';
import type { Expected, SessionIntent } from '../types.ts';
import { RUN_LIMITS, dropQueuedLines, finish, probeWritten, setProbe, setRun, writeStop, zeroWritten, type ProbeTx } from './common.ts';
import { onRead } from './run.ts';
import { SETTING_TOKENS, probeRunning } from './state.ts';
import type { ProbeOutcome } from './types.ts';

/**
 * Pause, Stop job and Spindle off while the probe runs. Pause: `!`, and the result once nothing more can move (the
 * probe move never went out, or the machine is at rest before the zero); otherwise the cycle's own end is the result
 * and `!` is sent again while the cycle runs without a hold (run.ts onProbePoll). Stop job: ^D, and its ALARM 207 is
 * the result. Returns false when no probe is running (the ordinary stop handles it).
 */
export function onProbeStop(t: ProbeTx, request: SessionIntent, at: number): boolean {
  const p = t.s.probeZ;
  const r = p.run;
  if (!probeRunning(p.step) || r === null || (request.intent === 'feedhold' && 'release' in request)) return false;
  const kill = request.intent !== 'feedhold';
  const realtime = t.s.dialect?.realtime;
  /* c8 ignore next -- a probe runs only on edge-next, which has both bytes */
  if (realtime === undefined || realtime.kill === undefined) return false;
  // Once the zero has gone to the transport its read-back still runs, but no zero is claimed (H90 mitigation 3).
  const zeroOut = zeroWritten(t.s);
  const moved = probeWritten(t.s);
  if (!zeroOut) {
    dropQueuedLines(t);
    if (r.zero === 'line') setRun(t, { zero: null }); // the zero never went out
  }
  t.set({ notices: { ...t.s.notices, pauseRequestedAt: at } });
  writeStop(t, kill ? 'kill' : 'feedhold', request.intent, kill ? realtime.kill.byte : realtime.feedhold.byte);
  if (r.stopped !== 'stopJob') setRun(t, { stopped: kill ? 'stopJob' : 'pause' });
  if (kill) setProbe(t, { alarmExpected: true, killUntil: at + RUN_LIMITS.killGraceMs });
  else if (!zeroOut && (!moved || p.step === 'zeroing')) finish(t, { kind: 'paused' }, at);
  return true;
}

/**
 * A lost or STALE link, or a FAULT, while the probe ran: what is known is said. With the link STALE the probe move
 * may still be running, so `!` goes out (Pause is always allowed); with it LOST nothing can be written (FAULT, W3).
 */
export function abandonProbe(t: ProbeTx, why: 'lost' | 'stale' | 'fault', at: number): void {
  const p = t.s.probeZ;
  if (!probeRunning(p.step)) return;
  const r = p.run;
  const realtime = t.s.dialect?.realtime;
  if (why === 'stale' && p.step !== 'zeroing' && probeWritten(t.s) && realtime !== undefined) writeStop(t, 'feedhold', 'feedhold', realtime.feedhold.byte);
  if (r?.zero === 'restore') {
    finish(t, r.pending as ProbeOutcome, at); // the outcome was decided; only putting the modes back is lost
    return;
  }
  const zero = p.step === 'zeroing' && r?.zero !== null;
  const outcome: ProbeOutcome = why !== 'fault' ? { kind: 'lost', during: zero ? 'zero' : 'probe' } : zero ? { kind: 'zeroUnconfirmed' } : { kind: 'noReport' };
  finish(t, outcome, at);
}

/**
 * One of the probe's lines was not written (the write gate refused it after a stop, or the matrix after an alarm or
 * an overlay): it is dropped, never held, and the run ends. A held-back restore shows the outcome it was putting
 * the modes back for (a zero that was set and read back stays said); a held-back zero is not confirmed; a probe
 * move held back after Pause is the Pause, after Stop job its ALARM 207 is the result.
 */
export function onProbeLineDropped(t: ProbeTx, line: string, at: number): void {
  t.set({ queue: t.s.queue.filter((q) => !(q.purpose === 'probeZ' && q.line === line)) });
  const r = t.s.probeZ.run;
  if (r === null) return;
  if (r.zero === 'restore') finish(t, r.pending as ProbeOutcome, at);
  else if (r.zero === 'line') finish(t, { kind: 'zeroUnconfirmed' }, at);
  else if (r.stopped === 'pause') finish(t, { kind: 'paused' }, at);
  else if (r.stopped === null) finish(t, { kind: 'refused', status: 0, text: 'Not sent: the machine left the state that allows it.' }, at);
}

/** One of the probe's answers timed out: the link goes STALE next, which ends the run (abandonProbe). */
export function onProbeMissed(t: ProbeTx, missed: Expected): void {
  if (SETTING_TOKENS.includes(missed.token) && t.s.probeZ.refreshing) setProbe(t, { refreshing: false });
}

/** One of the probe's answers arrived damaged: a line's is a FAULT (nothing shows whether it ran), a read's counts as unread. */
export function onProbeGarbled(t: ProbeTx, deps: MotionDeps, entry: Expected, at: number): void {
  if (entry.line !== undefined) deps.fault(t, 'unexpectedResponse', 'integrity', `the answer to a probe line (${entry.line}) arrived damaged`, at);
  else onRead(t, entry.token, undefined, at);
}
