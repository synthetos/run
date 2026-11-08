/**
 * The carve of a file (carve/carver.ts): tools per change point, unknown tools carve nothing, uncertain moves
 * carve nothing, partial steps, and scrubbing back through a keyframe gives the same heightmap as carving
 * from the start.
 */
import { describe, expect, it } from 'vitest';
import { SEGMENT, createCarver, type CarveTools, type GridSpec, type SegmentList, type ToolShape } from '../src/index.ts';
import { listOf } from './helpers.ts';

const SPEC: GridSpec = { x0: -0.125, y0: -0.125, cell: 0.25, nx: 81, ny: 81, top: 0, bottom: -6, outline: null };
const FLAT: ToolShape = { tip: 'flat', diameter: 2, fluteLength: 10, shank: 2, length: 30 };
const { FEED, RAPID } = SEGMENT;

/** `n` lines, each a cut at Z -1 along Y = 3 · (line index mod 6) from X 2 to 18: rapid over, plunge, cut, rapid up. */
function grooves(n: number): SegmentList {
  const lines: Array<Array<readonly [number, number, number, number]>> = [];
  for (let k = 0; k < n; k++) {
    const y = 3 * (k % 6);
    lines.push([[RAPID, 2, y, 5], [FEED, 2, y, -1], [FEED, 18, y, -1], [RAPID, 18, y, 5]]);
  }
  return listOf(lines);
}

const all = (shape: ToolShape | null): CarveTools => ({ starts: Uint32Array.from([0]), shapes: [shape] });

function carveTo(list: SegmentList, tools: CarveTools, target: number, budget = 1e9): ReturnType<typeof createCarver> {
  const c = createCarver(list, SPEC, tools);
  c.seek(target);
  while (!c.step(budget).done);
  return c;
}

const at = (z: Float32Array, x: number, y: number): number => z[Math.round((y + 0.125) / 0.25 - 0.5) * SPEC.nx + Math.round((x + 0.125) / 0.25 - 0.5)] as number;

describe('createCarver', () => {
  it('carves lines up to the target with the tool in force', () => {
    const c = carveTo(grooves(4), all(FLAT), 2);
    expect(c.through).toBe(2);
    expect(at(c.heightmap.z, 10, 0)).toBe(-1);
    expect(at(c.heightmap.z, 10, 3)).toBe(-1);
    expect(at(c.heightmap.z, 10, 6)).toBe(0);
    expect(c.lowest).toBe(-1);
  });

  it('carves nothing on lines whose tool is unknown, and resumes at the first known tool', () => {
    const tools: CarveTools = { starts: Uint32Array.from([1, 2, 3]), shapes: [null, FLAT, null] };
    const c = carveTo(grooves(4), tools, 4);
    // Line 0 is before the first change, line 1 an unknown tool, line 3 unknown again.
    expect(at(c.heightmap.z, 10, 0)).toBe(0);
    expect(at(c.heightmap.z, 10, 3)).toBe(0);
    expect(at(c.heightmap.z, 10, 6)).toBe(-1);
    expect(at(c.heightmap.z, 10, 9)).toBe(0);
  });

  it('carves nothing for an uncertain move', () => {
    const list = listOf([[[RAPID, 2, 5, 5], [FEED | SEGMENT.UNCERTAIN, 2, 5, -1], [FEED | SEGMENT.UNCERTAIN, 18, 5, -1]]]);
    expect(at(carveTo(list, all(FLAT), 1).heightmap.z, 10, 5)).toBe(0);
  });

  it('steps in small budgets to the same result', () => {
    const list = grooves(30);
    const whole = carveTo(list, all(FLAT), 30);
    const small = carveTo(list, all(FLAT), 30, 1);
    expect(small.heightmap.z).toEqual(whole.heightmap.z);
  });

  it('reports the cells each step changed', () => {
    const c = createCarver(grooves(2), SPEC, all(FLAT));
    c.seek(1);
    const s = c.step(1e9);
    expect(s.done).toBe(true);
    // Y = 0 ± 1 mm from X 1 to 19: rows 0..4 (centres 0..1, clipped at the edge), columns 4..76.
    expect(s.dirty).toEqual({ x: 4, y: 0, w: 73, h: 5 });
    expect(c.step(1e9).dirty).toBeNull();
  });

  it('scrubbing back restores a keyframe and carves forward to the same heightmap', () => {
    const list = grooves(400);
    const c = createCarver(list, SPEC, all(FLAT));
    c.seek(400);
    while (!c.step(1e9).done);
    expect(c.keyframes.count).toBeGreaterThan(0);
    const back = c.seek(123);
    expect(back).toEqual({ x: 0, y: 0, w: SPEC.nx, h: SPEC.ny });
    expect(c.through).toBe(100);
    while (!c.step(1e9).done);
    expect(c.through).toBe(123);
    expect(c.heightmap.z).toEqual(carveTo(list, all(FLAT), 123).heightmap.z);
    // Back before the first keyframe: from the uncut stock.
    c.seek(10);
    expect(c.through).toBe(0);
    while (!c.step(1e9).done);
    expect(c.heightmap.z).toEqual(carveTo(list, all(FLAT), 10).heightmap.z);
  });

  it('restores when stopped part way through the target line', () => {
    const list = listOf([[[RAPID, 2, 5, 5], [FEED, 2, 5, -1], [FEED, 10, 5, -1], [FEED, 18, 5, -1]]]);
    const c = createCarver(list, SPEC, all(FLAT));
    c.seek(1);
    c.step(3);
    expect(c.through).toBe(0);
    expect(at(c.heightmap.z, 5, 5)).toBe(-1);
    expect(c.seek(0)).not.toBeNull();
    expect(at(c.heightmap.z, 5, 5)).toBe(0);
  });

  it('scrubbing forward carries on without a restore', () => {
    const c = createCarver(grooves(20), SPEC, all(FLAT));
    c.seek(5);
    while (!c.step(1e9).done);
    expect(c.seek(10)).toBeNull();
    expect(c.through).toBe(5);
  });
});
