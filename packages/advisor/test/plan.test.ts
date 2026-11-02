/** §5.2 rules model for one operation: levels, checks, comparison and verdict, provenance, refusals. */
import { builtinMaterial, type Material, type Tool } from '@synthetos/library';
import { describe, expect, it } from 'vitest';
import { chipThinningFactor, planOperation, type AdvisorContext, type OperationPlan, type Point3 } from '../src/index.ts';
import { AL_6061, CITED_MODEL, SOURCE, citedMaterial, context, dialMachine, machine, tool } from './fixtures.ts';

type Planned = Extract<OperationPlan, { ok: true }>;

function planned(ctx: AdvisorContext): Planned {
  const p = planOperation(ctx);
  if (!p.ok) throw new Error(`${p.refusal}: ${p.message}`);
  return p;
}

const D = 3.175;
const THIN = chipThinningFactor(D, 1.2);

describe('levels', () => {
  it('span the surface speed and chipload ranges, with the frame factor and chip thinning', () => {
    const p = planned(context());
    const { conservative: c, balanced: b, aggressive: a } = p.levels;
    expect(c.rpm).toBeCloseTo(100_000 / (Math.PI * D), 6);
    expect(c.fz).toBeCloseTo(0.004 * D * 0.8, 12);
    expect(c.fzProgrammed).toBeCloseTo(c.fz * THIN, 12);
    expect(c.feed).toBeCloseTo(c.rpm * 2 * c.fzProgrammed, 9);
    expect(c.vc).toBeCloseTo(100, 9);
    expect(b.rpm).toBeCloseTo(200_000 / (Math.PI * D), 6);
    expect(b.fz).toBeCloseTo(0.006 * D * 0.8, 12);
    expect(a.rpm).toBe(24_000);
    expect(a.limitedBy).toEqual(['spindle-max']);
    expect(a.fz).toBeCloseTo(0.008 * D * 0.8, 12);
    expect(c.feed).toBeLessThan(b.feed);
    expect(b.feed).toBeLessThan(a.feed);
    for (const l of [c, b, a]) {
      expect(l.checks.map((k) => k.kind)).toEqual(['spindle-power', 'axis-max', 'frame-ap', 'frame-ae', 'deflection', 'coolant']);
      expect(l.checks.every((k) => k.status === 'ok')).toBe(true);
      expect(l.powerKw).toBeGreaterThan(0);
      expect(l.deflectionMm).toBeGreaterThan(0);
      expect(l.dial).toBeNull();
    }
    expect(p.provenance).toEqual({ placeholder: false, placeholderInputs: [], sources: ['Test handbook, 1st ed., table 1'] });
    expect(p.comparison).toBeNull();
    expect(p.achievable).toBeNull();
    expect(p.notes).toEqual([]);
    expect(p.operation).toBe('pocket');
  });

  it('holds a level at the axis maximum and slows the spindle to keep the chipload, down to the spindle minimum', () => {
    const p = planned(context({ machine: machine({ maxFeed: { xy: 400, z: 400 } }) }));
    const a = p.levels.aggressive;
    expect(a.feed).toBe(400);
    expect(a.rpm).toBeCloseTo(400 / (2 * a.fzProgrammed), 9);
    expect(a.limitedBy).toEqual(['spindle-max', 'axis-max']);
    const slow = planned(context({ machine: machine({ maxFeed: { xy: 100, z: 100 } }) }));
    expect(slow.levels.conservative).toMatchObject({ feed: 100, rpm: 6000, limitedBy: ['axis-max', 'spindle-min'] });
    const lowVc = citedMaterial({ cutting: [{ ...citedMaterial().cutting[0], vc: { value: { min: 10, max: 20 }, source: SOURCE } }] });
    const both = planned(context({ material: lowVc, machine: machine({ maxFeed: { xy: 100, z: 100 } }) }));
    expect(both.levels.conservative.limitedBy).toEqual(['spindle-min', 'axis-max']);
  });

  it('uses manufacturer cutting data over the generic range, then Synthetos data; user and AI entries are not targets', () => {
    const entry = { materialRef: { id: 'mine.al', version: 1 }, vc: 150, fz: 0.02, ap: 1, ae: 1, coolant: 'air', note: 'catalogue p. 12' };
    const t = tool({ cuttingData: [{ ...entry, source: 'user', vc: 999 }, { ...entry, source: 'synthetos', vc: 120 }, { ...entry, source: 'manufacturer' }] });
    const p = planned(context({ tool: t }));
    for (const l of Object.values(p.levels)) {
      expect(l.vc).toBeCloseTo(150, 9);
      expect(l.fz).toBeCloseTo(0.02 * 0.8, 12);
    }
    expect(p.provenance.sources).toContain('1/8 in 2-flute cutting data for Cited 6061, catalogue p. 12');
    const synth = planned(context({ tool: tool({ cuttingData: [{ ...entry, source: 'synthetos', vc: 120, note: '' }, { ...entry, source: 'ai', vc: 500 }] }) }));
    expect(synth.levels.balanced.vc).toBeCloseTo(120, 9);
    expect(synth.provenance.sources).toContain('1/8 in 2-flute cutting data for Cited 6061');
    const ignored = planned(context({ tool: tool({ cuttingData: [{ ...entry, source: 'user' }, { ...entry, materialRef: { id: 'other', version: 1 }, source: 'manufacturer' }] }) }));
    expect(ignored.levels.balanced.vc).toBeCloseTo(200, 9);
  });

  it('drilling: no chip thinning, the Z maximum, no deflection check', () => {
    const p = planned(context({ operation: { kind: 'drill', ap: 5, ae: D } }));
    expect(p.levels.balanced.fzProgrammed).toBeCloseTo(p.levels.balanced.fz, 12);
    expect(p.levels.balanced.checks.map((c) => c.kind)).not.toContain('deflection');
    expect(p.levels.balanced.deflectionMm).toBeNull();
    expect(p.levels.balanced.checks.find((c) => c.kind === 'axis-max')?.reason.values['maxFeed']).toBe(1000);
  });

  it('flags power, frame limits and deflection on the levels', () => {
    const weak = planned(context({ machine: machine({ spindle: { kind: 'vfd', minRpm: 6000, maxRpm: 24_000, powerKw: 0.005, sControlled: true } }) }));
    expect(weak.levels.aggressive.checks.find((c) => c.kind === 'spindle-power')?.status).toBe('fail');
    const deep = planned(context({ operation: { kind: 'finish', ap: 3, ae: 1.2 }, stickout: 38 }));
    const kinds = deep.levels.aggressive.checks.filter((c) => c.status === 'fail').map((c) => c.kind);
    expect(kinds).toContain('frame-ap');
    expect(kinds).toContain('deflection');
  });

  it('reports unknown deflection and power when the data is missing', () => {
    const noKc = citedMaterial({ physical: { density: { value: 2.7, source: SOURCE } } });
    const p = planned(context({ material: noKc }));
    expect(p.levels.balanced.powerKw).toBeNull();
    expect(p.levels.balanced.checks.find((c) => c.kind === 'spindle-power')?.status).toBe('unknown');
    expect(p.levels.balanced.checks.find((c) => c.kind === 'deflection')?.status).toBe('unknown');
    const noStickout = tool({ geometry: { diameter: D, shank: D, flutes: 2, fluteLength: 12, overallLength: 38 } });
    expect(planned(context({ tool: noStickout })).levels.balanced.deflectionMm).toBeNull();
    const noTypes = planned(context({ model: { ...CITED_MODEL, toolTypes: [] } }));
    expect(noTypes.levels.balanced.deflectionMm).toBeNull();
    expect(noTypes.provenance.placeholder).toBe(false);
  });

  it('maps every level to a dial position on a dial router, and notes that S does not set it', () => {
    const p = planned(context({ machine: dialMachine() }));
    expect(p.levels.aggressive.dial).toMatchObject({ setting: expect.any(String) });
    expect(p.notes).toContain('S does not set this spindle: set the speed by hand.');
  });

  it('flags placeholders: the seed data and the default model are never advice', () => {
    const { model: _model, ...seedOnly } = context({ material: AL_6061 });
    const p = planned(seedOnly);
    expect(p.provenance.placeholder).toBe(true);
    expect(p.provenance.placeholderInputs).toEqual([
      'material.cutting.chipload',
      'material.cutting.engagement',
      'material.cutting.vc',
      'material.physical.kc',
      'model.frameClassFactor.medium',
      'model.toolMaterials.carbide.youngsModulusGPa',
      'model.toolTypes.flat.effectiveDiameterRatio',
    ]);
    expect(p.provenance.sources).toEqual([]);
  });
});

