import { describe, expect, it } from 'vitest';
import { GuardedEngine, MockAiEngine, RulesEngine } from '@synthetos/advisor';
import { builtinMaterial } from '@synthetos/library';
import { analyseBytes } from '../src/gcode-worker/pipeline.ts';
import { advisorCheck, advisorFile, advisorMachine, advisorRow } from '../src/workspace/advisorModel.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import type { MachineProfile } from '../src/workspace/library.ts';
import { SAMPLES } from '../src/workspace/samples.ts';

const preview = (text: string) => analyseBytes(new TextEncoder().encode(text), { dialect: 'tinyg-en', mode: 'full' }).result;
const profile: MachineProfile = { id: 'test', name: 'Test machine', templateId: 'custom', drive: 'screw', travel: { x: 300, y: 300, z: 100 }, spindle: 'Test VFD', createdAt: '2026-11-03' };
const inputs = { frame: 'medium', spindle: 'vfd', minRpm: '6000', maxRpm: '24000', powerKw: '1.5', xy: '5000', z: '1000', accel: '100', junction: '0.05' };
const cutting = { tool: '1', kind: 'pocket', ap: '1', ae: '1', coolant: 'air' };
const stock = builtinMaterial('builtin.al-6061') ?? null;
const gcode = '(01 Pocket)\nG21 G90 G17 G94\nS18000 M3\nG0 X0 Y0 Z1\nG1 X10 F600\nG1 X20\nG0 X100\nG1 X110 F600\nG1 X120 F1200\nM5\nM30\n';

describe('advisor display mapping', () => {
  it('keeps plunge/cutting values separate and never joins a rapid into an estimate', () => {
    const file = advisorFile(preview(gcode));
    expect(file.problem).toBeNull();
    expect(file.operations.map((o) => o.feed)).toEqual([600, 1200]);
    const op = file.operations[0];
    expect(op?.name).toBe('Pocket');
    expect(op?.paths).toHaveLength(2);
    expect(op?.paths[0]?.map((p) => p[0])).toEqual([0, 10, 20]);
    expect(op?.paths[1]?.map((p) => p[0])).toEqual([100, 110]);
  });

  it('uses source spans for CRLF, LFCR and CR; resolves units before F regardless of word order', () => {
    for (const ending of ['\r\n', '\n\r', '\r']) {
      const file = advisorFile(preview(['G90 G17 G94', 'S18000 M3', '(01 Inch cut)', 'G0 X0', 'F10 G20 G1 X1', 'G1 X2', 'M5', 'M30', ''].join(ending)));
      expect(file.operations).toHaveLength(1);
      expect(file.operations[0]).toMatchObject({ name: 'Inch cut', feed: 254, rpm: 18000, line: 5 });
    }
  });

  it('uses operation headings and tool changes from the sample without assuming engagement', () => {
    const sample = SAMPLES[0];
    if (sample === undefined) throw new Error('sample missing');
    const file = advisorFile(preview(sample.text()));
    expect(new Set(file.operations.map((o) => o.name)).size).toBe(3);
    expect(new Set(file.operations.map((o) => o.tool))).toEqual(new Set([5, 1]));
    const op = file.operations[0];
    if (op === undefined) throw new Error('operation missing');
    const row = advisorRow(op, {}, advisorMachine(profile, inputs).machine, stock, SEED_TOOLS, null, null);
    expect(row.context).toBeNull();
    expect(row.problem).toBe('Choose the operation type.');
  });

  it('requires missing profile inputs and takes existing axis limits over supplementary values', () => {
    expect(advisorMachine(null, inputs).machine).toBeNull();
    expect(advisorMachine(profile, {}).machine).toBeNull();
    const m = advisorMachine({ ...profile, axes: { x: { maxFeed: 800 }, y: { maxFeed: 900 }, z: { maxFeed: 300 } } }, inputs).machine;
    expect(m?.maxFeed).toEqual({ xy: 800, z: 300 });
    expect(m?.drive).toBeUndefined(); // a generic screw does not identify lead vs ball screw
    expect(advisorMachine(profile, { ...inputs, minRpm: '25000' }).machine).toBeNull();
    expect(advisorMachine(profile, { ...inputs, spindle: 'dial-router', dial: '1=10000, 2=18000' }).machine?.spindle.dial).toHaveLength(2);
    expect(advisorMachine(profile, { ...inputs, spindle: 'dial-router', dial: '1=99999' }).machine).toBeNull();
  });

  it('keeps placeholder provenance, estimates, rules and guarded AI output explicit', async () => {
    const op = advisorFile(preview(gcode)).operations[0];
    if (op === undefined) throw new Error('operation missing');
    const row = advisorRow(op, cutting, advisorMachine(profile, inputs).machine, stock, SEED_TOOLS, null, null);
    expect(row.plan?.ok).toBe(true);
    expect(row.achievable).toBeGreaterThan(0);
    expect(row.achievable).toBeLessThan(600);
    expect(advisorCheck([row])).toContain('placeholder data; not advice');
    if (row.context === null) throw new Error(row.problem ?? 'no context');
    const rules = await new GuardedEngine(new RulesEngine()).plan(row.context);
    expect(rules.recommendations.map((r) => r.level)).toEqual(['conservative', 'balanced', 'aggressive']);
    const mock = await new GuardedEngine(new MockAiEngine()).plan(row.context);
    expect(mock.recommendations[0]).toMatchObject({ preview: true, placeholder: true, engine: 'mock-ai' });
  });

  it('withholds estimates for uncertain geometry and separates repeated same-tool changes', () => {
    const result = preview(gcode);
    if (result.segments === null) throw new Error('geometry missing');
    const kinds = result.segments.kinds.slice();
    kinds[2] = (kinds[2] ?? 0) | 0x80;
    const uncertain = advisorFile({ ...result, segments: { ...result.segments, kinds } });
    expect(uncertain.operations.every((o) => o.paths.length === 0)).toBe(true);
    const repeated = advisorFile(preview('G21 G90 G17 G94\nT1 M6\nS18000 M3\nG1 X10 F600\nM5\nT1 M6\nS18000 M3\nG1 X20 F600\nM5\nM30\n'));
    expect(repeated.operations).toHaveLength(2);
  });

  it('never presents a blocked or incomplete file as within range', () => {
    const result = preview(gcode);
    const file = advisorFile({ ...result, summary: { ...result.summary, blocked: true } });
    const op = file.operations[0];
    if (op === undefined) throw new Error('operation missing');
    const row = advisorRow(op, cutting, advisorMachine(profile, inputs).machine, stock, SEED_TOOLS, file.problem, null);
    expect(row.plan).toBeNull();
    expect(advisorCheck([row])).toBe('Feeds: needs review in Analyze');
    expect(advisorCheck([])).toContain('open a cutting file');
    expect(advisorRow({ ...op, rpm: null }, cutting, advisorMachine(profile, inputs).machine, stock, SEED_TOOLS, null, null).plan).toBeNull();
  });
});
