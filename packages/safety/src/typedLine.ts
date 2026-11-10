/**
 * The closed grammar of a typed move (H91, owner 2026-11-09; docs/design/terminal-typed-moves.md).
 *
 * The page classifies what the user typed and sends only a move here; the session does not trust that and parses
 * the line again. A typed move is exactly one of G0, G1, G2, G3 or G4, with only these words beside it:
 *
 * | Words | Meaning |
 * |---|---|
 * | `G17` `G18` `G19` | plane |
 * | `G20` `G21` | units |
 * | `G90` `G91` | distance mode |
 * | `G53` | machine coordinates for this G0 or G1 only |
 * | `G54`..`G59` | work coordinate system |
 * | `X Y Z A B C` | axis words (G0, G1, G2, G3) |
 * | `I J K` or `R` | arc centre or radius (G2, G3 only) |
 * | `F` | feed, more than 0 |
 * | `P` | dwell seconds (G4 only, alone with its modal words) |
 *
 * Nothing else: no M, S, T, N or other G word, no comment, no second motion word, no letter twice, no realtime
 * character, no byte outside printable ASCII. The session parses every typed line with it (machine typedMove.ts), and
 * the terminal page classifies with the same function, so there is one grammar. Numbers have at most 5 integer and 4 decimal digits (the motion
 * grammar's own shape, machine motionLines.ts). The line is written in a canonical form (upper case, one space between
 * words, numbers without redundant zeros), and it must fit the write gate's motion cap (64 bytes with its LF).
 *
 * Pure: no state. A change to this file changes what a typed line can make the machine do and needs safety
 * review (SAFETY §8).
 */

/** Longest typed line, LF excluded: the write gate's motion cap is 64 bytes with the LF (machine writePolicy.ts). */
export const TYPED_MAX_CHARS = 63;
/** Longest typed dwell, seconds. Pause and Stop job end a dwell on approved builds (H43), but a long one is a typo. */
export const TYPED_MAX_DWELL_S = 60;

export type TypedMotion = 0 | 1 | 2 | 3 | 4;

/** A typed line that passed the grammar. */
export interface TypedLine {
  /** The canonical line, as it is written to the board. */
  readonly line: string;
  readonly motion: TypedMotion;
  /** Every G word, in the order typed. */
  readonly gcodes: readonly number[];
  /** Every other word by letter. */
  readonly words: Readonly<Partial<Record<TypedLetter, number>>>;
}

export type TypedLetter = 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C' | 'I' | 'J' | 'K' | 'R' | 'F' | 'P';

export type TypedParse = { readonly ok: true; readonly value: TypedLine } | { readonly ok: false; readonly reason: string; readonly remedy: string };

const AXES: readonly TypedLetter[] = ['X', 'Y', 'Z', 'A', 'B', 'C'];
const ARC: readonly TypedLetter[] = ['I', 'J', 'K'];
const LETTERS: ReadonlySet<string> = new Set(['G', ...AXES, ...ARC, 'R', 'F', 'P']);
const MOTION: ReadonlySet<number> = new Set([0, 1, 2, 3, 4]);
/** Modal groups: at most one word of each. */
const GROUPS: readonly (readonly number[])[] = [
  [17, 18, 19],
  [20, 21],
  [90, 91],
  [53, 54, 55, 56, 57, 58, 59],
];
const MODAL: ReadonlySet<number> = new Set(GROUPS.flat());
const NUMBER = /^[+-]?(?:\d{1,5}(?:\.\d{0,4})?|\.\d{1,4})$/;
const WORD = /([A-Za-z])([+-]?[0-9.]*)/y;

const REMEDY = 'Type one move, such as G0 X10 or G1 X10 F500.';

function refuse(reason: string, remedy = REMEDY): TypedParse {
  return { ok: false, reason, remedy };
}

/** The number as written to the board: no `+`, no redundant zeros, never `-0`. */
function canonical(value: number): string {
  return String(value + 0);
}

