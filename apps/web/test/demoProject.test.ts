import { describe, expect, it } from 'vitest';
import { builtinMaterial, readProject, readStock, readTool } from '@synthetos/library';
import { analyseBytes } from '../src/gcode-worker/pipeline.ts';
import { advisorFile } from '../src/workspace/advisorModel.ts';
import { fileFacts } from '../src/workspace/samples.ts';
import { DEMO_NAME, DEMO_STOCK, DEMO_TOOL, demoFile, demoGcode, demoSetup } from '../src/wizard/demoProject.ts';
import { project } from './syncFixtures.ts';

const bytes = () => new TextEncoder().encode(demoGcode());
const words = (axis: string): number[] => [...demoGcode().matchAll(new RegExp(`\\b${axis}(-?\\d+(?:\\.\\d+)?)`, 'g'))].map((m) => Number(m[1]));

describe('the demo name plate (spec §6.4, R13)', () => {
  it('is an ASCII program with two operations, one tool at 16000 rpm, and the job card reads it', () => {
    const text = demoGcode();
    expect([...text].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(text.startsWith('(name-plate.nc - demo - 2 operations)\n')).toBe(true);
    expect(text.endsWith('M30\n')).toBe(true);
    const facts = fileFacts(bytes());
    expect(facts.toolChanges.map((t) => t.tool)).toEqual([1]);
    expect(facts.operations.map((o) => o.name)).toEqual(['Pocket', 'Engrave run']);
    expect(facts.spindle).toEqual([16000]);
    expect(demoFile().name).toBe('name-plate.nc');
    expect(DEMO_NAME).toBe('Name plate');
  });
  it('passes the sanitizer with no blocking finding', () => {
    const { result } = analyseBytes(bytes(), { dialect: 'tinyg-en', mode: 'full' });
    expect(result.summary.blocked).toBe(false);
    expect(result.summary.blocks).toEqual([]);
  });
  it('the analyze engine accepts it: no file problem, two operations on tool 1', () => {
    const file = advisorFile(analyseBytes(bytes(), { dialect: 'tinyg-en', mode: 'full' }).result);
    expect(file.problem).toBeNull();
    expect(file.operations.map((o) => o.tool)).toEqual([1, 1]);
    expect(file.operations.map((o) => o.name)).toEqual(['Pocket', 'Engrave run']);
  });
  it('stays inside the 180 × 120 stock, 1.5 mm pocket, engraving 0.6 mm below the floor, work zero front-left-top', () => {
    const x = words('X'); const y = words('Y'); const z = words('Z');
    expect(Math.min(...x)).toBeGreaterThanOrEqual(0); expect(Math.max(...x)).toBeLessThanOrEqual(180);
    expect(Math.min(...y)).toBeGreaterThanOrEqual(0); expect(Math.max(...y)).toBeLessThanOrEqual(120);
    expect(Math.min(...z)).toBe(-2.1);
    expect(z).toContain(-1.5);
    expect(Math.max(...words('F'))).toBeLessThanOrEqual(1000);
  });
  it('the demo tool, stock and project setup are valid library records', () => {
    expect(readTool(DEMO_TOOL).ok).toBe(true);
    expect(DEMO_TOOL).toMatchObject({ id: 'demo.quarter-2f', type: 'flat', geometry: { diameter: 6.35, flutes: 2 } });
    expect(readStock(DEMO_STOCK).ok).toBe(true);
    expect(DEMO_STOCK).toMatchObject({ width: 180, depth: 120, thickness: 6.35, materialRef: { id: 'builtin.mdf' }, zero: { corner: 'front-left', height: 'top' } });
    const setup = demoSetup(null, { number: 1, store: null, tool: DEMO_TOOL }, DEMO_STOCK);
    expect(setup.material).toEqual({ id: 'builtin.mdf', version: builtinMaterial('builtin.mdf')!.version, name: 'MDF' });
    expect(setup.tools).toEqual([{ id: 'demo.quarter-2f', version: 1, name: DEMO_TOOL.name, number: 1 }]);
    expect(setup.stock).toEqual({ id: 'stock', name: 'Block 180 × 120 × 6.35 mm' });
    expect(setup.stockSnapshot).toEqual(DEMO_STOCK);
    expect(setup.machine).toBeNull();
    expect(readProject({ ...project(), setup }).ok).toBe(true);
  });
});
