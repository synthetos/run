/**
 * The live carve follows the tool along the line it is on (carve/tip.ts, carver.ts; owner, 2026-11-09: "the bit
 * passes through it and then a few seconds later it disappears"): a reported position placed on the executing
 * line, a carve to that tip and no further, a later tip carrying on, an earlier one restoring, and the line
 * carved in pieces ending exactly as the whole line carved at once.
 */
import { describe, expect, it } from 'vitest';
import { SEGMENT, buildTimeline, createCarveClient, createCarver, pointAt, programmedTiming, tipOnLine, tipProgress, type CarveTools, type CarveWorkerLike, type GridSpec, type ToCarveWorker, type ToolShape } from '../src/index.ts';
import { listOf } from './helpers.ts';

const { FEED, RAPID } = SEGMENT;
const SPEC: GridSpec = { x0: 0, y0: 0, cell: 0.25, nx: 160, ny: 80, top: 0, bottom: -6, outline: null };
const FLAT: ToolShape = { tip: 'flat', diameter: 2, fluteLength: 10, shank: 2, length: 30 };
const TOOLS: CarveTools = { starts: Uint32Array.from([0]), shapes: [FLAT] };
// Line 0: rapid to (5, 10, 5) and plunge to Z -1. Line 1: one long cut to X 35. Line 2: an L, X 35 → Y 18 → X 5.
const LIST = listOf([
  [[RAPID, 5, 10, 5], [FEED, 5, 10, -1]],
  [[FEED, 35, 10, -1]],
  [[FEED, 35, 18, -1], [FEED, 5, 18, -1]],
]);
const at = (z: Float32Array, x: number, y: number): number => z[Math.floor(y / 0.25) * SPEC.nx + Math.floor(x / 0.25)] as number;

function run(c: ReturnType<typeof createCarver>): void {
  while (!c.step(1e9).done);
}

describe('tipOnLine', () => {
  it('places a position on the nearest segment of the line, and refuses one off the line', () => {
    expect(tipOnLine(LIST, 1, [20, 10, -1])).toEqual({ vertex: 3, t: 0.5 });
    expect(tipOnLine(LIST, 1, [20, 10.4, -1])).toEqual({ vertex: 3, t: 0.5 });
    expect(tipOnLine(LIST, 1, [20, 14, -1])).toBeNull();
    // The L: the corner belongs to the second segment (the tool is past it), the middle of the second leg too.
    expect(tipOnLine(LIST, 2, [35, 18, -1])).toEqual({ vertex: 5, t: 0 });
    expect(tipOnLine(LIST, 2, [20, 18, -1])).toEqual({ vertex: 5, t: 0.5 });
  });

  it('never goes back along the line from a tip already carved to', () => {
    const from = { vertex: 5, t: 0.5 };
    // Back on the first leg: not taken (the page then keeps the tip it has).
    expect(tipOnLine(LIST, 2, [35, 14, -1], from)).toBeNull();
    // Behind the tip on its own segment: held at the tip.
    expect(tipOnLine(LIST, 2, [20.5, 18, -1], from)).toEqual({ vertex: 5, t: 0.5 });
    expect(tipProgress({ vertex: 5, t: 0.5 })).toBeGreaterThan(tipProgress({ vertex: 4, t: 1 }));
  });
});

