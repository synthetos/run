import { expect, it } from 'vitest';
import { feedLimitWindow, foldFeedLimit } from '../src/session/feedLimit.ts';
const fs = { v: 2, e: 1, q: 2, c: [0, 1, 2, 3, 4, 5, 6], ct: 100, cd: 1, future: 'ignored' };
const fg = { e: 1, q: 2, g: [10, 20, 2], b: [[1, 2], [3, 4], [5, 6]], future: 'ignored' };
it('fs v2 keeps command boundaries, fg matches only the current e/q and duplicates cannot replace it', () => {
  const s = foldFeedLimit(feedLimitWindow(2), 'fs', fs, false);
  expect(s.last?.c).toEqual(fs.c);
  for (const wrong of [{ ...fg, q: 1 }, { ...fg, q: 3 }, { ...fg, e: 0 }, { ...fg, g: [-1, 2, 3] }]) expect(foldFeedLimit(s, 'fg', wrong, false)).toBe(s);
  const pair = foldFeedLimit(s, 'fg', { ...fg, x: 1 }, false);
  expect(pair.gaps).toMatchObject({ e: 1, q: 2, short: true, g: [10, 20, 2] });
  expect(pair.short).toBe(false);
  expect(foldFeedLimit(pair, 'fg', fg, false)).toBe(pair);
  expect(foldFeedLimit(pair, 'fs', { ...fs, q: 3 }, false).gaps).toBeNull();
  expect(foldFeedLimit(pair, 'fs', { ...fs, e: 2, q: 1 }, false).gaps).toBeNull();
});
it('fl supply class names the last line, missing/unknown g is not a diagnosis, legacy v1 stays six counters', () => {
  let s = feedLimitWindow(2);
  s = foldFeedLimit(s, 'fl', { k: 0, m: 0, p: null, n: 123, g: 2, future: true }, false);
  expect(s.move).toMatchObject({ g: 2, n: 123 });
  for (const body of [{ k: 0, g: 9 }, { k: 0 }]) expect(foldFeedLimit(s, 'fl', body, false).move?.g).toBeUndefined();
  expect(foldFeedLimit(s, 'fs', { ...fs, v: 1 }, false).last?.c).toHaveLength(6);
  expect(foldFeedLimit(s, 'fs', { ...fs, c: [1, 2] }, false)).toBe(s);
});
