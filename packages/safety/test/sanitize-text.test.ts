/** Text-level steps and the word lexer (SAFETY §4.7 steps 1–6). */
import { describe, expect, it } from 'vitest';
import { canonicalCode, lexLine, removeWords, type Word } from '../src/sanitize/lex.ts';
import { applyCommentRule, findControlByte, isTapeMarker, splitLines, trimLine } from '../src/sanitize/text.ts';

describe('splitLines', () => {
  it('CRLF, LFCR, CR and LF each end one line; a final terminator does not add a line', () => {
    expect(splitLines('a\r\nb\n\rc\rd\ne')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(splitLines('a\n')).toEqual(['a']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(splitLines('')).toEqual([]);
  });

  it('an iterable chunk always ends a line, once', () => {
    expect(splitLines(['a', 'b\n', '', 'c\r\nd'])).toEqual(['a', 'b', '', 'c', 'd']);
  });
});

describe('comments', () => {
  it('rejects text after a comment and leading comments before code', () => {
    expect(applyCommentRule('G0 (c) X1', true)).toEqual({ kind: 'textAfterComment' });
    expect(applyCommentRule('(c)G0', true)).toEqual({ kind: 'textAfterComment' });
    expect(applyCommentRule('G0 X1 (c) \t', true)).toEqual({ kind: 'ok', code: 'G0 X1  \t', stripped: true });
    expect(applyCommentRule('G0 X1', true)).toEqual({ kind: 'ok', code: 'G0 X1', stripped: false });
    expect(applyCommentRule('G0 (a', true)).toEqual({ kind: 'unclosed' });
    expect(applyCommentRule('G0 (a) (b', true)).toEqual({ kind: 'unclosed' });
  });

  it('control bytes, trimming and tape markers', () => {
    expect(findControlByte('G0\tX1')).toBeUndefined();
    expect(findControlByte('G0\x18')).toBe(0x18);
    expect(trimLine(' \t G0 \t')).toBe('G0');
    expect(isTapeMarker('%%')).toBe(true);
    expect(isTapeMarker('%G0')).toBe(false);
  });
});

describe('lexLine', () => {
  it('reads words the way TinyG does: whitespace anywhere, any case', () => {
    const r = lexLine('g 0 x 1 0 Y-.5 z+2.');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.words.map((w) => [w.letter, w.text, w.value])).toEqual([
      ['G', '0', 0],
      ['X', '10', 10],
      ['Y', '-.5', -0.5],
      ['Z', '+2.', 2],
    ]);
    // Spans cover the word as written, spaces inside included.
    expect('g 0 x 1 0'.slice(r.words[1]?.start, r.words[1]?.end)).toBe('x 1 0');
  });

  it('G0X10 is G0 then X10, never hexadecimal', () => {
    const r = lexLine('G0X10');
    expect(r.kind === 'ok' && r.words.map((w) => `${w.letter}${w.value}`)).toEqual(['G0', 'X10']);
  });

  it('refuses what is not a word', () => {
    expect(lexLine('X')).toEqual({ kind: 'malformed', detail: 'X has no number' });
    expect(lexLine('X-')).toEqual({ kind: 'malformed', detail: 'X has no number' });
    expect(lexLine('5')).toEqual({ kind: 'malformed', detail: '"5" where a word letter was expected' });
    expect(lexLine('XINF').kind).toBe('malformed');
    expect(lexLine('X1e5').kind).toBe('ok'); // E is a word letter; the dialect decides about it
    expect(lexLine('X1#')).toEqual({ kind: 'invalidCharacter', char: '#' });
  });
});

describe('canonicalCode and removeWords', () => {
  const w = (letter: string, text: string): Word => ({ letter, text, value: Number(text), start: 0, end: 0 });
  it('drops leading zeros and trailing fraction zeros; signs are never valid codes', () => {
    expect(canonicalCode(w('G', '01'))).toBe('G1');
    expect(canonicalCode(w('G', '1.0'))).toBe('G1');
    expect(canonicalCode(w('G', '92.10'))).toBe('G92.1');
    expect(canonicalCode(w('G', '.5'))).toBe('G0.5');
    expect(canonicalCode(w('G', '00'))).toBe('G0');
    expect(canonicalCode(w('M', '-3'))).toBeUndefined();
    expect(canonicalCode(w('M', '+3'))).toBeUndefined();
  });

  it('removes words and the whitespace after them', () => {
    const line = 'N10  G0 N20 X1';
    const r = lexLine(line);
    if (r.kind !== 'ok') throw new Error('lex');
    expect(removeWords(line, r.words.filter((x) => x.letter === 'N'))).toBe('G0 X1');
    expect(removeWords(line, [])).toBe(line);
  });
});
