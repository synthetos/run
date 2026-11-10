/**
 * Large-file acceptance for the preview (ROADMAP TB-03, old P1-04/P1-05,
 * RUN_PLAN §7.6 and §9 budgets). The worker side runs in-process here; the
 * main-thread side (geometry upload, list window) runs on the real clock.
 */
import { describe, expect, it } from 'vitest';
import { createRenderer, listWindow } from '@synthetos/gcode-view';
import { LITE_THRESHOLD_LINES, analyseBytes, transferablesOf } from '../src/gcode-worker/pipeline.ts';

/** A valid job of `n` motion lines: feeds and matching arcs. */
function job(n: number): Uint8Array {
  const lines: string[] = ['G21 G90 G17', 'G0 Z5', 'M3 S1000'];
  for (let i = 0; i < n; i++) lines.push(i % 2 === 0 ? `G1 X10 Y${String(i % 20)} F800` : `G2 X12 Y${String((i - 1) % 20)} I1 J0`);
  lines.push('M5', 'M30', '');
  const text = lines.join('\n');
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** A WebGL2 stand-in that accepts every call (the GPU work is not on the main thread's clock in a browser either). */
function nullGl(): WebGL2RenderingContext {
  const target: Record<string, unknown> = { canvas: { width: 0, height: 0 }, drawingBufferWidth: 1, drawingBufferHeight: 1, getShaderParameter: () => true, getProgramParameter: () => true };
  return new Proxy(target, { get: (t, p: string) => (p in t ? t[p] : /^[A-Z_0-9]+$/.test(p) ? 1 : () => ({})) }) as unknown as WebGL2RenderingContext;
}

describe('large files', () => {
  // Wall clock: a slice the host pre-empts (the other packages' tests share the cores under `pnpm check`) reads long
  // without the pipeline having overrun its budget, so this gets two retries, like the slicer's real-clock case.
  it('1M lines: full preview with no main-thread slice over 50 ms while the geometry uploads', { timeout: 240_000, retry: 2 }, async () => {
    const { result } = analyseBytes(job(1_000_000), { dialect: 'tinyg-en', mode: 'full' });
    expect(result.summary.blocked).toBe(false);
    const segments = result.segments;
    if (segments === null) throw new Error('expected 3D geometry');
    expect(segments.lineToVertex.length - 1).toBeGreaterThanOrEqual(1_000_000);

    let longest = 0;
    let sliceStart = performance.now();
    const renderer = createRenderer(nullGl(), {
      colors: { background: [1, 1, 1, 1], rapid: [0, 0, 1, 1], feed: [0, 0, 0, 1], arc: [0, 0, 0, 1], outOfBounds: [1, 0, 0, 1], uncertain: [0, 0, 0, 1], highlight: [1, 1, 0, 1], envelope: [0, 0, 0, 1], axisX: [1, 0, 0, 1], axisY: [0, 1, 0, 1], axisZ: [0, 0, 1, 1], grid: [0.9, 0.9, 0.9, 1], gridMajor: [0.8, 0.8, 0.8, 1] },
      requestFrame: () => {},
      grid: true,
    });
    await renderer.load(segments, {
      yieldToHost: async () => {
        longest = Math.max(longest, performance.now() - sliceStart);
        await new Promise((r) => setTimeout(r, 0));
        sliceStart = performance.now();
      },
    });
    longest = Math.max(longest, performance.now() - sliceStart);
    expect(renderer.chunkCount).toBeGreaterThan(10);
    expect(longest).toBeLessThan(50);

    // The list renders a window, whatever the length.
    const t = performance.now();
    const w = listWindow({ count: result.fileLines, rowHeight: 18, scrollTop: 7_000_000, viewportHeight: 800 });
    expect(w.end - w.first).toBeLessThan(80);
    expect(performance.now() - t).toBeLessThan(50);
  });

  it('750k lines retain geometry once, independent of initial drawing detail', { timeout: 240_000 }, () => {
    const bytes = job(750_000);
    const fileBytes = bytes.length;
    const { result } = analyseBytes(bytes, { dialect: 'tinyg-en', mode: 'auto' });
    expect(result.fileLines).toBeGreaterThan(LITE_THRESHOLD_LINES);
    expect(result.lite).toBe(false);
    expect(result.liteBySize).toBe(false);
    expect(result.segments).not.toBeNull();
    const held = transferablesOf(result).reduce((a, b) => a + b.byteLength, 0);
    // One packed vertex list plus bounded per-line tables; no copy for each detail level.
    expect(held).toBeLessThanOrEqual(fileBytes + (result.segments?.kinds.length ?? 0) * 13 + result.sourceLines.length * 32 + 1024);
  });
});