describe('comparison and verdict', () => {
  const balanced = (p: Planned) => p.levels.balanced;

  it('within: programmed at the balanced level', () => {
    const b = balanced(planned(context()));
    const p = planned(context({ operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: b.feed, rpm: b.rpm } } }));
    expect(p.comparison).toMatchObject({ verdict: 'within', fzAtAchievable: null, suggestedRpm: null, suggestedDial: null });
    expect(p.comparison?.fz).toBeCloseTo(b.fz, 12);
    expect(p.comparison?.reasons).toEqual([expect.stringMatching(/^The programmed chipload is 0\.015 mm \(levels 0\.010-0\.020 mm\)\.$/)]);
    expect(p.comparison?.checks.map((c) => c.kind)).toEqual(['spindle-power', 'axis-max', 'frame-ap', 'frame-ae', 'deflection', 'coolant', 'spindle-range', 'rubbing']);
  });

  it('too aggressive: a chipload above the aggressive level, or a failed power, axis, frame, deflection or spindle check', () => {
    const fast = planned(context({ operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: 3000, rpm: 18_000 } } }));
    expect(fast.comparison?.verdict).toBe('too-aggressive');
    expect(fast.comparison?.reasons.some((r) => /above the aggressive level/.test(r))).toBe(true);
    const weak = planned(
      context({
        machine: machine({ spindle: { kind: 'vfd', minRpm: 6000, maxRpm: 24_000, powerKw: 0.005, sControlled: true } }),
        operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: 600, rpm: 20_000 } },
      }),
    );
    expect(weak.comparison?.verdict).toBe('too-aggressive');
    expect(weak.comparison?.reasons[0]).toMatch(/^Needs about .* kW; the spindle is rated 0\.01 kW\.$/);
    const overTool = planned(context({ toolMaxRpm: 16_000, operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: 500, rpm: 18_000 } } }));
    expect(overTool.comparison?.verdict).toBe('too-aggressive');
    expect(overTool.levels.aggressive.limitedBy).toEqual(['tool-max']);
  });

  it('rubbing: suggests a slower spindle, clamped to the spindle range, and the dial position on a dial router', () => {
    const p = planned(context({ operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: 100, rpm: 24_000 } } }));
    expect(p.comparison?.verdict).toBe('rubbing');
    expect(p.comparison?.suggestedRpm).toBe(6000);
    expect(p.comparison?.reasons.at(-1)).toBe('Slow the spindle to about 6000 rpm to keep the chips thick.');
    expect(p.comparison?.suggestedDial).toBeNull();
    const dial = planned(context({ machine: dialMachine(), operation: { kind: 'pocket', ap: 0.5, ae: 0.6, programmed: { feed: 200, rpm: 30_000 } } }));
    expect(dial.comparison?.verdict).toBe('rubbing');
    expect(dial.comparison?.suggestedRpm).toBe(10_000);
    expect(dial.comparison?.suggestedDial).toMatchObject({ setting: '1' });
  });

  it('a suggested speed stays inside the spindle range and under the tool maximum', () => {
    const p = planned(context({ toolMaxRpm: 9000, operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: 50, rpm: 9000 } } }));
    expect(p.comparison?.verdict).toBe('rubbing');
    expect(p.comparison?.suggestedRpm).toBe(6000);
    const fast = planned(context({ operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: 200, rpm: 24_000 } } }));
    expect(fast.comparison?.verdict).toBe('rubbing');
    expect(fast.comparison?.suggestedRpm).toBeCloseTo(200 / (2 * fast.levels.balanced.fzProgrammed), 6);
  });

  it('check: a warning or a coolant failure without anything too aggressive', () => {
    const b = balanced(planned(context()));
    const p = planned(context({ coolant: 'none', operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: b.feed, rpm: b.rpm } } }));
    expect(p.comparison?.verdict).toBe('check');
    expect(p.comparison?.reasons[0]).toMatch(/needs coolant/);
  });

  it('uses the achievable feed when the path and the motion limits are known, and says it is an estimate', () => {
    const path: Point3[] = [];
    for (let i = 0; i < 40; i++) path.push([i % 2 === 0 ? 0 : 1.3, i * 1.3, 0]);
    const p = planned(context({ operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: 1500, rpm: 24_000 }, path } }));
    expect(p.achievable?.estimate).toBe(true);
    expect(p.achievable?.fraction).toBeLessThan(1);
    expect(p.comparison?.fzAtAchievable).toBeLessThan(p.comparison?.fz as number);
    expect(p.comparison?.reasons.some((r) => r.startsWith('Estimate: this operation averages about'))).toBe(true);
    const { motion: _motion, ...still } = machine();
    const noMotion = planned(context({ machine: still, operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: 1500, rpm: 24_000 }, path } }));
    expect(noMotion.achievable).toBeNull();
    const bad = planned(context({ operation: { kind: 'pocket', ap: 1, ae: 1.2, programmed: { feed: 1500, rpm: 24_000 }, path: [[0, 0, 0]] } }));
    expect(bad.achievable).toBeNull();
    expect(bad.notes).toEqual(['No achievable-feed estimate: The path has no length.']);
    const noProgram = planned(context({ operation: { kind: 'pocket', ap: 1, ae: 1.2, path } }));
    expect(noProgram.achievable).toBeNull();
  });
});

