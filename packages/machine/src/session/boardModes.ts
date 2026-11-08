/**
 * The board's units and distance mode as run knows them (OD-19, 2026-11-08): the job card shows them next to Start
 * ("Absolute, mm"), and nothing here decides a write.
 *
 * Sources, never a pushed report (a report lags `si` and samples late, SAFETY §4.2): the `unit` and `dist` reads (at
 * connect, a job's prep reads, the reads before a motion and after a job), and the lines run writes itself
 * (`G21`, a jog piece, `G90 G20`, a job's start modes, the probe's `G91`), taken once the board answered them with
 * status 0. A job's own lines may change either and end with M2 or M30, which put the board's defaults back: the
 * modes are unknown from the first job line until the reads after the job.
 *
 * Pure functions over the reducer's transition.
 */
import { parseLine } from './fileModes.ts';
import type { SessionState } from './types.ts';

interface ModesTx {
  s: SessionState;
  set(patch: Partial<SessionState>): void;
}

export const BOARD_MODES_UNKNOWN: SessionState['boardModes'] = Object.freeze({ units: undefined, dist: undefined });

/** A `unit` or `dist` read was answered (status 0 with 0 or 1 is known; anything else is unknown). */
export function noteModeRead(t: ModesTx, token: string, status: number, value: unknown): void {
  if (token !== 'unit' && token !== 'dist') return;
  const known = status === 0 && (value === 0 || value === 1) ? value : undefined;
  t.set({ boardModes: { ...t.s.boardModes, [token === 'unit' ? 'units' : 'dist']: known } });
}

/** A line of run's own was answered: with status 0, its G90/G91 and G20/G21 are what the board holds now. */
export function noteModeLine(t: ModesTx, line: string | undefined, status: number): void {
  if (line === undefined || status !== 0) return;
  const { codes } = parseLine(line);
  const m = t.s.boardModes;
  const dist = codes.has('G90') ? 0 : codes.has('G91') ? 1 : m.dist;
  const units = codes.has('G21') ? 1 : codes.has('G20') ? 0 : m.units;
  if (dist !== m.dist || units !== m.units) t.set({ boardModes: { units, dist } });
}

/** A job's own lines are about to run: what they leave is read after the job. */
export function forgetBoardModes(t: ModesTx): void {
  t.set({ boardModes: BOARD_MODES_UNKNOWN });
}

/** The modes in plain words for the job card: "Absolute, mm", "Relative, inches", or what is not known. */
export function boardModesText(m: SessionState['boardModes']): string {
  if (m.dist === undefined && m.units === undefined) return 'Not read yet';
  const dist = m.dist === 0 ? 'Absolute' : m.dist === 1 ? 'Relative' : 'Distance mode not read';
  const units = m.units === 1 ? 'mm' : m.units === 0 ? 'inches' : 'units not read';
  return `${dist}, ${units}`;
}
