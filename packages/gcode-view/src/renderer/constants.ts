import { type Vec3 } from '../segments.ts';

/** Overlay styles follow the segment styles in the colour table. */
export const OVERLAY = Object.freeze({ ENVELOPE: 5, AXIS_X: 6, AXIS_Y: 7, AXIS_Z: 8, GRID: 9, GRID_MAJOR: 10, MARKER: 11, RING: 12, MARKER_PREVIEW: 13, PLAY: 14 });

export const STYLE_COUNT = 15;

/**
 * How opaque the toolpath is over a carved stock, so the carve reads through it. 0.6 since the cut has its own
 * colour (owner, 2026-11-09): the lines stay plain over the cut, so it shows they line up (it was 0.35).
 */
export const PATH_OVER_CARVE_ALPHA = 0.6;

export const NO_OFFSET: Vec3 = [0, 0, 0];
