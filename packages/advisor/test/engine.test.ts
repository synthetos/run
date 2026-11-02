/**
 * §5.3 engines and the guard: RulesEngine, MockAiEngine (canned, preview),
 * and GuardedEngine, through which any engine's output passes. A malicious
 * or buggy engine (raise feed, raise spindle, NaN, Infinity, negative values,
 * junk, throwing) is refused or clamped, never let through.
 */
import { describe, expect, it } from 'vitest';
import {
  GuardedEngine,
  MOCK_AI_LABEL,
  MockAiEngine,
  PROGRAMMED_STATE,
  RulesEngine,
  boundRecommendation,
  estimateLiveChipload,
  planOperation,
  rulesCoach,
  rulesReview,
  STAT_RUN,
  type AdvisorContext,
  type AdvisorEngine,
  type EnvelopeInput,
  type JobRecord,
  type LiveEstimate,
  type Recommendation,
  type Review,
  type Suggestion,
  type TelemetrySummary,
} from '../src/index.ts';
import { context, dialMachine, AL_6061 } from './fixtures.ts';

const OK = { hold: false, alarm: false, fault: false, connected: true, orphanedMotion: false, toolChange: false, jobEnded: false };
const ENVELOPE_INPUT: EnvelopeInput = {
  programmed: { feed: 1500, rpm: 18_000 },
  limits: { spindleMinRpm: 6000, spindleMaxRpm: 24_000, axisMaxFeed: 5000 },
  state: PROGRAMMED_STATE,
  condition: OK,
  now: 100_000,
};

function estimate(vel: number, qr = 24): LiveEstimate {
  const samples = Array.from({ length: 12 }, (_, i) => ({ t: i * 250, vel, feed: 1500, qr, stat: STAT_RUN, line: i }));
  return estimateLiveChipload(samples, { flutes: 2, commandedRpm: 18_000 });
}

function summary(vel: number, qr = 24): TelemetrySummary {
  return { estimate: estimate(vel, qr), programmed: { feed: 1500, rpm: 18_000 }, targetChipload: 0.0417, floorChipload: 0.035 };
}

/** An engine that returns whatever it is given. */
function scripted(kind: 'rules' | 'ai', out: { plan?: unknown; coach?: unknown; review?: unknown; available?: unknown }, id = 'scripted'): AdvisorEngine {
  return {
    id,
    kind,
    available: async () => out.available as boolean,
    plan: async () => out.plan as Recommendation[],
    coach: async () => out.coach as Suggestion[],
    review: async () => out.review as Review,
  };
}

function throwing(): AdvisorEngine {
  const boom = async (): Promise<never> => {
    throw new Error('model unavailable');
  };
  return { id: 'broken', kind: 'ai', available: boom, plan: boom, coach: boom, review: boom };
}

const REC: Recommendation = { level: 'balanced', rpm: 18_000, feed: 1200, reasons: ['ok'], preview: false, placeholder: false, engine: 'x' };

