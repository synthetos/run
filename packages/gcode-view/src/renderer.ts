/**
 * WebGL2 toolpath renderer. It draws a segment list as chunked line segments,
 * the work envelope as a box and the work-coordinate origin as an axis triad.
 *
 * It renders on demand only: a frame is drawn when something changed (data,
 * view, toggles, highlight, size) and never otherwise. There is no animation,
 * no playback and no simulated tool position in this package, by design: a
 * preview must never look like a machine that is moving.
 */
import { fitOrbit, pan, rotate, viewProjection, zoom, type Orbit } from './camera.ts';
import { DEFAULT_SEGMENTS_PER_CHUNK, STYLE, chunks } from './geometry.ts';
import { checkSegmentList, drawnBounds, lineCount, type Box3, type SegmentList, type Vec3 } from './segments.ts';
import { runSliced, type SliceOptions } from './slicer.ts';

export type Rgba = readonly [number, number, number, number];

export interface PreviewColors {
  readonly background: Rgba;
  readonly rapid: Rgba;
  readonly feed: Rgba;
  readonly arc: Rgba;
  readonly outOfBounds: Rgba;
  readonly uncertain: Rgba;
  readonly highlight: Rgba;
  readonly envelope: Rgba;
  readonly axisX: Rgba;
  readonly axisY: Rgba;
  readonly axisZ: Rgba;
}

/** Overlay styles follow the segment styles in the colour table. */
const OVERLAY = Object.freeze({ ENVELOPE: 5, AXIS_X: 6, AXIS_Y: 7, AXIS_Z: 8 });
const STYLE_COUNT = 9;

export interface LoadOptions extends Pick<SliceOptions, 'signal' | 'budgetMs' | 'now' | 'yieldToHost'> {
  readonly segmentsPerChunk?: number;
  /** Fraction of segments uploaded, 0..1. */
  readonly onProgress?: (fraction: number) => void;
}

export interface PreviewRenderer {
  /** Replaces the drawn list. Uploads in time slices; rejects with AbortError when `signal` aborts. */
  load(list: SegmentList, options?: LoadOptions): Promise<void>;
  clear(): void;
  setRapidsVisible(visible: boolean): void;
  /** Highlights lines 0..line inclusive (the scrubber); -1 for none. */
  setHighlight(line: number): void;
  /** Machine-coordinate work envelope (from the live board only), or null. */
  setEnvelope(envelope: Box3 | null): void;
  /** Origin of the active work coordinate system in machine coordinates, or null to hide the triad. */
  setWcsOrigin(origin: Vec3 | null, size?: number): void;
  setColors(colors: PreviewColors): void;
  /** Canvas size in CSS pixels and the device pixel ratio. */
  resize(width: number, height: number, pixelRatio?: number): void;
  /** Fits the view to the drawn path (and envelope). */
  fit(): void;
  orbit(dAzimuth: number, dElevation: number): void;
  zoomBy(factor: number): void;
  panBy(dx: number, dy: number): void;
  /** Schedules one frame; several calls before it runs draw once. */
  requestRender(): void;
  /** Number of frames drawn (for tests and diagnostics). */
  readonly frames: number;
  readonly chunkCount: number;
  dispose(): void;
}

export interface RendererOptions {
  readonly colors: PreviewColors;
  /** Schedules a frame (default `requestAnimationFrame`). */
  readonly requestFrame?: (draw: () => void) => void;
}

const VERTEX = `#version 300 es
precision highp float;
in vec3 a_pos;
in float a_style;
in float a_line;
uniform mat4 u_mvp;
uniform float u_showRapids;
uniform float u_highlightEnd;
uniform vec4 u_colors[${String(STYLE_COUNT)}];
uniform vec4 u_highlight;
out vec4 v_color;
out float v_hidden;
void main() {
  int s = int(a_style + 0.5);
  v_hidden = (s == ${String(STYLE.RAPID)} && u_showRapids < 0.5) ? 1.0 : 0.0;
  v_color = (a_line >= 0.0 && a_line < u_highlightEnd) ? u_highlight : u_colors[s];
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec4 v_color;
in float v_hidden;
out vec4 o_color;
void main() {
  if (v_hidden > 0.5) discard;
  o_color = v_color;
}`;