/** Parses and checks one typed line against the grammar above. */
export function parseTypedLine(input: unknown): TypedParse {
  if (typeof input !== 'string') return refuse('A typed move is one line of text.');
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return refuse('That line has a character the board cannot take.', 'Type plain letters and numbers only.');
  }
  const compact = input.replace(/ /g, '');
  if (compact === '') return refuse('Nothing to send.');
  const gcodes: number[] = [];
  const words: Partial<Record<TypedLetter, number>> = {};
  const parts: string[] = [];
  WORD.lastIndex = 0;
  while (WORD.lastIndex < compact.length) {
    const at = WORD.lastIndex;
    const m = WORD.exec(compact);
    if (m === null) return refuse(`"${compact.slice(at, at + 8)}" is not a G-code word.`);
    const letter = (m[1] as string).toUpperCase();
    const raw = m[2] as string;
    if (!LETTERS.has(letter)) return refuse(`${letter} words are not part of a typed move.`, letter === 'M' || letter === 'S' || letter === 'T' ? 'Use the matching button instead.' : REMEDY);
    if (!NUMBER.test(raw)) return refuse(`${letter}${raw} is not a number run accepts here.`, 'Use at most 5 digits before the point and 4 after it.');
    const value = Number(raw);
    if (letter === 'G') {
      if (!Number.isInteger(value) || (!MOTION.has(value) && !MODAL.has(value))) return refuse(`G${raw} is not part of a typed move.`);
      gcodes.push(value);
      parts.push(`G${value}`);
      continue;
    }
    const l = letter as TypedLetter;
    if (words[l] !== undefined) return refuse(`${l} is in that line twice.`);
    words[l] = value;
    parts.push(`${l}${canonical(value)}`);
  }
  const motions = gcodes.filter((g) => MOTION.has(g));
  if (motions.length !== 1) return refuse(motions.length === 0 ? 'A typed move needs one of G0, G1, G2, G3 or G4.' : 'Only one of G0, G1, G2, G3 or G4 per line.');
  if (new Set(gcodes).size !== gcodes.length) return refuse('A G word is in that line twice.');
  for (const group of GROUPS) {
    if (gcodes.filter((g) => group.includes(g)).length > 1) return refuse(`${group.filter((g) => gcodes.includes(g)).map((g) => `G${g}`).join(' and ')} cannot be in one line.`);
  }
  const motion = motions[0] as TypedMotion;
  const has = (letters: readonly TypedLetter[]): boolean => letters.some((l) => words[l] !== undefined);
  if (words.F !== undefined && words.F <= 0) return refuse('A feed must be more than 0.', 'Add a feed, e.g. F500.');
  if (motion === 4) {
    if (words.P === undefined || has([...AXES, ...ARC, 'R', 'F']) || gcodes.includes(53)) return refuse('A dwell is G4 P<seconds>, with no other words.', 'Type G4 P1 to wait one second.');
    if (!(words.P > 0 && words.P <= TYPED_MAX_DWELL_S)) return refuse(`A typed dwell is more than 0 and at most ${TYPED_MAX_DWELL_S} seconds.`, 'Type G4 P1 to wait one second.');
  } else if (words.P !== undefined) {
    return refuse('P is used only with G4 (dwell) in a typed move.');
  }
  if (motion === 0 || motion === 1) {
    if (!has(AXES)) return refuse(`G${motion} needs at least one axis, such as X10.`);
    if (has([...ARC, 'R'])) return refuse('I, J, K and R are used only with G2 and G3.');
  }
  if (motion === 2 || motion === 3) {
    if (gcodes.includes(53)) return refuse('G53 works only with G0 or G1.');
    const centre = has(ARC);
    if (centre === (words.R !== undefined)) return refuse('An arc needs either I, J or K, or R.', 'Type for example G2 X10 Y0 I5 J0 F300.');
  }
  const line = parts.join(' ');
  if (line.length > TYPED_MAX_CHARS) return refuse(`That move is longer than ${TYPED_MAX_CHARS} characters.`, 'Shorten it, or open it as a job.');
  return { ok: true, value: { line, motion, gcodes, words } };
}
