import { describe, expect, it } from 'vitest';

import { SEGMENT, createRenderer, toolGlyph } from '../src/index.ts';

import { COLORS, fakeGl, frameQueue, listOf } from './helpers.ts';


const instant = { yieldToHost: async () => { } };
describe('WebGL renderer', () => {


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
});
describe('WebGL renderer', () => {


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
});
describe('WebGL renderer', () => {


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
