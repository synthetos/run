/**
 * The sweep against hand-computed grooves (docs/design/tool-sim.md, "Sweep"): a V-groove's depth and width,
 * a ball channel's cross-section, a flat pocket's floor, a bull-nose corner, a plunge stamp.
 */
import { describe, expect, it } from 'vitest';
import { NO_STOCK, createHeightmap, emptyDirty, isDirty, reachRadius, sweepSegment, type GridSpec, type Heightmap, type ToolShape } from '../src/index.ts';

/** A 20 × 20 mm stock, top 0, bottom -6, cell 0.25, laid out so cell centres fall on whole multiples of 0.25 mm. */
const SPEC: GridSpec = { x0: -0.125, y0: -0.125, cell: 0.25, nx: 81, ny: 81, top: 0, bottom: -6, outline: null };

const tool = (tip: ToolShape['tip'], extra: Partial<ToolShape> = {}): ToolShape => ({ tip, diameter: 6, fluteLength: 20, shank: 6, length: 40, ...extra });

/** The top at the cell centred on (x, y). */
function at(hm: Heightmap, x: number, y: number): number {
  const i = Math.round((x - hm.spec.x0) / hm.spec.cell - 0.5);
  const j = Math.round((y - hm.spec.y0) / hm.spec.cell - 0.5);
  return hm.z[j * hm.spec.nx + i] as number;
}

/** A horizontal groove along Y = 10 from X 5 to X 15 at depth z. */
function groove(shape: ToolShape, z: number): Heightmap {
  const hm = createHeightmap(SPEC);
  sweepSegment(hm, 5, 10, z, 15, 10, z, shape, emptyDirty());
  return hm;
}

