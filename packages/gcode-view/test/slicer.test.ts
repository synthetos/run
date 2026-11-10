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

  // Wall clock: a slice that the host pre-empts (the other packages' tests run on the same cores under
  // `pnpm check`) reads long without the slicer having overrun its budget, so this gets two retries.
  // The fake-clock case above proves the budget itself; a slicer that never yields still fails all three.
  it('old P1-04 acceptance: 1M lines of geometry build with no main-thread slice over 50 ms (real clock)', { retry: 2 }, async () => {
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
  it('coarse scanning of a million sparse vertices also yields within 50 ms', { retry: 2 }, async () => {
    const list = bigList(1_000_000);
    list.kinds.fill(0); // All BREAK: the input scan still has to yield, with no output geometry.
    let longest = 0;
    let start = performance.now();
    const steps = await runSliced(chunks(list, 8192, { stride: 7 }), {
      budgetMs: 8,
      yieldToHost: async () => {
        longest = Math.max(longest, performance.now() - start);
        await new Promise(resolve => setTimeout(resolve, 0));
        start = performance.now();
      },
    });
    longest = Math.max(longest, performance.now() - start);
    expect(steps).toBeGreaterThan(100);
    expect(longest).toBeLessThan(50);
  });

});
