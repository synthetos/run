/**
 * The spindle spins the bit (markerSpin.ts; owner, 2026-11-10): M3 turns the live marker clockwise seen from
 * above, M4 the other way, in steps well under the flutes' symmetry; the redraws come on a timer only while the
 * spindle is on and the marker is drawn, never under reduced motion, and none when the view is otherwise idle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEGMENT, SPIN_FRAME_MS, SPIN_STEP_RAD, createRenderer, fluteHelix, spinAngle } from '../src/index.ts';
import { COLORS, fakeGl, frameQueue, listOf } from './helpers.ts';

describe('spinAngle', () => {
  it('turns M3 clockwise from above (negative about +Z), M4 the other way, one step per frame, none when off', () => {
    expect(spinAngle(1, 0, 3 * SPIN_FRAME_MS, SPIN_FRAME_MS)).toBeCloseTo(-3 * SPIN_STEP_RAD, 9);
    expect(spinAngle(-1, 0, 3 * SPIN_FRAME_MS, SPIN_FRAME_MS)).toBeCloseTo(3 * SPIN_STEP_RAD, 9);
    expect(spinAngle(0, 0, 10_000, SPIN_FRAME_MS)).toBe(0);
    expect(spinAngle(1, 1000, 1000 + SPIN_FRAME_MS / 2, SPIN_FRAME_MS)).toBeCloseTo(0, 9);
    // Well under the 45° between the wireframe's flute lines, so the direction reads.
    expect(SPIN_STEP_RAD).toBeLessThan(Math.PI / 8);
  });

  it('builds a helix from the tip up the flutes', () => {
    const h = fluteHelix(3, 20, 1.5, 36);
    expect(h).toHaveLength(36);
    expect(h[0]?.[0]).toEqual([3, 0, 0]);
    expect(h.at(-1)?.[1][2]).toBeCloseTo(20, 9);
    expect(fluteHelix(0, 20)).toEqual([]);
  });
});

describe('the renderer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function setup(reduced = false): Promise<{ r: ReturnType<typeof createRenderer>; frames: ReturnType<typeof frameQueue> }> {
    const { gl } = fakeGl();
    const frames = frameQueue();
    let t = 0;
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request, now: () => (t += 1000), reducedMotion: () => reduced });
    await r.load(listOf([[[SEGMENT.FEED, 10, 0, 0]]]), { yieldToHost: async () => {} });
    r.setToolMarker([0, 0, 0]);
    frames.flush();
    return { r, frames };
  }

  it('redraws a few times a second while the spindle is on and the marker is drawn', async () => {
    const { r, frames } = await setup();
    r.setToolSpin(1);
    expect(frames.flush()).toBe(1);
    vi.advanceTimersByTime(SPIN_FRAME_MS);
    expect(frames.flush()).toBe(1);
    vi.advanceTimersByTime(SPIN_FRAME_MS);
    expect(frames.flush()).toBe(1);
    // Off: it rests.
    r.setToolSpin(0);
    frames.flush();
    vi.advanceTimersByTime(10 * SPIN_FRAME_MS);
    expect(frames.flush()).toBe(0);
  });

  it('does not turn (and asks for no frames) under reduced motion, or with no marker', async () => {
    const reduced = await setup(true);
    reduced.r.setToolSpin(1);
    reduced.frames.flush();
    vi.advanceTimersByTime(10 * SPIN_FRAME_MS);
    expect(reduced.frames.flush()).toBe(0);
    const hidden = await setup();
    hidden.r.setToolMarker(null);
    hidden.frames.flush();
    hidden.r.setToolSpin(-1);
    hidden.frames.flush();
    vi.advanceTimersByTime(10 * SPIN_FRAME_MS);
    expect(hidden.frames.flush()).toBe(0);
    hidden.r.dispose();
  });

  it('never turns the bit on a software renderer, where frames are too slow to spend on it', async () => {
    const { gl } = fakeGl();
    const soft = new Proxy(gl, { get: (t, p: string) => (p === 'getParameter' ? () => 'Google SwiftShader' : (t as unknown as Record<string, unknown>)[p]) }) as WebGL2RenderingContext;
    const frames = frameQueue();
    const r = createRenderer(soft, { colors: COLORS, requestFrame: frames.request, reducedMotion: () => false });
    expect(r.turnsBit).toBe(false);
    await r.load(listOf([[[SEGMENT.FEED, 10, 0, 0]]]), { yieldToHost: async () => {} });
    r.setToolMarker([0, 0, 0]);
    r.setToolSpin(1);
    frames.flush();
    vi.advanceTimersByTime(10 * SPIN_FRAME_MS);
    expect(frames.flush()).toBe(0);
  });
});
