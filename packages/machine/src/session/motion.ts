/**
 * The Phase 2 motion layer of the session reducer (owner 2026-11-02; SAFETY
 * §4.4, §4.5b, H50–H56; T-S89–T-S92).
 *
 * Pure functions over the reducer's transition (`MotionTx`): they read the
 * state, queue lines and realtime bytes as effects, and arm the `motion`
 * timer. Nothing here touches a port or a clock. The reducer calls them
 * only when the session's release allows motion; every intent has passed
 * the allow-matrix first, and every line and byte is checked again by the
 * write gate when it is written (writePolicy.ts).
 *
 * What runs here:
 * - **Jog** (H50): the session feeds short `G21 G91 G1` pieces, each at most
 *   `pieceMs` of travel at the jog feed, and only while the planner holds
 *   fewer than `lookahead` blocks (`qr`, polled after every piece). A step
 *   is one move of its whole distance (owner, 2026-11-09). A hold jog (no distance)
 *   needs a renewal from the page every `keepAliveMs`; without one it is
 *   released by the session itself.
 * - **Go to zero** (H53): `G53 G0 Z<safe>` first when X or Y move, then
 *   `G90 G0` to work zero, then Z; each line waits for polled idle.
 * - **Set zero**, **spindle and coolant**, **clear alarm**: single lines.
 * - **Ending a jog, Pause, Stop job** (H56): `!`, then polled reads until the
 *   hold is complete (or the machine is at rest) and every written line is
 *   answered, then `%` when anything is held or queued, then polled reads
 *   until the hold is gone and the planner is empty, then the closing lines
 *   (`M5`, `M9` for Stop job; `G90` and the units for a jog). A step that
 *   times out is W12 and FAULT. A Pause stops at the confirmed hold (HELD);
 *   Resume writes `~` and drains.
 *
 * Every decision about the machine uses polled `stat`, `hold`, `vel`, `qr`
 * (SAFETY §4.2), never the last status report and never the spindle and
 * coolant readouts. A decision reads the values of the poll cycle that
 * just completed (`SessionState.polled`), and only when every one of its
 * four reads was answered with status 0: a rejected, missing or damaged
 * answer makes the cycle count for nothing (independent review 2026-11-03,
 * R5; H56, H69). The shared live view (also fed by pushed reports) is for
 * display.
 *
 * Modes (independent review 2026-11-03, R1 and R2): a jog writes `G21` on
 * its own answered line before its first piece, because the firmware reads
 * F before it changes units in the same block; go to zero writes `G90 G21`
 * on its own answered line before its `G53 G0` move, because G53 keeps
 * G91 and G20, and puts the distance mode and units back at the end. What "back" means is read, never taken
 * from the live view: `unit` and `dist` GETs go out before the first line of either (modes.ts), because the
 * last pushed report can still show the previous jog's `G91` after its closing `G90` was answered.
 */
import { STOP_TEXT } from '@synthetos/safety';

import { mapStat } from '@synthetos/protocol';


import { restingStat } from './resting.ts';


import {
    restoreLine
} from './motionLines.ts';


import { noteAlarmEnded, onAlarmEntered, onClearAnswered } from './alarmRestore.ts';

import { forgetHomed, noteSetByHand } from './homedAxes.ts';


import { failJob, forgetJobLines, jobActive, jobStopped, lastFileLine } from './jobState.ts';

import { typedAlarmed, typedCheckTimedOut, typedEnded } from './typedNotice.ts';

import { raiseDone, raiseRestore } from './typedPieces.ts';

import { type MotionDeps, type MotionTx } from './motion/contract.ts';
import { changeNotice, message, queueLine, readBack, requestPoll, setMotion, tick, writeRealtime } from './motion/effects.ts';
import { feedMore, feeding, sendTypedPiece } from './motion/jog.ts';
import { ALARMABLE, ALARMED, MOTION_LIMITS } from './motion/limits.ts';
import { activeSystem, atRestPolled, axisNames, completedPoll, dialect, heldPolled, idleBase, machineClass, motionLinesSettled, planner, returnBase } from './motion/model.ts';
import { beginHold } from './motion/stops.ts';
import type { ChangeKind, JogAxis, MotionCtx, SessionState } from './types.ts';

