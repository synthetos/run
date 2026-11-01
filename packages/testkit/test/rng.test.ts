import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/rng.ts';

describe('SeededRng', () => {
  it('gives the same sequence for the same seed and a different one for another seed', () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    const c = new SeededRng(43);
    const sa = Array.from({ length: 16 }, () => a.nextU32());
    expect(Array.from({ length: 16 }, () => b.nextU32())).toEqual(sa);
    expect(Array.from({ length: 16 }, () => c.nextU32())).not.toEqual(sa);
  });

  it('is pinned: the first outputs of seed 1 never change (a change would alter every recorded fault run)', () => {
    const r = new SeededRng(1);
    expect([r.nextU32(), r.nextU32(), r.nextU32(), r.nextU32()]).toEqual([2442144158, 3238099751, 3819917871, 2104621829]);
  });

  it('keeps next(), int() and chance() in range', () => {
    const r = new SeededRng(7);
    let trues = 0;
    for (let i = 0; i < 10_000; i++) {
      const f = r.next();
      expect(f >= 0 && f < 1).toBe(true);
      const n = r.int(6);
      expect(Number.isInteger(n) && n >= 0 && n < 6).toBe(true);
      if (r.chance(0.25)) trues++;
    }
    expect(trues).toBeGreaterThan(2200);
    expect(trues).toBeLessThan(2800);
    expect(new SeededRng(3).chance(0)).toBe(false);
    expect(new SeededRng(3).chance(1)).toBe(true);
  });

  it('accepts large and negative safe-integer seeds and refuses others', () => {
    expect(new SeededRng(-5).nextU32()).not.toBe(new SeededRng(5).nextU32());
    expect(new SeededRng(2 ** 40).nextU32()).not.toBe(new SeededRng(0).nextU32());
    expect(() => new SeededRng(1.5)).toThrow(RangeError);
    expect(() => new SeededRng(2).int(0)).toThrow(RangeError);
    expect(() => new SeededRng(2).chance(1.5)).toThrow(RangeError);
  });
});
