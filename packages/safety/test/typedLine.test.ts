/**
 * H91: the closed grammar of a typed move (typedLine.ts), shared by the session and the terminal page. Exactly one of G0..G4, only the modal words the design
 * allows, canonical text, and the motion cap.
 */
import { describe, expect, it } from 'vitest';
import { TYPED_MAX_CHARS, TYPED_MAX_DWELL_S, parseTypedLine } from '../src/index.ts';

function line(input: unknown): string {
  const r = parseTypedLine(input);
  if (!r.ok) throw new Error(`${String(input)}: ${r.reason}`);
  return r.value.line;
}

function reason(input: unknown): string {
  const r = parseTypedLine(input);
  if (r.ok) throw new Error(`${String(input)} passed`);
  return r.reason;
}

describe('typed moves the grammar accepts, in canonical form', () => {
  it.each([
    ['g0x10', 'G0 X10'],
    ['G00 X+10.50 Y-.5', 'G0 X10.5 Y-0.5'],
    ['G1 X-0 F500', 'G1 X0 F500'],
    ['G21 G90 G54 G1 Z-1.25 F100', 'G21 G90 G54 G1 Z-1.25 F100'],
    ['G91 G0 A90 B1 C2', 'G91 G0 A90 B1 C2'],
    ['G53 G0 Z-5', 'G53 G0 Z-5'],
    ['G17 G2 X10 Y0 I5 J0 F300', 'G17 G2 X10 Y0 I5 J0 F300'],
    ['G18 G3 X10 Z0 R5', 'G18 G3 X10 Z0 R5'],
    ['G19 G2 K1', 'G19 G2 K1'],
    ['G20 G4 P0.5', 'G20 G4 P0.5'],
    ['G1.0 X1 F1', 'G1 X1 F1'],
    ['G4 P5.', 'G4 P5'],
  ])('%s → %s', (input, expected) => {
    expect(line(input)).toBe(expected);
  });

  it('keeps the motion, the G words and the other words', () => {
    expect(parseTypedLine('G91 G1 X2 F600')).toEqual({ ok: true, value: { line: 'G91 G1 X2 F600', motion: 1, gcodes: [91, 1], words: { X: 2, F: 600 } } });
  });
});

describe('typed lines the grammar refuses, with a reason', () => {
  it.each([
    [42, 'A typed move is one line of text.'],
    ['G0 X1\n', 'That line has a character the board cannot take.'],
    ['G0 X1 é', 'That line has a character the board cannot take.'],
    ['   ', 'Nothing to send.'],
    ['G0 X1 (note)', '"(note)" is not a G-code word.'],
    ['!', '"!" is not a G-code word.'],
    ['G0 X1 M3', 'M words are not part of a typed move.'],
    ['G0 X1 N10', 'N words are not part of a typed move.'],
    ['G0 X1.23456', 'X1.23456 is not a number run accepts here.'],
    ['G0 X123456', 'X123456 is not a number run accepts here.'],
    ['G0 X', 'X is not a number run accepts here.'],
    ['G28 X0', 'G28 is not part of a typed move.'],
    ['G91.1 G0 X1', 'G91.1 is not part of a typed move.'],
    ['G0 X1 X2', 'X is in that line twice.'],
    ['G90 X1', 'A typed move needs one of G0, G1, G2, G3 or G4.'],
    ['G0 G1 X1', 'Only one of G0, G1, G2, G3 or G4 per line.'],
    ['G90 G90 G0 X1', 'A G word is in that line twice.'],
    ['G90 G91 G0 X1', 'G90 and G91 cannot be in one line.'],
    ['G53 G54 G0 X1', 'G53 and G54 cannot be in one line.'],
    ['G1 X1 F0', 'A feed must be more than 0.'],
    ['G1 X1 F-5', 'A feed must be more than 0.'],
    ['G4', 'A dwell is G4 P<seconds>, with no other words.'],
    ['G4 P1 F100', 'A dwell is G4 P<seconds>, with no other words.'],
    ['G53 G4 P1', 'A dwell is G4 P<seconds>, with no other words.'],
    ['G4 P0', `A typed dwell is more than 0 and at most ${TYPED_MAX_DWELL_S} seconds.`],
    [`G4 P${TYPED_MAX_DWELL_S + 1}`, `A typed dwell is more than 0 and at most ${TYPED_MAX_DWELL_S} seconds.`],
    ['G0 X1 P2', 'P is used only with G4 (dwell) in a typed move.'],
    ['G0 F100', 'G0 needs at least one axis, such as X10.'],
    ['G1 X1 R2 F100', 'I, J, K and R are used only with G2 and G3.'],
    ['G53 G2 X1 I1', 'G53 works only with G0 or G1.'],
    ['G2 X1 F100', 'An arc needs either I, J or K, or R.'],
    ['G2 X1 I1 R1 F100', 'An arc needs either I, J or K, or R.'],
  ])('%s', (input, expected) => {
    expect(reason(input)).toBe(expected);
  });

  it('M, S and T words point to the buttons', () => {
    for (const word of ['M3', 'S1000', 'T1']) {
      const r = parseTypedLine(`G0 X1 ${word}`);
      expect(r).toMatchObject({ ok: false, remedy: 'Use the matching button instead.' });
    }
  });

  it('a line longer than the motion cap is refused', () => {
    const long = 'G21 G90 G54 G1 X10000.1234 Y10000.1234 Z10000.1234 A10000.1234 F500';
    expect(long.length).toBeGreaterThan(TYPED_MAX_CHARS);
    expect(parseTypedLine(long)).toMatchObject({ ok: false, reason: `That move is longer than ${TYPED_MAX_CHARS} characters.`, remedy: 'Shorten it, or open it as a job.' });
  });
});
