import { noteAlarmEnded, onAlarmEntered } from '../alarmRestore.ts';
import { forgetHomed } from '../homedAxes.ts';
import { failJob, jobActive, lastFileLine } from '../jobState.ts';
import { restingStat } from '../resting.ts';
import { typedAlarmed } from '../typedNotice.ts';
import { raiseRestore } from '../typedPieces.ts';
import type { SessionState } from '../types.ts';
import { type MotionTx } from './contract.ts';
import { message } from './effects.ts';
import { ALARMABLE, ALARMED } from './limits.ts';
import { dialect, idleBase, machineClass, returnBase } from './model.ts';

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
    return alarmMotion(t, s, at);
  }
  if (s.base === 'ALARM' && restingStat(dialect(s), s.live.stat as number, s.live.hold)) t.set({ base: idleBase(s) });
  return true;
}

function alarmMotion(t: MotionTx, s: SessionState, at: number): boolean {
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

/** The link dropped or a FAULT latched: the motion is over (nothing more is fed). */
export function abandonMotion(t: MotionTx): void {
  const ctx = t.s.motion;
  t.cancel('motion');
  if (ctx === null) return;
  t.set({ motion: null, base: returnBase(ctx, t.s), queue: t.s.queue.filter((q) => q.purpose !== 'motion') });
}
