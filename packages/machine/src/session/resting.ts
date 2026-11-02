/**
 * One rule for "the board is at rest" (SAFETY H14 mitigation 2, as amended 2026-11-02; PN §2.3 step 0), shared
 * by READING (ORPHANED_MOTION at connect) and the Phase 2 motion layer (drain and stop checks). Pure.
 */
import { mapStat, type Dialect, type MachineClass } from '@synthetos/protocol';

/** Classes that are resting on every dialect (stat ∈ {1, 4}). */
export const RESTING_CLASSES: ReadonlySet<MachineClass> = new Set(['idle', 'end']);

/**
 * Dialects on which PROGRAM_STOP (stat 3) with `hold` 0 is a finished cycle, not a pause (SAFETY H14 as
 * amended 2026-11-02). On edge-next every cycle that ends without M2/M30 finalizes to PROGRAM_STOP
 * (@cite EN canonical_machine.c cm_cycle_end; also after `{clear}`), while a program pause (M0/M1/M60)
 * is stat 3 **with hold 6** (@cite EN canonical_machine.c _exec_program_stop). Bench 1, 2026-11-02: an idle
 * 450.01 board after a harness run answered stat 3, hold 0, vel 0, qr 32. Not on 440.21 (`hold` is
 * unverified there) nor on any dialect whose program pause is not shown in `hold`.
 */
export const STAT3_RESTS_WITH_HOLD_ZERO: ReadonlySet<string> = new Set(['tinyg-en']);

/**
 * Whether the resting check consults `hold` on this dialect. SAFETY H14 mitigation 2: only where the
 * dialect does not list `hold` as unverified (on 440.21 only `stat` and `vel` are used).
 */
export function restingUsesHold(dialect: Dialect): boolean {
  return !dialect.unverified.some((u) => u.field === 'hold');
}

/** Whether `stat` (with `hold`) is a resting state on `dialect`. */
export function restingStat(dialect: Dialect, stat: number, hold: number | undefined): boolean {
  const cls = mapStat(dialect, stat);
  if (RESTING_CLASSES.has(cls)) return true;
  return cls === 'programStop' && STAT3_RESTS_WITH_HOLD_ZERO.has(dialect.id) && restingUsesHold(dialect) && hold === 0;
}
