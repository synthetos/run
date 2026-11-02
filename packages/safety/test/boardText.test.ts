/** ROADMAP P1-07, SAFETY T-S85: serial-port strings are bidi- and control-sanitised before they are shown. */
import { describe, expect, it } from 'vitest';
import { BOARD_TEXT_MAX, boardText } from '../src/index.ts';

describe('boardText (T-S85)', () => {
  it('keeps ordinary text, including non-Latin scripts', () => {
    expect(boardText('SIM-EN-0001')).toBe('SIM-EN-0001');
    expect(boardText('מכונה 1')).toBe('מכונה 1');
  });

  it('replaces every bidi override, embedding, isolate and mark', () => {
    for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c]) {
      expect(boardText(`a${String.fromCodePoint(cp)}b${String.fromCodePoint(cp)}c`)).toBe('a\ufffdb\ufffdc');
    }
    // A board id that would display as "1000-NE-MIS" reversed.
    expect(boardText('\u202eSIM-EN-0001')).toBe('\ufffdSIM-EN-0001');
  });

  it('replaces C0, C1, DEL and the line separators', () => {
    expect(boardText('a\nb\rc\td\u0000e\u001bf\u007fg\u0085h\u009fi\u2028j\u2029k')).toBe('a\ufffdb\ufffdc\ufffdd\ufffde\ufffdf\ufffdg\ufffdh\ufffdi\ufffdj\ufffdk');
  });

  it('replaces zero-width and other invisible format characters, so two ids never look the same (HIL-1.4)', () => {
    expect(boardText('ABC\u200b123')).toBe('ABC\ufffd123');
    expect(boardText('\ufeffABC123')).toBe('\ufffdABC123');
    for (const c of ['\u200b', '\u200c', '\u200d', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064', '\ufeff', '\u00ad', '\u180e']) {
      expect(boardText(`A${c}B`), c.codePointAt(0)?.toString(16)).toBe('A\ufffdB');
    }
    expect(boardText('ABC\u200b123')).not.toBe(boardText('ABC123'));
  });

  it('caps the length in code points', () => {
    const long = 'x'.repeat(BOARD_TEXT_MAX + 5);
    expect(boardText(long)).toBe(`${'x'.repeat(BOARD_TEXT_MAX)}\u2026`);
    expect(boardText('x'.repeat(BOARD_TEXT_MAX))).toBe('x'.repeat(BOARD_TEXT_MAX));
    expect(boardText('😀😀😀', 2)).toBe('😀😀\u2026');
  });

  it('shows a non-string as empty, never throwing', () => {
    expect(boardText(undefined)).toBe('');
    expect(boardText(42)).toBe('');
    expect(boardText(null)).toBe('');
  });
});
