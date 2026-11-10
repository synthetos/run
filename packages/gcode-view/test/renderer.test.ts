import { describe, expect, it } from 'vitest';
import { SEGMENT, chunks, createRenderer, toolGlyph } from '../src/index.ts';
import { COLORS, bigList, fakeGl, frameQueue, listOf } from './helpers.ts';

const instant = { yieldToHost: async () => {} };

describe('WebGL renderer', () => {
  it('renders on demand: one frame per batch of changes, none while idle', async () => {
    const { gl, calls } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    await r.load(listOf([[[SEGMENT.FEED, 1, 1, 0]]]), instant);
    expect(frames.flush()).toBe(1);
    expect(frames.flush()).toBe(0);
    r.setRapidsVisible(false);
    r.setHighlight(0);
    r.orbit(0.1, 0.1);
    r.zoomBy(0.5);
    expect(frames.pending).toBe(1);
    frames.flush();
    expect(r.frames).toBe(2);
    expect(calls.get('drawArrays')).toBe(2);
    expect(frames.flush()).toBe(0);
  });

  it('uploads exactly the chunked geometry and draws one call per chunk', async () => {
    const { gl, calls, uploads } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    const list = bigList(1000);
    await r.load(list, { ...instant, segmentsPerChunk: 100 });
    const drawn = 1000 - Math.ceil(1000 / 97);
    expect(r.chunkCount).toBe(Math.ceil(drawn / 100));
    // Buffers go up as (positions, styles, lines, traverse dash distances) per chunk.
    const uploaded = uploads.filter((_, i) => i % 4 === 0).flatMap((u) => Array.from(u as Float32Array));
    const expected = [...chunks(list, 100)].flatMap((c) => Array.from(c.positions));
    expect(uploaded).toEqual(expected);
    frames.flush();
    expect(calls.get('drawArrays')).toBe(r.chunkCount);
  });

  it('cancel: aborting a load rejects with AbortError and leaves nothing on the GPU', async () => {
    const { gl, live } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    const controller = new AbortController();
    let slices = 0;
    const p = r.load(bigList(100_000), {
      segmentsPerChunk: 1000,
      budgetMs: 0,
      signal: controller.signal,
      yieldToHost: async () => { if (++slices === 3) controller.abort(); },
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(r.chunkCount).toBe(0);
    expect(live()).toBe(0);
  });

  it('a new load supersedes one still uploading', async () => {
    const { gl } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    let release: () => void = () => {};
    const first = r.load(bigList(10_000), { segmentsPerChunk: 100, budgetMs: 0, yieldToHost: () => new Promise((res) => { release = res; }) });
    const second = r.load(listOf([[[SEGMENT.FEED, 1, 0, 0]]]), instant);
    release();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await second;
    expect(r.chunkCount).toBe(1);
  });

  it('envelope and WCS triad are drawn as an overlay; dispose frees everything and stops drawing', async () => {
    const { gl, calls, live } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    await r.load(listOf([[[SEGMENT.FEED, 1, 0, 0]]]), instant);
    r.setEnvelope({ min: [0, 0, -50], max: [300, 200, 0] });
    r.setWcsOrigin([10, 10, 0]);
    frames.flush();
    expect(calls.get('drawArrays')).toBe(2);
    r.dispose();
    expect(live()).toBe(0);
    r.requestRender();
    expect(frames.pending).toBe(0);
  });

  it('every move carries its distance along the segment for the dashes (traverses, and lines waiting for their ack); still one draw per chunk', async () => {
    const { gl, calls, uploads } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    await r.load(listOf([[[SEGMENT.RAPID, 3, 4, 0]], [[SEGMENT.FEED, 3, 10, 0]]]), instant);
    const dist = Array.from(uploads[3] as Float32Array);
    expect(dist).toEqual([0, 5, 0, 6]);
    frames.flush();
    expect(calls.get('drawArrays')).toBe(1);
    expect(calls.get('uniform1f')).toBeGreaterThanOrEqual(3);
  });

  it('the planner view and the tool marker are drawn on demand from what the page gives; a first marker does not animate', async () => {
    const { gl, calls, uploads } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: { ...COLORS, plannerStarving: [1, 0.6, 0, 1] }, requestFrame: frames.request, now: () => 0, reducedMotion: () => false });
    await r.load(listOf([[[SEGMENT.FEED, 1, 1, 0]], [[SEGMENT.FEED, 2, 2, 0]], [[SEGMENT.FEED, 3, 3, 0]]]), instant);
    frames.flush();
    const before = calls.get('uniform4fv') ?? 0;
    r.setPlanner({ cutEnd: 1, execEnd: 2, queuedEnd: 3, starving: false });
    expect(frames.flush()).toBe(1);
    r.setPlanner({ cutEnd: 1, execEnd: 2, queuedEnd: 3, starving: true });
    frames.flush();
    expect((calls.get('uniform4fv') ?? 0) - before).toBeGreaterThanOrEqual(8);
    const overlays = uploads.length;
    r.setToolMarker([1, 2, 3]);
    expect(uploads.length).toBeGreaterThan(overlays);
    r.setToolMarker(null);
    r.setPlanner(null);
    expect(frames.flush()).toBe(1);
    expect(frames.flush()).toBe(0);
  });

  it('the tool marker eases to each new report over the report interval, uploads nothing while it moves, then rests', async () => {
    const { gl, calls, uploads } = fakeGl();
    const frames = frameQueue();
    let clock = 0;
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request, now: () => clock, reducedMotion: () => false });
    await r.load(listOf([[[SEGMENT.FEED, 100, 100, 0]]]), instant);
    r.setToolMarker([0, 0, 0]);
    expect(frames.flush()).toBe(1);
    expect(frames.flush()).toBe(0);
    const overlays = uploads.length;
    clock = 250;
    r.setToolMarker([10, 0, 0]);
    let drawn = 0;
    for (; clock <= 600 && frames.pending > 0; clock += 16) drawn += frames.flush();
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThan(20);
    expect(frames.pending).toBe(0);
    expect(uploads.length).toBe(overlays);
    expect(calls.get('uniform3f')).toBeGreaterThan(drawn * 3 - 1);
  });

  it('the tool marker snaps under reduced motion: one frame per report', async () => {
    const { gl } = fakeGl();
    const frames = frameQueue();
    let clock = 0;
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request, now: () => clock, reducedMotion: () => true });
    r.setToolMarker([0, 0, 0]);
    frames.flush();
    clock = 250;
    r.setToolMarker([10, 0, 0]);
    expect(frames.flush()).toBe(1);
    expect(frames.flush()).toBe(0);
  });
});