describe('RulesEngine', () => {
  const rules = new RulesEngine();

  it('is the local, offline, deterministic default', async () => {
    expect(rules.id).toBe('rules');
    expect(rules.kind).toBe('rules');
    expect(await rules.available()).toBe(true);
  });

  it('plan: three recommendations, with reasons, never marked preview', async () => {
    const recs = await rules.plan(context());
    expect(recs.map((r) => r.level)).toEqual(['conservative', 'balanced', 'aggressive']);
    expect(recs.every((r) => !r.preview && !r.placeholder && r.engine === 'rules')).toBe(true);
    expect(recs[2]?.reasons).toEqual(['Limited by: spindle-max.']);
    expect(await rules.plan(context())).toEqual(recs);
  });

  it('plan: dial positions on a dial router, the S note, and placeholder reasons for seed data', async () => {
    const dial = await rules.plan(context({ machine: dialMachine() }));
    expect(dial[0]?.dialSetting).toMatch(/^[1-6]$/);
    expect(dial[0]?.reasons).toContain('S does not set this spindle: set the speed by hand.');
    const { model: _m, ...seed } = context({ material: AL_6061 });
    const recs = await rules.plan(seed);
    for (const r of recs) {
      expect(r.placeholder).toBe(true);
      expect(r.reasons.at(-1)).toMatch(/^Placeholder data \(.*material\.cutting\.vc.*\): not advice until sourced\.$/);
    }
  });

  it('plan: nothing for a refused plan (PVC); planOperation says why', async () => {
    const pvc = { ...context(), material: { ...AL_6061, cutting: [], safety: [{ severity: 'do-not-machine' as const, text: 'Do not machine PVC.' }] } };
    expect(await rules.plan(pvc)).toEqual([]);
    expect(planOperation(pvc)).toMatchObject({ ok: false, refusal: 'do-not-machine' });
  });

  it('coach: below the floor, slow the spindle so the chip is the target again at the speed reached', async () => {
    const s = summary(1110);
    const [sug] = await rules.coach(s);
    expect(sug?.engine).toBe('rules');
    expect(sug?.preview).toBe(false);
    // fz_live = 1110 / (18000·2) = 0.0308 < 0.035; scale = max(rpm·fz/(target·S), vel/F) = max(0.74, 0.74).
    expect(sug?.scale).toBeCloseTo(Math.max((18_000 * (1110 / 36_000)) / (0.0417 * 18_000), 1110 / 1500), 12);
    expect(sug?.reason).toMatch(/^Slow down: averaging 74 % of programmed feed\. Chipload 0\.031 mm is below the 0\.035 mm floor\. Spindle \d+ rpm \(-26 %\) keeps the chips thick\. The planner is starving/);
    expect((await rules.coach(summary(1110, 11)))[0]?.reason).toMatch(/Acceleration and jerk cap the speed/);
    expect((await rules.coach(summary(1110, 16)))[0]?.reason).toMatch(/keeps the chips thick\.$/);
  });

  it('coach: the feed is never scaled below the velocity already reached', () => {
    const s: TelemetrySummary = { ...summary(1110), targetChipload: 0.1, floorChipload: 0.05 };
    expect(rulesCoach(s)[0]?.scale).toBeCloseTo(1110 / 1500, 12);
  });

  it('coach: nothing when the chipload is fine, the estimate is not ready, or the targets are not numbers', async () => {
    expect(await rules.coach(summary(1450))).toEqual([]);
    expect(await rules.coach({ ...summary(1110), estimate: estimateLiveChipload([], { flutes: 2, commandedRpm: 18_000 }) })).toEqual([]);
    expect(await rules.coach({ ...summary(1110), targetChipload: Number.NaN })).toEqual([]);
    expect(await rules.coach({ ...summary(1110), floorChipload: 0 })).toEqual([]);
    expect(await rules.coach({ ...summary(1110), programmed: { feed: 0, rpm: 18_000 } })).toEqual([]);
    expect(await rules.coach({ ...summary(1110), programmed: { feed: 1500, rpm: Number.NaN } })).toEqual([]);
  });

  it('review: programmed against achieved feed and the time lost', async () => {
    const job: JobRecord = {
      operations: [
        { id: 'op1', kind: 'pocket', programmed: { feed: 1500, rpm: 18_000 }, achievedFeed: 1110, seconds: 300 },
        { id: 'op2', kind: 'profile', programmed: { feed: 1000, rpm: 18_000 }, achievedFeed: 1000, seconds: 60 },
        { id: 'op3', kind: 'drill', programmed: { feed: 300, rpm: 18_000 }, achievedFeed: Number.NaN, seconds: 10 },
        { id: 'op4', kind: 'finish', programmed: { feed: 1000, rpm: 18_000 }, achievedFeed: 999.5, seconds: 60 },
      ],
    };
    const r = await rules.review(job);
    expect(r.findings).toEqual([
      { level: 'warn', text: 'op1 (pocket): 74 % of programmed feed, about 78 s lost.' },
      { level: 'info', text: 'op2 (profile): 100 % of programmed feed.' },
      { level: 'info', text: 'op3: not enough data to review.' },
      { level: 'info', text: 'op4 (finish): 100 % of programmed feed.' },
    ]);
    expect(r.summary).toBe('3 operation(s) reviewed; about 78 s lost to feeds the machine did not reach.');
    expect(rulesReview({ operations: [] }).summary).toBe('No operations to review.');
  });
});

