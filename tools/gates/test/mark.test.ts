/**
 * The n mark in the icons (first-run design §4): the icon renderer draws the n from the same numbers as the SVG
 * wordmark, derived from WORDMARK_GEOMETRY, never copied.
 */
import { describe, expect, it } from 'vitest';
import { WORDMARK_GEOMETRY } from '../../../apps/web/src/brand/wordmarkGeometry.ts';
import { MARK_BOX, markPrimitives } from '../src/icons/mark.ts';
import { ICON_COLOURS, drawIcon } from '../src/icons/draw.ts';

describe('markPrimitives', () => {
  it('derives the n from the wordmark geometry, so the SVG and the icons share the numbers', () => {
    const p = markPrimitives(WORDMARK_GEOMETRY);
    expect(p.stem).toEqual({ x: 44, y0: 40, y1: 16 });
    expect(p.arch).toEqual({ cx: 52, cy: 24, r: 8 });
    expect(p.rightStem).toEqual({ x: 60, y0: 24, y1: 40 });
    expect(p.tool).toEqual(WORDMARK_GEOMETRY.tool);
    expect(p.stroke).toBe(WORDMARK_GEOMETRY.stroke);
    expect(p.dots.map((d) => [d.x, Math.round(d.y * 100) / 100])).toEqual([[44, 40], [44, 32.85], [44, 25.7], [44, 18.55]]);
    expect(WORDMARK_GEOMETRY.nStem).toBe(`M${p.stem.x} ${p.stem.y0}V${p.stem.y1}`);
    expect(WORDMARK_GEOMETRY.nArch).toBe(`M${p.arch.cx - p.arch.r} ${p.arch.cy}a${p.arch.r} ${p.arch.r} 0 0 1 ${2 * p.arch.r} 0v${p.rightStem.y1 - p.rightStem.y0}`);
  });
  it('the mark box is the spec viewBox around the n (40..64 × 12..44) and holds every primitive', () => {
    expect(MARK_BOX).toEqual({ x: 40, y: 12, w: 24, h: 32 });
    const p = markPrimitives(WORDMARK_GEOMETRY);
    const half = p.stroke / 2;
    expect(p.stem.x - half).toBeGreaterThan(MARK_BOX.x);
    expect(p.tool.cx + p.tool.r).toBeLessThan(MARK_BOX.x + MARK_BOX.w);
    expect(p.arch.cy - p.arch.r - half).toBeGreaterThan(MARK_BOX.y);
    expect(p.tool.cy + p.tool.r).toBeLessThan(MARK_BOX.y + MARK_BOX.h);
  });
  it('refuses a path it does not understand', () => {
    expect(() => markPrimitives({ ...WORDMARK_GEOMETRY, nStem: 'M1 1L2 2' })).toThrow(/nStem/);
    expect(() => markPrimitives({ ...WORDMARK_GEOMETRY, nArch: 'M44 24a8 8 0 0 0 16 0v16' })).toThrow(/nArch/);
    expect(() => markPrimitives({ ...WORDMARK_GEOMETRY, dash: '3' })).toThrow(/dash/);
  });
});

describe('the mark icon', () => {
  const near = (px: readonly number[], hex: string): boolean => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].every((v, k) => Math.abs(v - (px[k] as number)) <= 2);
  };
  it('is ink dots on the left, a blue arch and tool on the right, on paper, and nothing else', () => {
    const size = 96;
    const img = drawIcon(size, 'mark');
    let ink = 0;
    let blue = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        const px = [img.rgba[i] as number, img.rgba[i + 1] as number, img.rgba[i + 2] as number];
        expect(img.rgba[i + 3], `alpha ${x},${y}`).toBe(255);
        if (near(px, ICON_COLOURS.ink)) { ink += 1; expect(x, `ink at ${x},${y}`).toBeLessThan(size / 2); }
        if (near(px, ICON_COLOURS.blue)) { blue += 1; expect(x, `blue at ${x},${y}`).toBeGreaterThan(size / 4); }
      }
    }
    expect(ink).toBeGreaterThan(40);
    expect(blue).toBeGreaterThan(ink);
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
      const i = ((y as number) * size + (x as number)) * 4;
      expect(near([img.rgba[i] as number, img.rgba[i + 1] as number, img.rgba[i + 2] as number], ICON_COLOURS.paper), `corner ${x},${y}`).toBe(true);
    }
  });
});
