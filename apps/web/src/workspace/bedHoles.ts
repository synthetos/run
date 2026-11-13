/** Display-only filtering: keep the stored holes untouched, including those outside the bed. */
type BedHoles = { readonly width: number; readonly depth: number; readonly holes: readonly (readonly [number, number, number])[] };
/** Hole centres on the bed boundary are included; the measured pattern is never moved or resized. */
export function visibleBedHoles(bed: BedHoles): BedHoles['holes'] {
  return bed.holes.filter(([x, y]) => x >= 0 && y >= 0 && x <= bed.width && y <= bed.depth);
}
export function outsideBedHoleNote(bed: BedHoles): string | null {
  const n = bed.holes.length - visibleBedHoles(bed).length;
  return n === 0 ? null : `${n} holes fall outside the bed size. Check the bed's width and depth.`;
}