describe('tool shape', () => {
  const flat = { tip: 'flat', diameter: 6, fluteLength: 18, shank: 6, length: 26 } as const;

  it('builds the true-size wireframe once per shape: a new position or the same shape uploads nothing', async () => {
    const { gl, uploads } = fakeGl();
    const frames = frameQueue();
    let clock = 0;
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request, now: () => clock, reducedMotion: () => false });
    await r.load(listOf([[[SEGMENT.FEED, 100, 100, 0]]]), instant);
    r.setToolMarker([0, 0, 0]);
    frames.flush();
    let before = uploads.length;
    r.setToolShape(flat);
    expect(uploads.length).toBeGreaterThan(before);
    // The wireframe sits at true size: its z runs from the tip (0) to the drawn length.
    const zs = Array.from(uploads[before] as Float32Array).filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...zs)).toBeCloseTo(26, 5);
    expect(frames.flush()).toBe(1);
    before = uploads.length;
    r.setToolShape({ ...flat });
    clock = 250;
    r.setToolMarker([10, 0, 0]);
    for (; clock <= 700 && frames.pending > 0; clock += 16) frames.flush();
    expect(uploads.length).toBe(before);
    r.setToolShape({ ...flat, tip: 'ball' });
    expect(uploads.length).toBeGreaterThan(before);
  });

  it('a preview marker (no board) is dimmed and jumps: one frame per position, a rebuild only when its kind changes', async () => {
    const { gl, uploads } = fakeGl();
    const frames = frameQueue();
    let clock = 0;
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request, now: () => clock, reducedMotion: () => false });
    r.setToolShape(flat);
    r.setToolMarker([0, 0, 0], true);
    frames.flush();
    const styles = uploads.find((u) => u instanceof Uint8Array && u.length > 0) as Uint8Array;
    expect(new Set(styles)).toEqual(new Set([13]));
    const before = uploads.length;
    clock = 250;
    r.setToolMarker([10, 0, 0], true);
    expect(frames.flush()).toBe(1);
    expect(frames.flush()).toBe(0);
    expect(uploads.length).toBe(before);
    r.setToolMarker([10, 0, 0]);
    expect(uploads.length).toBeGreaterThan(before);
  });

  it('null brings back the generic glyph; a shape set while the marker is hidden draws when it appears', async () => {
    const { gl, uploads } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request, now: () => 0, reducedMotion: () => true });
    const before = uploads.length;
    r.setToolShape(flat);
    expect(uploads.length).toBe(before);
    r.setToolMarker([1, 1, 1]);
    const zs = Array.from(uploads[before] as Float32Array).filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(26, 5);
    const mid = uploads.length;
    r.setToolShape(null);
    const glyph = Array.from(uploads[mid] as Float32Array).filter((_, i) => i % 3 === 2);
    expect(Math.max(...glyph)).toBeCloseTo((25 + 12 + 80) * 0.2, 5);
  });
});

describe('toolGlyph', () => {
  it('draws the bit, collet nut and spindle above the tip, true size on a bed and smaller on a small drawing', () => {
    const big = toolGlyph([10, 20, 0], { min: [0, 0, 0], max: [800, 800, 10] });
    const zs = big.flatMap(([a, b]) => [a[2], b[2]]);
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...zs)).toBeCloseTo(25 + 12 + 80);
    const small = toolGlyph([0, 0, 0], { min: [0, 0, 0], max: [20, 20, 1] });
    expect(Math.max(...small.flatMap(([a, b]) => [a[2], b[2]]))).toBeCloseTo((25 + 12 + 80) * 0.2);
    expect(toolGlyph([0, 0, 0], null).length).toBe(big.length);
  });
});

it('background refinement keeps the coarse path until an atomic swap; abort preserves it', async () => {
  const { gl, live } = fakeGl();
  const frames = frameQueue();
  const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
  const list = bigList(1000);
  await r.load(list, { ...instant, sampling: { stride: 20 } });
  const coarseChunks = r.chunkCount;
  const coarseResources = live();
  const controller = new AbortController();
  await expect(r.load(list, {
    retainUntilReady: true, signal: controller.signal, segmentsPerChunk: 20, budgetMs: 0,
    yieldToHost: async () => { expect(r.chunkCount).toBe(coarseChunks); controller.abort(); },
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(r.chunkCount).toBe(coarseChunks);
  expect(live()).toBe(coarseResources);
  await r.load(list, {
    retainUntilReady: true, segmentsPerChunk: 20, budgetMs: 0,
    yieldToHost: async () => { expect(r.chunkCount).toBe(coarseChunks); },
  });
  expect(r.chunkCount).toBeGreaterThan(coarseChunks);
  r.dispose();
  expect(live()).toBe(0);
});