describe('MockAiEngine', () => {
  const mock = new MockAiEngine();

  it('returns canned output, clearly labelled as a preview, and calls nothing', async () => {
    expect(mock).toMatchObject({ id: 'mock-ai', kind: 'ai', label: 'AI assistant (preview)' });
    expect(await mock.available()).toBe(true);
    const [rec] = await mock.plan(context());
    expect(rec).toMatchObject({ preview: true, placeholder: true, engine: 'mock-ai' });
    expect(rec?.reasons[0]).toContain(MOCK_AI_LABEL);
    const [sug] = await mock.coach(summary(1110));
    expect(sug).toMatchObject({ scale: 0.9, preview: true });
    const review = await mock.review({ operations: [] });
    expect(review.preview).toBe(true);
    expect(review.summary).toContain(MOCK_AI_LABEL);
  });

  it('its output passes the guard as a preview', async () => {
    const g = new GuardedEngine(mock);
    expect(g.isAi).toBe(true);
    expect(await g.available()).toBe(true);
    const plan = await g.plan(context());
    expect(plan.recommendations[0]).toMatchObject({ preview: true, placeholder: true, clampedBy: [] });
    const coach = await g.coach(summary(1110), ENVELOPE_INPUT);
    expect(coach.decisions[0]?.decision).toMatchObject({ kind: 'apply', scale: 0.95 });
    expect((await g.review({ operations: [] })).review?.preview).toBe(true);
  });
});

