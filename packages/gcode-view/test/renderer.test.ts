import { describe, expect, it } from 'vitest';
import { SEGMENT, chunks, createRenderer } from '../src/index.ts';
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
    // Buffers go up as (positions, styles, lines) per chunk.
    const uploaded = uploads.filter((_, i) => i % 3 === 0).flatMap((u) => Array.from(u as Float32Array));
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
});
