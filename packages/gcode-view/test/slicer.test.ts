import { describe, expect, it } from 'vitest';
import { DEFAULT_SEGMENTS_PER_CHUNK, chunks, runSliced } from '../src/index.ts';
import { bigList } from './helpers.ts';

/** Steps that each advance a fake clock by `cost` ms. */
function costly(n: number, cost: number, clock: { t: number }): Iterator<unknown> {
  let i = 0;
  return { next: () => (i++ < n ? (clock.t += cost, { done: false, value: i }) : { done: true, value: undefined }) };
}

describe('time slicing', () => {
  it('yields to the host whenever the budget is spent, and runs every step', async () => {
    const clock = { t: 0 };
    const slices: number[] = [];
    let last = 0;
    const done = await runSliced(costly(20, 5, clock), {
      budgetMs: 12,
      now: () => clock.t,
      yieldToHost: async () => {},
      onSlice: (n) => { slices.push(n - last); last = n; },
    });
    expect(done).toBe(20);
    expect(Math.max(...slices)).toBe(3);
    expect(slices.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it('cancel: an abort stops before the next step and rejects with AbortError', async () => {
    const clock = { t: 0 };
    const controller = new AbortController();
    let yields = 0;
    const p = runSliced(costly(1000, 5, clock), {
      budgetMs: 12,
      now: () => clock.t,
      signal: controller.signal,
      yieldToHost: async () => { if (++yields === 2) controller.abort(); },
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(clock.t).toBeLessThanOrEqual(5 * 3 * 3);
  });

  it('old P1-04 acceptance: 1M lines of geometry build with no main-thread slice over 50 ms (real clock)', async () => {
    const list = bigList(1_000_000);
    let longest = 0;
    let sliceStart = performance.now();
    const n = await runSliced(chunks(list, DEFAULT_SEGMENTS_PER_CHUNK), {
      yieldToHost: async () => {
        longest = Math.max(longest, performance.now() - sliceStart);
        await new Promise((r) => setTimeout(r, 0));
        sliceStart = performance.now();
      },
    });
    longest = Math.max(longest, performance.now() - sliceStart);
    expect(n).toBe(Math.ceil((1_000_000 - Math.ceil(1_000_000 / 97)) / DEFAULT_SEGMENTS_PER_CHUNK));
    expect(longest).toBeLessThan(50);
  });
});