export { type MotionDeps, type MotionTx } from './motion/contract.ts';
export { clearMotionNotice, newCtx, queueMotionLine, requestPoll } from './motion/effects.ts';
export { onFollowUp, onMotionReport } from './motion/homing.ts';
export { onMotionIntent } from './motion/intents.ts';
export { sendTypedPiece } from './motion/jog.ts';
export { MOTION_LIMITS, POLL_TOKENS, TOOL_CHANGE_JOG_A, TOOL_CHANGE_ZERO } from './motion/limits.ts';
export { activeSystem, atRestPolled, completedPoll, heldPolled, idleBase, motionCapable, returnBase } from './motion/model.ts';
export { beginHold, motionStopApplies, onMotionStop } from './motion/stops.ts';



// --- Polls, answers, timer --------------------------------------------------------

/** One poll cycle was answered (after `qr`). */
export function onPollDone(t: MotionTx, at: number): void {
  const ctx = t.s.motion;
  if (ctx === null || !checkAlarm(t, at)) return;
  const s = t.s;
  const p = completedPoll(s);
  if (p === null) {
    // A read of this cycle was rejected, damaged or missing: it confirms nothing, whatever the live view says (R5;
    // H56, H69). Count from zero again; the hold and flush deadlines still run (W12 and FAULT on a silent board).
    setMotion(t, { confirmed: 0 });
    if (ctx.phase !== 'homing') requestPoll(t); // homing polls again from its own check timer
    return;
  }
  const confirm = (ok: boolean): number => (ok ? ctx.confirmed + 1 : 0);
  switch (ctx.phase) {
    case 'feed': {
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
    case 'drain': {
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
    case 'hold': {
      const held = heldPolled(s, p);
      // `!` is ignored while nothing moves (a line still being parsed, the planner's start-up): if the board is
      // moving with no hold in progress, send it again (SAFETY §4.4 Pause step 6).
      // The first cycle may have been asked before the `!` was written, so only later cycles count.
      if (ctx.holdPolls > 0 && p.hold === 0 && p.vel !== 0) writeRealtime(t, 'feedhold', ctx.reason === 'stopJob' ? 'stopJob' : 'feedhold');
      setMotion(t, { holdPolls: ctx.holdPolls + 1 });
      const confirmed = confirm((held || atRestPolled(s, p)) && motionLinesSettled(s));
      if (confirmed < MOTION_LIMITS.confirmations) {
        setMotion(t, { confirmed });
        requestPoll(t);
        return;
      }
      if (ctx.reason === 'pause') {
        if (held) {
          setMotion(t, { phase: 'held', confirmed: 0, deadline: null });
          t.set({ base: 'HELD' });
          t.cancel('motion');
          message(t, 'paused', STOP_TEXT.paused, at);
        } else {
          message(t, 'paused', STOP_TEXT.pausedIdle, at);
          finish(t, at);
        }
        return;
      }
      if (held || p.qr !== planner(s)) {
        writeRealtime(t, 'flush', ctx.reason === 'stopJob' ? 'stopJob' : 'feedhold');
        // `%` drops the board's line buffers: job lines still owed may never be answered (Phase 3).
        forgetJobLines(t);
        setMotion(t, { phase: 'flush', confirmed: 0, deadline: at + MOTION_LIMITS.stopStepMs });
        requestPoll(t);
        return;
      }
      finish(t, at);
      return;
    }
    case 'homing': {
      const resting = atRestPolled(s, p) && motionLinesSettled(s);
      const cls = mapStat(dialect(s), p.stat);
      const seen = ctx.seen === true || cls === 'homing' || p.vel !== 0;
      const confirmed = confirm(resting);
      // Done after two polled reads at rest, once the cycle was seen running (or three in a row: it ended unseen).
      if (confirmed < MOTION_LIMITS.confirmations || (!seen && confirmed < MOTION_LIMITS.confirmations + 1)) {
        setMotion(t, { confirmed, seen });
        if (confirmed > 0) requestPoll(t);
        return;
      }
      setMotion(t, { phase: 'readback', confirmed: 0, seen });
      t.cancel('motion');
      readBack(t, ['hom', 'mpo', 'pos', 'ofs', 'home'], 'homed');
      return;
    }
    case 'flush': {
      const confirmed = confirm(p.hold === 0 && p.qr === planner(s) && motionLinesSettled(s));
      if (confirmed < MOTION_LIMITS.confirmations) {
        setMotion(t, { confirmed });
        requestPoll(t);
        return;
      }
      t.set({ dwellWait: null }); // two polls confirm the requested flush; its timer is cancelled
      finish(t, at);
      return;
    }
    /* c8 ignore next 2 -- held and finish stop the poll timer, so no poll cycle completes in them */
    default:
      return;
  }
}


/** Queues the closing lines (SAFETY §4.4 Phase 2 step 5, §4.5b). */
function finish(t: MotionTx, at: number): void {
  const ctx = t.s.motion as MotionCtx;
  const stop = ctx.reason === 'stopJob';
  const lines = stop ? ['M5', 'M9'] : [];
  // A jog used G21 G91 and go to zero G90 G21 (R1, R2): put back the units read before them (modes.ts). A jog, go to
  // zero and a Stop job end in absolute distance (§4.4, §4.5b; go to zero since OD-19, 2026-11-08); only a jog during
  // a job's tool change puts back the job's own distance mode (Phase 3, H74). A mode that was not read is not put back.
  const dist = ctx.op === 'jog' && ctx.returnTo === 'PROGRAM_PAUSED' && !stop ? ctx.dist : 0;
  if (ctx.op === 'jog' || ctx.op === 'goToZero' || stop) lines.push(restoreLine(ctx.units, dist));
  // OD-31: a typed move's raise that did not finish puts the board's own modes back (a typed G91 or G20 stays).
  else lines.push(...raiseRestore(ctx));
  setMotion(t, { phase: 'finish', confirmed: 0, deadline: null });
  // Phase 3: the hold and the flush are confirmed, so every job line the board still had is gone (`%` dropped its
  // line buffers) and every one it ran has been answered: none is owed any more, and M5's answer is M5's.
  if (stop) t.set({ expected: t.s.expected.filter((e) => e.purpose !== 'job') });
  for (const line of lines) queueLine(t, line, stop ? 'stopJob' : ctx.op === 'goToZero' ? 'goToZero' : 'jog');
  t.cancel('motion');
  if (lines.length === 0) complete(t, at);
}


/** The read-back of each change (amendment 2026-11-02): what it changed, read once. */
const CHANGE_READBACK: Readonly<Record<ChangeKind, (s: SessionState) => readonly string[]>> = {
  setZero: (s) => [`g${53 + (activeSystem(s) as number)}`, 'ofs', 'pos'],
  setPosition: () => ['mpo', 'pos', 'hom', 'ofs', 'home'],
  tempOffset: () => ['g92', 'ofs', 'pos'],
  clearTempOffset: () => ['g92', 'ofs', 'pos'],
  selectCoord: () => ['coor', 'ofs', 'pos', 'g54', 'g55', 'g56', 'g57', 'g58', 'g59'],
};


const CHANGE_DONE: Readonly<Record<ChangeKind, (axes: string) => string>> = {
  setZero: (axes) => `Work zero set for ${axes} (saved on the controller); offsets read back.`,
  setPosition: (axes) => `Machine position set to 0 here for ${axes} (G28.3); position read back.`,
  tempOffset: (axes) => `Temporary offset set: ${axes} read 0 here (G92, not saved).`,
  clearTempOffset: () => 'Temporary offset cleared (G92.1).',
  selectCoord: () => 'Work coordinate system changed; offsets read back.',
};


function complete(t: MotionTx, at: number): void {
  const ctx = t.s.motion as MotionCtx;
  t.set({ motion: null, base: returnBase(ctx, t.s) });
  t.cancel('motion');
  if (ctx.op === 'change' && ctx.reason === null && ctx.refusal === null) {
    const change = ctx.change as ChangeKind;
    if (change === 'setPosition') noteSetByHand(t, ctx.axes as readonly JogAxis[]);
    readBack(t, CHANGE_READBACK[change](t.s), change === 'setPosition' ? 'positionSet' : undefined);
    changeNotice(t, 'done', CHANGE_DONE[change](axisNames(ctx.axes as readonly JogAxis[])), at);
  }
  if (ctx.op === 'home') {
    // Homing ended by Pause, Stop job or a refusal: the machine is not homed. Read the homing state back.
    readBack(t, ['hom', 'mpo', 'pos', 'home']);
    if (ctx.reason === 'homeAbort') changeNotice(t, 'failed', 'Homing stopped by Pause. The machine is not homed: home again before relying on positions.', at);
  }
  if (ctx.op === 'typed') typedEnded(t, ctx, at);
  if (ctx.reason === 'stopJob') {
    message(t, 'stopped', STOP_TEXT.stopped, at);
    jobStopped(t, at);
  }
  else if (ctx.reason === 'keepalive') message(t, 'failed', 'Jog stopped: the button was let go, or the page lost touch with it.', at);
  else if (ctx.refusal !== null) message(t, 'refused', ctx.refusal, at);
}


/** A motion line was answered. A non-zero status ends the motion (the board refused it). */
export function onMotionAnswer(t: MotionTx, line: string | undefined, status: number, at: number): void {
  const ctx = t.s.motion;
  // OD-19: a Clear alarm answered with status 0 sends the G90 a noted alarm asks for (its answer is routed on its own
  // intent in the reducer, alarmRestore.ts).
  onClearAnswered(t, line, status);
  if (status === 13 && ctx !== null && ctx.op === 'change' && ctx.line === line && ctx.attempts !== undefined) {
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
  const now = t.s.motion;
  // A piece was taken: top the planner up at once rather than waiting for the next poll (no stutter).
  if (status === 0 && now !== null && now.phase === 'feed' && (now.jog !== null || now.op === 'typed') && feeding(now)) feedMore(t);
  if (now !== null && now.phase === 'finish' && motionLinesSettled(t.s)) complete(t, at);
}


/** The `motion` timer: keep-alive, deadlines, and the next poll. */
export function onMotionTimer(t: MotionTx, deps: MotionDeps, at: number): void {
  // Armed only while a motion is in a polling phase: complete, abandon, held and finish cancel it.
  const ctx = t.s.motion as MotionCtx;
  if ((ctx.phase === 'hold' || ctx.phase === 'flush') && ctx.deadline !== null && at > ctx.deadline) {
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


/**
 * After live values changed (a report or a read): an alarm ends any motion (the controller stopped it) and
 * puts the session in ALARM; an alarm that cleared returns to idle. Returns false when motion was ended.
 */
export function checkAlarm(t: MotionTx, at: number): boolean {
  const s = t.s;
  if (!t.config.release.motion || s.dialect === null) return true;
  const cls = machineClass(s);
  if (cls === undefined) return true;
  if (cls === 'shutdown' || cls === 'panic') forgetHomed(t); // S1: edge-next's cm_shutdown unhomes every axis
  if (ALARMED.has(cls) && s.dialect.id === 'tinyg-en') t.set({ dwellWait: null }); // EN alarms cancel timer work
  if (ALARMED.has(cls) && ALARMABLE.has(s.base)) {
    const moving = s.motion !== null;
    // OD-19: a jog or go to zero ended here left G91 (and G21): Clear alarm puts G90 back (alarmRestore.ts).
    if (s.motion !== null && (s.motion.op === 'jog' || s.motion.op === 'goToZero' || raiseRestore(s.motion).length > 0)) noteAlarmEnded(t, s.motion.units);
    else onAlarmEntered(t);
    if (s.motion !== null && s.motion.op === 'typed') typedAlarmed(t, s.motion, at);
    t.set({ motion: null, base: 'ALARM', queue: s.queue.filter((q) => q.purpose !== 'motion') });
    t.cancel('motion');
    if (moving) message(t, 'failed', 'The controller alarmed and stopped the move. Read the alarm, then clear it.', at);
    // Phase 3: an alarm ends the job (on edge-next the controller has already flushed and turned its outputs off).
    if (jobActive(t.s)) failJob(t, at, `The controller alarmed at line ${lastFileLine(t.s.job as NonNullable<SessionState['job']>, t.s.live.line)} and stopped the job. Read the alarm, then clear it.`);
    return false;
  }
  if (s.base === 'ALARM' && restingStat(dialect(s), s.live.stat as number, s.live.hold)) t.set({ base: idleBase(s) });
  return true;
}


/** The link dropped or a FAULT latched: the motion is over (nothing more is fed). */
export function abandonMotion(t: MotionTx): void {
  const ctx = t.s.motion;
  t.cancel('motion');
  if (ctx === null) return;
  t.set({ motion: null, base: returnBase(ctx, t.s), queue: t.s.queue.filter((q) => q.purpose !== 'motion') });
}