describe('refusals', () => {
  it('refuses a do-not-machine material (PVC) with its safety note', () => {
    const pvc = builtinMaterial('builtin.pvc') as Material;
    const p = planOperation(context({ material: pvc }));
    expect(p).toMatchObject({ ok: false, refusal: 'do-not-machine', message: expect.stringMatching(/^Do not machine PVC/) });
    expect(p.safety).toEqual(pvc.safety);
  });

  it('refuses a tool material the material has no data for', () => {
    const p = planOperation(context({ tool: tool({ toolMaterial: 'hss' }) }));
    expect(p).toMatchObject({ ok: false, refusal: 'no-cutting-data', message: 'Cited 6061 has no cutting data for hss tools.' });
  });

  it('refuses inputs that are not valid, saying which', () => {
    const m = machine();
    const op = { kind: 'pocket' as const, ap: 1, ae: 1.2 };
    const cases: [Partial<AdvisorContext>, RegExp][] = [
      [{ tool: tool({ type: 'spoon' }) }, /^The tool is not valid: \/type/],
      [{ tool: tool({ geometry: { diameter: 3, shank: 3, flutes: 2, fluteLength: 50, overallLength: 38 } }) }, /^The tool is not valid: \/geometry\/fluteLength/],
      [{ material: citedMaterial({ family: 'unobtainium' }) }, /^The material is not valid/],
      [{ material: { ...citedMaterial(), id: '' } as Material }, /^The material is not valid: \/id/],
      [{ material: (({ notes: _n, ...rest }) => rest)(citedMaterial()) as Material }, /^The material is not valid: \/ missing required property "notes"/],
      [{ tool: (({ notes: _n, ...rest }) => rest)(tool()) as Tool }, /^The tool is not valid: \/ missing required property "notes"/],
      [{ machine: { ...m, spindle: { ...m.spindle, minRpm: 30_000 } } }, /speed range/],
      [{ machine: { ...m, spindle: { ...m.spindle, minRpm: -1 } } }, /speed range/],
      [{ machine: { ...m, spindle: { ...m.spindle, powerKw: 0 } } }, /rated power/],
      [{ machine: { ...m, maxFeed: { xy: 0, z: 100 } } }, /axis maximum/],
      [{ machine: { ...m, maxFeed: { xy: 100, z: Number.NaN } } }, /axis maximum/],
      [{ machine: { ...m, frameClass: 'huge' as 'hobby' } }, /frame class/],
      [{ toolMaxRpm: 1000 }, /maximum speed/],
      [{ toolMaxRpm: Number.NaN }, /maximum speed/],
      [{ stickout: 0 }, /stickout/],
      [{ coolant: 'oil' as 'air' }, /Coolant is/],
      [{ operation: { ...op, kind: 'laser' as 'slot' } }, /not an operation kind/],
      [{ operation: { ...op, ap: 0 } }, /depth of cut/],
      [{ operation: { ...op, ae: Number.NaN } }, /depth of cut/],
      [{ operation: { ...op, ae: 4 } }, /larger than the tool diameter/],
      [{ operation: { ...op, programmed: { feed: Number.NaN, rpm: 1 } } }, /programmed feed/],
      [{ operation: { ...op, programmed: { feed: 100, rpm: -1 } } }, /programmed feed/],
    ];
    for (const [over, message] of cases) {
      const p = planOperation(context(over));
      expect(p.ok, JSON.stringify(over)).toBe(false);
      if (!p.ok) {
        expect(p.refusal).toBe('invalid-input');
        expect(p.message).toMatch(message);
        expect(p.safety).toEqual([]);
      }
    }
  });
});
