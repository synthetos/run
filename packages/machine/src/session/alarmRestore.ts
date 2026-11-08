/**
 * After an alarm that ended a motion of run's, Clear alarm puts absolute distance back (OD-19, owner 2026-11-08;
 * SAFETY §4.5b Clear alarm).
 *
 * A jog writes `G21 G91` pieces, go to zero `G90 G21`, the probe `G21` and `G91 G38.2`. An alarm in the middle (a
 * limit switch, a soft limit, the probe's own) ends them with no closing line: the board refuses lines while alarmed,
 * and clearing the alarm does not reset its modes. So the alarm is noted with the units read before the motion, and
 * once a Clear alarm is answered with status 0 the session writes `G90` (`G90 G20` when those units were inches) as
 * the very next line, through its own matrix intent (`alarmRestore`) and only that exact line (the write gate checks
 * it against this note). The note is dropped once that line is answered, or with the link.
 *
 * Pure functions over the reducer's transition.
 */
import { CLEAR_LINE, restoreLine } from './motionLines.ts';
import type { SessionState } from './types.ts';

interface RestoreTx {
  s: SessionState;
  set(patch: Partial<SessionState>): void;
}

/** The exact line: `G90`, or `G90 G20` when the units read before the motion were inches. */
export function alarmRestoreLine(units: number | undefined): string {
  return restoreLine(units, 0);
}

/** An alarm ended a jog, go to zero or probe of run's: remember to put absolute distance back after the clear. */
export function noteAlarmEnded(t: RestoreTx, units: number | undefined): void {
  t.set({ alarmRestore: { units } });
}

/** A Clear alarm line was answered: with status 0 and an alarm noted, the restore goes out next (ahead of the polls). */
export function onClearAnswered(t: RestoreTx, line: string | undefined, status: number): void {
  const note = t.s.alarmRestore;
  if (line !== CLEAR_LINE || status !== 0 || note === null) return;
  t.set({ queue: [{ token: 'gc', purpose: 'motion', line: alarmRestoreLine(note.units), intent: 'alarmRestore' }, ...t.s.queue] });
}

/** True when `line` is exactly the restore the note asks for (the write gate's check for `alarmRestore`). */
export function alarmRestoreWritableIn(s: SessionState, line: string): boolean {
  return s.alarmRestore !== null && line === alarmRestoreLine(s.alarmRestore.units);
}

/**
 * The restore was answered: the note is done either way. Returns the refusal text when the board refused it (the
 * board may still be relative), null when it took it, undefined when `line` is not the restore.
 */
export function onAlarmRestoreAnswer(t: RestoreTx, line: string | undefined, status: number): string | null | undefined {
  const note = t.s.alarmRestore;
  if (note === null || line !== alarmRestoreLine(note.units)) return undefined;
  t.set({ alarmRestore: null });
  return status === 0 ? null : `The controller refused ${line} after the alarm was cleared (status ${status}): it may still be in relative mode. Jog once (a jog ends in G90) before you run anything.`;
}
