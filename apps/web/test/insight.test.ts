/**
 * The Advanced planner and cutting rows (owner, 2026-11-09): the planner buffer from qr, starving under 4 blocks in a
 * running job; chip load and surface speed maths with zero rpm, zero flutes and a ball nose; the missing-piece lines.
 */
import { describe, expect, it } from 'vitest';
import type { Material, Tool } from '@synthetos/library';
import { chipLoad, ONE_NUMBER_BAND, referenceFor, rubbingRisk, surfaceSpeedMpm, usesFullDiameterNote, verdict } from '../src/workspace/insight/chipLoad.ts';
import { cuttingRows, type CuttingInput } from '../src/workspace/insight/cuttingModel.ts';
import { DEFAULT_PLANNER_BLOCKS, plannerRows } from '../src/workspace/insight/plannerModel.ts';
import type { JobSnapshot } from '../src/workspace/jobUi.ts';
import { feedLimitWindow, foldFeedLimit } from '@synthetos/machine';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';

const t1 = SEED_TOOLS.find((t) => t.number === 1)?.tool as Tool; // 3.175 mm, 2 flutes, carbide, fz 0.08 in MDF
const ball = SEED_TOOLS.find((t) => t.tool.type === 'ball')?.tool as Tool;
const mdf = { id: 'builtin.mdf', name: 'MDF', cutting: [] } as unknown as Material;
const job = (o: Partial<JobSnapshot>): JobSnapshot => ({ phase: 'running', startedAt: 1, endedAt: null, sent: 120, acked: 110, total: 400, executing: { n: 104, line: 98 }, queuedSeconds: 3.2, queuedBoundMm: 41.4, ...o }) as JobSnapshot;

describe('chip load maths', () => {
  it('feed ÷ (rpm × flutes); none with the spindle stopped or no flutes', () => {
    expect(chipLoad(1200, 12000, 2)).toBeCloseTo(0.05, 6);
    expect(chipLoad(1200, 0, 2)).toBeNull();
    expect(chipLoad(1200, 12000, 0)).toBeNull();
    expect(chipLoad(null, 12000, 2)).toBeNull();
    expect(chipLoad(0, 12000, 2)).toBe(0);
  });
  it('surface speed π × D × rpm ÷ 1000; none at zero rpm', () => {
    expect(surfaceSpeedMpm(6, 10000)).toBeCloseTo(188.5, 1);
    expect(surfaceSpeedMpm(6, 0)).toBeNull();
    expect(surfaceSpeedMpm(0, 10000)).toBeNull();
  });
  it('a ball nose says it uses the full diameter; a flat end mill says nothing', () => {
    expect(usesFullDiameterNote('ball')).toMatch(/^Ball nose: worked out with the full diameter\./);
    expect(usesFullDiameterNote('flat')).toBeNull();
  });
  it('OD-35: one number gives 0.75–1.25 × fz (rubbing risk under 35 %); a maker’s range is used as it is', () => {
    const own = referenceFor(t1, 'builtin.mdf', null);
    expect(ONE_NUMBER_BAND).toEqual({ low: 0.75, high: 1.25 });
    expect(own).toMatchObject({ from: 'tool', target: { fz: 0.08, vc: 300 } });
    expect(own?.fz.min).toBeCloseTo(0.06, 6);
    expect(own?.fz.max).toBeCloseTo(0.1, 6);
    expect(own?.rubbing).toBeCloseTo(0.028, 6);
    expect(rubbingRisk(0.02, own as never)).toBe(true);
    expect(rubbingRisk(0.05, own as never)).toBe(false);
    const pine = { id: 'pine', name: 'Pine', cutting: [{ toolMaterial: 'carbide', vc: { value: { min: 200, max: 500 } }, chipload: { value: { kind: 'factor', min: 0.01, max: 0.02 } } }] } as unknown as Material;
    const fromMaterial = referenceFor(t1, 'pine', pine);
    expect(fromMaterial).toMatchObject({ from: 'material', rubbing: null, vc: { min: 200, max: 500 } });
    expect(fromMaterial?.fz.min).toBeCloseTo(0.03175, 6);
    expect(fromMaterial?.fz.max).toBeCloseTo(0.0635, 6);
    expect(rubbingRisk(0.001, fromMaterial as never)).toBe(false);
    expect(referenceFor(t1, 'pine', { ...pine, cutting: [] } as Material)).toBeNull();
    expect(verdict(0.01, { min: 0.02, max: 0.05 })).toBe('light');
    expect(verdict(0.02, { min: 0.02, max: 0.05 })).toBe('ok');
    expect(verdict(0.05, { min: 0.02, max: 0.05 })).toBe('ok');
    expect(verdict(0.06, { min: 0.02, max: 0.05 })).toBe('heavy');
  });
});

