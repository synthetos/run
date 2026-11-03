/**
 * WebGL2 toolpath renderer. It draws a segment list as chunked line segments,
 * the work envelope as a box, the work-coordinate origin as an axis triad and,
 * when asked, the bed/work grid (grid.ts) under the drawing.
 *
 * It renders on demand only: a frame is drawn when something changed (data,
 * view, toggles, highlight, size) and never otherwise. There is no animation,
 * no playback and no simulated tool position in this package, by design: a
 * preview must never look like a machine that is moving.
 */
import { fitOrbit, pan, rotate, viewProjection, zoom, type Orbit } from './camera.ts';
import { DEFAULT_SEGMENTS_PER_CHUNK, STYLE, chunks } from './geometry.ts';
import { checkSegmentList, lineCount, type Box3, type SegmentList, type Vec3 } from './segments.ts';
import { runSliced, type SliceOptions } from './slicer.ts';
import { gridLayout, gridLines } from './grid.ts';

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
  /** Bed/work grid, minor lines. */
  readonly grid: Rgba;
  /** Bed/work grid, major lines (every 5 or 10 cells, through the origin). */
  readonly gridMajor: Rgba;
  /** Planner view (a running job): the line executing now, and the queued band; amber while starving. Defaults derive from the others. */
  readonly plannerExec?: Rgba;
  readonly plannerQueued?: Rgba;
  readonly plannerStarving?: Rgba;
}

/**
 * The planner view of a running job, in the drawn list's line indices: lines before `cutEnd` are cut (drawn
 * dimmed), lines in [cutEnd, execEnd) are executing now, lines in [execEnd, queuedEnd) are sent and acknowledged but
 * not yet executed, the rest are not sent yet (normal colours). It comes from the board's reports; it never
 * animates anything by itself.
 */
export interface PlannerOverlay {
  readonly cutEnd: number;
  readonly execEnd: number;
  readonly queuedEnd: number;
  /** The queued band is nearly empty while cutting: drawn amber. */
  readonly starving: boolean;
}

/** Overlay styles follow the segment styles in the colour table. */
const OVERLAY = Object.freeze({ ENVELOPE: 5, AXIS_X: 6, AXIS_Y: 7, AXIS_Z: 8, GRID: 9, GRID_MAJOR: 10, MARKER: 11 });
const STYLE_COUNT = 12;

export interface LoadOptions extends Pick<SliceOptions, 'signal' | 'budgetMs' | 'now' | 'yieldToHost'> {
  readonly segmentsPerChunk?: number;
  /** Fraction of the list uploaded, 0..1. */
  readonly onProgress?: (fraction: number) => void;
  /**
   * Box of the path when the caller already has it (e.g. the interpreter's
   * exact bounds). Without it the box is gathered while the chunks upload,
   * so loading never scans the whole list in one go.
   */
  readonly bounds?: Box3 | null;
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
  /** Shows or hides the bed/work grid (see grid.ts). */
  setGridVisible(visible: boolean): void;
  /** Origin of the active work coordinate system in machine coordinates, or null to hide the triad. */
  setWcsOrigin(origin: Vec3 | null, size?: number): void;
  /** The planner view of a running job (lines cut, executing, queued), or null for none. */
  setPlanner(planner: PlannerOverlay | null): void;
  /** The tool position the board reports, drawn as a small marker, or null to hide it. */
  setToolMarker(position: Vec3 | null): void;
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
  /**
   * Draw the bed/work grid in the XY plane at the bottom of the drawn extent, over the envelope
   * (machine travel) when known or else the padded path extent (default false).
   */
  readonly grid?: boolean;
}

