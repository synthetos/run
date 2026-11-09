/**
 * Which start modes a job file relies on (OD-19, 2026-11-08; SAFETY §4.4a Start).
 *
 * The preview draws a file from `G21 G90 G17 G91.1` (apps/web gcode-worker OFFLINE_START). A file relies on one of
 * those modes when a line that depends on it comes before the file sets it:
 * - units (`G20`/`G21`): any move, any axis word (also `G92` and `G10` values), any `F`, any arc word. On a line
 *   that sets the units, `F` is still read in the units before them (the firmware sets F first: independent review
 *   2026-11-03, R2), so such a line relies on the start units when it carries `F`;
 * - distance (`G90`/`G91`): any move;
 * - plane (`G17`/`G18`/`G19`) and arc distance (`G90.1`/`G91.1`): any arc move.
 * A mode set on the same line as the move counts as set first (the firmware applies modes before the move).
 * The work coordinate system and the motion mode are not here: the preview's G54 has zero offsets, which no board
 * has, and the Set zero step and C31 are what match the work zero; G0 and G1 move along the same straight line.
 *
 * Reads the sanitised lines (comments gone, words canonical): the file's own lines and the segments a long move was
 * split into (the first carries the line's modal codes, analyze.ts `bodies`); the lines the check inserts (C14, C22)
 * carry no mode of the file's. Pure.
 */
import type { SentLine } from '@synthetos/safety';

/** The modes run may write before a job's first line, in the order it writes them. */
export type StartMode = 'distance' | 'units' | 'plane' | 'arcDistance';
export const START_MODES: readonly StartMode[] = Object.freeze(['distance', 'units', 'plane', 'arcDistance']);

const SETS: Readonly<Record<StartMode, readonly string[]>> = {
  distance: ['G90', 'G91'],
  units: ['G20', 'G21'],
  plane: ['G17', 'G18', 'G19'],
  arcDistance: ['G90.1', 'G91.1'],
};

/** One G-code word (a letter and its number); shared with jobTravel.ts. */
export const WORD = /([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g;
const AXIS = new Set(['X', 'Y', 'Z', 'A', 'B', 'C']);
const ARC_WORD = new Set(['I', 'J', 'K', 'R']);
const MOTION_MODES = new Set(['G0', 'G1', 'G2', 'G3', 'G38.2', 'G38.3', 'G38.4', 'G38.5', 'G80']);
/** Non-modal codes whose move is not along the modal motion (no arc then). */
const NON_MODAL_MOVES = new Set(['G28', 'G30', 'G53']);

interface Parsed {
  readonly codes: ReadonlySet<string>;
  readonly letters: ReadonlySet<string>;
}

/** The G and M codes of a line, canonical (`G01` is `G1`, `G90.10` is `G90.1`), and its word letters. */
export function parseLine(body: string): Parsed {
  const codes = new Set<string>();
  const letters = new Set<string>();
  for (const m of body.matchAll(WORD)) {
    const letter = (m[1] as string).toUpperCase();
    letters.add(letter);
    if (letter === 'G' || letter === 'M') codes.add(`${letter}${Number(m[2])}`);
  }
  return { codes, letters };
}

/** The start modes `lines` rely on, in `START_MODES` order. */
export function fileStartNeeds(lines: readonly Pick<SentLine, 'body' | 'origin' | 'motion'>[]): readonly StartMode[] {
  const settled = new Set<StartMode>();
  const needed = new Set<StartMode>();
  let motionMode: string | null = null;
  for (const line of lines) {
    if (line.origin !== 'file' && line.origin !== 'split') continue;
    const { codes, letters } = parseLine(line.body);
    for (const code of codes) if (MOTION_MODES.has(code)) motionMode = code;
    const move = line.motion !== null;
    const arc = move && (motionMode === 'G2' || motionMode === 'G3') && ![...codes].some((c) => NON_MODAL_MOVES.has(c));
    const axisWords = [...letters].some((l) => AXIS.has(l) || ARC_WORD.has(l));
    const rely = (mode: StartMode, depends: boolean): void => {
      if (depends && !settled.has(mode)) needed.add(mode);
    };
    // F is read before this line's own G20/G21 (R2).
    rely('units', letters.has('F'));
    for (const mode of START_MODES) if (SETS[mode].some((c) => codes.has(c))) settled.add(mode);
    rely('units', move || axisWords);
    rely('distance', move);
    rely('plane', arc);
    rely('arcDistance', arc);
    if (START_MODES.every((m) => settled.has(m) || needed.has(m))) break;
  }
  return START_MODES.filter((m) => needed.has(m));
}