describe('the cutting rows', () => {
  const base: CuttingInput = { toolNumber: 1, toolLive: false, fileTool: null, tools: SEED_TOOLS, materialId: 'builtin.mdf', material: mdf, vel: 1920, feed: 1000, sps: 12000, spindleOn: true, fileSpeed: null, inches: false };
  it('live velocity while moving, the board’s speed, and a verdict with the range', () => {
    const r = cuttingRows(base);
    expect(r.tool).toMatchObject({ number: 1, diameter: 3.175, flutes: 2, from: 'board' });
    expect(r.feed).toEqual({ mmMin: 1920, from: 'moving' });
    expect(r.spindle).toEqual({ rpm: 12000, from: 'board' });
    expect(r.chipLoad?.value).toBeCloseTo(0.08, 6);
    expect(r.chipLoad?.verdict).toBe('ok');
    expect(r.chipLoad?.rubbing).toBe(false);
    expect(r.surface?.reference).toBe('tool data 300 m/min');
    expect(r.missing).toEqual([]);
  });
  it('the programmed F when still, in inches converted; light, rubbing and heavy', () => {
    expect(cuttingRows({ ...base, vel: 0, feed: 10, inches: true }).feed).toEqual({ mmMin: 254, from: 'programmed' });
    expect(cuttingRows({ ...base, vel: 1200 }).chipLoad).toMatchObject({ verdict: 'light', rubbing: false }); // 0.050
    expect(cuttingRows({ ...base, vel: 600 }).chipLoad).toMatchObject({ verdict: 'light', rubbing: true }); // 0.025 < 0.028
    expect(cuttingRows({ ...base, vel: 2400 }).chipLoad).toMatchObject({ verdict: 'ok' }); // 0.100, the top of the band
    expect(cuttingRows({ ...base, vel: 3000 }).chipLoad).toMatchObject({ verdict: 'heavy', rubbing: false });
  });
  it('spindle off: zero rpm, no chip load or surface speed', () => {
    const r = cuttingRows({ ...base, spindleOn: false });
    expect(r.spindle).toEqual({ rpm: 0, from: 'board' });
    expect(r.chipLoad).toBeNull();
    expect(r.surface).toBeNull();
  });
  it('says what is missing, in one line each, with the fix', () => {
    expect(cuttingRows({ ...base, toolNumber: 7 }).missing).toEqual([{ text: 'Tool T7 isn’t in your tool table.', fix: { kind: 'tool', number: 7, label: 'Add T7' } }]);
    expect(cuttingRows({ ...base, materialId: null, material: null }).missing).toEqual([{ text: 'No material set for this job.', fix: { kind: 'step', step: 'stock', label: 'Stock & workholding' } }]);
    expect(cuttingRows({ ...base, sps: null }).missing[0]?.text).toBe('Spindle speed not known: the board does not report it.');
    expect(cuttingRows({ ...base, sps: null, fileSpeed: 16000 }).spindle).toEqual({ rpm: 16000, from: 'file' });
    expect(cuttingRows({ ...base, toolNumber: 0 }).missing[0]?.text).toBe('No tool chosen (T0).');
    const noFlutes = { number: 9, store: null, tool: { ...t1, geometry: { ...t1.geometry, flutes: 0 } } };
    const r = cuttingRows({ ...base, toolNumber: 9, tools: [noFlutes] });
    expect(r.chipLoad).toBeNull();
    expect(r.missing[0]).toEqual({ text: 'T9 has no flute count.', fix: { kind: 'tool', number: 9, label: 'Edit T9' } });
    expect(cuttingRows({ ...base, materialId: 'pine', material: { id: 'pine', name: 'Pine', cutting: [] } as unknown as Material }).missing[0]?.text).toBe('No chip-load data for Carbide in Pine.');
  });
  it('while a job runs the file’s tool stands in only when the board does not report tool (OD-34)', () => {
    expect(cuttingRows({ ...base, toolNumber: 0, fileTool: 2 }).tool).toMatchObject({ number: 2, from: 'file' });
    expect(cuttingRows({ ...base, toolLive: true, toolNumber: 1, fileTool: 2 }).tool).toMatchObject({ number: 1, from: 'board' });
    expect(cuttingRows({ ...base, toolLive: true, toolNumber: 0, fileTool: 2 }).missing[0]?.text).toBe('No tool chosen (T0).');
  });
  it('a ball nose carries the full-diameter note', () => {
    const n = SEED_TOOLS.find((t) => t.tool === ball)?.number ?? 3;
    expect(cuttingRows({ ...base, toolNumber: n }).note).toMatch(/^Ball nose/);
  });
});

