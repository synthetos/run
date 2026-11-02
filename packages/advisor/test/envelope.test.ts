/**
 * The §6.4 envelope: every rule, case by case, then as properties
 * (fast-check) over arbitrary and hostile inputs, then as a simulation of a
 * whole job's worth of proposals.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ENVELOPE,
  PROGRAMMED_STATE,
  decideOverride,
  forcedReason,
  superviseOverride,
  type EnvelopeDecision,
  type EnvelopeInput,
  type MachineCondition,
  type OverrideProposal,
  type OverrideState,
} from '../src/index.ts';

const OK: MachineCondition = { hold: false, alarm: false, fault: false, connected: true, orphanedMotion: false, toolChange: false, jobEnded: false };
const NOW = 100_000;

function input(overrides: Partial<EnvelopeInput> = {}): EnvelopeInput {
  return {
    programmed: { feed: 1500, rpm: 18_000 },
    limits: { spindleMinRpm: 6000, spindleMaxRpm: 24_000, toolMaxRpm: 30_000, axisMaxFeed: 5000 },
    state: PROGRAMMED_STATE,
    condition: OK,
    now: NOW,
    ...overrides,
  };
}

const state = (scale: number, changedAt: number | null = null, lastDirection: OverrideState['lastDirection'] = null): OverrideState => ({ scale, changedAt, lastDirection });

function expectKind<K extends EnvelopeDecision['kind']>(d: EnvelopeDecision, kind: K): Extract<EnvelopeDecision, { kind: K }> {
  expect(d.kind, JSON.stringify(d)).toBe(kind);
  return d as Extract<EnvelopeDecision, { kind: K }>;
}

describe('rule 1: forced to 100 % (and Auto off)', () => {
  const cases: [Partial<MachineCondition>, string][] = [
    [{ hold: true }, 'hold'],
    [{ alarm: true }, 'alarm'],
    [{ fault: true }, 'fault'],
    [{ connected: false }, 'connection-lost'],
    [{ orphanedMotion: true }, 'orphaned-motion'],
    [{ toolChange: true }, 'tool-change'],
    [{ jobEnded: true }, 'job-end'],
    [{ pausePressed: true }, 'pause'],
    [{ stopPressed: true }, 'stop'],
  ];

  it.each(cases)('%j resets with reason %s, whatever the proposal or the state', (condition, reason) => {
    for (const proposal of [{ scale: 0.5 }, { scale: Number.NaN }, {}, { feed: 1e9 }] as OverrideProposal[]) {
      for (const s of [PROGRAMMED_STATE, state(0.6, NOW - 10, 'down')]) {
        const d = expectKind(decideOverride(input({ condition: { ...OK, ...condition }, state: s }), proposal), 'reset');
        expect(d).toMatchObject({ scale: 1, reason, dropToOff: true, state: { scale: 1, changedAt: NOW, lastDirection: null } });
        expect(d.message).toMatch(/100 %/);
      }
    }
  });

  it('resets even when the programmed values and limits are nonsense', () => {
    const d = decideOverride(input({ condition: { ...OK, hold: true }, programmed: { feed: Number.NaN, rpm: -1 }, limits: { spindleMinRpm: -5, spindleMaxRpm: 0 } }), { scale: 0.9 });
    expect(d).toMatchObject({ kind: 'reset', reason: 'hold' });
  });

  it('treats an unknown condition as present (fail safe)', () => {
    const odd = [undefined, null, 1, 'yes', {}] as unknown as boolean[];
    for (const v of odd) {
      for (const key of ['hold', 'alarm', 'fault', 'orphanedMotion', 'toolChange', 'jobEnded'] as const) {
        expect(forcedReason({ ...OK, [key]: v })).not.toBeNull();
      }
      expect(forcedReason({ ...OK, connected: v })).toBe('connection-lost');
    }
    for (const v of [null, 1, 'yes', true] as unknown as boolean[]) {
      expect(forcedReason({ ...OK, pausePressed: v })).toBe('pause');
      expect(forcedReason({ ...OK, stopPressed: v })).toBe('stop');
    }
    expect(forcedReason({ ...OK, pausePressed: false, stopPressed: false })).toBeNull();
    expect(forcedReason(OK)).toBeNull();
    expect(forcedReason(null as unknown as MachineCondition)).toBe('connection-lost');
    expect(forcedReason('ok' as unknown as MachineCondition)).toBe('connection-lost');
  });

  it('resets on an override state that is not valid', () => {
    const bad: unknown[] = [
      null,
      'x',
      state(Number.NaN),
      state(0),
      state(-0.5),
      state(1.2),
      state(Number.POSITIVE_INFINITY),
      state(0.9, NOW + 1),
      state(0.9, Number.NaN),
      { scale: 0.9, changedAt: null, lastDirection: 'sideways' },
    ];
    for (const s of bad) expect(decideOverride(input({ state: s as OverrideState }), { scale: 0.9 })).toMatchObject({ kind: 'reset', reason: 'invalid-state' });
    const d = expectKind(decideOverride(input({ now: Number.NaN }), { scale: 0.9 }), 'reset');
    expect(d.state.changedAt).toBeNull();
  });

  it('resets when the scale in effect is below the spindle minimum (S changed under it)', () => {
    // S18000 with a 6000 minimum allows 1/3; 0.3 would run the spindle at 5400.
    expect(decideOverride(input({ state: state(0.3) }), { scale: 0.3 })).toMatchObject({ kind: 'reset', reason: 'invalid-state' });
  });

  it('superviseOverride resets on a condition with no proposal at all, and otherwise holds the scale in effect', () => {
    expect(superviseOverride(input({ condition: { ...OK, alarm: true }, state: state(0.7, 0, 'down') }))).toMatchObject({ kind: 'reset', reason: 'alarm' });
    expect(superviseOverride(input({ state: state(0.7, 0, 'down') }))).toMatchObject({ kind: 'hold', reason: 'no-change', scale: 0.7 });
    expect(superviseOverride(input({ state: null as unknown as OverrideState }))).toMatchObject({ kind: 'reset', reason: 'invalid-state' });
    expect(superviseOverride(null as unknown as EnvelopeInput)).toMatchObject({ kind: 'reset', reason: 'invalid-state', state: { changedAt: null } });
    expect(decideOverride(undefined as unknown as EnvelopeInput, { scale: 0.9 })).toMatchObject({ kind: 'reset', reason: 'invalid-state' });
  });
});

describe('rule 2: refusals', () => {
  it('refuses programmed values that are not finite positive numbers', () => {
    for (const bad of [Number.NaN, 0, -1500, Number.POSITIVE_INFINITY, '1500' as unknown as number]) {
      expect(decideOverride(input({ programmed: { feed: bad, rpm: 18_000 } }), { scale: 0.9 })).toMatchObject({ kind: 'refuse', reason: 'invalid-programmed', scale: 1 });
      expect(decideOverride(input({ programmed: { feed: 1500, rpm: bad } }), { scale: 0.9 })).toMatchObject({ kind: 'refuse', reason: 'invalid-programmed' });
    }
    expect(decideOverride(input({ programmed: null as unknown as EnvelopeInput['programmed'] }), { scale: 0.9 })).toMatchObject({ reason: 'invalid-programmed' });
  });

  it('refuses limits that are not valid', () => {
    const base = input().limits;
    const bad = [
      { ...base, spindleMinRpm: -1 },
      { ...base, spindleMinRpm: Number.NaN },
      { ...base, spindleMaxRpm: 0 },
      { ...base, spindleMaxRpm: Number.POSITIVE_INFINITY },
      { ...base, spindleMinRpm: 30_000 },
      { ...base, toolMaxRpm: 0 },
      { ...base, toolMaxRpm: Number.NaN },
      { ...base, axisMaxFeed: -1 },
      { ...base, axisMaxFeed: Number.NaN },
    ];
    for (const limits of bad) expect(decideOverride(input({ limits }), { scale: 0.9 })).toMatchObject({ kind: 'refuse', reason: 'invalid-limits' });
    expect(decideOverride(input({ limits: null as unknown as EnvelopeInput['limits'] }), { scale: 0.9 })).toMatchObject({ reason: 'invalid-limits' });
    const { toolMaxRpm: _t, axisMaxFeed: _a, ...minimal } = base;
    expect(decideOverride(input({ limits: minimal }), { scale: 0.9 }).kind).toBe('apply');
  });

  it('refuses a programmed S above the tool or spindle maximum, or below the spindle minimum, and an F above the axis maximum', () => {
    const lim = input().limits;
    expect(decideOverride(input({ programmed: { feed: 1500, rpm: 25_000 } }), { scale: 0.9 })).toMatchObject({ kind: 'refuse', reason: 'programmed-spindle-above-limit' });
    expect(decideOverride(input({ limits: { ...lim, toolMaxRpm: 16_000 } }), { scale: 0.9 })).toMatchObject({ reason: 'programmed-spindle-above-limit' });
    expect(decideOverride(input({ programmed: { feed: 1500, rpm: 5000 } }), { scale: 0.9 })).toMatchObject({ reason: 'programmed-spindle-below-minimum' });
    expect(decideOverride(input({ programmed: { feed: 6000, rpm: 18_000 } }), { scale: 0.9 })).toMatchObject({ reason: 'programmed-feed-above-axis-max' });
  });

  it('refuses proposals that are not a positive scale, feed or speed (NaN, Infinity, negative, zero, text, empty)', () => {
    const bad: unknown[] = [
      {},
      null,
      'slower',
      { scale: Number.NaN },
      { scale: Number.POSITIVE_INFINITY },
      { scale: Number.NEGATIVE_INFINITY },
      { scale: -0.5 },
      { scale: 0 },
      { feed: 'fast' },
      { rpm: -1 },
      { feed: Number.NaN, rpm: 9000 },
      { scale: 0.9, rpm: Number.POSITIVE_INFINITY },
    ];
    for (const p of bad) {
      const d = expectKind(decideOverride(input({ state: state(0.8, 0, 'down') }), p as OverrideProposal), 'refuse');
      expect(d).toMatchObject({ reason: 'invalid-proposal', scale: 0.8 });
    }
  });
});

describe('rules 3-5: never above programmed, together, never below the spindle minimum', () => {
  it('never raises F or S above programmed (raise feed, raise spindle, raise scale)', () => {
    for (const p of [{ scale: 1.5 }, { feed: 3000 }, { rpm: 30_000 }, { feed: 3000, rpm: 30_000 }]) {
      expect(decideOverride(input(), p)).toMatchObject({ kind: 'hold', reason: 'no-change', scale: 1 });
      const d = expectKind(decideOverride(input({ state: state(0.8, 0, 'up') }), p), 'apply');
      expect(d.target).toBe(1);
      expect(d.clampedBy).toContain('programmed');
      expect(d.scale).toBeCloseTo(0.85, 12);
      expect(d.feed).toBeLessThanOrEqual(1500);
      expect(d.rpm).toBeLessThanOrEqual(18_000);
    }
  });

  it('scales F and S together: a spindle-only proposal moves the feed too', () => {
    const d = expectKind(decideOverride(input(), { rpm: 0.8 * 18_000 }), 'apply');
    expect(d.target).toBeCloseTo(0.8, 12);
    expect(d.scale).toBeCloseTo(0.95, 12);
    expect(d.feed).toBeCloseTo(1500 * 0.95, 9);
    expect(d.rpm).toBeCloseTo(18_000 * 0.95, 9);
    expect(d.clampedBy).toEqual(['rate']);
  });

  it('takes the smallest ratio when a proposal asks F and S to move apart (ratio)', () => {
    const d1 = expectKind(decideOverride(input(), { feed: 1500, rpm: 0.8 * 18_000 }), 'apply');
    expect(d1.target).toBeCloseTo(0.8, 12);
    expect(d1.clampedBy).toContain('ratio');
    const d2 = expectKind(decideOverride(input(), { feed: 0.7 * 1500, rpm: 0.9 * 18_000, scale: 0.95 }), 'apply');
    expect(d2.target).toBeCloseTo(0.7, 12);
    expect(d2.feed / 1500).toBeCloseTo(d2.rpm / 18_000, 12);
  });

  it('never goes below the spindle minimum, and says so at the minimum', () => {
    const min = 6000 / 18_000;
    const d = expectKind(decideOverride(input({ state: state(0.36, 0, 'down') }), { scale: 0.1 }), 'apply');
    expect(d.target).toBeCloseTo(min, 12);
    expect(d.clampedBy).toContain('spindle-minimum');
    expect(d.scale).toBeCloseTo(min, 12);
    expect(d.rpm).toBeGreaterThanOrEqual(6000);
    expect(d.atSpindleMinimum).toBe(true);
    expect(d.message).toMatch(/minimum/);
    const again = expectKind(decideOverride(input({ state: d.state, now: NOW + 10_000 }), { scale: 0.1 }), 'hold');
    expect(again).toMatchObject({ reason: 'no-change', atSpindleMinimum: true });
    expect(again.message).toMatch(/no further/);
  });

  it('a programmed S at the spindle minimum allows no change down', () => {
    const d = decideOverride(input({ programmed: { feed: 1500, rpm: 6000 } }), { scale: 0.5 });
    expect(d).toMatchObject({ kind: 'hold', reason: 'no-change', atSpindleMinimum: true });
  });
});

describe('rule 6: settle', () => {
  it('holds in the first 3 s of a cut, and when the cut start is not a number', () => {
    expect(decideOverride(input({ cutStartedAt: NOW - 2999 }), { scale: 0.9 })).toMatchObject({ kind: 'hold', reason: 'settling', atSpindleMinimum: false });
    expect(decideOverride(input({ cutStartedAt: Number.NaN }), { scale: 0.9 })).toMatchObject({ kind: 'hold', reason: 'settling' });
    expect(decideOverride(input({ cutStartedAt: NOW - ENVELOPE.settleMs }), { scale: 0.9 }).kind).toBe('apply');
  });
});

describe('rule 7: hysteresis', () => {
  it('holds a change smaller than 2 points', () => {
    expect(decideOverride(input(), { scale: 0.99 })).toMatchObject({ kind: 'hold', reason: 'within-hysteresis' });
    expect(decideOverride(input(), { scale: 0.981 })).toMatchObject({ kind: 'hold', reason: 'within-hysteresis' });
    expect(decideOverride(input(), { scale: 0.98 }).kind).toBe('apply');
  });

  it('needs 4 points to reverse the last direction', () => {
    expect(decideOverride(input({ state: state(0.9, 0, 'down') }), { scale: 0.93 })).toMatchObject({ kind: 'hold', reason: 'reversal-hysteresis' });
    expect(decideOverride(input({ state: state(0.9, 0, 'down') }), { scale: 0.94 }).kind).toBe('apply');
    expect(decideOverride(input({ state: state(0.9, 0, 'up') }), { scale: 0.87 })).toMatchObject({ kind: 'hold', reason: 'reversal-hysteresis' });
    expect(decideOverride(input({ state: state(0.9, 0, 'up') }), { scale: 0.86 }).kind).toBe('apply');
    // Same direction: 2 points is enough.
    expect(decideOverride(input({ state: state(0.9, 0, 'down') }), { scale: 0.87 }).kind).toBe('apply');
    expect(decideOverride(input({ state: state(0.9, 0, 'up') }), { scale: 0.93 }).kind).toBe('apply');
  });
});

describe('rule 8: rate, 5 % per 2 s', () => {
  it('holds a change within 2 s of the last one', () => {
    expect(decideOverride(input({ state: state(0.9, NOW - 1999, 'down') }), { scale: 0.7 })).toMatchObject({ kind: 'hold', reason: 'rate-limited', scale: 0.9 });
    expect(decideOverride(input({ state: state(0.9, NOW - 2000, 'down') }), { scale: 0.7 }).kind).toBe('apply');
  });

  it('steps at most 5 points, either way', () => {
    const down = expectKind(decideOverride(input(), { scale: 0.5 }), 'apply');
    expect(down.scale).toBeCloseTo(0.95, 12);
    expect(down.clampedBy).toEqual(['rate']);
    expect(down.state).toEqual({ scale: down.scale, changedAt: NOW, lastDirection: 'down' });
    expect(down.message).toMatch(/95 % \(down\)/);
    const up = expectKind(decideOverride(input({ state: state(0.6, 0, 'up') }), { scale: 1 }), 'apply');
    expect(up.scale).toBeCloseTo(0.65, 12);
    expect(up.state.lastDirection).toBe('up');
    const small = expectKind(decideOverride(input(), { scale: 0.97 }), 'apply');
    expect(small.scale).toBeCloseTo(0.97, 12);
    expect(small.clampedBy).toEqual([]);
  });

  it('the first change needs no wait', () => {
    expect(decideOverride(input({ state: state(1, null, null) }), { scale: 0.9 }).kind).toBe('apply');
  });
});

// --- Properties -------------------------------------------------------------

const weird = fc.oneof(
  fc.double(),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -0, -1, 1e308),
  fc.double({ min: 1e-3, max: 1e5, noNaN: true }),
);
const maybe = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });

/** A plausible, valid scenario: programmed values inside the limits, a valid state. */
const scenario = fc
  .record({
    spindleMin: fc.double({ min: 0, max: 12_000, noNaN: true }),
    spindleSpan: fc.double({ min: 1, max: 30_000, noNaN: true }),
    toolMax: maybe(fc.double({ min: 1000, max: 60_000, noNaN: true })),
    axisMax: maybe(fc.double({ min: 100, max: 20_000, noNaN: true })),
    rpmT: fc.double({ min: 0, max: 1, noNaN: true }),
    feedT: fc.double({ min: 0.01, max: 1, noNaN: true }),
    scaleT: fc.double({ min: 0, max: 1, noNaN: true }),
    since: maybe(fc.integer({ min: 0, max: 10_000 })),
    lastDirection: fc.constantFrom('down', 'up', null),
    cutAgo: maybe(fc.integer({ min: 0, max: 10_000 })),
  })
  .filter((s) => s.toolMax === undefined || s.toolMax >= s.spindleMin)
  .map((s): EnvelopeInput => {
    const spindleMax = s.spindleMin + s.spindleSpan;
    const ceiling = s.toolMax === undefined ? spindleMax : Math.min(spindleMax, s.toolMax);
    const rpm = Math.max(1, s.spindleMin + s.rpmT * (ceiling - s.spindleMin));
    const feed = (s.axisMax ?? 10_000) * s.feedT;
    const minScale = s.spindleMin / rpm;
    const scale = Math.min(1, minScale + s.scaleT * (1 - minScale));
    return {
      programmed: { feed, rpm },
      limits: {
        spindleMinRpm: s.spindleMin,
        spindleMaxRpm: spindleMax,
        ...(s.toolMax === undefined ? {} : { toolMaxRpm: s.toolMax }),
        ...(s.axisMax === undefined ? {} : { axisMaxFeed: s.axisMax }),
      },
      state: { scale: scale > 0 ? scale : 1, changedAt: s.since === undefined ? null : NOW - s.since, lastDirection: s.lastDirection },
      condition: OK,
      now: NOW,
      ...(s.cutAgo === undefined ? {} : { cutStartedAt: NOW - s.cutAgo }),
    };
  });

