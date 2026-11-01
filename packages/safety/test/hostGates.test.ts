/**
 * Profile field classes (ROADMAP P0-10, SAFETY §4.10 rule 4, T-S69): a
 * host-gate loosening is not used without C19 (typed `WRITE` for spindle
 * kind away from laser or plasma, the ceiling and the jog caps); a
 * tightening applies at once; the envelope comes only from `tn`/`tm`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HOST_GATE_FIELDS, diffHostGates, effectiveHostGates, workEnvelope, type HostGates } from '../src/index.ts';

const BASE: HostGates = {
  spindleKind: 'laser',
  dualMotorAxes: [{ axis: 'Y', motors: [2, 3] }],
  queuedMotionCeilingS: 5,
  jogCaps: { maxStepMm: 10, maxFeedMmPerMin: 1000 },
  homingOrder: ['Z', 'X', 'Y'],
  holdTimeoutS: 60,
  hostLossPolicy: 'drain',
};

const NONE = { accepted: false, typedWrite: false };
const C19 = { accepted: true, typedWrite: false };
const TYPED = { accepted: true, typedWrite: true };

describe('T-S69: host gates', () => {
  it('lists exactly the host gates of SAFETY §4.10 rule 4, and no envelope', () => {
    expect([...HOST_GATE_FIELDS].sort()).toEqual(Object.keys(BASE).sort());
    for (const f of HOST_GATE_FIELDS) expect(f.toLowerCase()).not.toMatch(/envelope|travel|^tn|^tm/);
  });

  it('spindle kind away from laser needs the typed C19; towards laser applies at once', () => {
    const toSpindle = { ...BASE, spindleKind: 'spindle' as const };
    expect(diffHostGates(BASE, toSpindle)).toEqual([{ field: 'spindleKind', loosens: true, typed: true, malformed: false }]);
    expect(effectiveHostGates(BASE, toSpindle, NONE).spindleKind).toBe('laser');
    expect(effectiveHostGates(BASE, toSpindle, C19).spindleKind).toBe('laser');
    expect(effectiveHostGates(BASE, toSpindle, TYPED).spindleKind).toBe('spindle');
    const fromSpindle = { ...BASE, spindleKind: 'spindle' as const };
    expect(effectiveHostGates(fromSpindle, { ...fromSpindle, spindleKind: 'plasma' }, NONE).spindleKind).toBe('plasma');
  });

  it('a larger ceiling or larger jog caps need the typed C19; smaller ones apply at once', () => {
    expect(effectiveHostGates(BASE, { ...BASE, queuedMotionCeilingS: 10 }, C19).queuedMotionCeilingS).toBe(5);
    expect(effectiveHostGates(BASE, { ...BASE, queuedMotionCeilingS: 10 }, TYPED).queuedMotionCeilingS).toBe(10);
    expect(effectiveHostGates(BASE, { ...BASE, queuedMotionCeilingS: 3 }, NONE).queuedMotionCeilingS).toBe(3);
    expect(effectiveHostGates(BASE, { ...BASE, jogCaps: { maxStepMm: 10, maxFeedMmPerMin: 2000 } }, C19).jogCaps.maxFeedMmPerMin).toBe(1000);
    expect(effectiveHostGates(BASE, { ...BASE, jogCaps: { maxStepMm: 20, maxFeedMmPerMin: 1000 } }, TYPED).jogCaps.maxStepMm).toBe(20);
    expect(effectiveHostGates(BASE, { ...BASE, jogCaps: { maxStepMm: 5, maxFeedMmPerMin: 500 } }, NONE).jogCaps).toEqual({ maxStepMm: 5, maxFeedMmPerMin: 500 });
  });

  it('dropping or remapping a dual-motor axis, a new homing order, a longer or disabled hold timeout and a new host-loss policy need C19', () => {
    const cases: Partial<HostGates>[] = [
      { dualMotorAxes: [] },
      { dualMotorAxes: [{ axis: 'Y', motors: [2, 4] }] },
      { homingOrder: ['X', 'Y', 'Z'] },
      { holdTimeoutS: 120 },
      { holdTimeoutS: null },
      { hostLossPolicy: 'hold-and-spindle-pause' },
    ];
    for (const change of cases) {
      const proposed = { ...BASE, ...change };
      const [d] = diffHostGates(BASE, proposed);
      expect(d?.loosens, JSON.stringify(change)).toBe(true);
      expect(d?.typed).toBe(false);
      expect(effectiveHostGates(BASE, proposed, NONE)).toEqual(BASE);
      expect(effectiveHostGates(BASE, proposed, C19)).toEqual(proposed);
    }
  });

  it('adding a dual-motor axis or shortening the hold timeout tightens and applies at once', () => {
    const more = { ...BASE, dualMotorAxes: [...BASE.dualMotorAxes, { axis: 'X', motors: [1, 4] }], holdTimeoutS: 30 };
    expect(diffHostGates(BASE, more).every((c) => !c.loosens)).toBe(true);
    expect(effectiveHostGates(BASE, more, NONE)).toEqual(more);
    const disabled = { ...BASE, holdTimeoutS: null };
    expect(effectiveHostGates(disabled, BASE, NONE).holdTimeoutS).toBe(60);
  });

  it('without C19 the effective gates are never looser than the confirmed ones (fast-check)', () => {
    const gates = fc.record({
      spindleKind: fc.constantFrom('spindle', 'laser', 'plasma', 'none'),
      dualMotorAxes: fc.subarray([{ axis: 'Y', motors: [2, 3] }, { axis: 'X', motors: [1, 4] }]),
      queuedMotionCeilingS: fc.integer({ min: 2, max: 20 }),
      jogCaps: fc.record({ maxStepMm: fc.integer({ min: 1, max: 100 }), maxFeedMmPerMin: fc.integer({ min: 10, max: 5000 }) }),
      homingOrder: fc.constantFrom(['Z', 'X', 'Y'], ['X', 'Y', 'Z']),
      holdTimeoutS: fc.option(fc.integer({ min: 10, max: 300 }), { nil: null }),
      hostLossPolicy: fc.constantFrom('drain', 'hold-and-spindle-pause'),
    }) as fc.Arbitrary<HostGates>;
    fc.assert(
      fc.property(gates, gates, fc.boolean(), (confirmed, proposed, accepted) => {
        const eff = effectiveHostGates(confirmed, proposed, { accepted, typedWrite: false });
        // Nothing loosens relative to the confirmed gates, except untyped-C19 fields when accepted.
        for (const c of diffHostGates(confirmed, eff)) {
          if (c.loosens) {
            expect(accepted).toBe(true);
            expect(c.typed).toBe(false);
          }
        }
        expect(eff.queuedMotionCeilingS).toBeLessThanOrEqual(confirmed.queuedMotionCeilingS);
        expect(eff.jogCaps.maxStepMm).toBeLessThanOrEqual(confirmed.jogCaps.maxStepMm);
      }),
    );
  });
});

describe('the envelope comes only from the board', () => {
  it('uses tn/tm per axis, and leaves out an axis without both or with tn >= tm', () => {
    expect(workEnvelope({ tn: { X: 0, Y: -10, Z: -50, A: 5 }, tm: { X: 300, Y: 200, Z: 0, A: 5, B: 1 } })).toEqual({
      X: { min: 0, max: 300 },
      Y: { min: -10, max: 200 },
      Z: { min: -50, max: 0 },
    });
    expect(workEnvelope({ tn: { X: Number.NaN }, tm: { X: 1 } })).toEqual({});
    expect(workEnvelope({ tn: { X: 0 }, tm: { X: Number.POSITIVE_INFINITY } })).toEqual({});
  });

  it('takes nothing but tn and tm', () => {
    expect(workEnvelope.length).toBe(1);
    const fromProfile = { tn: {}, tm: {}, envelope: { X: { min: 0, max: 1 } } };
    expect(workEnvelope(fromProfile)).toEqual({});
  });
});

describe('malformed proposed values fail closed (SAFETY §4.10 rule 4)', () => {
  const bad: [string, Partial<Record<keyof HostGates, unknown>>][] = [
    ['jog step null', { jogCaps: { maxStepMm: null, maxFeedMmPerMin: 1000 } }],
    ['jog step NaN', { jogCaps: { maxStepMm: Number.NaN, maxFeedMmPerMin: 1000 } }],
    ['jog step string', { jogCaps: { maxStepMm: '5', maxFeedMmPerMin: 1000 } }],
    ['jog feed missing', { jogCaps: { maxStepMm: 5 } }],
    ['jog caps null', { jogCaps: null }],
    ['jog step negative', { jogCaps: { maxStepMm: -1, maxFeedMmPerMin: 1000 } }],
    ['jog step zero', { jogCaps: { maxStepMm: 0, maxFeedMmPerMin: 1000 } }],
    ['ceiling above range', { queuedMotionCeilingS: 21 }],
    ['dual motor axis not a string', { dualMotorAxes: [{ axis: 5, motors: [2, 3] }] }],
    ['ceiling NaN', { queuedMotionCeilingS: Number.NaN }],
    ['ceiling null', { queuedMotionCeilingS: null }],
    ['ceiling string', { queuedMotionCeilingS: '3' }],
    ['ceiling below range', { queuedMotionCeilingS: 1 }],
    ['hold timeout NaN', { holdTimeoutS: Number.NaN }],
    ['hold timeout string', { holdTimeoutS: '30' }],
    ['spindle kind unknown', { spindleKind: 'router' }],
    ['dual motor not a list', { dualMotorAxes: 'Y' }],
    ['dual motor bad motor', { dualMotorAxes: [{ axis: 'Y', motors: [2, 'x'] }, { axis: 'X', motors: [1, 4] }] }],
    ['dual motor entry null', { dualMotorAxes: [null] }],
    ['homing order not strings', { homingOrder: ['Z', 1] }],
    ['homing order null', { homingOrder: null }],
    ['host loss policy unknown', { hostLossPolicy: 'ignore' }],
  ];

  for (const [name, patch] of bad) {
    it(`${name}: reported as a malformed loosening and never applied, even with typed C19`, () => {
      const proposed = { ...BASE, ...patch } as unknown as HostGates;
      const changes = diffHostGates(BASE, proposed);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ loosens: true, malformed: true });
      expect(effectiveHostGates(BASE, proposed, TYPED)).toEqual(BASE);
      expect(effectiveHostGates(BASE, proposed, NONE)).toEqual(BASE);
    });
  }

  it('every enumerated value and the range ends are well formed', () => {
    for (const spindleKind of ['spindle', 'laser', 'plasma', 'none'] as const) {
      expect(diffHostGates({ ...BASE, spindleKind: 'spindle' }, { ...BASE, spindleKind }).every((c) => !c.malformed), spindleKind).toBe(true);
    }
    for (const hostLossPolicy of ['drain', 'hold-and-spindle-pause'] as const) {
      expect(diffHostGates({ ...BASE, hostLossPolicy: hostLossPolicy === 'drain' ? 'hold-and-spindle-pause' : 'drain' }, { ...BASE, hostLossPolicy })[0]?.malformed).toBe(false);
    }
    for (const queuedMotionCeilingS of [2, 20]) {
      expect(diffHostGates({ ...BASE, queuedMotionCeilingS: 5 }, { ...BASE, queuedMotionCeilingS })[0]?.malformed, String(queuedMotionCeilingS)).toBe(false);
    }
  });

  it('well-formed tightenings still apply at once', () => {
    const tighter: HostGates = { ...BASE, jogCaps: { maxStepMm: 1, maxFeedMmPerMin: 500 }, queuedMotionCeilingS: 2, holdTimeoutS: 30 };
    expect(effectiveHostGates(BASE, tighter, NONE)).toEqual(tighter);
    expect(diffHostGates(BASE, tighter).every((c) => !c.malformed)).toBe(true);
  });
});
