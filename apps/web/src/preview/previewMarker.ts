/**
 * The planned tool position the 3D view shows with no board (docs/design/tool-sim.md, slice 1): the end of
 * the last scrubbed line, in the path's frame. It is drawn dimmed and jumps with the scrubber (the renderer's
 * preview marker), the key says it is a preview, and it never has the live readout. Pure. Display only.
 */
import type { SegmentList, Vec3 } from '@synthetos/gcode-view';

export const PREVIEW_MARKER_NOTE = 'Tool at the scrubbed line (preview)';

/** Where the tool is after the scrubbed lines 0..scrub-1, or null with nothing scrubbed or nothing drawn. */
export function scrubbedToolAt(segments: Pick<SegmentList, 'vertices' | 'lineToVertex'> | null, scrub: number): Vec3 | null {
  if (segments === null || scrub < 1) return null;
  const { vertices, lineToVertex } = segments;
  const lines = lineToVertex.length - 1;
  if (lines < 1) return null;
  const end = (lineToVertex[Math.min(scrub, lines)] as number) - 1;
  if (end < 0 || end * 3 + 2 >= vertices.length) return null;
  return [vertices[end * 3] as number, vertices[end * 3 + 1] as number, vertices[end * 3 + 2] as number];
}