const proposal = fc.record(
  { scale: weird, feed: weird, rpm: weird },
  { requiredKeys: [] },
) as fc.Arbitrary<OverrideProposal>;

const condition = fc.record({
  hold: fc.boolean(),
  alarm: fc.boolean(),
  fault: fc.boolean(),
  connected: fc.boolean(),
  orphanedMotion: fc.boolean(),
  toolChange: fc.boolean(),
  jobEnded: fc.boolean(),
  pausePressed: maybe(fc.boolean()),
  stopPressed: maybe(fc.boolean()),
}) as fc.Arbitrary<MachineCondition>;

function checkApply(i: EnvelopeInput, d: Extract<EnvelopeDecision, { kind: 'apply' }>): void {
  const { programmed: p, limits: l, state: s } = i;
  const tiny = 1e-9;
  expect(Number.isFinite(d.scale) && Number.isFinite(d.feed) && Number.isFinite(d.rpm)).toBe(true);
  expect(d.scale).toBeLessThanOrEqual(1);
  expect(d.feed).toBeLessThanOrEqual(p.feed);
  expect(d.rpm).toBeLessThanOrEqual(p.rpm);
  expect(d.rpm).toBeLessThanOrEqual(l.spindleMaxRpm);
  if (l.toolMaxRpm !== undefined) expect(d.rpm).toBeLessThanOrEqual(l.toolMaxRpm);
  if (l.axisMaxFeed !== undefined) expect(d.feed).toBeLessThanOrEqual(l.axisMaxFeed);
  expect(d.rpm).toBeGreaterThanOrEqual(l.spindleMinRpm);
  expect(Math.abs(d.feed / p.feed - d.rpm / p.rpm)).toBeLessThan(tiny);
  expect(Math.abs(d.scale - s.scale)).toBeLessThanOrEqual(ENVELOPE.maxStep + tiny);
  expect(Math.abs(d.scale - s.scale)).toBeGreaterThanOrEqual(ENVELOPE.hysteresis - tiny);
  if (s.changedAt !== null) expect(i.now - s.changedAt).toBeGreaterThanOrEqual(ENVELOPE.periodMs);
  if (i.cutStartedAt !== undefined) expect(i.now - i.cutStartedAt).toBeGreaterThanOrEqual(ENVELOPE.settleMs);
  expect(d.state).toEqual({ scale: d.scale, changedAt: i.now, lastDirection: d.scale < s.scale ? 'down' : 'up' });
}

