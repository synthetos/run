/**
 * Place job's offset (owner, 2026-11-09: "if you click the corners you should also allow for offsets on x and y"):
 * positive moves the zero inward from any corner, the centre moves in machine directions; the offset is saved with
 * the job and restored; the margins to each stock edge; the travel and clamp words; and Run's zero check (C31)
 * compares the board with the offset zero.
 */
import { describe, expect, it } from 'vitest';
import { SEGMENT, type SegmentList } from '@synthetos/gcode-view';
import type { StockCorner } from '@synthetos/library';
import { SEED_SETUP } from '../src/workspace/library.ts';
import { datumPoint, inwardSigns, isJob, jobFromSetup, placementOffset, plannedZero, withDatum, withOffset, type Job, type JobClock } from '../src/workspace/jobModel.ts';
import { cutBounds, marginsText, pastEdgesText, placeMargins, radiusText } from '../src/workspace/placeMargins.ts';
import { CLAMPS_NOT_CHECKED, placeTravelText } from '../src/workspace/placeTravel.ts';
import { cutToolRadius } from '../src/workspace/placeTool.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { placeWords, runZeroCheck, setupPlan } from '../src/workspace/zeroPlan.ts';

const clock: JobClock = { now: () => new Date('2026-11-09T12:00:00Z'), newId: () => 'job-1' };
const base = (): Job => jobFromSetup(SEED_SETUP, 'place', clock);
const at = (corner: StockCorner, x: number, y: number): Job => withOffset(withDatum(base(), { corner, height: 'top' }, clock), { x, y }, clock);

describe('the offset from the datum corner', () => {
  it('moves the zero inward from every corner, whichever it is', () => {
    expect(inwardSigns('front-left')).toEqual({ x: 1, y: 1 });
    expect(inwardSigns('front-right')).toEqual({ x: -1, y: 1 });
    expect(inwardSigns('back-left')).toEqual({ x: 1, y: -1 });
    expect(inwardSigns('back-right')).toEqual({ x: -1, y: -1 });
    for (const corner of ['front-left', 'front-right', 'back-left', 'back-right'] as const) {
      const plain = datumPoint(at(corner, 0, 0));
      const moved = datumPoint(at(corner, 5, 3));
      const s = inwardSigns(corner);
      expect(moved.x - plain.x, corner).toBeCloseTo(5 * s.x, 9);
      expect(moved.y - plain.y, corner).toBeCloseTo(3 * s.y, 9);
      expect(moved.z).toBe(plain.z);
    }
  });

  it('moves the centre in machine directions, and allows a negative offset past an edge', () => {
    const c0 = datumPoint(at('center', 0, 0));
    const c1 = datumPoint(at('center', 4, -2));
    expect([c1.x - c0.x, c1.y - c0.y]).toEqual([4, -2]);
    const out = datumPoint(at('front-left', -3, 0));
    expect(out.x).toBeCloseTo(datumPoint(at('front-left', 0, 0)).x - 3, 9);
  });

  it('flows into the planned zero in machine mm', () => {
    const j = at('front-left', 5, 5);
    expect(plannedZero(j).x - plannedZero(at('front-left', 0, 0)).x).toBeCloseTo(5, 9);
  });

  it('is saved with the job and restored; old jobs without it read as no offset; a bad one is refused', () => {
    const j = at('back-right', 7.5, 2);
    const back = JSON.parse(JSON.stringify(j)) as unknown;
    expect(isJob(back)).toBe(true);
    expect(placementOffset(back as Job)).toEqual({ x: 7.5, y: 2, z: 0 });
    // Changing the corner keeps the offset; clearing it removes the field.
    expect(placementOffset(withDatum(j, { corner: 'front-left', height: 'top' }, clock))).toEqual({ x: 7.5, y: 2, z: 0 });
    const cleared = withOffset(j, { x: 0, y: 0 }, clock);
    expect('offset' in cleared.placement).toBe(false);
    expect(isJob(base())).toBe(true);
    expect(placementOffset(base())).toEqual({ x: 0, y: 0, z: 0 });
    expect(isJob({ ...j, placement: { ...j.placement, offset: { x: 'a', y: 1 } } })).toBe(false);
    // The stock's own zero record never carries it.
    expect(Object.keys(j.setup.stock.zero).sort()).toEqual(['corner', 'height']);
  });
});

