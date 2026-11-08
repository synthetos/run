/**
 * WebGL2 toolpath renderer. It draws a segment list as chunked line segments,
 * the work envelope as a box, the work-coordinate origin as an axis triad,
 * when asked the bed/work grid (grid.ts) under the drawing, and the scene
 * solids the caller gives it (scene.ts: bed, stock, fixture, clamps) as
 * flat-shaded triangles under the path. Given a carved surface
 * (`setCarve`, carve/mesh.ts) it draws that in place of the flat stock.
 *
 * Frames: the solids, the grid, the envelope and the triad are in the
 * drawing's own (machine) frame. The path and the tool marker are in the
 * path's frame, moved into the drawing by `setPathOffset` (the planned work
 * zero): a uniform in the vertex shader, so a million segments move without
 * a re-upload.
 *
 * It renders on demand only: a frame is drawn when something changed (data,
 * view, toggles, highlight, size) and never otherwise. There is no playback
 * and no simulated tool position in this package, by design: a preview must
 * never look like a machine that is moving. The one motion is the tool marker
 * easing from one reported position to the next (markerMotion.ts), which
 * never runs past the latest report; its geometry is built once at the
 * origin and moved by the offset uniform, so those frames upload nothing.
 * Its shape is the active tool's at true size when the page gives one
 * (toolProfile.ts, `setToolShape`), else a generic glyph sized to the drawing.
 * Without a board the page may place it at the end of the scrubbed line: that
 * marker is drawn dimmed and jumps with the scrubber, never easing, so it
 * cannot read as a machine moving.
 */
import { VIEW_ANGLES, fitOrbit, pan, rotate, viewProjection, zoom, type Orbit, type ViewAngles, type ViewPreset } from './camera.ts';
import { DEFAULT_SEGMENTS_PER_CHUNK, STYLE, chunks } from './geometry.ts';
import { checkSegmentList, lineCount, type Box3, type SegmentList, type Vec3 } from './segments.ts';
import { runSliced, type SliceOptions } from './slicer.ts';
import { gridLayout, gridLines } from './grid.ts';
import { pickSolid, rayThrough } from './pick.ts';
import { nextMotion, positionAt, settled, type MarkerMotion } from './markerMotion.ts';
import { offsetBox, ringSegments, sceneBounds, solidTriangles, unionBox, type Rgba, type SceneLayers } from './scene.ts';
import { toolWireframe, type ToolShape } from './toolProfile.ts';
import { link } from './glProgram.ts';
import { createCarveLayer } from './carve/mesh.ts';
import type { CarveSurface } from './carve/client.ts';
import type { CellRect } from './carve/heightmap.ts';

export type { Rgba };

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
const OVERLAY = Object.freeze({ ENVELOPE: 5, AXIS_X: 6, AXIS_Y: 7, AXIS_Z: 8, GRID: 9, GRID_MAJOR: 10, MARKER: 11, RING: 12, MARKER_PREVIEW: 13 });
const STYLE_COUNT = 14;

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
  /**
   * The tool position the board reports (in the path's frame), drawn as a small marker, or null to hide it.
   * `preview` marks a planned position (the end of the scrubbed line, no board): drawn dimmed, and it jumps
   * to each position, so it never reads as a machine moving.
   */
  setToolMarker(position: Vec3 | null, preview?: boolean): void;
  /** The marker's tool, drawn at true size; null for the generic glyph. The geometry is rebuilt only when this changes. */
  setToolShape(shape: ToolShape | null): void;
  /** The scene solids under the path (bed, stock, fixture, clamps), in the drawing's frame, or null for none. */
  setScene(scene: SceneLayers | null): void;
  /** Where the path's origin sits in the drawing's frame (the planned work zero); [0, 0, 0] by default. */
  setPathOffset(offset: Vec3): void;
  /** The carved stock (carve/mesh.ts, in the path's frame), drawn in place of the flat stock solid; null for none. */
  setCarve(surface: CarveSurface | null): void;
  /** A rectangle of the carved surface changed. */
  updateCarve(rect: CellRect): void;
  /** Turns the view to a named direction and refits it. */
  setView(preset: ViewPreset): void;
  setColors(colors: PreviewColors): void;
  /** Canvas size in CSS pixels and the device pixel ratio. */
  resize(width: number, height: number, pixelRatio?: number): void;
  /** Fits the view to the drawn path (and envelope and scene). */
  fit(): void;
  orbit(dAzimuth: number, dElevation: number): void;
  zoomBy(factor: number): void;
  panBy(dx: number, dy: number): void;
  /** The tag of the nearest scene solid under a canvas point (CSS pixels from its top-left), or null. */
  pick(x: number, y: number): string | null;
  /** Schedules one frame; several calls before it runs draw once. */
  requestRender(): void;
  /** Number of frames drawn (for tests and diagnostics). */
  readonly frames: number;
  readonly chunkCount: number;
  /** Number of scene solids uploaded (for tests and diagnostics). */
  readonly solidCount: number;
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
  /** The clock for the tool marker's motion, ms (default `performance.now`). */
  readonly now?: () => number;
  /** True to draw each tool position at once (default: the `prefers-reduced-motion` media query). */
  readonly reducedMotion?: () => boolean;
  /** Most vertices per side of the carved stock's mesh (carve/mesh.ts; default: one per cell, fewer on a software renderer). */
  readonly carveMeshMax?: number;
}

