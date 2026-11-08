/**
 * The stock carving's page side (tool-sim slice 2): the tools per change point from the tool table, the notes
 * for lines that are not carved (never a guessed size), the stock's grid in the path frame, and the key line.
 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { h } from 'preact';
import { signal } from '@preact/signals';
import { NO_TOOL, type ToolChanges } from '@synthetos/gcode';
import { SEGMENT, type SceneLayers } from '@synthetos/gcode-view';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { MAX_UNCARVED_NOTES, NO_CHANGE_REASON, NO_T_REASON, carvePlan } from '../src/preview/carveTools.ts';
import { carveGrid } from '../src/preview/carveStock.ts';
import { BelowNote, CarveLabel, belowText, carveNotes, cellText, depthText } from '../src/preview/CarveKey.ts';
import { BED_NOT_SET, SceneKey, pickHint } from '../src/preview/SceneKey.ts';
import { plainToolWords, simpleToolName, toolNumbered } from '../src/preview/activeTool.ts';
import type { JobScene } from '../src/preview/sceneModel.ts';
import type { CarveStatus } from '../src/preview/useCarve.ts';

const changes = (lines: number[], tools: number[]): Pick<ToolChanges, 'lines' | 'tools'> => ({ lines: Uint32Array.from(lines), tools: Int32Array.from(tools) });

/** Sent lines that each draw one segment of the given kind (0 for none). */
function segs(kinds: number[]): { kinds: Uint8Array; lineToVertex: Uint32Array } {
  return { kinds: Uint8Array.from([SEGMENT.BREAK, ...kinds.filter((k) => k !== 0)]), lineToVertex: Uint32Array.from(kinds.reduce<number[]>((acc, k) => [...acc, (acc.at(-1) as number) + (k === 0 ? 0 : 1)], [1])) };
}

describe('carvePlan', () => {
  const { FEED, RAPID, ARC } = SEGMENT;
  it('maps tool changes to sent lines, with the shape from the tool table', () => {
    // File lines 1..6 sent as lines 0..5; T1 M6 on line 2, T4 M6 on line 5.
    const plan = carvePlan(changes([2, 5], [1, 4]), Uint32Array.from([1, 2, 3, 4, 5, 6]), segs([0, 0, FEED, FEED, 0, FEED]), SEED_TOOLS);
    expect([...plan.tools.starts]).toEqual([0, 1, 4]);
    expect(plan.tools.shapes.map((s) => s?.tip ?? null)).toEqual([null, 'flat', 'v']);
    expect(plan.uncarved).toEqual([]);
  });

  it('names the lines an unknown tool would have cut, and why', () => {
    const lines = Uint32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const kinds = [FEED, 0, FEED, ARC, 0, FEED, 0, FEED, RAPID, FEED];
    // Lines 1 before any change; T9 at line 3 (not in the table); M6 with no T at line 6; T1 at line 8.
    const plan = carvePlan(changes([3, 6, 8], [9, NO_TOOL, 1]), lines, segs(kinds), SEED_TOOLS);
    expect(plan.tools.shapes.map((s) => s?.tip ?? null)).toEqual([null, null, null, 'flat']);
    expect(plan.uncarved).toEqual([`Line 1 not carved: ${NO_CHANGE_REASON}`, 'Lines 3–4 not carved: T9 is not in your tool table', `Line 6 not carved: ${NO_T_REASON}`]);
  });

  it('carves the lines before the first tool change with the tool the user chose as already in the spindle', () => {
    const lines = Uint32Array.from([1, 2, 3, 4]);
    const plan = carvePlan(changes([3], [4]), lines, segs([FEED, FEED, 0, FEED]), SEED_TOOLS, 1);
    expect(plan.tools.shapes.map((s) => s?.tip ?? null)).toEqual(['flat', 'v']);
    expect(plan.uncarved).toEqual([]);
    // A chosen T number the table does not have is named, never guessed.
    expect(carvePlan(changes([], []), lines, segs([FEED, FEED, 0, FEED]), SEED_TOOLS, 9).uncarved).toEqual(['Lines 1–4 not carved: T9 is not in your tool table']);
  });

  it('does not call a rapid alone an uncarved cut', () => {
    expect(carvePlan(changes([3], [1]), Uint32Array.from([1, 2, 3, 4]), segs([RAPID, RAPID, 0, FEED]), SEED_TOOLS).uncarved).toEqual([]);
  });

  it('a change on the first sent line replaces the "none" entry', () => {
    const plan = carvePlan(changes([1], [3]), Uint32Array.from([1, 2]), segs([0, FEED]), SEED_TOOLS);
    expect([...plan.tools.starts]).toEqual([0]);
    expect(plan.tools.shapes[0]?.tip).toBe('ball');
  });

  it('counts the runs past the first few', () => {
    const n = MAX_UNCARVED_NOTES + 2;
    const lines = Uint32Array.from({ length: n * 2 }, (_, i) => i + 1);
    // Alternate unknown T9 and known T1, a cut on every line.
    const at = Array.from({ length: n * 2 }, (_, i) => i + 1);
    const plan = carvePlan(changes(at, at.map((_, i) => (i % 2 === 0 ? 9 : 1))), lines, segs(at.map(() => FEED)), SEED_TOOLS);
    expect(plan.uncarved).toHaveLength(MAX_UNCARVED_NOTES + 1);
    expect(plan.uncarved.at(-1)).toBe('2 more runs of lines not carved');
  });
});

