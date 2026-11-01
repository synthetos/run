import { describe, expect, it } from 'vitest';
import { VirtualClock, settle } from '../src/clock.ts';

describe('VirtualClock', () => {
  it('runs timers in due-time order, ties in scheduling order, each at its own time', () => {
    const clock = new VirtualClock();
    const log: string[] = [];
    clock.setTimeout(() => log.push(`b@${clock.now()}`), 20);
    clock.setTimeout(() => log.push(`a@${clock.now()}`), 10);
    clock.setTimeout(() => log.push(`c@${clock.now()}`), 20);
    clock.advance(15);
    expect(log).toEqual(['a@10']);
    expect(clock.now()).toBe(15);
    clock.advance(100);
    expect(log).toEqual(['a@10', 'b@20', 'c@20']);
    expect(clock.now()).toBe(115);
  });

  it('runs timers scheduled from a callback within the same advance when due', () => {
    const clock = new VirtualClock();
    const log: number[] = [];
    clock.setTimeout(() => {
      log.push(clock.now());
      clock.setTimeout(() => log.push(clock.now()), 5);
      clock.setTimeout(() => log.push(clock.now()), 0);
    }, 10);
    clock.advance(12);
    expect(log).toEqual([10, 10]);
    clock.advance(3);
    expect(log).toEqual([10, 10, 15]);
  });

  it('cancels timers', () => {
    const clock = new VirtualClock();
    let ran = false;
    const id = clock.setTimeout(() => (ran = true), 5);
    expect(clock.pending()).toBe(1);
    clock.clearTimeout(id);
    expect(clock.pending()).toBe(0);
    expect(clock.nextAt()).toBeUndefined();
    clock.advance(10);
    expect(ran).toBe(false);
  });

  it('refuses bad input and stops a runaway timer loop', () => {
    const clock = new VirtualClock({ maxCallbacksPerAdvance: 100 });
    expect(() => clock.setTimeout(() => undefined, -1)).toThrow(RangeError);
    expect(() => clock.setTimeout(() => undefined, Number.NaN)).toThrow(RangeError);
    expect(() => clock.advance(-1)).toThrow(RangeError);
    clock.advance(5);
    expect(() => clock.advanceTo(1)).toThrow(RangeError);
    expect(() => new VirtualClock({ start: -1 })).toThrow(RangeError);
    const loop = (): void => {
      clock.setTimeout(loop, 0);
    };
    loop();
    expect(() => clock.advance(1)).toThrow(/runaway/);
  });

  it('runUntil stops as soon as the predicate holds, or reports false at the limit', () => {
    const clock = new VirtualClock();
    let flag = false;
    clock.setTimeout(() => (flag = true), 42);
    expect(clock.runUntil(() => flag, 100)).toBe(true);
    expect(clock.now()).toBe(42);
    expect(clock.runUntil(() => false, 10)).toBe(false);
    expect(clock.now()).toBe(52);
    expect(() => clock.runUntil(() => true, 1, 0)).toThrow(RangeError);
  });

  it('advanceAsync lets promise consumers react at each timer before time moves on', async () => {
    const clock = new VirtualClock();
    const seen: number[] = [];
    let resolveNext: (() => void) | undefined;
    const waitTick = (): Promise<void> => new Promise((r) => (resolveNext = r));
    void (async () => {
      for (let i = 0; i < 2; i++) {
        await waitTick();
        seen.push(clock.now());
      }
    })();
    await settle();
    clock.setTimeout(() => resolveNext?.(), 10);
    clock.setTimeout(() => resolveNext?.(), 20);
    await clock.advanceAsync(30);
    expect(seen).toEqual([10, 20]);
    expect(clock.now()).toBe(30);
    await expect(clock.advanceAsync(-1)).rejects.toThrow(RangeError);
  });
});
