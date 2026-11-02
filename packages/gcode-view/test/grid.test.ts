import { describe, expect, it } from 'vitest';
import { GRID_MAX_CELLS, SEGMENT, createRenderer, gridLayout, gridLines, niceStep, svgGrid } from '../src/index.ts';
import { COLORS, fakeGl, frameQueue, listOf } from './helpers.ts';

const instant = { yieldToHost: async () => {} };

describe('bed/work grid', () => {
  it('niceStep picks the smallest 1, 2 or 5 × 10^n at least the raw step', () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.3)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(31.6)).toBe(50);
  });

  it('covers the padded job extent, includes the origin, sits at the bottom of the path, 10 to 25 cells', () => {
    const g = gridLayout({ min: [10, 10, -6], max: [50, 50, 5] }, null);
    expect(g).not.toBeNull();
    if (g === null) return;
    expect(g.x0).toBeLessThanOrEqual(0);
    expect(g.y0).toBeLessThanOrEqual(0);
    expect(g.x1).toBeGreaterThanOrEqual(50);
    expect(g.z).toBe(-6);
    const cells = Math.max(g.x1 - g.x0, g.y1 - g.y0) / g.step;
    expect(cells).toBeGreaterThanOrEqual(10);
    expect(cells).toBeLessThanOrEqual(GRID_MAX_CELLS + 1);
  });

  it('covers the envelope (machine travel) when known, at its floor when lower', () => {
    const g = gridLayout({ min: [0, 0, -2], max: [40, 40, 5] }, { min: [0, 0, -100], max: [800, 600, 0] });
    expect(g).toMatchObject({ x0: 0, y0: 0, x1: 800, y1: 600, z: -100, step: 50, majorEvery: 10 });
  });

  it('major lines fall on the origin and every 5 or 10 cells; nothing to stand on gives no grid', () => {
    const g = gridLayout({ min: [-30, -30, 0], max: [30, 30, 0] }, null);
    if (g === null) throw new Error('no grid');
    const lines = gridLines(g);
    const x0 = lines.find((l) => l.a[0] === 0 && l.b[0] === 0);
    expect(x0?.major).toBe(true);
    expect(lines.some((l) => !l.major)).toBe(true);
    expect(gridLayout(null, null)).toBeNull();
  });

  it('the renderer draws it in the overlay (one call) only when turned on, and it survives a new file', async () => {
    const { gl, calls, uploads } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request, grid: true });
    await r.load(listOf([[[SEGMENT.FEED, 40, 40, -1]]]), instant);
    frames.flush();
    expect(calls.get('drawArrays')).toBe(2);
    const styles = uploads.filter((_, i) => i % 4 === 1).at(-1) as Uint8Array;
    expect(Array.from(styles).some((s) => s === 9 || s === 10)).toBe(true);
    await r.load(listOf([[[SEGMENT.FEED, 5, 5, 0]]]), instant);
    frames.flush();
    expect(calls.get('drawArrays')).toBe(4);
    r.setGridVisible(false);
    frames.flush();
    expect(calls.get('drawArrays')).toBe(5);
  });

  it('svgGrid gives minor and major path data under a top view', () => {
    const g = svgGrid(listOf([[[SEGMENT.FEED, 40, 40, 0]]]));
    expect(g.minor).toMatch(/^M/);
    expect(g.major).toMatch(/^M/);
    expect(svgGrid(listOf([])).box).toBeNull();
  });
});
