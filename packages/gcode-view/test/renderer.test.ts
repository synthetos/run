import { describe, expect, it } from 'vitest';

import { SEGMENT, createRenderer } from '../src/index.ts';

import { COLORS, fakeGl, frameQueue, listOf } from './helpers.ts';


const instant = { yieldToHost: async () => { } };
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
});
describe('WebGL renderer', () => {


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
describe('WebGL renderer', () => {


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
});
