/** Colour by tool in the renderer (lineTools.ts, pathShaders.ts): the per-line slots as a texture, on a recording context. */
import { describe, expect, it } from 'vitest';
import { LINE_TOOLS_WIDTH, TOOL_COLOR_SLOTS, createRenderer, lineToolsLayout, pathShaderSource } from '../src/index.ts';
import { COLORS, fakeGl, frameQueue, listOf } from './helpers.ts';

describe('lineToolsLayout', () => {
  it('lays the slots out in rows of 4096, padded with the neutral slot', () => {
    expect(lineToolsLayout(Uint8Array.from([1, 2, 3]))).toEqual({ width: 3, height: 1, data: Uint8Array.from([1, 2, 3]) });
    const big = lineToolsLayout(new Uint8Array(LINE_TOOLS_WIDTH + 2).fill(5));
    expect([big.width, big.height]).toEqual([LINE_TOOLS_WIDTH, 2]);
    expect(big.data[LINE_TOOLS_WIDTH + 1]).toBe(5);
    expect(big.data[LINE_TOOLS_WIDTH + 2]).toBe(0);
    expect(lineToolsLayout(new Uint8Array(0))).toMatchObject({ width: 1, height: 1 });
  });
});

describe('the renderer with tool colours', () => {
  it('uploads the slots once per change, not the path', () => {
    const { gl, calls, uploads } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    r.load(listOf([[[1, 1, 0, 0]], [[1, 2, 0, 0]]])).catch(() => undefined); // superseded or disposed loads reject with AbortError
    const texBefore = calls.get('texImage2D') ?? 0;
    const uploadsBefore = uploads.length;
    r.setToolColors({ lineSlots: Uint8Array.from([1, 2]), palette: Array.from({ length: TOOL_COLOR_SLOTS }, () => [0, 0, 1, 1] as const) });
    expect((calls.get('texImage2D') ?? 0) - texBefore).toBe(1);
    expect(uploads.length).toBe(uploadsBefore);
    r.setToolFocus(2);
    expect(frames.pending).toBe(1);
    frames.flush();
    r.setToolColors(null);
    r.dispose();
  });

  it('keeps the move type visible: arcs lighter and rapids fainter than feeds, in the tool colour', () => {
    const src = pathShaderSource();
    expect(src).toMatch(/c = mix\(c, u_bg, 0\.35\)/);
    expect(src).toMatch(/else if \(rapid\) c = mix\(c, u_bg, 0\.55\)/);
  });
});
