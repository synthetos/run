import { describe, expect, it } from 'vitest';
import { ByteFaults, NO_FAULTS, validateFaultPlan, type Fault, type FaultPlan } from '../src/faults.ts';
import { SeededRng } from '../src/rng.ts';

const bad = (f: unknown): FaultPlan => ({ faults: [f as Fault] });

describe('validateFaultPlan', () => {
  it('accepts every kind RUN_PLAN §8.1 lists and freezes the result', () => {
    const plan = validateFaultPlan({
      faults: [
        { kind: 'drop', direction: 'toDevice', select: { at: [1, 2] } },
        { kind: 'corrupt', direction: 'toHost', select: { probability: 0.1, fromByte: 5, toByte: 10 }, xor: 0x20 },
        { kind: 'duplicate', direction: 'toHost', select: { probability: 0.01 } },
        { kind: 'latency', direction: 'toHost', fromMs: 0, toMs: 100, extraMs: 50 },
        { kind: 'disconnect', direction: 'toDevice', atByte: 100 },
        { kind: 'alarm', atMs: 10, cause: 'limitSwitch' },
        { kind: 'suppressReports', fromMs: 0, toMs: 5 },
        { kind: 'boardReset', atMs: 7 },
        { kind: 'xoffBurst', atMs: 1, holdMs: 2, repeat: 3, everyMs: 10 },
        { kind: 'bannerDelay', extraMs: 500 },
        { kind: 'ringOverrun', atByte: 3, count: 4 },
      ],
    });
    expect(plan.faults).toHaveLength(11);
    expect(Object.isFrozen(plan.faults)).toBe(true);
    expect(Object.isFrozen(plan.faults[0])).toBe(true);
    expect(validateFaultPlan(NO_FAULTS).faults).toEqual([]);
  });

  it('refuses every malformed field rather than silently ignoring it', () => {
    const cases: unknown[] = [
      { kind: 'nope' },
      { kind: 'drop', direction: 'sideways', select: { at: [1] } },
      { kind: 'drop', direction: 'toHost', select: { at: [] } },
      { kind: 'drop', direction: 'toHost', select: { at: [-1] } },
      { kind: 'drop', direction: 'toHost', select: { probability: 2 } },
      { kind: 'drop', direction: 'toHost', select: { probability: 0.5, fromByte: 5, toByte: 5 } },
      { kind: 'drop', direction: 'toHost', select: null },
      { kind: 'corrupt', direction: 'toHost', select: { at: [1] }, xor: 0 },
      { kind: 'latency', direction: 'toHost', fromMs: 10, toMs: 5, extraMs: 1 },
      { kind: 'latency', direction: 'toHost', fromMs: 0, toMs: 5, extraMs: -1 },
      { kind: 'disconnect', direction: 'toHost', atByte: 1.5 },
      { kind: 'alarm', atMs: -1, cause: 'limitSwitch' },
      { kind: 'alarm', atMs: 1, cause: 'estop' },
      { kind: 'suppressReports', fromMs: 5, toMs: 5 },
      { kind: 'boardReset', atMs: Number.NaN },
      { kind: 'xoffBurst', atMs: 1, holdMs: 0 },
      { kind: 'xoffBurst', atMs: 1, holdMs: 5, repeat: 2, everyMs: 4 },
      { kind: 'xoffBurst', atMs: 1, holdMs: 5, repeat: 0 },
      { kind: 'bannerDelay', extraMs: -3 },
      { kind: 'ringOverrun', atByte: 1, count: 0 },
    ];
    for (const c of cases) expect(() => validateFaultPlan(bad(c)), JSON.stringify(c)).toThrow();
    expect(() => validateFaultPlan(null as unknown as FaultPlan)).toThrow(TypeError);
  });
});

describe('ByteFaults', () => {
  it('drops, corrupts and duplicates exactly the selected bytes of its own direction', () => {
    const plan = validateFaultPlan({
      faults: [
        { kind: 'drop', direction: 'toDevice', select: { at: [1] } },
        { kind: 'corrupt', direction: 'toDevice', select: { at: [2] }, xor: 0x01 },
        { kind: 'duplicate', direction: 'toDevice', select: { at: [3] } },
        { kind: 'drop', direction: 'toHost', select: { at: [0, 1, 2, 3] } },
      ],
    });
    const f = new ByteFaults(plan, 'toDevice', new SeededRng(1));
    const fates = [0x41, 0x42, 0x43, 0x44, 0x45].map((b) => f.next(b));
    expect(fates.map((x) => x.deliver)).toEqual([[0x41], [], [0x42], [0x44, 0x44], [0x45]]);
    expect(fates[1]?.notes[0]).toMatch(/drop toDevice byte 1/);
    expect(f.index).toBe(5);
  });

  it('marks ring-overrun bytes, disconnects before the chosen byte, and adds latency in its window', () => {
    const plan = validateFaultPlan({
      faults: [
        { kind: 'ringOverrun', atByte: 1, count: 2 },
        { kind: 'disconnect', direction: 'toDevice', atByte: 4 },
        { kind: 'latency', direction: 'toDevice', fromMs: 10, toMs: 20, extraMs: 7 },
      ],
    });
    const f = new ByteFaults(plan, 'toDevice', new SeededRng(1));
    const fates = [0, 1, 2, 3, 4].map((b) => f.next(b));
    expect(fates.map((x) => x.overrun)).toEqual([false, true, true, false, false]);
    expect(fates.map((x) => x.disconnect)).toEqual([false, false, false, false, true]);
    expect(fates[4]?.deliver).toEqual([]);
    expect([f.latencyAt(5), f.latencyAt(10), f.latencyAt(19.9), f.latencyAt(20)]).toEqual([0, 7, 7, 0]);
    const host = new ByteFaults(plan, 'toHost', new SeededRng(1));
    expect(host.next(9).overrun).toBe(false); // ring overrun is a device-side receive fault only
  });

  it('draws probabilities from the seeded RNG: same seed, same victims; another seed, others', () => {
    const plan = validateFaultPlan({ faults: [{ kind: 'drop', direction: 'toHost', select: { probability: 0.2 } }] });
    const victims = (seed: number): number[] => {
      const f = new ByteFaults(plan, 'toHost', new SeededRng(seed));
      return Array.from({ length: 200 }, (_, i) => i).filter((i) => f.next(i).deliver.length === 0);
    };
    expect(victims(5)).toEqual(victims(5));
    expect(victims(5)).not.toEqual(victims(6));
    expect(victims(5).length).toBeGreaterThan(20);
  });

  it('a probability window does not consume RNG draws outside it', () => {
    const windowed = validateFaultPlan({ faults: [{ kind: 'corrupt', direction: 'toHost', select: { probability: 1, fromByte: 10, toByte: 12 } }] });
    const f = new ByteFaults(windowed, 'toHost', new SeededRng(9));
    const out = Array.from({ length: 14 }, () => f.next(0)).map((x) => x.deliver[0]);
    expect(out.slice(0, 10).every((b) => b === 0)).toBe(true);
    expect(out.slice(10, 12).every((b) => b !== 0)).toBe(true); // one bit flipped
    expect(out.slice(12)).toEqual([0, 0]);
  });
});
