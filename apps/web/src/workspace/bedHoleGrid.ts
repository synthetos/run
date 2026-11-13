/** Display-only hole pattern. These coordinates never participate in clearance or travel checks. */
export interface BedHoleGrid {
  readonly pitchX: number;
  readonly pitchY: number;
  readonly columns: number;
  readonly rows: number;
  readonly diameter: number;
  readonly firstX: number;
  readonly firstY: number;
  readonly offsetMeasured: boolean;
}
export const XCARVE_HOLE_GRID: BedHoleGrid = { pitchX: 75, pitchY: 75, columns: 11, rows: 11, diameter: 6.5, firstX: 0, firstY: 0, offsetMeasured: false };

/** Length inputs may be mm or inches; all saved geometry is mm. Bound allocations and reject invalid drafts. */
export function holeGridMm(grid: BedHoleGrid, units: 'mm' | 'in'): BedHoleGrid | null {
  if (![grid.pitchX, grid.pitchY, grid.diameter, grid.firstX, grid.firstY].every(Number.isFinite)
    || grid.pitchX <= 0 || grid.pitchY <= 0 || grid.diameter <= 0 || grid.firstX < 0 || grid.firstY < 0
    || !Number.isInteger(grid.columns) || !Number.isInteger(grid.rows) || grid.columns < 1 || grid.rows < 1
    || grid.columns * grid.rows > 2500) return null;
  const scale = units === 'in' ? 25.4 : 1;
  if (![grid.pitchX * scale * grid.columns + grid.firstX * scale, grid.pitchY * scale * grid.rows + grid.firstY * scale, grid.diameter * scale].every(Number.isFinite)) return null;
  return { ...grid, pitchX: grid.pitchX * scale, pitchY: grid.pitchY * scale, diameter: grid.diameter * scale, firstX: grid.firstX * scale, firstY: grid.firstY * scale };
}
export function gridHoles(grid: BedHoleGrid, units: 'mm' | 'in' = 'mm'): readonly (readonly [number, number, number])[] {
  const g = holeGridMm(grid, units);
  if (g === null) return [];
  return Array.from({ length: g.columns * g.rows }, (_, i) => [g.firstX + (i % g.columns) * g.pitchX, g.firstY + Math.floor(i / g.columns) * g.pitchY, g.diameter / 2] as const);
}