describe('the margins', () => {
  // A 20 × 10 mm cut from (0, 0) in the path frame, with a rapid well outside that must not count.
  const list: SegmentList = {
    vertices: Float32Array.from([0, 0, 5, -50, -50, 5, 0, 0, -1, 20, 0, -1, 20, 10, -1, 0, 10, -1]),
    kinds: Uint8Array.from([SEGMENT.BREAK, SEGMENT.RAPID, SEGMENT.RAPID, SEGMENT.FEED, SEGMENT.FEED, SEGMENT.ARC]),
    lineToVertex: Uint32Array.from([0, 6]),
  };
  it('take the cutting moves only', () => {
    expect(cutBounds(list)).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10, minZ: -1, maxZ: -1 });
  });
  it('measure from the cut, widened by the tool radius, to each stock edge (the sample stock is 180 × 120 mm)', () => {
    const cut = cutBounds(list);
    if (cut === null) throw new Error('no cut');
    const m = placeMargins(at('front-left', 5, 5), cut, 1.5875);
    expect(m.left).toBeCloseTo(5 - 1.5875, 6);
    expect(m.front).toBeCloseTo(5 - 1.5875, 6);
    expect(m.right).toBeCloseTo(180 - 25 - 1.5875, 6);
    expect(m.back).toBeCloseTo(120 - 15 - 1.5875, 6);
    expect(marginsText(placeMargins(at('front-left', 5, 5), cut, null))).toBe('Left 5 mm · Front 5 mm · Right 155 mm · Back 105 mm');
    expect(radiusText(1.5875)).toBe('Includes the tool’s 1.6 mm radius.');
    expect(radiusText(null)).toBe('Tool size not known: margins are to the tool’s centre.');
  });
  it('say when the cut goes past an edge', () => {
    const cut = cutBounds(list);
    if (cut === null) throw new Error('no cut');
    const m = placeMargins(at('front-left', -2, 0), cut, null);
    expect(marginsText(m)).toContain('Left −2 mm');
    expect(pastEdgesText(m)).toBe('The cut goes 2 mm past the left edge.');
    expect(pastEdgesText(placeMargins(at('front-left', 5, 5), cut, null))).toBeNull();
  });
});

describe('travel and clamps in Place job', () => {
  it('shows the travel check when it ran, else says when it runs; clamps are never checked', () => {
    expect(placeTravelText({ connected: false, homed: false })).toBe('Travel is checked when a machine is connected and homed.');
    expect(placeTravelText({ connected: true, homed: false })).toBe('Travel is checked once the machine is homed.');
    expect(placeTravelText({ connected: true, homed: true })).toBe('Travel is checked in the Check step.');
    expect(placeTravelText({ connected: true, homed: true, travel: { block: { text: 'Line 2: X would reach 200 mm, past its 150 mm limit.' }, confirm: null } })).toBe('Travel: Line 2: X would reach 200 mm, past its 150 mm limit.');
    expect(placeTravelText({ connected: true, homed: true, travel: { block: null, confirm: null } })).toBe('Travel: the job fits the machine at the board’s work zero now.');
    expect(CLAMPS_NOT_CHECKED).toBe('Clamp clearance is not checked. Look before you start.');
  });
});

describe('Run’s zero check (C31) uses the offset zero', () => {
  it('matches a board zero at the offset point and names the offset', () => {
    const j = at('front-left', 5, 5);
    const plan = setupPlan(j);
    expect(placeWords(plan)).toBe('the front-left corner of the top of the stock, moved in 5 mm in X and 5 mm in Y');
    const zero = plannedZero(j);
    expect(runZeroCheck({ x: zero.x, y: zero.y, z: zero.z }, null, plan, true).state).toBe('match');
    // The corner itself is now 5 mm off the plan.
    const corner = plannedZero(at('front-left', 0, 0));
    const off = runZeroCheck({ x: corner.x, y: corner.y, z: corner.z }, null, plan, true);
    expect(off.state).toBe('differs');
    expect(off.text).toContain('5.0 mm to the left');
    expect(placeWords(setupPlan(at('center', 2, -1)))).toBe('the centre of the top of the stock, moved X 2 mm and Y −1 mm');
  });
});

describe('the tool radius the margins add', () => {
  const segments = { vertices: Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0]), kinds: Uint8Array.from([SEGMENT.BREAK, SEGMENT.FEED, SEGMENT.FEED]), lineToVertex: Uint32Array.from([1, 2, 3]), lineMarks: new Uint8Array(2) };
  const sourceLines = Uint32Array.from([1, 2]);
  it('is the largest radius of the tools that cut', () => {
    expect(cutToolRadius({ tools: { lines: Uint32Array.from([1, 2]), tools: Int32Array.from([1, 4]), firstCut: 1 }, sourceLines, segments }, SEED_TOOLS, null)).toBeCloseTo(6.35, 6);
  });
  it('is not known when a cutting tool is not in the table, or none was chosen', () => {
    expect(cutToolRadius({ tools: { lines: Uint32Array.from([1, 2]), tools: Int32Array.from([1, 9]), firstCut: 1 }, sourceLines, segments }, SEED_TOOLS, null)).toBeNull();
    expect(cutToolRadius({ tools: { lines: new Uint32Array(0), tools: new Int32Array(0), firstCut: 1 }, sourceLines, segments }, SEED_TOOLS, null)).toBeNull();
    expect(cutToolRadius({ tools: { lines: new Uint32Array(0), tools: new Int32Array(0), firstCut: 1 }, sourceLines, segments }, SEED_TOOLS, 1)).toBeCloseTo(1.5875, 6);
  });
});