describe('sweepSegment', () => {
  it('cuts a 90° V-groove 1 mm deep and 2 mm wide at the top', () => {
    const hm = groove(tool('v', { vAngle: 90 }), -1);
    // tan(45°) = 1: the groove rises 1 mm per mm off its centre line.
    for (const [d, h] of [[0, -1], [0.25, -0.75], [0.5, -0.5], [0.75, -0.25], [1, 0], [1.5, 0]] as const) {
      expect(at(hm, 10, 10 + d)).toBeCloseTo(h, 5);
      expect(at(hm, 10, 10 - d)).toBeCloseTo(h, 5);
    }
    // Width at the top: cells with d < 1 are cut, 3 + 1 + 3 rows.
    let cut = 0;
    for (let j = 0; j < SPEC.ny; j++) if ((hm.z[j * SPEC.nx + 40] as number) < 0) cut++;
    expect(cut).toBe(7);
    // The end is a cone around (15, 10).
    expect(at(hm, 15.5, 10)).toBeCloseTo(-0.5, 5);
    expect(at(hm, 16, 10)).toBe(0);
  });

  it('cuts a 60° V-groove: rise 1/tan(30°) per mm', () => {
    const hm = groove(tool('v', { vAngle: 60 }), -1);
    expect(at(hm, 10, 10.5)).toBeCloseTo(-1 + 0.5 * Math.sqrt(3), 5);
  });

  it('cuts a ball channel with a round cross-section', () => {
    const hm = groove(tool('ball'), -2);
    for (const d of [0, 0.5, 1, 1.5, 2, 2.5, 2.75]) expect(at(hm, 10, 10 + d)).toBeCloseTo(-2 + 3 - Math.sqrt(9 - d * d), 5);
    // Top width: 3 − √(9 − d²) = 2 at d = √8 ≈ 2.83, so d = 3 is uncut.
    expect(at(hm, 10, 13)).toBe(0);
  });

  it('leaves a flat pocket floor at the cut depth, and nothing outside it', () => {
    const hm = createHeightmap(SPEC);
    const flat = tool('flat');
    // A zigzag at Z -1.5, stepover 3 mm, over X 6..14, Y 6..14.
    const pts: [number, number][] = [[6, 6], [14, 6], [14, 9], [6, 9], [6, 12], [14, 12], [14, 14], [6, 14]];
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k] as [number, number];
      const [bx, by] = pts[k + 1] as [number, number];
      sweepSegment(hm, ax, ay, -1.5, bx, by, -1.5, flat, emptyDirty());
    }
    for (let x = 4; x <= 16; x += 0.5) for (let y = 4; y <= 16; y += 0.5) expect(at(hm, x, y)).toBe(-1.5);
    expect(at(hm, 2.75, 10)).toBe(0);
    expect(at(hm, 10, 17.25)).toBe(0);
  });

  it('rounds a bull-nose cut at the corner radius', () => {
    const hm = groove(tool('bull-nose', { cornerRadius: 1 }), -1);
    // Flat to R − c = 2 mm, then the corner: c − √(c² − (d − 2)²).
    expect(at(hm, 10, 12)).toBeCloseTo(-1, 5);
    expect(at(hm, 10, 12.5)).toBeCloseTo(-1 + 1 - Math.sqrt(1 - 0.25), 5);
    expect(at(hm, 10, 12.75)).toBeCloseTo(-1 + 1 - Math.sqrt(1 - 0.5625), 5);
    expect(at(hm, 10, 13)).toBe(0);
  });

  it('stamps a plunge once, at its lowest point', () => {
    const hm = createHeightmap(SPEC);
    sweepSegment(hm, 10, 10, 2, 10, 10, -1, tool('v', { vAngle: 90 }), emptyDirty());
    expect(at(hm, 10, 10)).toBeCloseTo(-1, 5);
    expect(at(hm, 10.5, 10)).toBeCloseTo(-0.5, 5);
    expect(at(hm, 10, 10.75)).toBeCloseTo(-0.25, 5);
    expect(at(hm, 11, 10)).toBe(0);
  });

  it('takes Z along a ramp at the XY-closest point (approximate on slopes)', () => {
    const hm = createHeightmap(SPEC);
    sweepSegment(hm, 5, 10, 0, 15, 10, -2, tool('flat'), emptyDirty());
    expect(at(hm, 10, 10)).toBeCloseTo(-1, 5);
    expect(at(hm, 15, 10)).toBeCloseTo(-2, 5);
    expect(at(hm, 16, 10)).toBeCloseTo(-2, 5);
  });

  it('cuts nothing from a move at or above the stock top, and reports the changed cells', () => {
    const hm = createHeightmap(SPEC);
    const dirty = emptyDirty();
    expect(sweepSegment(hm, 0, 0, 0, 20, 20, 0, tool('flat'), dirty)).toBe(false);
    expect(isDirty(dirty)).toBe(false);
    expect(sweepSegment(hm, 10, 10, -1, 10, 10, -1, tool('flat', { diameter: 1 }), dirty)).toBe(true);
    // Cells within 0.5 mm of (10, 10): columns and rows 38..42.
    expect(dirty).toEqual({ x0: 38, y0: 38, x1: 42, y1: 42, lowest: -1 });
  });

  it('never cuts a cell with no stock', () => {
    const hm = createHeightmap({ ...SPEC, outline: [[0, 0], [10, 0], [10, 20], [0, 20]] });
    sweepSegment(hm, 5, 10, -1, 15, 10, -1, tool('flat'), emptyDirty());
    expect(at(hm, 9, 10)).toBe(-1);
    expect(at(hm, 12, 10)).toBe(NO_STOCK);
  });

  it('carves nothing with a tool of no size', () => {
    const hm = createHeightmap(SPEC);
    expect(sweepSegment(hm, 5, 10, -1, 15, 10, -1, tool('flat', { diameter: 0 }), emptyDirty())).toBe(false);
  });

  it('scans only as far as the tool can reach below the stock top', () => {
    expect(reachRadius(tool('v', { vAngle: 90 }), 1)).toBeCloseTo(1, 6);
    expect(reachRadius(tool('ball'), 1)).toBeCloseTo(Math.sqrt(9 - 4), 6);
    expect(reachRadius(tool('ball'), 5)).toBe(3);
    expect(reachRadius(tool('flat'), 0.1)).toBe(3);
    expect(reachRadius(tool('flat'), 0)).toBe(0);
  });

  it('leaves a smooth trough when a ball follows a curved path in short segments', () => {
    // A 3.175 mm ball at Z -1.5 along a sine wave of 0.5 mm chords, as CAM writes a curve.
    const ball: ToolShape = { tip: 'ball', diameter: 3.175, fluteLength: 10, shank: 3.175, length: 30 };
    const hm = createHeightmap(SPEC);
    const pts = Array.from({ length: 33 }, (_, k) => [2 + k * 0.5, 10 + 2 * Math.sin((2 + k * 0.5) / 2)] as const);
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k] as readonly [number, number];
      const b = pts[k + 1] as readonly [number, number];
      sweepSegment(hm, a[0], a[1], -1.5, b[0], b[1], -1.5, ball, emptyDirty());
    }
    // Along the channel, the deepest cell of each column is within the cell sampling of the ball (centre cells sit
    // up to 0.18 mm off the path: at most 0.01 mm shallower), with no bumps at the chord joints.
    const R = 3.175 / 2;
    for (let i = 20; i <= 64; i++) {
      let lowest = 0;
      for (let j = 0; j < SPEC.ny; j++) lowest = Math.min(lowest, hm.z[j * SPEC.nx + i] as number);
      expect(lowest).toBeGreaterThanOrEqual(-1.5 - 1e-6);
      expect(lowest).toBeLessThan(-1.5 + (R - Math.sqrt(R * R - 0.18 * 0.18)) + 1e-6);
    }
  });
});