interface GpuChunk {
  readonly vao: WebGLVertexArrayObject;
  readonly buffers: readonly WebGLBuffer[];
  readonly vertexCount: number;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('gcode-view: could not create a shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) throw new Error(`gcode-view: shader did not compile: ${gl.getShaderInfoLog(shader) ?? ''}`);
  return shader;
}

function abortError(): DOMException {
  return new DOMException('the preview load was cancelled', 'AbortError');
}

export function createRenderer(gl: WebGL2RenderingContext, options: RendererOptions): PreviewRenderer {
  const requestFrame = options.requestFrame ?? ((draw: () => void) => { requestAnimationFrame(draw); });
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.bindAttribLocation(program, 1, 'a_style');
  gl.bindAttribLocation(program, 2, 'a_line');
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) throw new Error(`gcode-view: program did not link: ${gl.getProgramInfoLog(program) ?? ''}`);
  const u = {
    mvp: gl.getUniformLocation(program, 'u_mvp'),
    showRapids: gl.getUniformLocation(program, 'u_showRapids'),
    highlightEnd: gl.getUniformLocation(program, 'u_highlightEnd'),
    colors: gl.getUniformLocation(program, 'u_colors'),
    highlight: gl.getUniformLocation(program, 'u_highlight'),
  };

  let colors = options.colors;
  let path: GpuChunk[] = [];
  let overlay: GpuChunk | null = null;
  let list: SegmentList | null = null;
  let bounds: Box3 | null = null;
  let envelope: Box3 | null = null;
  let wcs: { origin: Vec3; size: number } | null = null;
  let showRapids = true;
  let highlightLine = -1;
  let view: Orbit = fitOrbit(null);
  let width = 1, height = 1;
  let scheduled = false;
  let frames = 0;
  let generation = 0;
  let disposed = false;

