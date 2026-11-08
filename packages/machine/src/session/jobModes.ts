/**
 * Job start matches the preview (OD-19, owner 2026-11-08: "option 1 for job start"; SAFETY §4.4a Start).
 *
 * The preview draws a file from `G21 G90 G17 G91.1`. The board may hold other modes: an alarm, a lost link, a FAULT
 * or a stopped probe can leave it in `G91`, and an earlier file or another program can leave inches, another plane
 * or absolute arc centres. For each of those modes that the file relies on (fileModes.ts) and that the board, as
 * read at Start, does not hold, run writes it on one line before the job's first line. Then it takes every prep read
 * again (independent second review 2026-11-08, M1: the offsets, the stored positions and the axis settings are
 * printed in the board's units, so values read before a `G21` are inches), confirms the modes it wrote, and checks
 * the file from those values: the modes the file relies on are then the preview's, and so is the unit of every
 * value the check uses. A file that sets its own modes before it moves gets nothing.
 *
 * The card's line is a forecast from what run knows now (the board's modes as read or set by its own lines,
 * boardModes.ts; the plane and arc mode as last read); Start decides again from the values it reads then.
 *
 * Pure functions over the reducer's transition; nothing here touches a port or a clock.
 */
import type { SentLine } from '@synthetos/safety';
import { fileStartNeeds, type StartMode } from './fileModes.ts';
import { jobEvent, patchJob, type JobTx } from './jobState.ts';
import type { PendingRead, SessionState } from './types.ts';

interface Target {
  readonly code: string;
  readonly token: string;
  readonly value: number;
  readonly words: string;
}

/** What run writes for each mode, the token that reads it, the value that means it, and its plain words. */
const TARGET: Readonly<Record<StartMode, Target>> = {
  distance: { code: 'G90', token: 'dist', value: 0, words: 'absolute mode' },
  units: { code: 'G21', token: 'unit', value: 1, words: 'millimetres' },
  plane: { code: 'G17', token: 'plan', value: 0, words: 'the XY plane' },
  arcDistance: { code: 'G91.1', token: 'admo', value: 1, words: 'arc centres relative to the start' },
};

function readValue(s: SessionState, token: string): number | undefined {
  const v = s.values[token];
  return v !== undefined && v.status === 0 && typeof v.value === 'number' ? v.value : undefined;
}

/** The modes the file relies on that this dialect has (no arc distance mode where the dialect has none). */
export function startNeeds(s: SessionState, lines: readonly SentLine[]): readonly StartMode[] {
  const arcDistance = s.dialect?.gcode.job?.codes.includes('G90.1') === true;
  return fileStartNeeds(lines).filter((m) => m !== 'arcDistance' || arcDistance);
}

/** What Start will write, from the values read last: relied on and not held (or not known). */
export function planStartModes(s: SessionState, needs: readonly StartMode[]): readonly StartMode[] {
  return needs.filter((m) => readValue(s, TARGET[m].token) !== TARGET[m].value);
}

/**
 * The card's forecast (N4): the units and the distance mode as the board holds them now (reads and run's own answered
 * lines, boardModes.ts), so it follows a jog or a job that changed them; the plane and arc mode as last read.
 */
export function forecastStartModes(s: SessionState, needs: readonly StartMode[]): readonly StartMode[] {
  const now = (m: StartMode): number | undefined => (m === 'units' ? s.boardModes.units : m === 'distance' ? s.boardModes.dist : readValue(s, TARGET[m].token));
  return needs.filter((m) => now(m) !== TARGET[m].value);
}

/** The one line that sets them, in a fixed order (`G90 G21 G17 G91.1`, a shape of the motion grammar). */
export function startModesLine(modes: readonly StartMode[]): string {
  return modes.map((m) => TARGET[m].code).join(' ');
}

/** The check's plain line: "Run sets absolute mode and millimetres before the first line, as the preview shows." */
export function startModesText(modes: readonly StartMode[]): string | null {
  if (modes.length === 0) return null;
  const words = modes.map((m) => TARGET[m].words);
  const list = words.length === 1 ? (words[0] as string) : `${words.slice(0, -1).join(', ')} and ${words.at(-1) as string}`;
  return `Run sets ${list} before the first line, as the preview shows.`;
}

/** True when `line` is exactly the start-modes line of the job starting now (the write gate's check for `jobModes`). */
export function jobModesWritableIn(s: SessionState, line: string): boolean {
  const plan = s.job?.startModes;
  return s.job?.phase === 'checking' && plan !== undefined && plan.written && plan.modes.length > 0 && line === startModesLine(plan.modes);
}

export type StartModesStep = { readonly kind: 'go' } | { readonly kind: 'wait' } | { readonly kind: 'refused'; readonly text: string };

/**
 * At Start, each time the prep reads are in: `wait` after queueing the start-modes line and every prep read again
 * (`prepReads`), `refused` when a mode cannot be read back (N6) or reads back other than written, else `go`.
 */
export function startModesStep(t: JobTx, at: number, prepReads: readonly PendingRead[]): StartModesStep {
  const s = t.s;
  const j = s.job;
  /* c8 ignore next -- called only while a job is checking */
  if (j === null) return { kind: 'go' };
  const plan = j.startModes;
  if (plan === undefined || !plan.written) {
    const needs = startNeeds(s, j.lines);
    const modes = planStartModes(s, needs);
    const unreadable = modes.filter((m) => !prepReads.some((r) => r.token === TARGET[m].token));
    patchJob(t, { startModes: { needs, modes, written: modes.length > 0 && unreadable.length === 0 } });
    if (modes.length === 0) return { kind: 'go' };
    // Fail closed (N6): a mode that cannot be read back is never written blind.
    if (unreadable.length > 0) return { kind: 'refused', text: `The job did not start: this board cannot read back ${unreadable.map((m) => TARGET[m].code).join(' ')}, which the file relies on.` };
    t.set({ queue: [...t.s.queue, { token: 'gc', purpose: 'motion', line: startModesLine(modes), intent: 'jobModes' }, ...prepReads] });
    jobEvent(t, at, 'info', `${startModesText(modes) as string} Writing ${startModesLine(modes)}, then reading the board again.`);
    return { kind: 'wait' };
  }
  const unmet = plan.modes.filter((m) => readValue(s, TARGET[m].token) !== TARGET[m].value);
  if (unmet.length > 0) return { kind: 'refused', text: `The board did not confirm ${unmet.map((m) => TARGET[m].code).join(' ')} after run wrote ${startModesLine(plan.modes)}: nothing of the job was sent.` };
  return { kind: 'go' };
}
