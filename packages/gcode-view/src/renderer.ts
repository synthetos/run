import { VIEW_ANGLES, fitOrbit, pan, rotate, zoom, zoomToward, type Orbit } from './camera.ts';
import { createCarveLayer } from './carve/mesh.ts';
import { framedBox } from './framing.ts';
import type { Chunk } from './geometry.ts';
import { DEFAULT_SEGMENTS_PER_CHUNK, chunks } from './geometry.ts';
import { link } from './glProgram.ts';
import { createLineTools } from './lineTools.ts';
import { SPIN_FRAME_MS, isSoftwareRenderer } from './markerSpin.ts';
import { PATH_FRAGMENT, SOLID_FRAGMENT, SOLID_VERTEX, pathVertex } from './pathShaders.ts';
import { pickSolid, rayThrough } from './pick.ts';
import { rebuildOverlay, rebuildSolids, sceneApi, visibilityApi } from './renderer/bed.ts';
import { NO_OFFSET, STYLE_COUNT } from './renderer/constants.ts';
import { type RendererContext } from './renderer/context.ts';
import { type GpuChunk, type LoadOptions, type PreviewRenderer, type RendererOptions } from './renderer/contract.ts';
import { draw, requestRender } from './renderer/draw.ts';
import { clearPath, dashDistances, linesChunk, release, upload, uploadSolid } from './renderer/geometry.ts';
import { markerApi, markerChunk, rebuildMarker } from './renderer/marker.ts';
import { colorTable, plannerColors, themeApi } from './renderer/materials.ts';
import { offsetBox, unionBox } from './scene.ts';
import { checkSegmentList, type Box3, type SegmentList } from './segments.ts';
import { runSliced, type SliceOptions } from './slicer.ts';
export { PATH_OVER_CARVE_ALPHA } from './renderer/constants.ts';
export { type LoadOptions, type PlannerOverlay, type PreviewColors, type PreviewRenderer, type RendererOptions } from './renderer/contract.ts';
export { glyphBit, toolGlyph } from './renderer/glyph.ts';
export type { Rgba } from './scene.ts';


function createContext(gl: WebGL2RenderingContext, options: RendererOptions): RendererContext {
  const ctx = { gl, options } as RendererContext;
  bindRenderer(ctx);
  initializeRenderer(ctx);
  return ctx;
}


