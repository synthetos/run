/**
 * Colour by tool (renderer.ts): the colour slot of every list line, as a small integer texture the path's
 * vertex shader reads by line (pathShaders.ts), and the colours of the slots. Slot 0 is the neutral colour of
 * an unknown tool; slots 1 to 8 are the tools in the order the file uses them (the page decides, never this
 * module). Changing the tool table re-uploads this texture only, never the path.
 *
 * It does not choose colours or slots (the app does), and it draws nothing itself.
 */
import type { Rgba } from './scene.ts';
import { LINE_TOOLS_WIDTH } from './pathShaders.ts';

/** Colour slots: the neutral one and eight tools. */
export const TOOL_COLOR_SLOTS = 9;

/** What the page gives: a slot per list line and a colour per slot (missing slots are drawn neutral). */
export interface ToolColors {
  readonly lineSlots: Uint8Array;
  readonly palette: readonly Rgba[];
}

export interface LineTools {
  set(colors: ToolColors | null): void;
  readonly active: boolean;
  /** Binds the texture to `unit` and sets the shader's uniforms (u_lineTools, u_toolOn, u_toolColors). */
  bind(unit: number, sampler: WebGLUniformLocation | null, on: WebGLUniformLocation | null, palette: WebGLUniformLocation | null): void;
  dispose(): void;
}

/** The slots laid out as rows of `LINE_TOOLS_WIDTH`, padded with 0. */
export function lineToolsLayout(slots: Uint8Array): { readonly width: number; readonly height: number; readonly data: Uint8Array } {
  const width = Math.max(1, Math.min(LINE_TOOLS_WIDTH, slots.length));
  const height = Math.max(1, Math.ceil(slots.length / LINE_TOOLS_WIDTH));
  const data = new Uint8Array(width * height);
  data.set(slots.subarray(0, data.length));
  return { width, height, data };
}

export function createLineTools(gl: WebGL2RenderingContext): LineTools {
  const texture = gl.createTexture();
  let colors: ToolColors | null = null;

  function upload(slots: Uint8Array): void {
    const { width, height, data } = lineToolsLayout(slots);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    // Integer textures are read only with texelFetch, and must not be filtered.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  // A 1 × 1 texture from the start, so the sampler always has an integer texture to read.
  upload(new Uint8Array(1));

  return {
    set(next) {
      colors = next;
      upload(next === null ? new Uint8Array(1) : next.lineSlots);
    },
    get active() {
      return colors !== null;
    },
    bind(unit, sampler, on, palette) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(sampler, unit);
      gl.uniform1f(on, colors === null ? 0 : 1);
      const flat = new Float32Array(TOOL_COLOR_SLOTS * 4);
      const p = colors?.palette ?? [];
      for (let k = 0; k < TOOL_COLOR_SLOTS; k++) flat.set((p[k] ?? p[0] ?? [0.55, 0.57, 0.6, 1]) as readonly number[], k * 4);
      gl.uniform4fv(palette, flat);
    },
    dispose() {
      gl.deleteTexture(texture);
    },
  };
}
