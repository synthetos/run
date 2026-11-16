import type { Chunk } from './geometry.ts';
import { DEFAULT_SEGMENTS_PER_CHUNK, chunks } from './geometry.ts';
import { sceneApi, visibilityApi } from './renderer/bed.ts';
import { cameraApi } from './renderer/camera.ts';
import { type RendererContext } from './renderer/context.ts';
import { type GpuChunk, type LoadOptions, type PreviewRenderer, type RendererOptions } from './renderer/contract.ts';
import { createContext } from './renderer/initialize.ts';
import { markerApi } from './renderer/marker.ts';
import { themeApi } from './renderer/materials.ts';
import { checkSegmentList, type Box3, type SegmentList } from './segments.ts';
import { runSliced, type SliceOptions } from './slicer.ts';
export { PATH_OVER_CARVE_ALPHA } from './renderer/constants.ts';
export { type LoadOptions, type PlannerOverlay, type PreviewColors, type PreviewRenderer, type RendererOptions } from './renderer/contract.ts';
export { glyphBit, toolGlyph } from './renderer/glyph.ts';
export type { Rgba } from './scene.ts';


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
