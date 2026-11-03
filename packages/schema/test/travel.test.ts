/**
 * Travel ranges against the firmware's soft-limit test (finding P0-09, batch
 * 12): `fp_EQ` on float32 ends skips the axis, and an end at or below
 * DISABLE_SOFT_LIMIT is not tested (EN canonical_machine.c:549-565; TG
 * canonical_machine.c:480-496).
 *
 * The oracle is the corrected test-kit firmware models (finding P0-11 #4,
 * bf3b2e5), which transcribe that guard independently of this package: each
 * case writes the travel through the model's own setter, homes X, turns soft
 * limits on and sends a move outside the range. A 220 means the firmware
 * limits the axis; a 0 means it does not.
 */
import { TinyG440Model, TinyGEdgeNextModel, createSim, type Sim } from '@synthetos/testkit';
import { describe, expect, it } from 'vitest';
import { SETTINGS_SCHEMAS, TRAVEL_SEMANTICS, confirmSoftLimits, screenWritePlan, travelSemanticsFor, travelWriteProblem, validate } from '../src/index.ts';
import type { Issue, IssueCode } from '../src/index.ts';

const EN = SETTINGS_SCHEMAS['tinyg-en'];
const TG = SETTINGS_SCHEMAS['tinyg-440'];
const codes = (issues: readonly Issue[]): [string, IssueCode][] => issues.map((i) => [i.key, i.code]);

type AnySim = Sim<TinyGEdgeNextModel> | Sim<TinyG440Model>;
const MODELS = [
  ['tinyg-en', (): AnySim => createSim(new TinyGEdgeNextModel())],
  ['tinyg-440', (): AnySim => createSim(new TinyG440Model())],
] as const;