describe('the planner rows', () => {
  it('uses reported supply evidence while running, with no diagnosis from the buffer or after the job', () => {
    const feedLimit = foldFeedLimit(feedLimitWindow(2), 'fl', { k: 0, g: 2, n: 3 }, false);
    expect(plannerRows({ qr: 32, plannerBlocks: 32, job: job({ feedLimit }) }).diagnosis).toBe("Run didn't send lines fast enough");
    expect(plannerRows({ qr: 32, plannerBlocks: 32, job: job({ feedLimit, phase: 'paused' }) }).diagnosis).toBeNull();
    expect(plannerRows({ qr: 32, plannerBlocks: 32, job: job({}) }).diagnosis).toBeNull();
  });
  it('blocks in use out of the board’s size; starving under 4 in a running job', () => {
    expect(plannerRows({ qr: 26, plannerBlocks: 28, job: job({}) }).buffer).toEqual({ used: 2, total: 28, starving: true });
    expect(plannerRows({ qr: 20, plannerBlocks: null, job: job({}) }).buffer).toEqual({ used: 12, total: DEFAULT_PLANNER_BLOCKS, starving: false });
    expect(plannerRows({ qr: 32, plannerBlocks: 32, job: null }).buffer).toEqual({ used: 0, total: 32, starving: false });
    expect(plannerRows({ qr: null, plannerBlocks: 32, job: null }).buffer).toBeNull();
  });
  it('queued motion and lines only while a job is under way', () => {
    const r = plannerRows({ qr: 10, plannerBlocks: 32, job: job({}) });
    expect(r.queued).toEqual({ seconds: 3.2, mm: 41.4 });
    expect(r.lines).toEqual({ sent: 120, acked: 110, total: 400, executing: 104 });
    expect(plannerRows({ qr: 10, plannerBlocks: 32, job: job({ endedAt: 5 }) }).lines).toBeNull();
  });
});

describe('the rows as drawn', () => {
  it('draws every row with nothing known, and the verdict with its range', async () => {
    const { renderToString } = await import('preact-render-to-string');
    const { cuttingList, plannerList } = await import('../src/workspace/insight/MachineInsight.ts');
    const empty = cuttingRows({ toolNumber: null, toolLive: false, fileTool: null, tools: [], materialId: null, material: null, vel: null, feed: null, sps: null, spindleOn: null, fileSpeed: null, inches: false });
    const html = renderToString(cuttingList(empty) as never);
    expect(html).toContain('Not known');
    expect(html).toContain('No material set for this job.');
    const at = (vel: number) => renderToString(cuttingList(cuttingRows({ toolNumber: 1, toolLive: false, fileTool: null, tools: SEED_TOOLS, materialId: 'builtin.mdf', material: mdf, vel, feed: null, sps: 12000, spindleOn: true, fileSpeed: null, inches: false })) as never);
    // Short labels (owner: "less is more"): the range in parentheses, one line.
    expect(at(1920)).toMatch(/data-verdict="ok"[^>]*>✓ 0\.080 mm\/tooth</);
    expect(at(1200)).toMatch(/0\.050 mm\/tooth<\/span><span class="insight-warn" data-verdict="light">⚠ light \(0\.060–0\.100\)</);
    expect(at(600)).toMatch(/data-verdict="light">⚠ light, rubbing risk \(0\.060–0\.100\)</);
    expect(at(3000)).toMatch(/data-verdict="heavy">⚠ heavy \(0\.060–0\.100\)</);
    const p = renderToString(plannerList(plannerRows({ qr: 30, plannerBlocks: 32, job: job({}) }), 'Live · 0.10 s') as never);
    expect(p).toContain('data-starving="true"');
    expect(p).toContain('⚠ Starving');
    expect(p).toContain('sent 120 · answered 110 · running N104');
  });
});
