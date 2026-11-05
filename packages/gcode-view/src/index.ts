/**
 * @synthetos/gcode-view
 *
 * Toolpath preview for a plain segment list. Its input is never G-code text,
 * and it never imports machine, safety or protocol code: it draws what it is
 * given. It has no runtime npm dependencies and no animation, playback or
 * simulation API.
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.1.0';

export { LINE_MARK, SEGMENT, SegmentListError, checkSegmentList, drawnBounds, lineCount, lineOfVertex, scrubVertexEnd } from './segments.ts';
export type { Box3, SegmentList, Vec3 } from './segments.ts';
export { DEFAULT_SEGMENTS_PER_CHUNK, STYLE, chunks, styleOf } from './geometry.ts';
export type { Chunk } from './geometry.ts';
export { DEFAULT_SLICE_BUDGET_MS, runSliced } from './slicer.ts';
export type { SliceOptions } from './slicer.ts';
export { VIEW_ANGLES, eye, fitOrbit, lookAt, multiply, pan, perspective, project, rotate, viewProjection, zoom } from './camera.ts';
export type { Mat4, Orbit, ViewAngles, ViewPreset } from './camera.ts';
export { createRenderer, toolGlyph } from './renderer.ts';
export type { LoadOptions, PlannerOverlay, PreviewColors, PreviewRenderer, RendererOptions, Rgba } from './renderer.ts';
export { attachViewControls } from './controls.ts';
export { svgEnvelope, svgGrid, svgPaths, svgScene, svgViewBox } from './svg.ts';
export { FACE_SHADE, MAX_CAP_POINTS, offsetBox, ringSegments, sceneBounds, solidTriangles, triangulate, unionBox } from './scene.ts';
export type { Pt2, SceneBox, SceneLayers, ScenePrism, SceneRing, SceneSolid, SolidTriangles } from './scene.ts';
export { GRID_MAX_CELLS, gridLayout, gridLines, niceStep } from './grid.ts';
export type { GridLayout, GridLine } from './grid.ts';
export type { SvgOptions, SvgPaths, SvgScene, SvgSolid } from './svg.ts';
export { MAX_SCROLL_HEIGHT, listWindow, scrollTopFor } from './virtualList.ts';
export type { ListWindow, ListWindowInput } from './virtualList.ts';
