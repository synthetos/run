import { describe, expect, it } from 'vitest';

import { SEGMENT, chunks, createRenderer } from '../src/index.ts';

import { COLORS, bigList, fakeGl, frameQueue, listOf } from './helpers.ts';


const instant = { yieldToHost: async () => { } };
describe('WebGL renderer', () => {


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
});
describe('WebGL renderer', () => {


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
});
describe('WebGL renderer', () => {


  it('a new load supersedes one still uploading', async () => {
    const { gl } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    let release: () => void = () => { };
    const first = r.load(bigList(10_000), { segmentsPerChunk: 100, budgetMs: 0, yieldToHost: () => new Promise((res) => { release = res; }) });
    const second = r.load(listOf([[[SEGMENT.FEED, 1, 0, 0]]]), instant);
    release();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await second;
    expect(r.chunkCount).toBe(1);
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
