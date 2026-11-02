/**
 * Geometry used by long-move splitting (SAFETY §4.3, §4.7 step 6a): the
 * duration model, number formatting, and the arc model against EN's arc code.
 */
import { describe, expect, it } from 'vitest';
import { formatNumber, modelArc, moveSeconds, noVelocityMessage, roundTo, splitArc, splitLinear, type ArcInput } from '../src/sanitize/geometry.ts';
import type { MotionModel } from '../src/index.ts';
import { STANDARD_LINEAR, STANDARD_ROTARY } from './sanitizeHelpers.ts';

const MODEL: MotionModel = { ceilingSeconds: 5, k: 0.5, maxVelocity: { X: 1000, Y: 2000, Z: 500 }, feedrateMax: { X: 1000, Y: 2000, Z: 500 }, rotary: STANDARD_ROTARY, linear: STANDARD_LINEAR };

const arc = (over: Partial<ArcInput>): ArcInput => ({
  clockwise: true,
  d0: 10,
  d1: 0,
  dLin: 0,
  centre: { c0: 5, c1: 0 },
  radius: null,
  noPlaneEndpoint: false,
  rotations: null,
  coincidence: 'position',
  magnitudeMm: 0,
  startUncertaintyMm: 0,
  ...over,
});

describe('moveSeconds: length over v_eff = min(F, fr) × k, or vm × k for a rapid', () => {
  it('uses the slowest moving axis for vm, and F when it is lower', () => {
    expect(moveSeconds(['X', 'Y'], 100, null, MODEL)).toEqual({ kind: 'ok', seconds: 12 });
    expect(moveSeconds(['Y'], 100, null, MODEL)).toEqual({ kind: 'ok', seconds: 6 });
    expect(moveSeconds(['Y'], 100, 600, MODEL)).toEqual({ kind: 'ok', seconds: 20 });
    expect(moveSeconds(['Y'], 100, 5000, MODEL)).toEqual({ kind: 'ok', seconds: 6 });
    expect(moveSeconds([], 0, null, MODEL)).toEqual({ kind: 'ok', seconds: 0 });
  });

  it('refuses an axis with no usable velocity', () => {
    expect(moveSeconds(['A'], 1, null, MODEL)).toEqual({ kind: 'noVelocity', axis: 'A', limit: 'vm' });
    expect(moveSeconds(['X'], 1, null, { ...MODEL, maxVelocity: { X: 0 } })).toEqual({ kind: 'noVelocity', axis: 'X', limit: 'vm' });
    expect(moveSeconds(['X'], 1, null, { ...MODEL, maxVelocity: { X: Number.POSITIVE_INFINITY } })).toEqual({ kind: 'noVelocity', axis: 'X', limit: 'vm' });
    expect(moveSeconds(['X'], 1, 100, { ...MODEL, feedrateMax: { Y: 100 } })).toEqual({ kind: 'noVelocity', axis: 'X', limit: 'fr' });
    expect(noVelocityMessage({ kind: 'noVelocity', axis: 'X', limit: 'vm' })).toContain('maximum velocity (vm)');
    expect(noVelocityMessage({ kind: 'noVelocity', axis: 'X', limit: 'fr' })).toContain('feed rate maximum (fr)');
  });

  it('limits a feed move by fr, not vm, and a rapid by vm, not fr (EN plan_line.c:377-381)', () => {
    // xvm 16000, xfr 1000, G1 X300 F10000: the firmware runs at 1000 mm/min, so 300 / (1000 × 0.5) min = 36 s.
    const model: MotionModel = { ...MODEL, maxVelocity: { X: 16000 }, feedrateMax: { X: 1000 } };
    expect(moveSeconds(['X'], 300, 10000, model)).toEqual({ kind: 'ok', seconds: 36 });
    // A rapid ignores fr: 300 / (16000 × 0.5) min = 2.25 s.
    expect(moveSeconds(['X'], 300, null, model)).toEqual({ kind: 'ok', seconds: 2.25 });
    // A feed below fr is the limit.
    expect(moveSeconds(['X'], 300, 600, model)).toEqual({ kind: 'ok', seconds: 60 });
  });
});

describe('formatNumber', () => {
  it('prints without exponent, trailing zeros or -0', () => {
    expect(formatNumber(1.5, 4)).toBe('1.5');
    expect(formatNumber(2, 4)).toBe('2');
    expect(formatNumber(5, 0)).toBe('5');
    expect(formatNumber(-0.00001, 4)).toBe('0');
    expect(formatNumber(1e-7, 5)).toBe('0');
    expect(formatNumber(123456.123456, 4)).toBe('123456.1235');
    expect(roundTo(1.23456, 4)).toBe(1.2346);
  });
});

