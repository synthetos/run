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
export { eye, fitOrbit, lookAt, multiply, pan, perspective, project, rotate, viewProjection, zoom } from './camera.ts';
export type { Mat4, Orbit } from './camera.ts';
export { createRenderer } from './renderer.ts';
export type { LoadOptions, PreviewColors, PreviewRenderer, RendererOptions, Rgba } from './renderer.ts';
export { attachViewControls } from './controls.ts';
export { svgEnvelope, svgPaths } from './svg.ts';
export type { SvgOptions, SvgPaths } from './svg.ts';
export { MAX_SCROLL_HEIGHT, listWindow, scrollTopFor } from './virtualList.ts';
export type { ListWindow, ListWindowInput } from './virtualList.ts';
