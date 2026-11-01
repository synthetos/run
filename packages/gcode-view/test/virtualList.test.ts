import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_SCROLL_HEIGHT, listWindow, scrollTopFor } from '../src/index.ts';

describe('virtualised list window', () => {
  it('renders only the rows in view plus overscan', () => {
    const w = listWindow({ count: 10_000, rowHeight: 20, scrollTop: 2000, viewportHeight: 400, overscan: 5 });
    expect(w).toEqual({ first: 95, end: 125, offsetTop: 1900, totalHeight: 200_000 });
  });

  it('every row of a list taller than the browser cap is reachable, and the window is bounded (property)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: 0, max: 4_999_999 }), (count, index) => {
      fc.pre(index < count);
      const input = { count, rowHeight: 18, viewportHeight: 600 };
      const top = scrollTopFor(index, input);
      const w = listWindow({ ...input, scrollTop: top });
      expect(w.totalHeight).toBeLessThanOrEqual(MAX_SCROLL_HEIGHT);
      expect(index).toBeGreaterThanOrEqual(w.first);
      expect(index).toBeLessThan(w.end);
      expect(w.end - w.first).toBeLessThanOrEqual(Math.ceil(600 / 18) + 1 + 20);
    }));
  });

  it('refuses a non-positive row height', () => {
    expect(() => listWindow({ count: 1, rowHeight: 0, scrollTop: 0, viewportHeight: 1 })).toThrow(RangeError);
  });
});