describe('modelArc follows EN plan_arc.c', () => {
  it('G18 EN-HIL e029: G2 X2 Z0 I1 K0.75 dips to Z-0.5 (standard direction)', () => {
    // G18 plane axes are (Z, X): d0 = dZ = 0, d1 = dX = 2, centre (K, I) = (0.75, 1).
    const r = modelArc(arc({ d0: 0, d1: 2, centre: { c0: 0.75, c1: 1 } }));
    if (r.kind !== 'ok') throw new Error(r.detail);
    const mid = r.arc.theta + r.arc.travel / 2;
    expect(r.arc.c0 + Math.sin(mid) * r.arc.radius).toBeCloseTo(-0.5, 9);
    expect(r.arc.radius).toBeCloseTo(1.25, 12);
  });

  it('R format: the centre side follows direction and the sign of R; R = chord/2 is a half circle', () => {
    const cw = modelArc(arc({ centre: null, radius: 5 }));
    const ccw = modelArc(arc({ centre: null, radius: 5, clockwise: false }));
    const big = modelArc(arc({ centre: null, radius: -6 }));
    const small = modelArc(arc({ centre: null, radius: 6 }));
    for (const r of [cw, ccw, big, small]) if (r.kind !== 'ok') throw new Error(r.detail);
    if (cw.kind !== 'ok' || ccw.kind !== 'ok' || big.kind !== 'ok' || small.kind !== 'ok') return;
    expect(Math.abs(cw.arc.travel)).toBeCloseTo(Math.PI, 9);
    expect(ccw.arc.travel).toBeCloseTo(-Math.PI, 9);
    expect(Math.abs(big.arc.travel)).toBeGreaterThan(Math.PI);
    expect(Math.abs(small.arc.travel)).toBeLessThan(Math.PI);
    expect(big.arc.c1).toBeCloseTo(-small.arc.c1, 9);
  });

  it('a clockwise arc whose raw angle difference is negative goes the long way round, as EN does', () => {
    const r = modelArc(arc({ d0: -10, centre: { c0: -5, c1: 0 } }));
    expect(r.kind === 'ok' && r.arc.travel).toBeCloseTo(Math.PI, 12);
  });

  it('full circles: P turns, or one turn by default; coincident end points with plane words are a full circle', () => {
    const one = modelArc(arc({ d0: 0, noPlaneEndpoint: true }));
    const two = modelArc(arc({ d0: 0, noPlaneEndpoint: true, rotations: 2, clockwise: false }));
    const coincident = modelArc(arc({ d0: 0 }));
    const coincidentCcw = modelArc(arc({ d0: 0, clockwise: false }));
    expect(one.kind === 'ok' && one.arc.travel).toBeCloseTo(2 * Math.PI, 12);
    expect(two.kind === 'ok' && two.arc.travel).toBeCloseTo(-4 * Math.PI, 12);
    expect(coincident.kind === 'ok' && coincident.arc.travel).toBeCloseTo(2 * Math.PI, 12);
    expect(coincidentCcw.kind === 'ok' && coincidentCcw.arc.travel).toBeCloseTo(-2 * Math.PI, 12);
    // P adds whole turns to a partial arc.
    const plus = modelArc(arc({ rotations: 1 }));
    expect(plus.kind === 'ok' && plus.arc.travel).toBeCloseTo(3 * Math.PI, 12);
  });

  it('refuses what the firmware refuses', () => {
    expect(modelArc(arc({ noPlaneEndpoint: true, d0: 0, rotations: 0 }))).toEqual({ kind: 'invalid', detail: 'the arc has no movement' });
    expect(modelArc(arc({ centre: { c0: 0, c1: 0 } })).kind).toBe('invalid');
    expect(modelArc(arc({ centre: { c0: 4, c1: 0 } })).kind).toBe('invalid');
    expect(modelArc(arc({ centre: null, radius: 4 })).kind).toBe('invalid');
    expect(modelArc(arc({ centre: null, radius: 0.05 })).kind).toBe('invalid');
    expect(modelArc(arc({ centre: null, radius: 5, d0: 0 })).kind).toBe('invalid');
    // Within max(0.005 mm, 0.1 % of r) the centre is accepted.
    expect(modelArc(arc({ centre: { c0: 5.002, c1: 0 } })).kind).toBe('ok');
    expect(modelArc(arc({ centre: { c0: 5.004, c1: 0 } })).kind).toBe('invalid');
  });
});

