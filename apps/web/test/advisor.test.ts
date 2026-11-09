/**
 * Cutting advice on the job analysis report (docs/design/ANALYZE.md slice 1): one card per CAM operation from the
 * interpreter's event tape (no second reading of the file's modes), the cutting regime compared, and one question at
 * a time.
 */
import { describe, expect, it } from 'vitest';
import { GuardedEngine, MockAiEngine, RulesEngine } from '@synthetos/advisor';
import { builtinMaterial } from '@synthetos/library';
import { analyseBytes } from '../src/gcode-worker/pipeline.ts';
import { advisorCheck, advisorFile, advisorMachine, advisorRow, cuttingRegime } from '../src/workspace/advisorModel.ts';
import { machineQuestion, operationQuestion } from '../src/workspace/cuttingQuestions.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import type { MachineProfile } from '../src/workspace/library.ts';
import { SAMPLES } from '../src/workspace/samples.ts';

const preview = (text: string) => analyseBytes(new TextEncoder().encode(text), { dialect: 'tinyg-en', mode: 'full' }).result;
const profile: MachineProfile = { id: 'test', name: 'Test machine', templateId: 'custom', drive: 'screw', travel: { x: 300, y: 300, z: 100 }, spindle: 'Test VFD', createdAt: '2026-11-03' };
const inputs = { frame: 'medium', spindle: 'vfd', minRpm: '6000', maxRpm: '24000', powerKw: '1.5', xy: '5000', z: '1000' };
const cutting = { tool: '1', kind: 'pocket', ap: '1', ae: '1', coolant: 'air' };
const stock = builtinMaterial('builtin.al-6061') ?? null;
const gcode = '(01 Pocket)\nG21 G90 G17 G94\nS18000 M3\nG0 X0 Y0 Z1\nG1 Z-1 F200\nG1 X10 F600\nG1 X20\nG0 Z1\nG0 X100\nG1 Z-1 F200\nG1 X110 F600\nG1 X120 F1200\nM5\nM30\n';

describe('operations for cutting advice', () => {
  it('one operation with its plunge and cut regimes, never one card per feed', () => {
    const file = advisorFile(preview(gcode));
    expect(file.problem).toBeNull();
    expect(file.operations).toHaveLength(1);
    const op = file.operations[0];
    expect(op?.name).toBe('Pocket');
    expect(op?.summary.regimes.map((r) => [r.kind, r.feed])).toEqual([['plunge', 200], ['cut', 600], ['cut', 1200]]);
    // The advice compares the cut with the most distance.
    expect([op?.feed, op?.rpm]).toEqual([600, 18000]);
  });

  it('reads units from the interpreter for CRLF, LFCR and CR, whatever the word order', () => {
    for (const ending of ['\r\n', '\n\r', '\r']) {
      const file = advisorFile(preview(['G90 G17 G94', 'S18000 M3', '(01 Inch cut)', 'G0 X0', 'F10 G20 G1 X1', 'G1 X2', 'M5', 'M30', ''].join(ending)));
      expect(file.operations).toHaveLength(1);
      expect(file.operations[0]).toMatchObject({ name: 'Inch cut', rpm: 18000, line: 5 });
      expect(file.operations[0]?.feed).toBeCloseTo(254, 6);
    }
  });

  it('uses the sample’s headings and tool changes without assuming engagement', () => {
    const sample = SAMPLES[0];
    if (sample === undefined) throw new Error('sample missing');
    const file = advisorFile(preview(sample.text()));
    expect(new Set(file.operations.map((o) => o.name)).size).toBe(file.operations.length);
    expect(new Set(file.operations.map((o) => o.tool))).toEqual(new Set([5, 1]));
    const op = file.operations[0];
    if (op === undefined) throw new Error('operation missing');
    const row = advisorRow(op, {}, advisorMachine(profile, inputs).machine, stock, SEED_TOOLS, null, null);
    expect(row.context).toBeNull();
    expect(row.problem).toBe('Choose the operation type.');
  });

  it('joins spans of the same tool, and picks a cut over a longer plunge', () => {
    const repeated = advisorFile(preview('G21 G90 G17 G94\nT1 M6\nS18000 M3\nG1 X10 F600\nM5\nT1 M6\nS18000 M3\nG1 X20 F600\nM5\nM30\n'));
    expect(repeated.operations).toHaveLength(1);
    const empty = { id: 'x', name: 'x', tool: null, fromLine: 1, toLine: 2, spans: [], feedMm: 0, seconds: null };
    expect(cuttingRegime({ ...empty, regimes: [] })).toBeNull();
    const plunge = { kind: 'plunge' as const, feed: 100, spindle: null, moves: 1, mm: 50, seconds: 30, firstLine: 1, firstSent: 0 };
    const cut = { ...plunge, kind: 'cut' as const, feed: 500, mm: 5, seconds: 1, firstLine: 2 };
    expect(cuttingRegime({ ...empty, regimes: [plunge, cut] })?.kind).toBe('cut');
    expect(cuttingRegime({ ...empty, regimes: [plunge, { ...plunge, mm: 60 }] })?.mm).toBe(60);
  });
});

