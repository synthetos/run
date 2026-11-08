/**
 * @synthetos/gcode-view
 *
 * Toolpath preview for a plain segment list. Its input is never G-code text,
 * and it never imports machine, safety or protocol code: it draws what it is
 * given. It has no runtime npm dependencies and no animation or playback
 * API. The stock carving (carve/) computes the shape a toolpath leaves in the
 * stock up to a line the caller names; it is display only and nothing in it
 * moves by itself.
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.1.0';

export { LINE_MARK, SEGMENT, SegmentListError, checkSegmentList, drawnBounds, lineCount, lineOfVertex, scrubVertexEnd } from './segments.ts';
export type { Box3, SegmentList, Vec3 } from './segments.ts';
export { DEFAULT_SEGMENTS_PER_CHUNK, STYLE, chunks, styleOf } from './geometry.ts';
export type { Chunk } from './geometry.ts';
export { DEFAULT_SLICE_BUDGET_MS, runSliced } from './slicer.ts';
export type { SliceOptions } from './slicer.ts';
export { VIEW_ANGLES, eye, fitOrbit, lookAt, multiply, pan, perspective, project, rotate, viewProjection, zoom, zoomToward } from './camera.ts';
export { FRAMED_TAGS, framedBox, jobSolidsBox } from './framing.ts';
export type { Mat4, Orbit, ViewAngles, ViewPreset } from './camera.ts';
export { PATH_OVER_CARVE_ALPHA, createRenderer, toolGlyph } from './renderer.ts';
export type { LoadOptions, PlannerOverlay, PreviewColors, PreviewRenderer, RendererOptions, Rgba } from './renderer.ts';
export { profileHeight, tipHeight, toolOutline, toolWireframe } from './toolProfile.ts';
export type { ToolShape, ToolTip } from './toolProfile.ts';
export { attachViewControls } from './controls.ts';
export { CLICK_SLOP_PX, hitSolid, pickSolid, rayThrough } from './pick.ts';
export type { Ray } from './pick.ts';
export { attachPicking } from './picking.ts';
export type { PickHandlers } from './picking.ts';
export { svgEnvelope, svgGrid, svgPaths, svgScene, svgViewBox } from './svg.ts';
export { FACE_SHADE, MAX_CAP_POINTS, offsetBox, ringSegments, sceneBounds, solidTriangles, triangulate, unionBox } from './scene.ts';
export type { Pt2, SceneBox, SceneLayers, ScenePrism, SceneRing, SceneSolid, SolidTriangles } from './scene.ts';
export { GRID_MAX_CELLS, gridLayout, gridLines, niceStep } from './grid.ts';
export type { GridLayout, GridLine } from './grid.ts';
export type { SvgOptions, SvgPaths, SvgScene, SvgSolid } from './svg.ts';
export { MAX_SCROLL_HEIGHT, listWindow, scrollTopFor } from './virtualList.ts';
export type { ListWindow, ListWindowInput } from './virtualList.ts';
export { BASE_CELL_MM, MAX_CELLS, MAX_GRID_SIDE, NO_STOCK, cellSizeFor, copyRect, createHeightmap, fullRect, gridSpec, pasteRect, sameSpec, unionRect } from './carve/heightmap.ts';
export type { CellRect, GridSpec, Heightmap, StockFootprint } from './carve/heightmap.ts';
export { emptyDirty, isDirty, reachRadius, sweepSegment } from './carve/sweep.ts';
export type { Dirty } from './carve/sweep.ts';
export { KEYFRAME_CAP_BYTES, MIN_KEYFRAME_INTERVAL, createKeyframes, keyframeInterval } from './carve/keyframes.ts';
export type { Keyframe, Keyframes } from './carve/keyframes.ts';
export { createCarver } from './carve/carver.ts';
export type { CarveStep, CarveTools, Carver, CarverOptions } from './carve/carver.ts';
export { createCarveHandler } from './carve/worker.ts';
export type { CarveHandlerOptions, CarvePost } from './carve/worker.ts';
export { createCarveClient } from './carve/client.ts';
export type { CarveClientOptions, CarveClient, CarveFeed, CarveListener, CarveProgress, CarveSurface, CarveWorkerLike } from './carve/client.ts';
export type { CarveProgressMessage, CarveSegments, CarveToolTable, FromCarveWorker, ToCarveWorker } from './carve/protocol.ts';
export { createCarveLayer, defaultMeshMax } from './carve/mesh.ts';
export { MESH_MAX, SOFTWARE_MESH_MAX, meshLayout, wallVertices } from './carve/meshGeometry.ts';
export type { CarveLayer, CarveLayerOptions } from './carve/mesh.ts';
export { BELOW_STOCK_EPS, noteBelow } from './carve/belowStock.ts';
export type { BelowStock } from './carve/belowStock.ts';