describe('splitting refuses what it cannot do within tolerance', () => {
  const TWO: MotionModel = { ...MODEL, ceilingSeconds: 2 };
  it('a straight move that would need sub-segments under 0.01 mm', () => {
    const r = splitLinear([{ axis: 'X', start: 0, delta: 1, written: '1', scale: 1, mmPerUnit: 1, decimals: 4 }], true, 0.3, 400, TWO);
    expect(r.kind).toBe('impossible');
  });

  it('a sub-arc chord under 0.01 mm', () => {
    const input = arc({ d0: 1, centre: { c0: 0.5, c1: 0 } });
    const m = modelArc(input);
    if (m.kind !== 'ok') throw new Error(m.detail);
    const w = { plane: 'G17', absolute: true, absoluteCentre: false, start0: 0, start1: 0, startLin: 0, scale: 1, decimals: 4, written: { a0: '1', a1: '0', lin: '0' }, linearMoves: false } as const;
    expect(splitArc(m.arc, input, w, 0.3, 700, TWO).kind).toBe('impossible');
  });

  it('adds segments until every one fits, starting from a low estimate', () => {
    // Told the move takes 1 s, the splitter starts with 2 segments and adds more until each fits 2 s.
    const lin = splitLinear([{ axis: 'X', start: 0, delta: 100, written: '100', scale: 1, mmPerUnit: 1, decimals: 4 }], true, 600, 1, TWO);
    expect(lin.kind === 'ok' && lin.segments.length).toBe(11);
    const input = arc({ d0: 100, centre: { c0: 50, c1: 0 } });
    const m = modelArc(input);
    if (m.kind !== 'ok') throw new Error(m.detail);
    const w = { plane: 'G17', absolute: true, absoluteCentre: false, start0: 0, start1: 0, startLin: 0, scale: 1, decimals: 4, written: { a0: '100', a1: '0', lin: '0' }, linearMoves: false } as const;
    const r = splitArc(m.arc, input, w, 600, 1, TWO);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') for (const seg of r.segments) expect(seg.seconds).toBeLessThanOrEqual(2);
  });

  it('a clockwise sub-arc across the atan2 seam gets the same travel the firmware will compute', () => {
    // Semicircle from east to west about (-50, 0), clockwise through south, in three sub-arcs: the middle one
    // crosses the seam where EN's start angle wraps from +pi to -pi.
    const fast: MotionModel = { ceilingSeconds: 2, k: 0.5, maxVelocity: { X: 1e6, Y: 1e6 }, feedrateMax: { X: 1e6, Y: 1e6 }, rotary: STANDARD_ROTARY, linear: STANDARD_LINEAR };
    const input = arc({ d0: -100, centre: { c0: -50, c1: 0 } });
    const m = modelArc(input);
    if (m.kind !== 'ok') throw new Error(m.detail);
    const w = { plane: 'G17', absolute: true, absoluteCentre: false, start0: 0, start1: 0, startLin: 0, scale: 1, decimals: 4, written: { a0: '-100', a1: '0', lin: '0' }, linearMoves: false } as const;
    const r = splitArc(m.arc, input, w, 1e6, 5, fast);
    expect(r.kind === 'ok' && r.segments.map((seg) => seg.words.slice(0, 2).join(' '))).toEqual(['X-25 Y-43.3013', 'X-75 Y-43.3013', 'X-100 Y0']);
  });

  it('a sub-arc that fails the continuity check after rounding', () => {
    const input = arc({});
    const m = modelArc(input);
    if (m.kind !== 'ok') throw new Error(m.detail);
    // A model inconsistent with the written numbers: the centre the firmware would use is not where the sub-arcs are.
    const wrong = { ...m.arc, c0: m.arc.c0 + 0.5 };
    const w = { plane: 'G17', absolute: true, absoluteCentre: false, start0: 0, start1: 0, startLin: 0, scale: 1, decimals: 4, written: { a0: '10', a1: '0', lin: '0' }, linearMoves: false } as const;
    expect(splitArc(wrong, input, w, 10, 100, MODEL)).toEqual({ kind: 'impossible', detail: 'a sub-arc fails the continuity check after rounding' });
  });
});
