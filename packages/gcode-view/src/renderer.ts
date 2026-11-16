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
 * view, toggles, highlight, size) and never otherwise. The renderer runs no
 * clock of its own: a preview must never look like a machine that is moving.
 * Play preview (owner, 2026-11-09; SAFETY H15 and T-S41 amended) is driven
 * by the page (play/), which moves a separate play marker (`setPlayMarker`)
 * drawn in the highlight colour, never in the live marker's. The live tool marker
 * eases from one reported position to the next (markerMotion.ts) and
 * never runs past the latest report; its geometry is built once at the
 * origin and moved by the offset uniform, so those frames upload nothing.
 * Its shape is the active tool's at true size when the page gives one
 * (toolProfile.ts, `setToolShape`), else a generic glyph sized to the drawing.
 * Without a board the page may place it at the end of the scrubbed line: that
 * marker is drawn dimmed and jumps with the scrubber, never easing, so it
 * cannot read as a machine moving.
 */
import { sceneApi, visibilityApi } from './renderer/bed.ts';
import { cameraApi } from './renderer/camera.ts';
import { type PreviewRenderer, type RendererOptions } from './renderer/contract.ts';
import { createContext } from './renderer/initialize.ts';
import { lifecycleApi } from './renderer/lifecycle.ts';
import { loadingApi } from './renderer/loading.ts';
import { markerApi } from './renderer/marker.ts';
import { themeApi } from './renderer/materials.ts';

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

export { PATH_OVER_CARVE_ALPHA } from './renderer/constants.ts';
export type { LoadOptions, PlannerOverlay, PreviewColors, PreviewRenderer, RendererOptions } from './renderer/contract.ts';
export { glyphBit, toolGlyph } from './renderer/glyph.ts';
export type { Rgba } from './scene.ts';