/** How opaque the toolpath is over a carved stock, so the carve reads through it. */
export const PATH_OVER_CARVE_ALPHA = 0.35;

const VERTEX = `#version 300 es
precision highp float;
in vec3 a_pos;
in float a_style;
in float a_line;
in float a_dist;
uniform mat4 u_mvp;
uniform vec3 u_offset;
uniform float u_showRapids;
uniform float u_highlightEnd;
uniform vec4 u_colors[${String(STYLE_COUNT)}];
uniform vec4 u_highlight;
uniform vec4 u_plan;
uniform vec4 u_cut;
uniform vec4 u_exec;
uniform vec4 u_queued;
uniform vec4 u_dimRect;
uniform float u_dimAlpha;
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
  // Over a carved stock the path is drawn faint, so the carve reads through it.
  if (u_dimAlpha < 1.0 && a_pos.x >= u_dimRect.x && a_pos.x <= u_dimRect.z && a_pos.y >= u_dimRect.y && a_pos.y <= u_dimRect.w) v_color.a *= u_dimAlpha;
  gl_Position = u_mvp * vec4(a_pos + u_offset, 1.0);
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

/** The scene solids: flat triangles with a baked colour per vertex. */
const SOLID_VERTEX = `#version 300 es
precision highp float;
in vec3 a_pos;
in vec4 a_color;
uniform mat4 u_mvp;
out vec4 v_color;
void main() {
  v_color = a_color;
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

const SOLID_FRAGMENT = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 o_color;
void main() {
  o_color = v_color;
}`;

interface GpuChunk {
  readonly vao: WebGLVertexArrayObject;
  readonly buffers: readonly WebGLBuffer[];
  readonly vertexCount: number;
}

function abortError(): DOMException {
  return new DOMException('the preview load was cancelled', 'AbortError');
}

const NO_OFFSET: Vec3 = [0, 0, 0];

export function createRenderer(gl: WebGL2RenderingContext, options: RendererOptions): PreviewRenderer {
  const requestFrame = options.requestFrame ?? ((draw: () => void) => { requestAnimationFrame(draw); });
  const now = options.now ?? (() => performance.now());
  const reducedMotion = options.reducedMotion ?? (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const program = link(gl, VERTEX, FRAGMENT, ['a_pos', 'a_style', 'a_line', 'a_dist']);
  const u = {
    mvp: gl.getUniformLocation(program, 'u_mvp'),
    offset: gl.getUniformLocation(program, 'u_offset'),
    showRapids: gl.getUniformLocation(program, 'u_showRapids'),
    highlightEnd: gl.getUniformLocation(program, 'u_highlightEnd'),
    colors: gl.getUniformLocation(program, 'u_colors'),
    highlight: gl.getUniformLocation(program, 'u_highlight'),
    dash: gl.getUniformLocation(program, 'u_dash'),
    plan: gl.getUniformLocation(program, 'u_plan'),
    cut: gl.getUniformLocation(program, 'u_cut'),
    exec: gl.getUniformLocation(program, 'u_exec'),
    queued: gl.getUniformLocation(program, 'u_queued'),
    dimRect: gl.getUniformLocation(program, 'u_dimRect'),
    dimAlpha: gl.getUniformLocation(program, 'u_dimAlpha'),
  };
  const solidProgram = link(gl, SOLID_VERTEX, SOLID_FRAGMENT, ['a_pos', 'a_color']);
  const su = { mvp: gl.getUniformLocation(solidProgram, 'u_mvp') };
  const carve = createCarveLayer(gl, options.carveMeshMax === undefined ? {} : { meshMax: options.carveMeshMax });

  let colors = options.colors;
  let path: GpuChunk[] = [];
  /** The grid, in the drawing's frame, depth-tested so the stock hides it. */
  let gridChunk: GpuChunk | null = null;
  /** Envelope, triad and hole rings, in the drawing's frame. */
  let frameOverlay: GpuChunk | null = null;
  /** The tool marker, built with its tip at the origin and drawn at `motion`'s position in the path's frame. */
  let markerOverlay: GpuChunk | null = null;
  let solids: GpuChunk[] = [];
  /** The index in `solids` of the stock, hidden while a carved surface stands in for it; -1 for none. */
  let stockSolid = -1;
  let list: SegmentList | null = null;
  let bounds: Box3 | null = null;
  let envelope: Box3 | null = null;
  let scene: SceneLayers | null = null;
  let sceneBox: Box3 | null = null;
  let pathOffset: Vec3 = NO_OFFSET;
  let wcs: { origin: Vec3; size: number } | null = null;
  let showRapids = true;
  let showGrid = options.grid === true;
  let highlightLine = -1;
  let planner: PlannerOverlay | null = null;
  let marker: Vec3 | null = null;
  let toolShape: ToolShape | null = null;
  let markerPreview = false;
  let motion: MarkerMotion | null = null;
  let angles: ViewAngles = VIEW_ANGLES.iso;
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

  function uploadSolid(positions: Float32Array, vertexColors: Float32Array): GpuChunk {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const make = (data: ArrayBufferView, index: number, size: number): WebGLBuffer => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
      return b;
    };
    const buffers = [make(positions, 0, 3), make(vertexColors, 1, 4)];
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

  function linesChunk(pos: number[], sty: number[]): GpuChunk | null {
    return pos.length === 0 ? null : upload(new Float32Array(pos), new Uint8Array(sty), new Float32Array(sty.length).fill(-1));
  }

  function rebuildOverlay(): void {
    if (gridChunk !== null) release(gridChunk);
    if (frameOverlay !== null) release(frameOverlay);
    gridChunk = frameOverlay = null;
    const pos: number[] = [];
    const sty: number[] = [];
    const seg = (a: Vec3, b: Vec3, s: number): void => {
      pos.push(...a, ...b);
      sty.push(s, s);
    };
    const grid = showGrid ? gridLayout(unionBox(offsetBox(bounds, pathOffset), sceneBox), envelope) : null;
    if (grid !== null) {
      for (const l of gridLines(grid)) seg([l.a[0], l.a[1], grid.z], [l.b[0], l.b[1], grid.z], l.major ? OVERLAY.GRID_MAJOR : OVERLAY.GRID);
      gridChunk = linesChunk(pos, sty);
      pos.length = 0;
      sty.length = 0;
    }
    if (envelope !== null) {
      const [x0, y0, z0] = envelope.min;
      const [x1, y1, z1] = envelope.max;
      const c: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
      for (const [a, b] of edges) seg(c[a] as Vec3, c[b] as Vec3, OVERLAY.ENVELOPE);
    }
    if (scene !== null) {
      for (const ring of scene.rings) {
        const pts = ringSegments(ring);
        for (let i = 0; i + 1 < pts.length; i += 2) seg(pts[i] as Vec3, pts[i + 1] as Vec3, OVERLAY.RING);
      }
    }
    if (wcs !== null) {
      const [x, y, z] = wcs.origin;
      const s = wcs.size;
      seg([x, y, z], [x + s, y, z], OVERLAY.AXIS_X);
      seg([x, y, z], [x, y + s, z], OVERLAY.AXIS_Y);
      seg([x, y, z], [x, y, z + s], OVERLAY.AXIS_Z);
    }
    frameOverlay = linesChunk(pos, sty);
    // The generic glyph is sized to the drawing, so it follows the drawn extent; a true-size tool does not.
    if (toolShape === null) rebuildMarker();
  }

  /** The marker's geometry, tip at the origin: the tool's wireframe at true size, or the generic glyph. */
  function rebuildMarker(): void {
    if (markerOverlay !== null) release(markerOverlay);
    markerOverlay = null;
    if (marker === null) return;
    const lines = toolShape === null ? toolGlyph(NO_OFFSET, fitBox()) : toolWireframe(toolShape);
    const pos: number[] = [];
    const sty: number[] = [];
    for (const [a, b] of lines) {
      pos.push(...a, ...b);
      const style = markerPreview ? OVERLAY.MARKER_PREVIEW : OVERLAY.MARKER;
      sty.push(style, style);
    }
    markerOverlay = linesChunk(pos, sty);
  }

  function rebuildSolids(): void {
    for (const s of solids) release(s);
    solids = [];
    stockSolid = -1;
    if (scene === null) return;
    for (const solid of scene.solids) {
      const t = solidTriangles(solid);
      if (t.positions.length === 0) continue;
      if (solid.tag === 'stock') {
        stockSolid = solids.length;
        carve.setColor(solid.color);
      }
      solids.push(uploadSolid(t.positions, t.colors));
    }
  }

  function colorTable(): Float32Array {
    const ring = colors.envelope;
    const exec = plannerColors().exec;
    const table = [colors.rapid, colors.feed, colors.arc, colors.outOfBounds, colors.uncertain, colors.envelope, colors.axisX, colors.axisY, colors.axisZ, colors.grid, colors.gridMajor, exec, ring, mix(exec, colors.background, 0.55)];
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
    const mvp = viewProjection(view, width / height);
    // 1. The scene solids, depth-tested among themselves.
    if (solids.length > 0) {
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(solidProgram);
      gl.uniformMatrix4fv(su.mvp, false, mvp);
      solids.forEach((s, i) => {
        if (i === stockSolid && carve.active) return;
        gl.bindVertexArray(s.vao);
        gl.drawArrays(gl.TRIANGLES, 0, s.vertexCount);
      });
    }
    // 1b. The carved stock, in the path's frame, in place of the flat stock.
    carve.draw(mvp, pathOffset);
    gl.useProgram(program);
    gl.uniformMatrix4fv(u.mvp, false, mvp);
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
    gl.uniform1f(u.dimAlpha, 1);
    // 2. The grid, in the drawing's frame, hidden where a solid stands on it.
    gl.uniform3f(u.offset, 0, 0, 0);
    if (gridChunk !== null) {
      gl.enable(gl.DEPTH_TEST);
      gl.bindVertexArray(gridChunk.vao);
      gl.drawArrays(gl.LINES, 0, gridChunk.vertexCount);
    }
    // 3. The path and the marker (the path's frame) and the frame overlay, always on top: a cut inside
    //    the stock must stay visible, so lines are never hidden by a solid.
    gl.disable(gl.DEPTH_TEST);
    if (frameOverlay !== null) {
      gl.bindVertexArray(frameOverlay.vao);
      gl.drawArrays(gl.LINES, 0, frameOverlay.vertexCount);
    }
    gl.uniform3f(u.offset, pathOffset[0], pathOffset[1], pathOffset[2]);
    const dim = carve.footprint;
    if (dim !== null) {
      gl.uniform4f(u.dimRect, dim[0], dim[1], dim[2], dim[3]);
      gl.uniform1f(u.dimAlpha, PATH_OVER_CARVE_ALPHA);
      gl.enable(gl.BLEND);
      // Blend the colour only; the canvas stays opaque.
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    }
    for (const c of path) {
      gl.bindVertexArray(c.vao);
      gl.drawArrays(gl.LINES, 0, c.vertexCount);
    }
    gl.disable(gl.BLEND);
    gl.uniform1f(u.dimAlpha, 1);
    if (markerOverlay !== null && motion !== null) {
      const t = now();
      const at = positionAt(motion, t);
      gl.uniform3f(u.offset, pathOffset[0] + at[0], pathOffset[1] + at[1], pathOffset[2] + at[2]);
      gl.bindVertexArray(markerOverlay.vao);
      gl.drawArrays(gl.LINES, 0, markerOverlay.vertexCount);
      // Frames only while the marker is still on its way to the latest report; then it rests.
      if (!settled(motion, t)) requestRender();
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

  /** The path (and envelope and scene) framed to fill about 80% of the canvas, for its current shape. */
  function fitView(): Orbit {
    return fitOrbit(fitBox(), undefined, width / height, 0.8, angles);
  }

  /** The box of everything drawn: the path moved by its offset, the envelope and the scene. */
  function fitBox(): Box3 | null {
    return unionBox(offsetBox(bounds, pathOffset), envelope, sceneBox);
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
      rebuildOverlay();
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
              rebuildOverlay();
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
          rebuildOverlay();
        }
        requestRender();
        throw e;
      }
      if (given === undefined) view = fitView();
      rebuildOverlay();
      loadOptions.onProgress?.(1);
      requestRender();
    },
    clear() {
      generation++;
      clearPath();
      rebuildOverlay();
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
      if (autoFit) view = fitView();
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
    setScene(next) {
      scene = next;
      sceneBox = sceneBounds(next);
      rebuildSolids();
      if (autoFit) view = fitView();
      rebuildOverlay();
      requestRender();
    },
    setPathOffset(offset) {
      if (offset[0] === pathOffset[0] && offset[1] === pathOffset[1] && offset[2] === pathOffset[2]) return;
      pathOffset = offset;
      if (autoFit) view = fitView();
      rebuildOverlay();
      requestRender();
    },
    setCarve(surface) {
      carve.set(surface);
      requestRender();
    },
    updateCarve(rect) {
      carve.update(rect);
      requestRender();
    },
    setView(preset) {
      angles = VIEW_ANGLES[preset];
      autoFit = true;
      view = fitView();
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
    setToolMarker(position, preview = false) {
      // The glyph is rebuilt only when the marker appears, goes or changes kind; a new position is a new motion target.
      const rebuild = (marker === null) !== (position === null) || preview !== markerPreview;
      marker = position;
      markerPreview = preview;
      motion = nextMotion(motion, position, now(), preview || reducedMotion());
      if (rebuild) rebuildMarker();
      requestRender();
    },
    setToolShape(shape) {
      if (sameShape(shape, toolShape)) return;
      toolShape = shape;
      rebuildMarker();
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
    pick(x, y) {
      if (scene === null) return null;
      const ray = rayThrough(view, width / height, (2 * x) / width - 1, 1 - (2 * y) / height);
      return pickSolid(ray, scene.solids)?.tag ?? null;
    },
    requestRender,
    get frames() {
      return frames;
    },
    get chunkCount() {
      return path.length;
    },
    get solidCount() {
      return solids.length;
    },
    dispose() {
      disposed = true;
      generation++;
      clearPath();
      for (const s of solids) release(s);
      solids = [];
      if (gridChunk !== null) release(gridChunk);
      if (frameOverlay !== null) release(frameOverlay);
      if (markerOverlay !== null) release(markerOverlay);
      gridChunk = frameOverlay = markerOverlay = null;
      gl.deleteProgram(program);
      gl.deleteProgram(solidProgram);
      carve.dispose();
    },
  };
}

/** `a` mixed a fraction `t` of the way to `b`, opaque. */
function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
}

/** True when two tool shapes draw the same wireframe. */
function sameShape(a: ToolShape | null, b: ToolShape | null): boolean {
  if (a === null || b === null) return a === b;
  return a.tip === b.tip && a.diameter === b.diameter && a.fluteLength === b.fluteLength && a.shank === b.shank && a.length === b.length && a.cornerRadius === b.cornerRadius && a.vAngle === b.vAngle && a.tipWidth === b.tipWidth && a.pointAngle === b.pointAngle;
}

/**
 * The tool, drawn as lines with its tip at `tip`: a 1/8 in bit 25 mm long under a 52 mm spindle 80 mm tall,
 * at true size on a bed and scaled down (to a fifth at most) when the drawing is small, so it never hides a part.
 */
export function toolGlyph(tip: Vec3, box: Box3 | null): Array<readonly [Vec3, Vec3]> {
  const span = box === null ? 0 : Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]);
  const k = Math.min(1, Math.max(0.2, span / 500));
  const [x, y, z] = tip;
  const bitR = 1.6 * k, bitL = 25 * k, nutR = 10 * k, nutH = 12 * k, bodyR = 26 * k, bodyH = 80 * k;
  const out: Array<readonly [Vec3, Vec3]> = [];
  const ring = (r: number, at: number, n: number): void => {
    const pts = ringSegments({ center: [x, y, at], radius: r, color: [0, 0, 0, 0] }, n);
    for (let i = 0; i + 1 < pts.length; i += 2) out.push([pts[i] as Vec3, pts[i + 1] as Vec3]);
  };
  const posts = (r: number, z0: number, z1: number): void => {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) out.push([[x + dx, y + dy, z0], [x + dx, y + dy, z1]]);
  };
  // The bit: its tip, its flutes' outline, a short cross at the tip so the exact point reads at any zoom.
  ring(bitR, z, 12);
  posts(bitR, z, z + bitL);
  out.push([[x - bitR * 2, y, z], [x + bitR * 2, y, z]], [[x, y - bitR * 2, z], [x, y + bitR * 2, z]]);
  // The collet nut, then the spindle body.
  const n0 = z + bitL;
  ring(nutR, n0, 16);
  ring(nutR, n0 + nutH, 16);
  posts(nutR, n0, n0 + nutH);
  const b0 = n0 + nutH;
  ring(bodyR, b0, 24);
  ring(bodyR, b0 + bodyH, 24);
  posts(bodyR, b0, b0 + bodyH);
  return out;
}