describe('the carver with a tip', () => {
  it('carves the executing line up to the tool and no further, then carries on', () => {
    const c = createCarver(LIST, SPEC, TOOLS);
    c.seek(1, { vertex: 3, t: 0.5 });
    run(c);
    const z = c.heightmap.z;
    expect(at(z, 10, 10)).toBe(-1);
    expect(at(z, 19, 10)).toBe(-1);
    // Past the tool (X 20) by more than the tool's radius: untouched.
    expect(at(z, 22, 10)).toBe(0);
    expect(at(z, 30, 10)).toBe(0);
    c.seek(1, { vertex: 3, t: 0.9 });
    run(c);
    expect(at(z, 30, 10)).toBe(-1);
    expect(at(z, 34.5, 10)).toBe(0);
  });

  it('restores when the tip goes back, and a line carved in pieces ends as the whole line carved at once', () => {
    const pieces = createCarver(LIST, SPEC, TOOLS);
    for (const t of [0.1, 0.35, 0.6, 0.85]) {
      pieces.seek(1, { vertex: 3, t });
      run(pieces);
    }
    expect(pieces.seek(1, { vertex: 3, t: 0.2 })).not.toBeNull();
    run(pieces);
    expect(at(pieces.heightmap.z, 30, 10)).toBe(0);
    for (const t of [0.5, 1]) {
      pieces.seek(1, { vertex: 3, t });
      run(pieces);
    }
    pieces.seek(2, { vertex: 5, t: 0.3 });
    run(pieces);
    pieces.seek(3);
    run(pieces);
    const whole = createCarver(LIST, SPEC, TOOLS);
    whole.seek(3);
    run(whole);
    expect(Array.from(pieces.heightmap.z)).toEqual(Array.from(whole.heightmap.z));
  });

  it('ignores a tip that is not on the target line', () => {
    const c = createCarver(LIST, SPEC, TOOLS);
    c.seek(1, { vertex: 5, t: 0.5 });
    run(c);
    expect(at(c.heightmap.z, 20, 10)).toBe(0);
    expect(at(c.heightmap.z, 5, 10)).toBe(-1);
  });
});

describe('a long line erodes under the tool as it travels (owner, 2026-11-09)', () => {
  // Line 0: rapid down to (0, 10, -1) from above. Line 1: one 100 mm cut along X at F600 (10 s).
  const LONG = listOf([[[RAPID, 0, 10, 5], [FEED, 0, 10, -1]], [[FEED, 100, 10, -1]]]);
  const spec: GridSpec = { x0: -5, y0: 0, cell: 0.25, nx: 440, ny: 80, top: 0, bottom: -6, outline: null };
  const timeline = buildTimeline(programmedTiming(Float32Array.from([300, 600])).durations(LONG));
  const lineStart = timeline.at[2] as number;
  const lineTime = (timeline.at[3] as number) - lineStart;

  /** The furthest X (cell centre) the carve has lowered along the line. */
  function reach(z: Float32Array): number {
    let far = -Infinity;
    const j = Math.floor((10 - spec.y0) / spec.cell);
    for (let i = 0; i < spec.nx; i++) if ((z[j * spec.nx + i] as number) < 0) far = Math.max(far, spec.x0 + (i + 0.5) * spec.cell);
    return far;
  }

  it('removes stock only up to the tool at 25%, 50% and 75% of the move, within a cell', () => {
    expect(lineTime).toBeCloseTo(10, 3);
    const c = createCarver(LONG, spec, TOOLS);
    const r = FLAT.diameter / 2;
    for (const f of [0.25, 0.5, 0.75]) {
      const p = pointAt(LONG, timeline, lineStart + f * lineTime);
      if (p === null) throw new Error('no point');
      expect(p.line).toBe(1);
      c.seek(p.line, { vertex: p.vertex, t: p.t });
      run(c);
      // The tool is at X = 100·f; the cut reaches its far edge (X + radius), and no further, to within a cell.
      expect(Math.abs(reach(c.heightmap.z) - (100 * f + r))).toBeLessThanOrEqual(spec.cell);
    }
    // The move done: the whole line.
    c.seek(2);
    run(c);
    expect(Math.abs(reach(c.heightmap.z) - (100 + r))).toBeLessThanOrEqual(spec.cell);
  });
});

describe('the client', () => {
  it('sends a new tip on the same line, coalesced to the latest', () => {
    const sent: ToCarveWorker[] = [];
    const worker: CarveWorkerLike = { postMessage: (m) => { sent.push(m); }, terminate: () => undefined, onmessage: null, onerror: null };
    let clock = 0;
    const timers: (() => void)[] = [];
    const c = createCarveClient(() => worker, { now: () => clock, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => undefined });
    c.setup(SPEC, TOOLS);
    c.seek(1, { vertex: 3, t: 0.2 });
    c.seek(1, { vertex: 3, t: 0.3 });
    c.seek(1, { vertex: 3, t: 0.4 });
    clock = 30;
    timers.shift()?.();
    const seeks = sent.filter((m) => m.type === 'seek');
    expect(seeks).toEqual([{ type: 'seek', session: 1, target: 1, tip: { vertex: 3, t: 0.2 } }, { type: 'seek', session: 1, target: 1, tip: { vertex: 3, t: 0.4 } }]);
  });
});
