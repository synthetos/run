/** The CAM tip for tiny moves (docs/design/ANALYZE.md slice 1), in the named CAM's own words where Run knows them. Pure. */

export function camTip(cam: string | null): string {
  if (cam === 'Fusion') return 'In Fusion, turn on Smoothing in the operation’s Passes tab, with a tolerance around 0.01 mm, and use a post that outputs arcs (G2/G3).';
  return `In your CAM${cam === null ? '' : ` (${cam})`}, turn on arc output (G2/G3) and smoothing, with a tolerance around 0.01 mm.`;
}