describe('GuardedEngine: whatever an engine returns is refused or bounded', () => {
  it('clamps raised feeds and speeds in a plan to the machine and tool limits', async () => {
    const evil = scripted('ai', {
      plan: [
        { ...REC, rpm: 90_000, feed: 99_000 },
        { ...REC, level: 'conservative', rpm: 100 },
        { ...REC, level: 'aggressive', rpm: 28_000 },
      ],
    });
    const plan = await new GuardedEngine(evil).plan(context({ toolMaxRpm: 20_000 }));
    expect(plan.refused).toEqual([]);
    expect(plan.recommendations[0]).toMatchObject({ rpm: 20_000, feed: 5000, clampedBy: ['tool-max', 'axis-max'], preview: true, placeholder: true, engine: 'scripted' });
    expect(plan.recommendations[1]).toMatchObject({ rpm: 6000, clampedBy: ['spindle-min'] });
    expect(plan.recommendations[2]).toMatchObject({ rpm: 20_000, clampedBy: ['tool-max'] });
    const noToolMax = await new GuardedEngine(evil).plan(context());
    expect(noToolMax.recommendations[0]).toMatchObject({ rpm: 24_000, clampedBy: ['spindle-max', 'axis-max'] });
    const drill = boundRecommendation({ ...REC, feed: 4000 }, context({ operation: { kind: 'drill', ap: 5, ae: 3.175 } }));
    expect(drill).toMatchObject({ feed: 1000, clampedBy: ['axis-max'] });
  });

  it('refuses NaN, Infinity, negative, zero and non-numeric values, extra fields and junk items', async () => {
    const items: unknown[] = [
      { ...REC, rpm: Number.NaN },
      { ...REC, feed: Number.POSITIVE_INFINITY },
      { ...REC, rpm: -18_000 },
      { ...REC, feed: 0 },
      { ...REC, feed: '1200' },
      { ...REC, level: 'ludicrous' },
      { ...REC, command: 'G1 F99999' },
      { ...REC, reasons: ['a\u0007b'] },
      null,
      'G1 X10 F5000',
      42,
      REC,
    ];
    const plan = await new GuardedEngine(scripted('ai', { plan: items })).plan(context());
    expect(plan.refused.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(plan.refused.every((r) => r.reason.startsWith('Not a valid engine result:'))).toBe(true);
    expect(plan.recommendations).toHaveLength(1);
  });

  it('refuses the whole call, without asking the engine, when the limits cannot bound its values', async () => {
    let asked = 0;
    const counting: AdvisorEngine = { ...scripted('ai', { plan: [REC] }), plan: async () => { asked++; return [REC]; } };
    const g = new GuardedEngine(counting);
    const base = context();
    const bad: AdvisorContext[] = [
      { ...base, machine: { ...base.machine, spindle: { ...base.machine.spindle, maxRpm: Number.NaN } } },
      { ...base, machine: { ...base.machine, spindle: { ...base.machine.spindle, minRpm: -1 } } },
      { ...base, machine: { ...base.machine, spindle: { ...base.machine.spindle, minRpm: 30_000 } } },
      { ...base, machine: { ...base.machine, maxFeed: { xy: 0, z: 1000 } } },
      { ...base, machine: { ...base.machine, maxFeed: { xy: 5000, z: Number.POSITIVE_INFINITY } } },
      { ...base, toolMaxRpm: 5000 },
      { ...base, toolMaxRpm: Number.NaN },
    ];
    for (const ctx of bad) {
      const plan = await g.plan(ctx);
      expect(plan.recommendations).toEqual([]);
      expect(plan.refused).toEqual([{ index: -1, reason: expect.stringMatching(/so no engine value can be bounded\.$/) }]);
    }
    expect(asked).toBe(0);
    expect((await g.plan({ ...base, toolMaxRpm: 6000 })).recommendations[0]).toMatchObject({ rpm: 6000, clampedBy: ['tool-max'] });
    expect(asked).toBe(1);
  });

  it('refuses a result that is not a list, a throwing engine, and more than the item limit', async () => {
    expect((await new GuardedEngine(scripted('ai', { plan: { rpm: 1 } })).plan(context())).refused).toEqual([{ index: -1, reason: 'The engine did not return a list.' }]);
    const broken = new GuardedEngine(throwing());
    expect(await broken.available()).toBe(false);
    expect((await broken.plan(context())).refused).toEqual([{ index: -1, reason: 'The engine failed: model unavailable' }]);
    const coach = await broken.coach(summary(1110), ENVELOPE_INPUT);
    expect(coach).toMatchObject({ decisions: [], state: PROGRAMMED_STATE, refused: [{ index: -1 }] });
    expect(await broken.review({ operations: [] })).toMatchObject({ review: null, refused: [{ index: -1, reason: 'The engine failed: model unavailable' }] });
    const stringThrower: AdvisorEngine = { ...throwing(), plan: () => Promise.reject('nope') };
    expect((await new GuardedEngine(stringThrower).plan(context())).refused[0]?.reason).toBe('The engine failed: nope');
    const many = await new GuardedEngine(scripted('ai', { plan: Array.from({ length: 35 }, () => REC) })).plan(context());
    expect(many.recommendations).toHaveLength(30);
    expect(many.refused).toHaveLength(5);
    expect(await new GuardedEngine(scripted('ai', { available: 'yes' })).available()).toBe(false);
  });

  it('cannot pass a rules engine off as non-preview when it is AI, nor take another engine name', async () => {
    const liar = scripted('ai', { plan: [{ ...REC, preview: false, placeholder: false, engine: 'rules' }], review: { summary: 'Fine.', findings: [], preview: false, engine: 'rules' } }, 'cloud-ai');
    const g = new GuardedEngine(liar);
    expect((await g.plan(context())).recommendations[0]).toMatchObject({ preview: true, placeholder: true, engine: 'cloud-ai' });
    expect((await g.review({ operations: [] })).review).toMatchObject({ preview: true, engine: 'cloud-ai' });
    const honestRules = new GuardedEngine(scripted('rules', { plan: [REC] }, 'my-rules'));
    expect(honestRules.isAi).toBe(false);
    expect((await honestRules.plan(context())).recommendations[0]).toMatchObject({ preview: false, placeholder: false, engine: 'my-rules' });
  });

  it('live suggestions go through the envelope: raise feed, raise spindle, NaN, Infinity and negatives never get out', async () => {
    const coach: unknown[] = [
      { scale: 1.5, reason: 'go faster', preview: false, engine: 'x' },
      { feed: 9000, reason: 'raise feed', preview: false, engine: 'x' },
      { rpm: 40_000, reason: 'raise spindle', preview: false, engine: 'x' },
      { scale: Number.NaN, reason: 'nan', preview: false, engine: 'x' },
      { feed: Number.POSITIVE_INFINITY, reason: 'inf', preview: false, engine: 'x' },
      { rpm: -1, reason: 'negative', preview: false, engine: 'x' },
      { reason: 'nothing', preview: false, engine: 'x' },
      { scale: 0.5, reason: 'slow down', preview: false, engine: 'x' },
    ];
    const g = new GuardedEngine(scripted('ai', { coach }));
    const out = await g.coach(summary(1110), ENVELOPE_INPUT);
    expect(out.refused.map((r) => r.index)).toEqual([3, 4, 5]);
    const kinds = out.decisions.map((d) => [d.suggestion.reason, d.decision.kind, (d.decision as { reason?: string }).reason ?? null]);
    expect(kinds).toEqual([
      ['go faster', 'hold', 'no-change'],
      ['raise feed', 'hold', 'no-change'],
      ['raise spindle', 'hold', 'no-change'],
      ['nothing', 'refuse', 'invalid-proposal'],
      ['slow down', 'apply', null],
    ]);
    for (const d of out.decisions) {
      expect(d.suggestion.preview).toBe(true);
      if (d.decision.kind === 'apply') {
        expect(d.decision.feed).toBeLessThanOrEqual(1500);
        expect(d.decision.rpm).toBeLessThanOrEqual(18_000);
      }
    }
    expect(out.state.scale).toBeCloseTo(0.95, 12);
  });

  it('threads the override state, so several suggestions in one call still obey the rate limit', async () => {
    const coach = [0.5, 0.5, 0.5].map((scale) => ({ scale, reason: 'slow', preview: false, engine: 'x' }));
    const out = await new GuardedEngine(scripted('rules', { coach })).coach(summary(1110), ENVELOPE_INPUT);
    expect(out.decisions.map((d) => d.decision.kind)).toEqual(['apply', 'hold', 'hold']);
    expect(out.decisions[1]?.decision).toMatchObject({ reason: 'rate-limited' });
    expect(out.state.scale).toBeCloseTo(0.95, 12);
  });

  it('a forced condition resets whatever the engine says, and the reset state carries forward', async () => {
    const coach = [{ scale: 0.5, feed: 700, rpm: 9000, reason: 'slow', preview: false, engine: 'x' }];
    const held: EnvelopeInput = { ...ENVELOPE_INPUT, state: { scale: 0.8, changedAt: 0, lastDirection: 'down' }, condition: { ...OK, hold: true } };
    const out = await new GuardedEngine(scripted('ai', { coach })).coach(summary(1110), held);
    expect(out.decisions[0]?.decision).toMatchObject({ kind: 'reset', reason: 'hold', dropToOff: true });
    expect(out.state).toEqual({ scale: 1, changedAt: 100_000, lastDirection: null });
  });

  it('refuses a malformed review', async () => {
    const bad: unknown[] = [{ summary: '', findings: [], preview: false, engine: 'x' }, { summary: 'x', findings: [{ level: 'panic', text: 'x' }], preview: false, engine: 'x' }, 'fine', null];
    for (const review of bad) {
      const r = await new GuardedEngine(scripted('ai', { review })).review({ operations: [] });
      expect(r.review).toBeNull();
      expect(r.refused[0]?.reason).toMatch(/^Not a valid engine result:/);
    }
    const ok = await new GuardedEngine(new RulesEngine()).review({ operations: [] });
    expect(ok).toMatchObject({ engine: 'rules', refused: [], review: { preview: false, engine: 'rules' } });
  });

  it('wraps the rules engine without changing its output', async () => {
    const ctx: AdvisorContext = context();
    const g = new GuardedEngine(new RulesEngine());
    expect(g.id).toBe('rules');
    const plan = await g.plan(ctx);
    const direct = await new RulesEngine().plan(ctx);
    expect(plan.recommendations.map(({ clampedBy: _c, ...r }) => r)).toEqual(direct);
    expect(plan.recommendations.every((r) => r.clampedBy.length === 0)).toBe(true);
  });
});
