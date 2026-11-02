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
import type { ClassifiedLine, Footer } from '../types.ts';
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

/**
 * The dialect's footer rule, applied after `classifyLine` once the session
 * knows its dialect: a revision-1 footer must carry a checksum on a dialect
 * that always prints one (440.21) and must not carry one where the firmware
 * never prints it (g2core). Anything else is `Garbled{bad-footer}`, an
 * integrity fault during a job (SAFETY §3). Other events pass unchanged.
 */
export function checkFooterForDialect(dialect: Dialect, event: ClassifiedLine): ClassifiedLine {
  if (event.kind !== 'Response' && event.kind !== 'Banner') return event;
  const footer = event.footer;
  if (footer === undefined) return event;
  if (footerChecksumFits(dialect, footer)) return event;
  return Object.freeze({ kind: 'Garbled', reason: 'bad-footer', line: event.line });
}

/**
 * Whether a footer's checksum presence is the dialect's: a revision-1 footer
 * carries one exactly when the dialect always prints one (440.21), and a
 * revision 2/3 footer never does.
 */
function footerChecksumFits(dialect: Dialect, footer: Footer): boolean {
  return (footer.checksum !== undefined) === (dialect.caps.footerChecksum === 'required' && footer.rev === 1);
}

/**
 * The whole footer contract of a dialect, as the classifier applies it to
 * every footer the probe collected (P0-08 review): a revision the dialect
 * prints and the dialect's checksum rule. A footer that fails either is
 * evidence the board is not that dialect, or that the line was damaged.
 */
export function footerFitsDialect(dialect: Dialect, footer: Footer): boolean {
  return dialect.caps.footerRevs.includes(footer.rev) && footerChecksumFits(dialect, footer);
}

/** What is known around an EN status-13 reply. */
export interface BufferFullEvidence {
  /** An `er` with `st` 13 arrived for this line (the first damaged line raises ALARM 13 and prints it). */
  readonly exception13: boolean;
  /** The status of the alarm the machine is latched in, or null when it is not in ALARM (or it is unknown). */
  readonly alarmStatus: number | null;
}

/**
 * EN status 13 means either "this damaged line never ran" (E162: it comes
 * with an `er` 13, or arrives while ALARM 13 stands, @cite EN
 * controller.c:253-266) or "this line ran, but its reply overflowed"
 * (E102: `{"r":{},...}` with 13 in place of OK, no `er`, no alarm,
 * @cite EN json_parser.c:888-893). Only the first is safe to resend. With
 * no evidence of E162, the answer is `responseLost`: never resend (a group
 * SET would be applied twice), re-read state instead. An alarm of another
 * status is not evidence of E162.
 */
export function resolveBufferFull(evidence: BufferFullEvidence): 'damagedLine' | 'responseLost' {
  return evidence.exception13 || evidence.alarmStatus === 13 ? 'damagedLine' : 'responseLost';
}
