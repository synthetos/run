/** The CAM tip for tiny and short moves (docs/design/ANALYZE.md slice 1), one line, in the named CAM's words where Run knows them. Pure. */

export function camTip(cam: string | null): string {
  if (cam === 'Fusion') return 'In Fusion, turn on Smoothing (Passes tab) and arcs.';
  return `Turn on arcs and smoothing in ${cam ?? 'your CAM'}.`;
}

/** The detail behind the tip. */
export const CAM_TOLERANCE = 'Smoothing tolerance: about 0.01 mm.';