  function upload(positions: Float32Array, styles: Uint8Array, lines: Float32Array): GpuChunk {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const make = (data: ArrayBufferView, index: number, size: number, type: number): WebGLBuffer => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, type, false, 0, 0);
      return b;
    };
    const buffers = [make(positions, 0, 3, gl.FLOAT), make(styles, 1, 1, gl.UNSIGNED_BYTE), make(lines, 2, 1, gl.FLOAT)];
    gl.bindVertexArray(null);
    return { vao, buffers, vertexCount: positions.length / 3 };
  }

  function release(c: GpuChunk): void {
    gl.deleteVertexArray(c.vao);
    for (const b of c.buffers) gl.deleteBuffer(b);
  }

  function rebuildOverlay(): void {
    if (overlay !== null) release(overlay);
    overlay = null;
    const pos: number[] = [];
    const sty: number[] = [];
    const seg = (a: Vec3, b: Vec3, s: number): void => {
      pos.push(...a, ...b);
      sty.push(s, s);
    };
    if (envelope !== null) {
      const [x0, y0, z0] = envelope.min;
      const [x1, y1, z1] = envelope.max;
      const c: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
      for (const [a, b] of edges) seg(c[a] as Vec3, c[b] as Vec3, OVERLAY.ENVELOPE);
    }
    if (wcs !== null) {
      const [x, y, z] = wcs.origin;
      const s = wcs.size;
      seg([x, y, z], [x + s, y, z], OVERLAY.AXIS_X);
      seg([x, y, z], [x, y + s, z], OVERLAY.AXIS_Y);
      seg([x, y, z], [x, y, z + s], OVERLAY.AXIS_Z);
    }
    if (pos.length === 0) return;
    overlay = upload(new Float32Array(pos), new Uint8Array(sty), new Float32Array(sty.length).fill(-1));
  }

  function colorTable(): Float32Array {
    const table = [colors.rapid, colors.feed, colors.arc, colors.outOfBounds, colors.uncertain, colors.envelope, colors.axisX, colors.axisY, colors.axisZ];
    return new Float32Array(table.flat());
  }

  function draw(): void {
    scheduled = false;
    if (disposed) return;
    frames++;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const bg = colors.background;
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);
    gl.uniformMatrix4fv(u.mvp, false, viewProjection(view, width / height));
    gl.uniform1f(u.showRapids, showRapids ? 1 : 0);
    gl.uniform1f(u.highlightEnd, highlightLine + 1);
    gl.uniform4fv(u.colors, colorTable());
    gl.uniform4fv(u.highlight, new Float32Array(colors.highlight));
    for (const c of overlay === null ? path : [...path, overlay]) {
      gl.bindVertexArray(c.vao);
      gl.drawArrays(gl.LINES, 0, c.vertexCount);
    }
    gl.bindVertexArray(null);
  }

  function requestRender(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    requestFrame(draw);
  }

  function clearPath(): void {
    for (const c of path) release(c);
    path = [];
    list = null;
    bounds = null;
  }

  function fitBox(): Box3 | null {
    if (bounds === null) return envelope;
    if (envelope === null) return bounds;
    return {
      min: [Math.min(bounds.min[0], envelope.min[0]), Math.min(bounds.min[1], envelope.min[1]), Math.min(bounds.min[2], envelope.min[2])],
      max: [Math.max(bounds.max[0], envelope.max[0]), Math.max(bounds.max[1], envelope.max[1]), Math.max(bounds.max[2], envelope.max[2])],
    };
  }

  return {
    async load(next, loadOptions = {}) {
      checkSegmentList(next);
      const mine = ++generation;
      clearPath();
      list = next;
      bounds = drawnBounds(next);
      view = fitOrbit(fitBox());
      let drawable = 0;
      for (let i = 1; i < next.kinds.length; i++) if (((next.kinds[i] as number) & 0x7f) !== 0) drawable++;
      let uploaded = 0;
      const source = chunks(next, loadOptions.segmentsPerChunk ?? DEFAULT_SEGMENTS_PER_CHUNK);
      const steps: Iterator<unknown> = {
        next: () => {
          if (mine !== generation || disposed) throw abortError();
          const r = source.next();
          if (r.done === true) return { done: true, value: undefined };
          path.push(upload(r.value.positions, r.value.styles, r.value.lines));
          uploaded += r.value.segments;
          loadOptions.onProgress?.(drawable === 0 ? 1 : uploaded / drawable);
          requestRender();
          return { done: false, value: undefined };
        },
      };
      try {
        await runSliced(steps, {
          ...(loadOptions.signal === undefined ? {} : { signal: loadOptions.signal }),
          ...(loadOptions.budgetMs === undefined ? {} : { budgetMs: loadOptions.budgetMs }),
          ...(loadOptions.now === undefined ? {} : { now: loadOptions.now }),
          ...(loadOptions.yieldToHost === undefined ? {} : { yieldToHost: loadOptions.yieldToHost }),
        });
      } catch (e) {
        if (mine === generation) clearPath();
        requestRender();
        throw e;
      }
      loadOptions.onProgress?.(1);
      requestRender();
    },
    clear() {
      generation++;
      clearPath();
      requestRender();
    },
    setRapidsVisible(visible) {
      showRapids = visible;
      requestRender();
    },
    setHighlight(line) {
      highlightLine = list === null ? -1 : Math.min(Math.max(-1, Math.floor(line)), lineCount(list) - 1);
      requestRender();
    },
    setEnvelope(next) {
      envelope = next;
      rebuildOverlay();
      requestRender();
    },
    setWcsOrigin(origin, size) {
      const box = fitBox();
      const auto = box === null ? 10 : Math.max(1, Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]) / 8);
      wcs = origin === null ? null : { origin, size: size ?? auto };
      rebuildOverlay();
      requestRender();
    },
    setColors(next) {
      colors = next;
      requestRender();
    },
    resize(w, h, pixelRatio = 1) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      const canvas = gl.canvas;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      requestRender();
    },
    fit() {
      view = fitOrbit(fitBox());
      requestRender();
    },
    orbit(dA, dE) {
      view = rotate(view, dA, dE);
      requestRender();
    },
    zoomBy(factor) {
      view = zoom(view, factor);
      requestRender();
    },
    panBy(dx, dy) {
      view = pan(view, dx, dy);
      requestRender();
    },
    requestRender,
    get frames() {
      return frames;
    },
    get chunkCount() {
      return path.length;
    },
    dispose() {
      disposed = true;
      generation++;
      clearPath();
      if (overlay !== null) release(overlay);
      overlay = null;
      gl.deleteProgram(program);
    },
  };
}

