/**
 * Word lexer for one line of job G-code, after comments are stripped
 * (SAFETY §4.7 step 6).
 *
 * It reads a line the way TinyG does: whitespace is ignored everywhere
 * (`X 1 0` is X10), letters are case-insensitive, and a word is a letter
 * followed by a decimal number (@cite EN gcode_parser.c `_normalize_gcode_block`,
 * `_get_next_gcode_word`). It is stricter than the firmware wherever the
 * firmware is lenient: there is no exponent (`E` is a word letter, E159), no
 * `inf`/`nan`/hex, and any character outside letters, digits, `+`, `-`, `.`,
 * space and tab is refused, because the firmware's normaliser once spliced
 * digits across such characters (E161, PN §9.3).
 */

export interface Word {
  /** Upper-case letter. */
  readonly letter: string;
  /** The number as written, whitespace removed (`-1.50`). */
  readonly text: string;
  readonly value: number;
  /** Index of the letter in the line. */
  readonly start: number;
  /** Index one past the last character of the number. */
  readonly end: number;
}

export type LexResult =
  | { readonly kind: 'ok'; readonly words: readonly Word[] }
  | { readonly kind: 'invalidCharacter'; readonly char: string }
  | { readonly kind: 'malformed'; readonly detail: string };

const ALLOWED = /^[A-Za-z0-9+\-. \t]$/;

/** Lexes a comment-free line into words. */
export function lexLine(line: string): LexResult {
  // Keep only significant characters, remembering where each came from.
  const chars: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (!ALLOWED.test(c)) return { kind: 'invalidCharacter', char: c };
    if (c === ' ' || c === '\t') continue;
    chars.push(c.toUpperCase());
    at.push(i);
  }
  const words: Word[] = [];
  let i = 0;
  while (i < chars.length) {
    const letter = chars[i] as string;
    if (!/^[A-Z]$/.test(letter)) return { kind: 'malformed', detail: `"${letter}" where a word letter was expected` };
    let j = i + 1;
    let text = '';
    if (chars[j] === '+' || chars[j] === '-') text += chars[j++];
    let digits = 0;
    while (j < chars.length && /^[0-9]$/.test(chars[j] as string)) {
      text += chars[j++];
      digits++;
    }
    if (chars[j] === '.') {
      text += chars[j++];
      while (j < chars.length && /^[0-9]$/.test(chars[j] as string)) {
        text += chars[j++];
        digits++;
      }
    }
    if (digits === 0) return { kind: 'malformed', detail: `${letter} has no number` };
    if (!Number.isFinite(Number(text))) return { kind: 'malformed', detail: `${letter} is out of range` };
    words.push({ letter, text, value: Number(text), start: at[i] as number, end: (at[j - 1] as number) + 1 });
    i = j;
  }
  return { kind: 'ok', words };
}

/**
 * The canonical code for a G or M word: the integer part without leading
 * zeros and, if the fraction has a non-zero digit, the fraction without
 * trailing zeros (`G01` → `G1`, `G1.0` → `G1`, `G92.10` → `G92.1`). This is
 * how EN counts significant decimals (@cite EN gcode_parser.c `_get_next_gcode_word`, E150).
 * A negative or signed code returns undefined (never supported).
 */
export function canonicalCode(word: Word): string | undefined {
  if (word.text.startsWith('-') || word.text.startsWith('+')) return undefined;
  const [intPart = '', fracPart = ''] = word.text.split('.');
  const int = intPart.replace(/^0+(?=\d)/, '') || '0';
  const frac = fracPart.replace(/0+$/, '');
  return frac === '' ? `${word.letter}${int}` : `${word.letter}${int}.${frac}`;
}

/** Removes the given words from the line text, with the whitespace after each, and trims the result. */
export function removeWords(line: string, words: readonly Word[]): string {
  if (words.length === 0) return line;
  const sorted = [...words].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const w of sorted) {
    out += line.slice(pos, w.start);
    pos = w.end;
    while (line[pos] === ' ' || line[pos] === '\t') pos++;
  }
  out += line.slice(pos);
  return out.replace(/^[ \t]+|[ \t]+$/g, '');
}
