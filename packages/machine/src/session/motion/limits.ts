import { type MachineClass } from '@synthetos/protocol';
import { type Decision } from '@synthetos/safety';
import {
  MAX_JOG_FEED,
  MAX_RPM,
  type MotionAxisLetter
} from '../motionLines.ts';
import type { JogAxis, SessionBase } from '../types.ts';


/** Timing and bounds of the motion layer (SAFETY §4.5b). Milliseconds unless named otherwise. */
export const MOTION_LIMITS = Object.freeze({
  /** Polled reads while motion is in progress. */
  pollMs: 100,
  /** Longest travel time of one jog piece at the jog feed. */
  pieceMs: 150,
  /** Most hold-jog pieces queued in the planner at once (enough that the planner never brakes between them). */
  lookahead: 4,
  /** A hold jog ends when the page has not renewed it for this long. */
  keepAliveMs: 500,
  /** Each stop step (hold, flush) must complete within this. */
  stopStepMs: 3000,
  /** Consecutive polled reads that must agree (SAFETY §4.2). */
  confirmations: 2,
  /**
   * An offset write (G10 L20, G54..G59) refused with status 13 (buffer full) is written again after this long, at
   * most `offsetAttempts` times in all (firmware bug hunt 2026-11-02: back-to-back G10 can be refused with 13 even
   * when each reply is awaited; the cause is not known yet).
   */
  offsetRetryMs: 500,
  offsetAttempts: 3,
  /** Longest single jog step, mm (100 mm, or 4 in = 101.6 mm). */
  maxStepMm: 102,
  maxFeed: MAX_JOG_FEED,
  maxRpm: MAX_RPM,
  /**
   * Homing (amendment 2026-11-02): pushed reports say when the cycle may have ended; a check poll runs at most
   * this often in case a report was missed. Two polled reads confirm the end.
   */
  homingCheckMs: 1000,
});

/** The polled reads of the motion layer, in order; the cycle is complete when the last one is answered. */
export const POLL_TOKENS: readonly string[] = Object.freeze(['stat', 'hold', 'vel', 'qr']);

export const LETTER: Readonly<Record<JogAxis, MotionAxisLetter>> = { x: 'X', y: 'Y', z: 'Z', a: 'A' };

export const JOG_AXES: readonly JogAxis[] = ['x', 'y', 'z', 'a'];

/** Bases a homing or G28.3 read-back settles into idle (or CONNECTED_UNKNOWN). */
export const SETTLE_BASES: ReadonlySet<SessionBase> = new Set(['HOMING', 'CONNECTED_UNKNOWN', 'IDLE_UNHOMED', 'IDLE_HOMED']);

export const ALARMED: ReadonlySet<MachineClass> = new Set(['alarm', 'softAlarm', 'shutdown', 'panic']);

/** Bases an alarm report moves to ALARM. */
export const ALARMABLE: ReadonlySet<SessionBase> = new Set(['IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING', 'HOMING', 'HELD', 'STOPPING_JOB', 'PREAMBLE', 'RUNNING', 'PROGRAM_PAUSED']);

/** Bases a Stop job in a motion session may start from (anything else keeps the Phase 1 `!` only). Phase 3 adds the job bases. */
export const STOPPABLE: ReadonlySet<SessionBase> = new Set(['IDLE_UNHOMED', 'IDLE_HOMED', 'JOGGING', 'HOMING', 'HELD', 'STOPPING_JOB', 'CONNECTED_UNKNOWN', 'PREAMBLE', 'RUNNING', 'PROGRAM_PAUSED']);

export const ALLOWED: Decision = Object.freeze({ allowed: true });

/** Why only Z may be zeroed at a manual tool change (H74); the page shows the same words. */
export const TOOL_CHANGE_ZERO = "At a tool change only Z can be re-zeroed, for the new tool's length.";

/** Why A is not jogged at a manual tool change: Resume returns X, Y and Z only. */
export const TOOL_CHANGE_JOG_A = 'At a tool change A is not jogged: Resume returns X, Y and Z to where the job stopped, not A.';