function initializeRenderer(ctx: RendererContext): void {
  ctx.requestFrame = ctx.options.requestFrame ?? ((draw: () => void) => { requestAnimationFrame(draw); });
  ctx.now = ctx.options.now ?? (() => performance.now());
  ctx.reducedMotion = ctx.options.reducedMotion ?? (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  initializePrograms(ctx);
  ctx.colors = ctx.options.colors;
  ctx.path = [];
  ctx.gridChunk = null;
  ctx.frameOverlay = null;
  ctx.markerOverlay = null;
  ctx.playOverlay = null;
  ctx.playAt = null;
  ctx.solids = [];
  ctx.stockSolid = -1;
  ctx.list = null;
  ctx.bounds = null;
  ctx.envelope = null;
  ctx.scene = null;
  ctx.sceneBox = null;
  ctx.pathOffset = NO_OFFSET;
  ctx.wcs = null;
  ctx.showRapids = true;
  ctx.showGrid = ctx.options.grid === true;
  ctx.highlightLine = -1;
  ctx.planner = null;
  ctx.marker = null;
  ctx.toolShape = null;
  ctx.markerPreview = false;
  ctx.motion = null;
  ctx.spin = 0;
  ctx.spinSince = 0;
  ctx.spinTimer = null;
  initializeView(ctx);
}


function initializePrograms(ctx: RendererContext): void {

  ctx.program = link(ctx.gl, pathVertex(STYLE_COUNT), PATH_FRAGMENT, ['a_pos', 'a_style', 'a_line', 'a_dist']);
  ctx.u = {
    mvp: ctx.gl.getUniformLocation(ctx.program, 'u_mvp'),
    offset: ctx.gl.getUniformLocation(ctx.program, 'u_offset'),
    showRapids: ctx.gl.getUniformLocation(ctx.program, 'u_showRapids'),
    highlightEnd: ctx.gl.getUniformLocation(ctx.program, 'u_highlightEnd'),
    colors: ctx.gl.getUniformLocation(ctx.program, 'u_colors'),
    highlight: ctx.gl.getUniformLocation(ctx.program, 'u_highlight'),
    dash: ctx.gl.getUniformLocation(ctx.program, 'u_dash'),
    plan: ctx.gl.getUniformLocation(ctx.program, 'u_plan'),
    plan2: ctx.gl.getUniformLocation(ctx.program, 'u_plan2'),
    rot: ctx.gl.getUniformLocation(ctx.program, 'u_rot'),
    exec: ctx.gl.getUniformLocation(ctx.program, 'u_exec'),
    queued: ctx.gl.getUniformLocation(ctx.program, 'u_queued'),
    dimRect: ctx.gl.getUniformLocation(ctx.program, 'u_dimRect'),
    dimAlpha: ctx.gl.getUniformLocation(ctx.program, 'u_dimAlpha'),
    toolOn: ctx.gl.getUniformLocation(ctx.program, 'u_toolOn'),
    toolColors: ctx.gl.getUniformLocation(ctx.program, 'u_toolColors'),
    lineTools: ctx.gl.getUniformLocation(ctx.program, 'u_lineTools'),
    focus: ctx.gl.getUniformLocation(ctx.program, 'u_focus'),
    bg: ctx.gl.getUniformLocation(ctx.program, 'u_bg'),
  };
  ctx.solidProgram = link(ctx.gl, SOLID_VERTEX, SOLID_FRAGMENT, ['a_pos', 'a_color']);
  ctx.su = { mvp: ctx.gl.getUniformLocation(ctx.solidProgram, 'u_mvp') };
  ctx.carve = createCarveLayer(ctx.gl, ctx.options.carveMeshMax === undefined ? {} : { meshMax: ctx.options.carveMeshMax });
  ctx.lineTools = createLineTools(ctx.gl);
  ctx.toolFocus = -1;
  ctx.carve.setBelowColor(ctx.options.colors.outOfBounds);
  if (ctx.options.colors.carveCut !== undefined) ctx.carve.setCutColor(ctx.options.colors.carveCut);
}


function initializeView(ctx: RendererContext): void {

  ctx.canSpin = !isSoftwareRenderer(ctx.gl);
  ctx.spinFrameMs = SPIN_FRAME_MS;
  ctx.angles = VIEW_ANGLES.iso;
  ctx.view = fitOrbit(null);
  ctx.autoFit = true;
  ctx.width = 1;
  ctx.height = 1;
  ctx.scheduled = false;
  ctx.frameCount = 0;
  ctx.generation = 0;
  ctx.disposed = false;
}


function bindRenderer(ctx: RendererContext): void {
  ctx.upload = (positions, styles, lines) => upload(ctx, positions, styles, lines);
  ctx.uploadSolid = (positions, vertexColors) => uploadSolid(ctx, positions, vertexColors);
  ctx.dashDistances = (positions, styles) => dashDistances(ctx, positions, styles);
  ctx.release = (c) => release(ctx, c);
  ctx.linesChunk = (pos, sty) => linesChunk(ctx, pos, sty);
  ctx.rebuildOverlay = () => rebuildOverlay(ctx);
  ctx.markerChunk = (style) => markerChunk(ctx, style);
  ctx.rebuildMarker = () => rebuildMarker(ctx);
  ctx.rebuildSolids = () => rebuildSolids(ctx);
  ctx.colorTable = () => colorTable(ctx);
  ctx.plannerColors = () => plannerColors(ctx);
  ctx.draw = () => draw(ctx);
  ctx.dashPeriod = () => dashPeriod(ctx);
  ctx.requestRender = () => requestRender(ctx);
  ctx.clearPath = () => clearPath(ctx);
  ctx.fitView = () => fitView(ctx);
  ctx.fitBox = () => fitBox(ctx);
}


/** Dash period of traverses, in drawing units: about 1/120 of the framed extent (0, solid, with nothing framed). */
function dashPeriod(ctx: RendererContext): number {
  const box = ctx.fitBox();
  if (box === null) return 0;
  const span = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  return Number.isFinite(span) && span > 0 ? span / 120 : 0;
}


/** The job (the path with the stock, fixture and clamps; framing.ts) framed to fill about 80% of the canvas. */
function fitView(ctx: RendererContext): Orbit {
  return fitOrbit(framedBox(offsetBox(ctx.bounds, ctx.pathOffset), ctx.scene, ctx.fitBox()), undefined, ctx.width / ctx.height, 0.8, ctx.angles);
}


/** The box of everything drawn: the path moved by its offset, the envelope and the scene. */
function fitBox(ctx: RendererContext): Box3 | null {
  return unionBox(offsetBox(ctx.bounds, ctx.pathOffset), ctx.envelope, ctx.sceneBox);
}


function cameraApi(ctx: RendererContext): Pick<PreviewRenderer, "setView" | "resize" | "fit" | "orbit" | "zoomBy" | "zoomAt" | "panBy" | "pick"> {
  return {
    setView(preset) {
      ctx.angles = VIEW_ANGLES[preset];
      ctx.autoFit = true;
      ctx.view = ctx.fitView();
      ctx.requestRender();
    },
    resize(w, h, pixelRatio = 1) {
      ctx.width = Math.max(1, w);
      ctx.height = Math.max(1, h);
      const canvas = ctx.gl.canvas;
      canvas.width = Math.round(ctx.width * pixelRatio);
      canvas.height = Math.round(ctx.height * pixelRatio);
      if (ctx.autoFit) ctx.view = ctx.fitView();
      ctx.requestRender();
    },
    fit() {
      ctx.autoFit = true;
      ctx.view = ctx.fitView();
      ctx.requestRender();
    },
    orbit(dA, dE) {
      ctx.autoFit = false;
      ctx.view = rotate(ctx.view, dA, dE);
      ctx.requestRender();
    },
    zoomBy(factor) {
      ctx.autoFit = false;
      ctx.view = zoom(ctx.view, factor);
      ctx.requestRender();
    },
    zoomAt(factor, x, y) {
      ctx.autoFit = false;
      ctx.view = zoomToward(ctx.view, factor, (2 * x) / ctx.width - 1, 1 - (2 * y) / ctx.height, ctx.width / ctx.height);
      ctx.requestRender();
    },
    panBy(dx, dy) {
      ctx.autoFit = false;
      ctx.view = pan(ctx.view, dx, dy);
      ctx.requestRender();
    },
    pick(x, y) {
      if (ctx.scene === null) return null;
      const ray = rayThrough(ctx.view, ctx.width / ctx.height, (2 * x) / ctx.width - 1, 1 - (2 * y) / ctx.height);
      return pickSolid(ray, ctx.scene.solids)?.tag ?? null;
    }
  };
}


function abortError(): DOMException {
  return new DOMException('the preview load was cancelled', 'AbortError');
}


async function loadPath(ctx: RendererContext, next: SegmentList, loadOptions: LoadOptions): Promise<void> {
  checkSegmentList(next);
  const mine = ++ctx.generation;
  const retain = loadOptions.retainUntilReady === true;
  const pending: typeof ctx.path = [];
  if (!retain) { ctx.clearPath(); ctx.list = next; ctx.path = pending; }
  const given = loadOptions.bounds;
  if (!retain) {
    ctx.bounds = given === undefined ? null : given;
    ctx.autoFit = true;
    ctx.view = ctx.fitView();
    ctx.rebuildOverlay();
  }
  const total = Math.max(1, next.kinds.length);
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const source = chunks(next, loadOptions.segmentsPerChunk ?? DEFAULT_SEGMENTS_PER_CHUNK, loadOptions.sampling);
  const steps: Iterator<unknown> = {
    next: () => {
      if (mine !== ctx.generation || ctx.disposed) throw abortError();
      const r = source.next();
      if (r.done === true) return { done: true, value: undefined };
      const c = r.value;
      if (c.segments > 0) pending.push(ctx.upload(c.positions, c.styles, c.lines));
      gatherChunkBounds(ctx, { given, c, box, pending, retain });
      loadOptions.onProgress?.(c.vertexEnd / total);
      if (!retain) ctx.requestRender();
      return { done: false, value: undefined };
    },
  };
  try {
    await runSliced(steps, loadSliceOptions(loadOptions));
    if (mine !== ctx.generation || ctx.disposed || loadOptions.signal?.aborted === true) throw abortError();
  } catch (e) {
    if (retain) for (const c of pending) ctx.release(c);
    if (!retain && mine === ctx.generation) {
      ctx.clearPath();
      ctx.rebuildOverlay();
    }
    ctx.requestRender();
    throw e;
  }
  finishLoad(ctx, { retain, pending, next, given, box, loadOptions });
}


function gatherChunkBounds(ctx: RendererContext, { given, c, box, pending, retain }: GatherChunkBoundsInput): void {

  if (given === undefined && c.segments > 0) {
    const p = c.positions;
    for (let i = 0; i < c.segments * 6; i += 3) {
      for (let a = 0; a < 3; a++) {
        const value = p[i + a] as number;
        if (value < (box.min[a] as number)) box.min[a] = value;
        if (value > (box.max[a] as number)) box.max[a] = value;
      }
    }
    const first = pending.length === 1;
    if (!retain) ctx.bounds = { min: [box.min[0] as number, box.min[1] as number, box.min[2] as number], max: [box.max[0] as number, box.max[1] as number, box.max[2] as number] };
    if (first && !retain) {
      ctx.view = ctx.fitView();
      ctx.rebuildOverlay();
    }
  }
}


function finishLoad(ctx: RendererContext, { retain, pending, next, given, box, loadOptions }: FinishLoadInput): void {

  if (retain) {
    ctx.clearPath();
    ctx.path = pending;
    ctx.list = next;
    ctx.bounds = given === undefined ? (box.min[0] === Infinity ? null : { min: box.min as [number, number, number], max: box.max as [number, number, number] }) : given;
  } else if (given === undefined) ctx.view = ctx.fitView();
  ctx.rebuildOverlay();
  loadOptions.onProgress?.(1);
  ctx.requestRender();
}


function loadSliceOptions(loadOptions: LoadOptions): SliceOptions {
  return {
    ...(loadOptions.signal === undefined ? {} : { signal: loadOptions.signal }),
    ...(loadOptions.budgetMs === undefined ? {} : { budgetMs: loadOptions.budgetMs }),
    ...(loadOptions.now === undefined ? {} : { now: loadOptions.now }),
    ...(loadOptions.yieldToHost === undefined ? {} : { yieldToHost: loadOptions.yieldToHost }),
  };
}


function loadingApi(ctx: RendererContext): Pick<PreviewRenderer, "load" | "clear"> {
  return {
    load(next, loadOptions = {}) { return loadPath(ctx, next, loadOptions); },
    clear() {
      ctx.generation++;
      ctx.clearPath();
      ctx.rebuildOverlay();
      ctx.requestRender();
    }
  };
}


interface GatherChunkBoundsInput { given: Box3 | null | undefined; c: Chunk; box: { min: number[]; max: number[]; }; pending: GpuChunk[]; retain: boolean }

interface FinishLoadInput { retain: boolean; pending: GpuChunk[]; next: SegmentList; given: Box3 | null | undefined; box: { min: number[]; max: number[]; }; loadOptions: LoadOptions }


function lifecycleApi(ctx: RendererContext): Pick<PreviewRenderer, "dispose"> {
  return {
    dispose() {
      ctx.disposed = true;
      ctx.generation++;
      if (ctx.spinTimer !== null) clearTimeout(ctx.spinTimer);
      ctx.spinTimer = null;
      ctx.clearPath();
      for (const s of ctx.solids) ctx.release(s);
      ctx.solids = [];
      if (ctx.gridChunk !== null) ctx.release(ctx.gridChunk);
      if (ctx.frameOverlay !== null) ctx.release(ctx.frameOverlay);
      if (ctx.markerOverlay !== null) ctx.release(ctx.markerOverlay);
      if (ctx.playOverlay !== null) ctx.release(ctx.playOverlay);
      ctx.gridChunk = ctx.frameOverlay = ctx.markerOverlay = ctx.playOverlay = null;
      ctx.gl.deleteProgram(ctx.program);
      ctx.gl.deleteProgram(ctx.solidProgram);
      ctx.carve.dispose();
      ctx.lineTools.dispose();
    }
  };
}

export function createRenderer(gl: WebGL2RenderingContext, options: RendererOptions): PreviewRenderer {
  const ctx = createContext(gl, options);
  const loading = loadingApi(ctx);
  const visibility = visibilityApi(ctx);
  const scene = sceneApi(ctx);
  const theme = themeApi(ctx);
  const marker = markerApi(ctx);
  const camera = cameraApi(ctx);
  const lifecycle = lifecycleApi(ctx);
  return {
    load: loading.load,
    clear: loading.clear,
    setRapidsVisible: visibility.setRapidsVisible,
    setHighlight: visibility.setHighlight,
    setGridVisible: visibility.setGridVisible,
    setEnvelope: visibility.setEnvelope,
    setWcsOrigin: visibility.setWcsOrigin,
    setScene: scene.setScene,
    setPathOffset: scene.setPathOffset,
    setToolColors: theme.setToolColors,
    setToolFocus: theme.setToolFocus,
    setCarve: scene.setCarve,
    updateCarve: scene.updateCarve,
    setView: camera.setView,
    setColors: theme.setColors,
    setPlanner: theme.setPlanner,
    get turnsBit() {
      return ctx.canSpin;
    },
    setToolSpin: theme.setToolSpin,
    setToolMarker: marker.setToolMarker,
    setPlayMarker: marker.setPlayMarker,
    setToolShape: marker.setToolShape,
    resize: camera.resize,
    fit: camera.fit,
    orbit: camera.orbit,
    zoomBy: camera.zoomBy,
    zoomAt: camera.zoomAt,
    panBy: camera.panBy,
    pick: camera.pick,
    requestRender: ctx.requestRender,
    get frames() {
      return ctx.frameCount;
    },
    get chunkCount() {
      return ctx.path.length;
    },
    get solidCount() {
      return ctx.solids.length;
    },
    dispose: lifecycle.dispose,
  };
}
