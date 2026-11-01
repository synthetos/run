/**
 * G-code block normalising and word reading, as each firmware does it.
 *
 * The two builds differ in ways run's safety rules depend on, so the
 * differences are explicit options rather than one "correct" parser:
 * - EN keeps any non-alphanumeric character so the line fails as malformed
 *   (E161), and a `%` that is not alone on the line stays in it and is
 *   rejected (@cite EN gcode_parser.c:143-156).
 * - TG silently deletes every character other than letters, digits, `-` and
 *   `.` (@cite TG gcode_parser.c:131-138), so `X0.001*9` becomes `X0.0019`.
 * - EN reads `E` as a word letter, never as an exponent (E159, @cite EN
 *   gcode_parser.c:238-248); TG's strtof takes it as an exponent
 *   (@cite TG gcode_parser.c:190-196).
 * Comments start at `(` or `;` and end the block on both (text after a
 * comment is dropped, PN §9.3).
 */

import '../marker.ts';
export interface GcodeSyntax {
  /** EN E161: keep unknown characters (the line then fails); TG: delete them. */
  readonly keepInvalidChars: boolean;
  /** Characters kept besides letters and digits. EN `-.+`, TG `-.`. */
  readonly signChars: string;
  /** EN E159: `E` is always a word letter. TG: strtof reads it as an exponent. */
  readonly exponentIsWord: boolean;
  /** EN: a lone `%` is the program delimiter and becomes an empty block. */
  readonly lonePercentIsDelimiter: boolean;
}

export interface Normalized {
  /** Upper-cased block without whitespace or comment. */
  readonly block: string;
  readonly comment: string | null;
  readonly blockDelete: boolean;
}

export function normalizeBlock(line: string, syntax: GcodeSyntax): Normalized {
  let out = '';
  let comment: string | null = null;
  const blockDelete = line.startsWith('/');
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (c === '(' || c === ';') {
      comment = line.slice(i + 1).replace(/\).*$/, '');
      break;
    }
    if (/[A-Za-z0-9]/.test(c) || syntax.signChars.includes(c)) out += c.toUpperCase();
    else if (syntax.keepInvalidChars && !/\s/.test(c)) out += c;
  }
  if (syntax.lonePercentIsDelimiter && out === '%') out = '';
  return { block: stripOctalZeros(out), comment, blockDelete };
}

/** Remove a leading zero after a non-digit before another digit, up to the first `.` (both builds). */
function stripOctalZeros(s: string): string {
  let r = s;
  let i = 0;
  while (i < r.length) {
    if (r[i] === '.') break;
    if (!/[0-9]/.test(r[i] as string) && r[i + 1] === '0' && /[0-9]/.test(r[i + 2] ?? '')) {
      r = r.slice(0, i + 1) + r.slice(i + 2);
      continue;
    }
    i++;
  }
  return r;
}

export interface Word {
  readonly letter: string;
  readonly value: number;
  /** Significant decimal digits as written, trailing zeros dropped (EN E150). */
  readonly decimals: number;
}

export type WordsResult =
  | { readonly ok: true; readonly words: readonly Word[] }
  | { readonly ok: false; readonly status: 'INVALID_OR_MALFORMED_COMMAND' | 'BAD_NUMBER_FORMAT' };

/** Read the words of a normalised block. The first bad word fails the whole block before anything runs. */
export function readWords(block: string, syntax: GcodeSyntax): WordsResult {
  const words: Word[] = [];
  let i = 0;
  while (i < block.length) {
    const letter = block[i] as string;
    if (!/[A-Z]/.test(letter)) return { ok: false, status: 'INVALID_OR_MALFORMED_COMMAND' };
    i++;
    // `G0X100` must not read `0X100` as hexadecimal (both builds trap it).
    if (block[i] === '0' && block[i + 1] === 'X') {
      words.push({ letter, value: 0, decimals: 0 });
      i++;
      continue;
    }
    const numberPattern = syntax.exponentIsWord ? /^[+-]?(\d+\.?\d*|\.\d+)/ : /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;
    const m = numberPattern.exec(block.slice(i));
    if (m === null) return { ok: false, status: 'BAD_NUMBER_FORMAT' };
    const textValue = m[0];
    i += textValue.length;
    const frac = /\.(\d*)/.exec(textValue)?.[1] ?? '';
    words.push({ letter, value: Number(textValue), decimals: frac.replace(/0+$/, '').length });
  }
  return { ok: true, words };
}