describe('carveGrid', () => {
  const stock = (s: SceneLayers['solids'][number]): SceneLayers => ({ solids: [{ kind: 'box', min: [0, 0, 0], max: [800, 800, 19], color: [1, 1, 1, 1], tag: 'bed' }, s], rings: [] });
  it('takes the stock box into the path frame', () => {
    const g = carveGrid(stock({ kind: 'box', min: [70, 60, 31], max: [250, 180, 37.35], color: [1, 1, 1, 1], tag: 'stock' }), [70, 60, 37.35]);
    expect(g).toMatchObject({ x0: 0, y0: 0, cell: 0.25, nx: 720, ny: 480, outline: null });
    expect(g?.top).toBeCloseTo(0, 9);
    expect(g?.bottom).toBeCloseTo(-6.35, 9);
  });
  it('keeps a round or imported outline', () => {
    const g = carveGrid(stock({ kind: 'prism', outline: [[10, 10], [30, 10], [20, 30]], z0: 0, z1: 5, color: [1, 1, 1, 1], tag: 'stock' }), [10, 10, 5]);
    expect(g).toMatchObject({ x0: 0, y0: 0, nx: 80, ny: 80, top: 0, bottom: -5 });
    expect(g?.outline).toEqual([[0, 0], [20, 0], [10, 20]]);
  });
  it('carves nothing without a stock', () => {
    expect(carveGrid(null, [0, 0, 0])).toBeNull();
    expect(carveGrid({ solids: [], rings: [] }, [0, 0, 0])).toBeNull();
  });
});

describe('the key', () => {
  const info = (s: Partial<CarveStatus> = {}) => ({ cell: 0.25, uncarved: ['Lines 12–340 not carved: T3 is not in your tool table'], status: signal<CarveStatus>({ through: 40, done: true, lowest: -1, failed: null, below: null, ...s }) });
  it('says the carve cell size in plain words, with test hooks', () => {
    expect(cellText(0.25)).toBe('0.25 mm');
    expect(cellText(1.25)).toBe('1.25 mm');
    const html = renderToString(h(CarveLabel, { carve: info() }));
    expect(html).toContain('Carving detail 0.25 mm');
    expect(html).toContain('data-carved-through="40"');
    // Simple: the hooks, no words.
    const simple = renderToString(h(CarveLabel, { carve: info(), simple: true }));
    expect(simple).toContain('data-carved-through="40"');
    expect(simple).not.toContain('Carving');
    expect(html).toContain('data-carve-cell="0.25"');
    expect(html).toContain('data-carve-done="true"');
    expect(renderToString(h(CarveLabel, { carve: info({ failed: 'boom' }) }))).toContain('Carving stopped');
  });
  it('lists the uncarved lines in the scene notes', () => {
    expect(carveNotes(null)).toEqual([]);
    const html = renderToString(h(SceneKey, { scene: null, carve: info() }));
    expect(html).toContain('Lines 12–340 not carved: T3 is not in your tool table');
    expect(html).toContain('Carving detail 0.25 mm');
    expect(html).not.toMatch(/safe/i);
  });
  it('names where the cut goes below the stock, as a preview of the planned setup', () => {
    expect(depthText(0.6)).toBe('0.6 mm');
    expect(depthText(0.04)).toBe('0.04 mm');
    expect(belowText({ firstLine: 812, firstDepth: 0.6, deepestLine: 812, deepestDepth: 0.6 })).toBe('The tool goes 0.6 mm below the stock at line 812 (preview, from the planned setup)');
    expect(belowText({ firstLine: 812, firstDepth: 0.6, deepestLine: 900, deepestDepth: 1.2 })).toBe('The tool goes 0.6 mm below the stock at line 812, and 1.2 mm below at line 900 (preview, from the planned setup)');
    const html = renderToString(h(SceneKey, { scene: null, carve: info({ below: { firstLine: 812, firstDepth: 0.6, deepestLine: 812, deepestDepth: 0.6 } }) }));
    expect(html).toContain('data-scene="below-stock-note"');
    expect(html).not.toMatch(/safe|verified/i);
    expect(renderToString(h(BelowNote, { carve: info() }))).toBe('');
  });
});

