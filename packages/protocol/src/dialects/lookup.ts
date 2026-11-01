/**
 * Reading dialect data (ROADMAP P0-08). These are the only functions that
 * interpret a dialect's tables, so every consumer gets the same answer and
 * every unknown input gets the safe one.
 */
import { G2CORE_EDGE } from './g2core.ts';
import { READ_ONLY_STOP_JOB } from './shared.ts';
import { TINYG_440 } from './tinyg440.ts';
import { TINYG_449_STOCK } from './tinyg449Stock.ts';
import { TINYG_EN } from './tinygEn.ts';
import type { Dialect, DialectFlow, DialectId, MachineClass, StatusClass, StopSequence } from './types.ts';

/** Every dialect that has data, in classification-table order. */
export const DIALECTS: readonly Dialect[] = Object.freeze([TINYG_EN, TINYG_440, TINYG_449_STOCK, G2CORE_EDGE]);

/** The dialect with this id, or undefined (`g2core-101.03` has no data). */
export function dialectById(id: DialectId): Dialect | undefined {
  return DIALECTS.find((d) => d.id === id);
}

/**
 * What a `stat` value means. A value the dialect does not define (or that is
 * not a non-negative integer) is `unknown`, which no consumer treats as idle.
 */
export function mapStat(dialect: Dialect, stat: number): MachineClass {
  if (!Number.isSafeInteger(stat) || stat < 0) return 'unknown';
  return dialect.stat[stat]?.machineClass ?? 'unknown';
}

/** The name of a `hold` value, or undefined when the dialect does not define it. */
export function holdName(dialect: Dialect, hold: number): string | undefined {
  if (!Number.isSafeInteger(hold) || hold < 0) return undefined;
  return dialect.hold[hold];
}

/**
 * What a status code means. 0 is `ok`; a code the dialect does not classify
 * (including a non-integer) is `error`, a FAULT during a job (SAFETY §3).
 */
export function statusClass(dialect: Dialect, code: number): StatusClass {
  if (code === 0) return 'ok';
  return dialect.status.get(code)?.statusClass ?? 'error';
}

/** Session modes as the classifier returns them. */
export type SessionMode = 'full' | 'readOnly';

/**
 * The flow engine a session may use: none at all unless the session is in
 * full mode on a dialect that can be approved. A READ_ONLY session streams
 * nothing, whatever its dialect.
 */
export function selectFlowEngine(dialect: Dialect | null, mode: SessionMode): DialectFlow | null {
  if (dialect === null || mode !== 'full' || dialect.mode !== 'manifest') return null;
  return dialect.flow.engine;
}

/**
 * The Stop job sequence for a session (SAFETY §4.4). Only a full session on
 * an approvable dialect gets the dialect's own sequence. Every other session,
 * including an unclassified board (`dialect === null`, SAFETY §3
 * ORPHANED_MOTION unclassified), gets `!` plus "Use your E-stop": never ^D,
 * `%` or M-codes (T-S24a).
 */
export function stopJobFor(dialect: Dialect | null, mode: SessionMode): StopSequence {
  if (dialect === null || mode !== 'full' || dialect.mode !== 'manifest') return READ_ONLY_STOP_JOB;
  return dialect.stopJob;
}
