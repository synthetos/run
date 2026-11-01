/**
 * overrunBound (ROADMAP P0-10, SAFETY §4.3 "Overrun display", H1): the
 * distance is a true upper bound (the sum of every queued length), the time
 * an estimate, and anything it cannot read makes it Infinity, never less.
 */
import fc from 'fast-check';
import { TINYG_EN } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { overrunBound } from '../src/index.ts';
import { START, run } from './sanitizeHelpers.ts';

describe('overrunBound', () => {
  it('is zero for an empty queue and ignores lines that do not move', () => {
    expect(overrunBound([])).toEqual({ mmUpperBound: 0, secondsEstimate: 0 });
    expect(overrunBound([{ motion: null }, { motion: null }])).toEqual({ mmUpperBound: 0, secondsEstimate: 0 });
  });

  it('sums every queued length and modelled time, arcs included', () => {
    const r = run('G0 X10\nM3 S1000\nG1 Y10 F600\nG2 X20 Y10 I5 J0\nM5\n', TINYG_EN, { start: START });
    const b = overrunBound(r.lines);
    expect(b.mmUpperBound).toBeCloseTo(10 + 10 + 5 * Math.PI, 9);
    expect(b.secondsEstimate).toBeCloseTo(r.lines.reduce((s, l) => s + (l.motion?.seconds ?? 0), 0), 12);
  });

  it('is never below the length of any queued move, and grows with every move (fast-check)', () => {
    const move = fc.record({ lengthMm: fc.double({ min: 0, max: 1e4, noNaN: true }), seconds: fc.double({ min: 0, max: 20, noNaN: true }) });
    fc.assert(
      fc.property(fc.array(fc.option(move, { nil: null })), (moves) => {
        const q = moves.map((motion) => ({ motion }));
        const b = overrunBound(q);
        for (const m of moves) if (m !== null) expect(b.mmUpperBound).toBeGreaterThanOrEqual(m.lengthMm);
        const total = moves.reduce((s, m) => s + (m?.lengthMm ?? 0), 0);
        expect(b.mmUpperBound).toBeCloseTo(total, 6);
      }),
    );
  });

  it('fails safe: a length or time that is not a finite, non-negative number makes that half Infinity', () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(overrunBound([{ motion: { lengthMm: 1, seconds: 1 } }, { motion: { lengthMm: bad, seconds: 1 } }])).toEqual({
        mmUpperBound: Number.POSITIVE_INFINITY,
        secondsEstimate: 2,
      });
      expect(overrunBound([{ motion: { lengthMm: 1, seconds: bad } }]).secondsEstimate).toBe(Number.POSITIVE_INFINITY);
    }
    // Once unknown, a later valid move does not bring it back.
    expect(overrunBound([{ motion: { lengthMm: Number.NaN, seconds: 1 } }, { motion: { lengthMm: 1, seconds: 1 } }]).mmUpperBound).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