function lines(sim: AnySim, line: string, ms = 50): Record<string, unknown>[] {
  sim.host.take();
  sim.host.sendLine(line);
  sim.clock.advance(ms);
  return sim.host.take().flatMap((l) => {
    try {
      const v: unknown = JSON.parse(l);
      return typeof v === 'object' && v !== null ? [v as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

function status(sim: AnySim, line: string, ms = 50): number[] {
  return lines(sim, line, ms).flatMap((v) => (Array.isArray(v['f']) ? [v['f'][1] as number] : []));
}

/** Reads one setting back through the model's JSON GET, as the board reports it. */
function readBack(sim: AnySim, key: string): unknown {
  for (const v of lines(sim, `{"${key}":null}`)) {
    const r = v['r'];
    if (typeof r === 'object' && r !== null && key in r) return (r as Record<string, unknown>)[key];
  }
  return undefined;
}

/** Writes travel through the model's setters, homes X, enables soft limits, and moves to `target`. Returns the move's status. */
function firmwareLimits(make: () => AnySim, xtn: number, xtm: number, target: number): { sim: AnySim; status: number[] } {
  const sim = make();
  expect(status(sim, `{"xtn":${xtn}}`)).toEqual([0]);
  expect(status(sim, `{"xtm":${xtm}}`)).toEqual([0]);
  expect(status(sim, '{"sl":1}')).toEqual([0]);
  sim.device.setHomed(['x', 'y', 'z']);
  return { sim, status: status(sim, `G1 X${target} F600`, 1000) };
}

describe('P0-09: the reproductions are refused (and the firmware really skips the limit)', () => {
  for (const [dialect, make] of MODELS) {
    // 440 has no reviewed travel overlay yet (its keys stop at notReviewed), so the cross-key rule is
    // exercised with the EN overlay under the dialect's own travel semantics.
    const schema = { ...EN, dialectId: dialect } as typeof EN;
    it(`${dialect}: {xtn:0, xtm:0.000001} is one value to the firmware, so validate refuses it`, () => {
      // The firmware does not limit X: a move to X1 (far outside 0..0.000001) is accepted.
      expect(firmwareLimits(make, 0, 0.000001, 1).status).toEqual([0]);
      expect(codes(validate({ xtn: 0, xtm: 0.000001 }, schema))).toEqual([
        ['xtn', 'travelFirmwareEqual'],
        ['xtm', 'travelFirmwareEqual'],
      ]);
      const plan = screenWritePlan(
        [
          { key: 'xtn', value: 0 },
          { key: 'xtm', value: 0.000001 },
        ],
        schema,
      );
      expect(plan.ok).toBe(false);
    });

    it(`${dialect}: {xtn:1000, xtm:1000.000001} collapse to one float32, so validate refuses it`, () => {
      expect(Math.fround(1000) === Math.fround(1000.000001)).toBe(true);
      expect(firmwareLimits(make, 1000, 1000.000001, 1).status).toEqual([0]);
      expect(codes(validate({ xtn: 1000, xtm: 1000.000001 }, schema))).toEqual([
        ['xtn', 'travelFirmwareEqual'],
        ['xtm', 'travelFirmwareEqual'],
      ]);
    });

    it(`${dialect}: one end changed against a board end it would equal is refused too`, () => {
      expect(codes(validate({ xtm: 0.000001 }, schema, { base: { xtn: 0 } }))).toEqual([['xtm', 'travelFirmwareEqual']]);
      expect(codes(validate({ xtn: 99_999.99 }, schema, { base: { xtm: 99_999.995 } }))).toEqual([['xtn', 'travelFirmwareEqual']]);
    });
  }
});

describe('near-equal ranges around the firmware boundary', () => {
  it('a span inside fp_EQ, at it, or float32-collapsed at large coordinates is refused', () => {
    for (const [lo, hi] of [
      [0, 0.000005],
      [0, 0.0000099],
      [-50, -49.99999],
      [99_999.99, 99_999.995], // float32 ulp at 1e5 is ~0.0078: one stored value
      [-100_000, -99_999.996],
    ] as const) {
      const issues = validate({ xtn: lo, xtm: hi }, EN);
      expect(issues.length, `${lo}..${hi}`).toBe(2);
      expect(issues.every((i) => i.code === 'travelFirmwareEqual'), `${lo}..${hi}`).toBe(true);
    }
  });

  it('a span the firmware sees as distinct but read-back cannot prove is refused as too narrow', () => {
    // 0.0001 is 10x epsilon (the firmware limits the axis) but reads back as 0.000 and 0.000.
    expect(codes(validate({ xtn: 0, xtm: 0.0001 }, EN))).toEqual([
      ['xtn', 'travelTooNarrow'],
      ['xtm', 'travelTooNarrow'],
    ]);
    expect(codes(validate({ ytn: 10, ytm: 10.009 }, EN))).toEqual([
      ['ytn', 'travelTooNarrow'],
      ['ytm', 'travelTooNarrow'],
    ]);
  });

  it('the firmware does limit an axis at a span validate accepts (contrast)', () => {
    for (const [, make] of MODELS) expect(firmwareLimits(make, 0, 0.01, 1).status).toEqual([220]);
    expect(validate({ xtn: 0, xtm: 0.01 }, EN)).toEqual([]);
  });

  it('every reproduction case is refused on every axis X..C', () => {
    for (const a of ['x', 'y', 'z', 'a', 'b', 'c']) {
      expect(codes(validate({ [`${a}tn`]: 0, [`${a}tm`]: 0.000001 }, EN)).map(([, c]) => c)).toEqual(['travelFirmwareEqual', 'travelFirmwareEqual']);
      expect(codes(validate({ [`${a}tn`]: 1000, [`${a}tm`]: 1000.000001 }, EN)).map(([, c]) => c)).toEqual(['travelFirmwareEqual', 'travelFirmwareEqual']);
    }
  });
});

describe('normal ranges still pass', () => {
  it('ordinary machine ranges and the extremes of the host range', () => {
    expect(validate({ xtn: 0, xtm: 300, ytn: 0, ytm: 200, ztn: -80, ztm: 0 }, EN)).toEqual([]);
    expect(validate({ atn: -360, atm: 360 }, EN)).toEqual([]);
    expect(validate({ xtn: -100_000, xtm: 100_000 }, EN)).toEqual([]);
    expect(validate({ xtn: 99_999.9, xtm: 100_000 }, EN)).toEqual([]);
    expect(validate({ xtn: 0, xtm: 0.01 }, EN)).toEqual([]);
    expect(validate({ xtn: -5 }, EN, { base: { xtm: 300 } })).toEqual([]);
  });

  it('reversed and equal ranges stay travelOrder', () => {
    expect(codes(validate({ xtn: 10, xtm: 5 }, EN)).map(([, c]) => c)).toEqual(['travelOrder', 'travelOrder']);
    expect(codes(validate({ xtn: 0, xtm: 0 }, EN)).map(([, c]) => c)).toEqual(['travelOrder', 'travelOrder']);
  });
});

describe('DISABLE_SOFT_LIMIT applies per end', () => {
  it('a board end at or below -1000000 is refused: the firmware would not test it', () => {
    // The host range is ±100000, so the draft cannot write one; the board can hold one.
    expect(codes(validate({ xtm: 150 }, EN, { base: { xtn: -1_000_000 } }))).toEqual([['xtn', 'travelEndDisabled']]);
    expect(codes(validate({ xtm: 150 }, EN, { base: { xtn: -2_000_000 } }))).toEqual([['xtn', 'travelEndDisabled']]);
    expect(validate({ xtm: 150 }, EN, { base: { xtn: -99_999 } })).toEqual([]);
    // The firmware: only the minimum end is skipped.
    for (const [, make] of MODELS) {
      expect(firmwareLimits(make, -1_000_000, 150, -5).status).toEqual([0]);
    }
  });

  it('a board maximum at or below -1000000 is refused (the range is then reversed for any draft minimum the host accepts)', () => {
    expect(codes(validate({ xtn: -99_000 }, EN, { base: { xtm: -1_000_000 } }))).toEqual([['xtn', 'travelOrder']]);
    expect(travelWriteProblem(TRAVEL_SEMANTICS['tinyg-en']!, -2_000_000, -1_000_000)).toEqual({ kind: 'endDisabled' });
    expect(travelWriteProblem(TRAVEL_SEMANTICS['tinyg-en']!, -1_500_000, -1_000_000)).toEqual({ kind: 'endDisabled' });
  });

  it('the boundary uses the stored float32: -999999.97 rounds onto -1000000 and is refused', () => {
    const sem = TRAVEL_SEMANTICS['tinyg-en']!;
    expect(Math.fround(-999_999.97)).toBe(-1_000_000);
    expect(travelWriteProblem(sem, -999_999.97, 0)).toEqual({ kind: 'endDisabled' });
  });
});

describe('dialect scope: TinyG epsilon only where it is transcribed', () => {
  it('EN and 440 share the pinned rule; any other dialect has none and fails closed', () => {
    expect(travelSemanticsFor('tinyg-en')).toBe(travelSemanticsFor('tinyg-440'));
    expect(travelSemanticsFor('g2core')).toBeUndefined();
    expect(travelSemanticsFor('tinyg-449-stock')).toBeUndefined();
    expect(travelSemanticsFor('__proto__')).toBeUndefined();
    const fake = { ...EN, dialectId: 'g2core' } as unknown as typeof EN;
    expect(codes(validate({ xtn: 0, xtm: 300 }, fake))).toEqual([
      ['xtn', 'travelSemanticsUnknown'],
      ['xtm', 'travelSemanticsUnknown'],
    ]);
    expect(confirmSoftLimits('g2core', { values: { sl: 1, unit: 1, xtn: 0, xtm: 300 }, required: ['x'] }).active).toBe(false);
  });

  it('440 refuses the reproductions exactly as EN does (when its travel keys are reviewed)', () => {
    // 440 has no reviewed overlay yet: the keys are refused before the cross-key rule.
    expect(validate({ xtn: 0, xtm: 0.000001 }, TG).every((i) => i.code === 'notReviewed' || i.code === 'travelFirmwareEqual')).toBe(true);
  });
});

describe('read-back confirms soft limits before they count as on', () => {
  for (const [dialect, make] of MODELS) {
    it(`${dialect}: the reproduction ranges read back as not enforced`, () => {
      for (const [lo, hi] of [
        [0, 0.000001],
        [1000, 1000.000001],
      ] as const) {
        const { sim } = firmwareLimits(make, lo, hi, 1);
        const values = { sl: readBack(sim, 'sl'), unit: readBack(sim, 'unit'), xtn: readBack(sim, 'xtn'), xtm: readBack(sim, 'xtm') };
        const c = confirmSoftLimits(dialect, { values, required: ['x'], written: { xtn: lo, xtm: hi } });
        expect(c.active, `${lo}..${hi}`).toBe(false);
        expect(c.axes.x).toBe('notEnforced');
      }
    });

    it(`${dialect}: a normal range reads back as enforced, and the model agrees`, () => {
      const { sim, status: st } = firmwareLimits(make, 0, 300, 400);
      expect(st).toEqual([220]);
      const values = { sl: readBack(sim, 'sl'), unit: readBack(sim, 'unit'), xtn: readBack(sim, 'xtn'), xtm: readBack(sim, 'xtm') };
      const c = confirmSoftLimits(dialect, { values, required: ['x'], written: { xtn: 0, xtm: 300 } });
      expect(c).toEqual({ active: true, axes: { x: 'enforced' }, reasons: [] });
    });
  }

  it('sl off, a missing axis, a disabled end, or a value that did not read back as written is not confirmed', () => {
    const ok = { sl: 1, unit: 1, xtn: 0, xtm: 300, ytn: 0, ytm: 200 };
    expect(confirmSoftLimits('tinyg-en', { values: ok, required: ['x', 'y'] }).active).toBe(true);
    expect(confirmSoftLimits('tinyg-en', { values: { ...ok, sl: 0 }, required: ['x'] }).active).toBe(false);
    expect(confirmSoftLimits('tinyg-en', { values: { ...ok, sl: '1' }, required: ['x'] }).active).toBe(false);
    expect(confirmSoftLimits('tinyg-en', { values: ok, required: ['x', 'z'] }).active).toBe(false);
    expect(confirmSoftLimits('tinyg-en', { values: { ...ok, xtn: -1_000_000 }, required: ['x'] }).active).toBe(false);
    expect(confirmSoftLimits('tinyg-en', { values: { ...ok, xtm: -1_000_000, xtn: -2_000_000 }, required: ['x'] }).active).toBe(false);
    const maxOff = confirmSoftLimits('tinyg-en', { values: { ...ok, xtn: 0, xtm: -1_000_000 }, required: ['x'] });
    expect(maxOff.active).toBe(false);
    expect(maxOff.reasons).toEqual(['X travel 0..-1000000: its maximum is at or below -1000000, so that end is not tested']);
    expect(confirmSoftLimits('tinyg-en', { values: { ...ok, xtn: -1_000_000 }, required: ['x'] }).reasons).toEqual([
      'X travel -1000000..300: its minimum is at or below -1000000, so that end is not tested',
    ]);
    expect(confirmSoftLimits('tinyg-en', { values: { ...ok, xtm: 0.0001 }, required: ['x'] }).reasons).toEqual(['X travel 0..0.0001: its ends cannot be proved distinct to the firmware (fp_EQ), which then skips the axis']);
    // An axis not required is reported but does not block.
    const optional = confirmSoftLimits('tinyg-en', { values: { ...ok, ytm: 0 }, required: ['x'] });
    expect(optional).toEqual({ active: true, axes: { x: 'enforced', y: 'notEnforced' }, reasons: [] });
    expect(confirmSoftLimits('tinyg-en', { values: { ...ok, xtm: 'x' }, required: ['x'] }).active).toBe(false);
    expect(confirmSoftLimits('tinyg-en', { values: ok, required: ['x'], written: { xtm: 310 } }).active).toBe(false);
    expect(confirmSoftLimits('tinyg-en', { values: ok, required: ['x'], written: { ztm: 0 } }).active).toBe(false);
    expect(confirmSoftLimits('tinyg-en', { values: { ...ok, xtm: 300.0004 }, required: ['x'], written: { xtm: 300 } }).active).toBe(true);
  });

  it('a read-back under G20 is not interpreted: linear travel then reports in inches (F_CONVERT)', () => {
    // EN config_app.c:845-856 / TG config_app.c:763-770 divide an F_CONVERT float by 25.4 on output while the
    // units mode is inches. A stored minimum of -1000000 mm (DISABLE_SOFT_LIMIT: that end is not tested) then
    // reads back as -39370.079, which taken as millimetres would look tested.
    const inches = { sl: 1, unit: 0, xtn: Number((-1_000_000 / 25.4).toFixed(3)), xtm: Number((300 / 25.4).toFixed(3)) };
    const g20 = confirmSoftLimits('tinyg-en', { values: inches, required: ['x'] });
    expect(g20.active).toBe(false);
    expect(g20.reasons).toEqual(['units mode (unit) does not read back as millimetres (1): travel cannot be read as millimetres']);
    expect(confirmSoftLimits('tinyg-440', { values: inches, required: ['x'] }).active).toBe(false);
    const { unit: _unit, ...noUnit } = { sl: 1, unit: 1, xtn: 0, xtm: 300 };
    expect(confirmSoftLimits('tinyg-en', { values: noUnit, required: ['x'] }).active).toBe(false);
    expect(confirmSoftLimits('tinyg-en', { values: { ...noUnit, unit: '1' }, required: ['x'] }).active).toBe(false);
    expect(confirmSoftLimits('tinyg-en', { values: { ...noUnit, unit: 1 }, required: ['x'] }).active).toBe(true);
  });

  it('reported ends too close to prove distinct are not confirmed; 3-decimal reports of the smallest accepted span are', () => {
    expect(confirmSoftLimits('tinyg-en', { values: { sl: 1, unit: 1, xtn: 0, xtm: 0 }, required: ['x'] }).axes.x).toBe('notEnforced');
    expect(confirmSoftLimits('tinyg-en', { values: { sl: 1, unit: 1, xtn: 0, xtm: 0.001 }, required: ['x'] }).axes.x).toBe('notEnforced');
    expect(confirmSoftLimits('tinyg-en', { values: { sl: 1, unit: 1, xtn: 0, xtm: 0.01 }, required: ['x'] }).axes.x).toBe('enforced');
    expect(confirmSoftLimits('tinyg-en', { values: { sl: 1, unit: 1, xtn: 1000, xtm: 1000 }, required: ['x'] }).axes.x).toBe('notEnforced');
  });
});