describe('the key at each level', () => {
  const scene = (placeholder: boolean, fixture = true): JobScene => ({
    layers: { solids: [{ kind: 'box', min: [0, 0, 0], max: [1, 1, 1], color: [1, 1, 1, 1], tag: 'bed' }, ...(fixture ? [{ kind: 'box' as const, min: [0, 0, 1] as const, max: [1, 1, 2] as const, color: [1, 1, 1, 1] as const, tag: 'fixture' }] : [])], rings: [] },
    pathOffset: [0, 0, 0], zero: [0, 0, 0], bounds: null,
    heights: { bedTop: 0, fixtureTop: 0, stockTop: 0, aboveTable: { bedTop: 0, fixtureTop: 0, stockTop: 0 } },
    bedPlaceholder: placeholder, bedLabel: 'Bed of My X-Carve · 750 × 750 mm · placeholder',
  });
  const t1 = toolNumbered(1, SEED_TOOLS);
  const info = () => ({ cell: 0.25, uncarved: ['Lines 12–340 not carved: T3 is not in your tool table'], status: signal<CarveStatus>({ through: 40, done: true, lowest: -1, failed: null, below: null }) });

  it('names a seed tool in plain words, and a tool the user named by its own name', () => {
    expect(t1.plain).toBe('3.175 mm flat end mill');
    expect(toolNumbered(4, SEED_TOOLS).plain).toBe('12.7 mm 90° V-bit');
    expect(plainToolWords({ type: 'o-flute', geometry: { diameter: 6.35, shank: 6.35, flutes: 1, fluteLength: 22, overallLength: 63 } })).toBe('6.35 mm single-flute end mill');
    expect(simpleToolName({ id: 'seed.t1', name: 'My favourite end mill', type: 'flat', geometry: { diameter: 3.175, shank: 3.175, flutes: 2, fluteLength: 12, overallLength: 38 } })).toBe('My favourite end mill');
    expect(simpleToolName({ id: 'mine.1', name: '1/8 in downcut', type: 'flat', geometry: { diameter: 3.175, shank: 3.175, flutes: 2, fluteLength: 12, overallLength: 38 } })).toBe('1/8 in downcut');
  });

  it('Simple: the tool, "Bed size not set" for a placeholder bed, the hint, no bed name, detail or links', () => {
    const html = renderToString(h(SceneKey, { scene: scene(true), tool: t1, carve: info(), simple: true, onOpen: () => undefined }));
    expect(html).toContain('T1 · 3.175 mm flat end mill');
    expect(html).toContain(BED_NOT_SET);
    expect(html).toContain('Click the bed, fixture or stock to change it');
    expect(html).toContain('Lines 12–340 not carved');
    expect(html).not.toMatch(/My X-Carve|revision|Carving detail|Bed settings/);
    expect(renderToString(h(SceneKey, { scene: scene(false), tool: t1, simple: true, onOpen: () => undefined }))).not.toContain(BED_NOT_SET);
    expect(pickHint(['bed', 'stock'])).toBe('Click the bed or stock to change it');
  });

  it('Advanced: the bed name and size, the carving detail and the links', () => {
    const html = renderToString(h(SceneKey, { scene: scene(true), tool: t1, carve: info(), onOpen: () => undefined }));
    expect(html).toContain('Bed of My X-Carve · 750 × 750 mm · placeholder');
    expect(html).toContain('T1 · 3.175 mm 2-flute up-cut');
    expect(html).toContain('Carving detail 0.25 mm');
    expect(html).toContain('Bed settings');
    expect(html).not.toContain('Click the bed');
  });
});

