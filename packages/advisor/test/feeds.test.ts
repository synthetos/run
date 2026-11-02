/** §5.2.1-§5.2.4 formulas and checks. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkAxisMax,
  checkCoolant,
  checkDeflection,
  checkFrameLimits,
  checkPower,
  checkRubbing,
  checkSpindleRange,
  chipThinningFactor,
  chiploadAt,
  chiploadRange,
  cuttingForceN,
  cuttingPowerKw,
  feedRate,
  lerp,
  spindleSpeed,
  surfaceSpeed,
  toolDeflectionMm,
} from '../src/index.ts';

const SPINDLE = { minRpm: 6000, maxRpm: 24_000 };

describe('spindle speed (§5.2.1)', () => {
  it('is vc·1000 / (π·D) inside the range', () => {
    const s = spindleSpeed(200, 6, SPINDLE);
    expect(s.rpm).toBeCloseTo((200 * 1000) / (Math.PI * 6), 9);
    expect(s.ideal).toBe(s.rpm);
    expect(s.limitedBy).toBeNull();
    expect(surfaceSpeed(s.rpm, 6)).toBeCloseTo(200, 9);
  });

  it('clamps to the spindle maximum (small tools on routers), the tool maximum and the spindle minimum', () => {
    expect(spindleSpeed(300, 3.175, SPINDLE)).toMatchObject({ rpm: 24_000, limitedBy: 'spindle-max' });
    expect(spindleSpeed(300, 3.175, SPINDLE, 20_000)).toMatchObject({ rpm: 20_000, limitedBy: 'tool-max' });
    expect(spindleSpeed(300, 3.175, SPINDLE, 30_000)).toMatchObject({ rpm: 24_000, limitedBy: 'spindle-max' });
    expect(spindleSpeed(300, 3.175, SPINDLE, 24_000)).toMatchObject({ rpm: 24_000, limitedBy: 'spindle-max' });
    expect(spindleSpeed(50, 12, SPINDLE)).toMatchObject({ rpm: 6000, limitedBy: 'spindle-min' });
  });

  it('always lands in the range (fast-check)', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 2000, noNaN: true }), fc.double({ min: 0.1, max: 50, noNaN: true }), (vc, d) => {
        const s = spindleSpeed(vc, d, SPINDLE);
        expect(s.rpm).toBeGreaterThanOrEqual(SPINDLE.minRpm);
        expect(s.rpm).toBeLessThanOrEqual(SPINDLE.maxRpm);
      }),
    );
  });
});

describe('chipload (§5.2.2)', () => {
  it('a factor scales with the diameter', () => {
    expect(chiploadRange({ kind: 'factor', min: 0.004, max: 0.008 }, 6)).toEqual({ min: 0.024, max: 0.048 });
  });

  it('a curve is interpolated and held at its ends', () => {
    const curve = { kind: 'curve' as const, points: [{ d: 3, min: 0.01, max: 0.02 }, { d: 6, min: 0.02, max: 0.04 }, { d: 12, min: 0.05, max: 0.08 }] };
    expect(chiploadRange(curve, 2)).toEqual({ min: 0.01, max: 0.02 });
    expect(chiploadRange(curve, 3)).toEqual({ min: 0.01, max: 0.02 });
    expect(chiploadRange(curve, 4.5).min).toBeCloseTo(0.015, 12);
    expect(chiploadRange(curve, 6)).toEqual({ min: 0.02, max: 0.04 });
    expect(chiploadRange(curve, 9).max).toBeCloseTo(0.06, 12);
    expect(chiploadRange(curve, 20)).toEqual({ min: 0.05, max: 0.08 });
  });

  it('radial chip thinning is fz·D / (2·√(D·ae − ae²)) below half the diameter, and 1 above', () => {
    expect(chipThinningFactor(6, 3)).toBe(1);
    expect(chipThinningFactor(6, 6)).toBe(1);
    expect(chipThinningFactor(6, 0.6)).toBeCloseTo(6 / (2 * Math.sqrt(6 * 0.6 - 0.36)), 12);
    expect(chipThinningFactor(6, 0.6)).toBeCloseTo(1.6667, 3);
  });

  it('the thinned feed cuts exactly the target chip thickness (fast-check)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 25, noNaN: true }), fc.double({ min: 0.01, max: 1, noNaN: true }), fc.double({ min: 0.001, max: 0.5, noNaN: true }), (d, t, fz) => {
        const ae = d * t;
        const k = chipThinningFactor(d, ae);
        expect(k).toBeGreaterThanOrEqual(1);
        const hmax = ae >= d / 2 ? fz * k : (fz * k * 2 * Math.sqrt(d * ae - ae * ae)) / d;
        expect(hmax).toBeCloseTo(fz, 9);
      }),
    );
  });
});

describe('feed (§5.2.3)', () => {
  it('vf = n · z · fz_prog, and back', () => {
    expect(feedRate(18_000, 2, 0.025)).toBe(900);
    expect(chiploadAt(900, 18_000, 2)).toBeCloseTo(0.025, 12);
    expect(lerp({ min: 100, max: 300 }, 0)).toBe(100);
    expect(lerp({ min: 100, max: 300 }, 0.5)).toBe(200);
    expect(lerp({ min: 100, max: 300 }, 1)).toBe(300);
  });
});

describe('envelope checks (§5.2.4)', () => {
  it('spindle power: P = ap·ae·vf·kc / 60e6 against the rated power', () => {
    expect(cuttingPowerKw(2, 3.175, 1500, 800)).toBeCloseTo((2 * 3.175 * 1500 * 800) / 60e6, 12);
    expect(checkPower({ ap: 2, ae: 6, vf: 1500, kc: 800, powerKw: 1 })).toMatchObject({ kind: 'spindle-power', status: 'ok', reason: { code: 'power-ok' } });
    const near = checkPower({ ap: 6, ae: 6, vf: 1500, kc: 800, powerKw: 0.8 });
    expect(near).toMatchObject({ status: 'warn', reason: { code: 'near-power' } });
    const over = checkPower({ ap: 6, ae: 6, vf: 1500, kc: 800, powerKw: 0.7 });
    expect(over).toMatchObject({ status: 'fail', reason: { code: 'over-power', values: { ratedKw: 0.7 } } });
    expect(over.reason.values['kw']).toBeCloseTo(0.72, 9);
    expect(over.reason.message).toBe('Needs about 0.72 kW; the spindle is rated 0.70 kW.');
    expect(checkPower({ ap: 1, ae: 1, vf: 1, kc: undefined, powerKw: 1 })).toMatchObject({ status: 'unknown', reason: { code: 'no-kc' } });
  });

  it('axis maximum', () => {
    expect(checkAxisMax(4000, 5000)).toMatchObject({ status: 'ok' });
    expect(checkAxisMax(5000, 5000)).toMatchObject({ status: 'ok' });
    expect(checkAxisMax(5001, 5000)).toMatchObject({ status: 'fail', reason: { code: 'over-axis-max', values: { feed: 5001, maxFeed: 5000 } } });
  });

  it('frame-class ap and ae limits are multiples of the diameter', () => {
    const [ap, ae] = checkFrameLimits(1.5, 0.8, 6, { ap: 0.25, ae: 0.25 });
    expect(ap).toMatchObject({ kind: 'frame-ap', status: 'ok', reason: { values: { ap: 1.5, apMax: 1.5 } } });
    expect(ae).toMatchObject({ kind: 'frame-ae', status: 'ok' });
    const [ap2, ae2] = checkFrameLimits(1.6, 1.6, 6, { ap: 0.25, ae: 0.25 });
    expect(ap2).toMatchObject({ status: 'fail', reason: { code: 'ap-over' } });
    expect(ae2).toMatchObject({ status: 'fail', reason: { code: 'ae-over' } });
  });

  it('deflection: a cantilever of the effective diameter over the stickout', () => {
    const inertia = (Math.PI * 4.8 ** 4) / 64;
    expect(toolDeflectionMm(10, 20, 4.8, 600)).toBeCloseTo((10 * 20 ** 3) / (3 * 600_000 * inertia), 15);
    expect(cuttingForceN(1, 1, 1000, 800, 6, 18_000)).toBeCloseTo((1 * 1 * 1000 * 800) / (Math.PI * 6 * 18_000), 12);
    // Doubling the stickout multiplies the deflection by eight.
    expect(toolDeflectionMm(10, 40, 4.8, 600) / toolDeflectionMm(10, 20, 4.8, 600)).toBeCloseTo(8, 9);
    expect(checkDeflection(0.03, false)).toMatchObject({ status: 'ok', reason: { values: { limitMm: 0.05 } } });
    expect(checkDeflection(0.03, true)).toMatchObject({ status: 'fail', reason: { code: 'over-deflection', values: { limitMm: 0.02 } } });
    expect(checkDeflection(0.06, false).reason.message).toMatch(/roughing/);
    expect(checkDeflection(null, false)).toMatchObject({ status: 'unknown' });
  });

  it('rubbing floor: below 35 % of target', () => {
    expect(checkRubbing(0.008, 0.025)).toMatchObject({ status: 'fail', reason: { code: 'rubbing' } });
    expect(checkRubbing(0.008, 0.025).reason.message).toMatch(/^Rubbing: 0\.008 mm chipload is below the 0\.009 mm floor/);
    expect(checkRubbing(0.009, 0.025)).toMatchObject({ status: 'ok' });
    expect(checkRubbing(0.01, 0.025)).toMatchObject({ status: 'ok' });
  });

  it('coolant: required with none fails, recommended with none warns, avoid with mist or flood warns', () => {
    expect(checkCoolant('required', 'welds', 'none')).toMatchObject({ status: 'fail', reason: { code: 'coolant-required', message: 'This material needs coolant or air. welds' } });
    expect(checkCoolant('required', '', 'none').reason.message).toBe('This material needs coolant or air.');
    expect(checkCoolant('required', '', 'air')).toMatchObject({ status: 'ok' });
    expect(checkCoolant('recommended', '', 'none')).toMatchObject({ status: 'warn' });
    expect(checkCoolant('recommended', '', 'mist')).toMatchObject({ status: 'ok' });
    expect(checkCoolant('avoid', 'swells', 'mist')).toMatchObject({ status: 'warn', reason: { code: 'coolant-avoid' } });
    expect(checkCoolant('avoid', '', 'flood')).toMatchObject({ status: 'warn' });
    expect(checkCoolant('avoid', '', 'air')).toMatchObject({ status: 'ok' });
    expect(checkCoolant('none', '', 'none')).toMatchObject({ status: 'ok' });
  });

  it('spindle range of a programmed speed', () => {
    expect(checkSpindleRange(18_000, 6000, 24_000, undefined)).toMatchObject({ status: 'ok', reason: { values: { rpm: 18_000 } } });
    expect(checkSpindleRange(18_000, 6000, 24_000, 16_000)).toMatchObject({ status: 'fail', reason: { code: 'over-tool-max', values: { toolMaxRpm: 16_000 } } });
    expect(checkSpindleRange(25_000, 6000, 24_000, 30_000)).toMatchObject({ status: 'fail', reason: { code: 'over-spindle-max' } });
    expect(checkSpindleRange(5000, 6000, 24_000, undefined)).toMatchObject({ status: 'warn', reason: { code: 'under-spindle-min' } });
  });
});