const VERTEX = `#version 300 es
precision highp float;
in vec3 a_pos;
in float a_style;
in float a_line;
in float a_dist;
uniform mat4 u_mvp;
uniform float u_showRapids;
uniform float u_highlightEnd;
uniform vec4 u_colors[${String(STYLE_COUNT)}];
uniform vec4 u_highlight;
uniform vec4 u_plan;
uniform vec4 u_cut;
uniform vec4 u_exec;
uniform vec4 u_queued;
out vec4 v_color;
out float v_hidden;
out float v_dist;
out float v_dash;
void main() {
  int s = int(a_style + 0.5);
  bool rapid = s == ${String(STYLE.RAPID)};
  v_hidden = (rapid && u_showRapids < 0.5) ? 1.0 : 0.0;
  v_dash = rapid ? 1.0 : 0.0;
  v_dist = a_dist;
  // The scrubber tints cutting moves; traverses stay muted and dashed so the cut stays dominant.
  v_color = (!rapid && a_line >= 0.0 && a_line < u_highlightEnd) ? u_highlight : u_colors[s];
  // The planner view of a running job: cut lines dimmed, the executing line highlighted, the queued band.
  if (u_plan.w > 0.5 && a_line >= 0.0) {
    if (a_line < u_plan.x) v_color = u_cut;
    else if (a_line < u_plan.y) v_color = u_exec;
    else if (a_line < u_plan.z) v_color = u_queued;
  }
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec4 v_color;
in float v_hidden;
in float v_dist;
in float v_dash;
uniform float u_dash;
out vec4 o_color;
void main() {
  if (v_hidden > 0.5) discard;
  if (v_dash > 0.5 && u_dash > 0.0 && fract(v_dist / u_dash) > 0.55) discard;
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
  gl.bindAttribLocation(program, 3, 'a_dist');
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) throw new Error(`gcode-view: program did not link: ${gl.getProgramInfoLog(program) ?? ''}`);
  const u = {
    mvp: gl.getUniformLocation(program, 'u_mvp'),
    showRapids: gl.getUniformLocation(program, 'u_showRapids'),
    highlightEnd: gl.getUniformLocation(program, 'u_highlightEnd'),
    colors: gl.getUniformLocation(program, 'u_colors'),
    highlight: gl.getUniformLocation(program, 'u_highlight'),
    dash: gl.getUniformLocation(program, 'u_dash'),
    plan: gl.getUniformLocation(program, 'u_plan'),
    cut: gl.getUniformLocation(program, 'u_cut'),
    exec: gl.getUniformLocation(program, 'u_exec'),
    queued: gl.getUniformLocation(program, 'u_queued'),
  };

  let colors = options.colors;
  let path: GpuChunk[] = [];
  let overlay: GpuChunk | null = null;
  let list: SegmentList | null = null;
  let bounds: Box3 | null = null;
  let envelope: Box3 | null = null;
  let wcs: { origin: Vec3; size: number } | null = null;
  let showRapids = true;
  let showGrid = options.grid === true;
  let highlightLine = -1;
  let planner: PlannerOverlay | null = null;
  let marker: Vec3 | null = null;
  let view: Orbit = fitOrbit(null);
  /** True until the person turns, zooms or pans the view: a resize then refits it. */
  let autoFit = true;
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
    const buffers = [make(positions, 0, 3, gl.FLOAT), make(styles, 1, 1, gl.UNSIGNED_BYTE), make(lines, 2, 1, gl.FLOAT), make(dashDistances(positions, styles), 3, 1, gl.FLOAT)];
    gl.bindVertexArray(null);
    return { vao, buffers, vertexCount: positions.length / 3 };
  }

  /** Per vertex: distance along its traverse segment (0 at the start, the length at the end); 0 elsewhere. */
  function dashDistances(positions: Float32Array, styles: Uint8Array): Float32Array {
    const out = new Float32Array(styles.length);
    for (let v = 0; v + 1 < styles.length; v += 2) {
      if (styles[v] !== STYLE.RAPID) continue;
      const i = v * 3;
      out[v + 1] = Math.hypot((positions[i + 3] as number) - (positions[i] as number), (positions[i + 4] as number) - (positions[i + 1] as number), (positions[i + 5] as number) - (positions[i + 2] as number));
    }
    return out;
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
    const grid = showGrid ? gridLayout(bounds, envelope) : null;
    if (grid !== null) {
      for (const l of gridLines(grid)) seg([l.a[0], l.a[1], grid.z], [l.b[0], l.b[1], grid.z], l.major ? OVERLAY.GRID_MAJOR : OVERLAY.GRID);
    }
    if (envelope !== null) {
      const [x0, y0, z0] = envelope.min;
      const [x1, y1, z1] = envelope.max;
      const c: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
      for (const [a, b] of edges) seg(c[a] as Vec3, c[b] as Vec3, OVERLAY.ENVELOPE);
    }
    if (marker !== null) {
      const [x, y, z] = marker;
      const box = fitBox();
      const r = box === null ? 2 : Math.max(0.5, Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]) / 60);
      seg([x - r, y, z], [x + r, y, z], OVERLAY.MARKER);
      seg([x, y - r, z], [x, y + r, z], OVERLAY.MARKER);
      seg([x, y, z], [x, y, z + r * 3], OVERLAY.MARKER);
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
    const table = [colors.rapid, colors.feed, colors.arc, colors.outOfBounds, colors.uncertain, colors.envelope, colors.axisX, colors.axisY, colors.axisZ, colors.grid, colors.gridMajor, plannerColors().exec];
    return new Float32Array(table.flat());
  }

  /** The planner view's colours: cut lines are the feed colour mixed most of the way to the background. */
  function plannerColors(): { readonly cut: Rgba; readonly exec: Rgba; readonly queued: Rgba } {
    const bg = colors.background;
    const f = colors.feed;
    const cut: Rgba = [f[0] + (bg[0] - f[0]) * 0.7, f[1] + (bg[1] - f[1]) * 0.7, f[2] + (bg[2] - f[2]) * 0.7, 1];
    const exec = colors.plannerExec ?? colors.highlight;
    const queued = planner?.starving === true ? (colors.plannerStarving ?? colors.highlight) : (colors.plannerQueued ?? colors.arc);
    return { cut, exec, queued };
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
    gl.uniform1f(u.dash, dashPeriod());
    const pc = plannerColors();
    gl.uniform4fv(u.plan, new Float32Array(planner === null ? [0, 0, 0, 0] : [planner.cutEnd, planner.execEnd, planner.queuedEnd, 1]));
    gl.uniform4fv(u.cut, new Float32Array(pc.cut));
    gl.uniform4fv(u.exec, new Float32Array(pc.exec));
    gl.uniform4fv(u.queued, new Float32Array(pc.queued));
    for (const c of overlay === null ? path : [...path, overlay]) {
      gl.bindVertexArray(c.vao);
      gl.drawArrays(gl.LINES, 0, c.vertexCount);
    }
    gl.bindVertexArray(null);
  }

  /** Dash period of traverses, in drawing units: about 1/120 of the framed extent (0, solid, with nothing framed). */
  function dashPeriod(): number {
    const box = fitBox();
    if (box === null) return 0;
    const span = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    return Number.isFinite(span) && span > 0 ? span / 120 : 0;
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

  /** The path (and envelope) framed to fill about 80% of the canvas, for its current shape. */
  function fitView(): Orbit {
    return fitOrbit(fitBox(), undefined, width / height, 0.8);
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
      const given = loadOptions.bounds;
      bounds = given === undefined ? null : given;
      autoFit = true;
      view = fitView();
      if (showGrid) rebuildOverlay();
      const total = Math.max(1, next.kinds.length);
      const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      const source = chunks(next, loadOptions.segmentsPerChunk ?? DEFAULT_SEGMENTS_PER_CHUNK);
      const steps: Iterator<unknown> = {
        next: () => {
          if (mine !== generation || disposed) throw abortError();
          const r = source.next();
          if (r.done === true) return { done: true, value: undefined };
          const c = r.value;
          path.push(upload(c.positions, c.styles, c.lines));
          if (given === undefined) {
            const p = c.positions;
            for (let i = 0; i < c.segments * 6; i += 3) {
              for (let a = 0; a < 3; a++) {
                const value = p[i + a] as number;
                if (value < (box.min[a] as number)) box.min[a] = value;
                if (value > (box.max[a] as number)) box.max[a] = value;
              }
            }
            const first = path.length === 1;
            bounds = { min: [box.min[0] as number, box.min[1] as number, box.min[2] as number], max: [box.max[0] as number, box.max[1] as number, box.max[2] as number] };
            if (first) {
              view = fitView();
              if (showGrid) rebuildOverlay();
            }
          }
          loadOptions.onProgress?.(c.vertexEnd / total);
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
        if (mine === generation) {
          clearPath();
          if (showGrid) rebuildOverlay();
        }
        requestRender();
        throw e;
      }
      if (given === undefined) view = fitView();
      if (showGrid) rebuildOverlay();
      loadOptions.onProgress?.(1);
      requestRender();
    },
    clear() {
      generation++;
      clearPath();
      if (showGrid) rebuildOverlay();
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
    setGridVisible(visible) {
      if (showGrid === visible) return;
      showGrid = visible;
      rebuildOverlay();
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
    setPlanner(next) {
      planner = next;
      requestRender();
    },
    setToolMarker(position) {
      marker = position;
      rebuildOverlay();
      requestRender();
    },
    resize(w, h, pixelRatio = 1) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      const canvas = gl.canvas;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      if (autoFit) view = fitView();
      requestRender();
    },
    fit() {
      autoFit = true;
      view = fitView();
      requestRender();
    },
    orbit(dA, dE) {
      autoFit = false;
      view = rotate(view, dA, dE);
      requestRender();
    },
    zoomBy(factor) {
      autoFit = false;
      view = zoom(view, factor);
      requestRender();
    },
    panBy(dx, dy) {
      autoFit = false;
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