describe('the advice rows', () => {
  it('requires missing profile inputs and takes existing axis limits over supplementary values', () => {
    expect(advisorMachine(null, inputs).machine).toBeNull();
    expect(advisorMachine(profile, {}).machine).toBeNull();
    const m = advisorMachine({ ...profile, axes: { x: { maxFeed: 800 }, y: { maxFeed: 900 }, z: { maxFeed: 300 } } }, inputs).machine;
    expect(m?.maxFeed).toEqual({ xy: 800, z: 300 });
    expect(m?.drive).toBeUndefined();
    expect(advisorMachine(profile, { ...inputs, minRpm: '25000' }).machine).toBeNull();
    expect(advisorMachine(profile, { ...inputs, spindle: 'dial-router', dial: '1=10000, 2=18000' }).machine?.spindle.dial).toHaveLength(2);
    expect(advisorMachine(profile, { ...inputs, spindle: 'dial-router', dial: '1=99999' }).machine).toBeNull();
  });

  it('keeps placeholder provenance, rules and guarded AI output explicit', async () => {
    const op = advisorFile(preview(gcode)).operations[0];
    if (op === undefined) throw new Error('operation missing');
    const row = advisorRow(op, cutting, advisorMachine(profile, inputs).machine, stock, SEED_TOOLS, null, null);
    expect(row.plan?.ok).toBe(true);
    expect(advisorCheck([row])).toContain('placeholder data; not advice');
    if (row.context === null) throw new Error(row.problem ?? 'no context');
    const rules = await new GuardedEngine(new RulesEngine()).plan(row.context);
    expect(rules.recommendations.map((r) => r.level)).toEqual(['conservative', 'balanced', 'aggressive']);
    const mock = await new GuardedEngine(new MockAiEngine()).plan(row.context);
    expect(mock.recommendations[0]).toMatchObject({ preview: true, placeholder: true, engine: 'mock-ai' });
  });

  it('a missing material affects only the advice, and is asked first', () => {
    const op = advisorFile(preview(gcode)).operations[0];
    if (op === undefined) throw new Error('operation missing');
    expect(advisorRow(op, cutting, null, null, SEED_TOOLS, null, 'Choose your machine in Machines.').problem).toBe('Choose a stock material in Setup.');
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

describe('one question at a time', () => {
  it('asks the machine’s spindle facts in order, then nothing', () => {
    const answers: Record<string, string> = {};
    const asked: string[] = [];
    const replies: Record<string, string> = { frame: 'medium', spindle: 'dial-router', minRpm: '10000', maxRpm: '30000', powerKw: '1', dial: '1=10000', xy: '3000', z: '600' };
    for (let q = machineQuestion(profile, answers); q !== null; q = machineQuestion(profile, answers)) {
      asked.push(q.key);
      answers[q.key] = replies[q.key] ?? '';
    }
    expect(asked).toEqual(['frame', 'spindle', 'minRpm', 'maxRpm', 'powerKw', 'dial', 'xy', 'z']);
    expect(machineQuestion(null, {})).toMatchObject({ scope: 'machines' });
    expect(machineQuestion(profile, { ...answers, maxRpm: '5000' })?.key).toBe('maxRpm');
    expect(machineQuestion({ ...profile, axes: { x: { maxFeed: 1 }, y: { maxFeed: 1 }, z: { maxFeed: 1 } } }, { ...answers, xy: '', z: '' })).toBeNull();
  });

  it('asks an operation for its tool only when the file names none, then its cut', () => {
    const answers: Record<string, string> = {};
    const asked: string[] = [];
    const replies: Record<string, string> = { tool: '1', kind: 'pocket', ap: '1', ae: '0.5', coolant: 'air' };
    for (let q = operationQuestion(null, answers, SEED_TOOLS); q !== null; q = operationQuestion(null, answers, SEED_TOOLS)) {
      asked.push(q.key);
      answers[q.key] = replies[q.key] ?? '';
    }
    expect(asked).toEqual(['tool', 'kind', 'ap', 'ae', 'coolant']);
    expect(operationQuestion(1, {}, SEED_TOOLS)?.key).toBe('kind');
    expect(operationQuestion(99, {}, SEED_TOOLS)).toMatchObject({ scope: 'machines', key: 'tool-library', label: 'Add T99 to the tool library.' });
  });
});