describe('envelope properties (fast-check)', () => {
  it('every applied change obeys every rule, for any proposal (including NaN, Infinity, negatives)', () => {
    fc.assert(
      fc.property(scenario, proposal, (i, p) => {
        const d = decideOverride(i, p);
        expect(['apply', 'hold', 'refuse', 'reset']).toContain(d.kind);
        expect(Number.isFinite(d.scale)).toBe(true);
        if (d.kind === 'apply') checkApply(i, d);
        if (d.kind === 'hold' || d.kind === 'refuse') expect(d.scale).toBe(i.state.scale);
      }),
      { numRuns: 2000 },
    );
  });

  it('any forced condition resets to 100 %, whatever else is true', () => {
    fc.assert(
      fc.property(scenario, proposal, condition, (i, p, c) => {
        const d = decideOverride({ ...i, condition: c }, p);
        if (forcedReason(c) !== null) expect(d).toMatchObject({ kind: 'reset', scale: 1, dropToOff: true });
        else expect(d.kind).not.toBe('reset');
      }),
      { numRuns: 1000 },
    );
  });

  it('never throws and never returns a non-finite scale, for arbitrary hostile input', () => {
    const hostile = fc.record({
      programmed: fc.record({ feed: weird, rpm: weird }),
      limits: fc.record({ spindleMinRpm: weird, spindleMaxRpm: weird, toolMaxRpm: maybe(weird), axisMaxFeed: maybe(weird) }),
      state: fc.record({ scale: weird, changedAt: fc.oneof(fc.constant(null), weird), lastDirection: fc.constantFrom('down', 'up', null, 'x') }),
      condition,
      now: weird,
      cutStartedAt: maybe(weird),
    }) as unknown as fc.Arbitrary<EnvelopeInput>;
    fc.assert(
      fc.property(hostile, proposal, (i, p) => {
        const d = decideOverride(i, p);
        expect(Number.isFinite(d.scale) && d.scale > 0 && d.scale <= 1).toBe(true);
        if (d.kind === 'apply') checkApply(i, d);
      }),
      { numRuns: 2000 },
    );
  });

  it('over a simulated job, changes are at least 2 s apart, at most 5 points each, and stay in [minimum, 100 %]', () => {
    const steps = fc.array(fc.record({ dt: fc.integer({ min: 0, max: 3000 }), scale: fc.double({ min: 0, max: 1.5, noNaN: true }) }), { minLength: 1, maxLength: 200 });
    fc.assert(
      fc.property(steps, (seq) => {
        let s: OverrideState = PROGRAMMED_STATE;
        let now = 0;
        const applied: { t: number; scale: number; from: number }[] = [];
        for (const step of seq) {
          now += step.dt;
          const i = input({ state: s, now });
          const d = decideOverride(i, { scale: step.scale });
          if (d.kind === 'apply') {
            checkApply(i, d);
            applied.push({ t: now, scale: d.scale, from: s.scale });
            s = d.state;
          }
          expect(s.scale).toBeGreaterThanOrEqual(6000 / 18_000 - 1e-12);
          expect(s.scale).toBeLessThanOrEqual(1);
        }
        for (let k = 1; k < applied.length; k++) {
          expect((applied[k] as { t: number }).t - (applied[k - 1] as { t: number }).t).toBeGreaterThanOrEqual(ENVELOPE.periodMs);
        }
        for (const a of applied) expect(Math.abs(a.scale - a.from)).toBeLessThanOrEqual(ENVELOPE.maxStep + 1e-12);
      }),
      { numRuns: 500 },
    );
  });
});
