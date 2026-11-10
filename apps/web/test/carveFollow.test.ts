/**
 * The carve follows the tool (preview/carveFollow.ts; owner, 2026-11-09: "the bit passes through it and then a
 * few seconds later it disappears"): during a job the carve target moves with the drawn tool, part way along the
 * executing line, and a finished line is carved whole only once the drawn tool has left it. Never ahead of the
 * newest report.
 */
import { describe, expect, it } from 'vitest';
import { SEGMENT, type SegmentList } from '@synthetos/gcode-view';
import { createLiveFollower, createTipSource, type CarveTarget } from '../src/preview/carveFollow.ts';

const { BREAK, FEED, RAPID } = SEGMENT;
// Line 0: rapid to (5, 10, 5), plunge to Z -1. Line 1: X 5 → 35 at Y 10. Line 2: Y 10 → 18 at X 35.
const LIST: SegmentList = {
  vertices: new Float32Array([0, 0, 0, 5, 10, 5, 5, 10, -1, 35, 10, -1, 35, 18, -1]),
  kinds: new Uint8Array([BREAK, RAPID, FEED, FEED, FEED]),
  lineToVertex: new Uint32Array([1, 3, 4, 5]),
};

function harness(): { follower: ReturnType<typeof createLiveFollower>; seen: (CarveTarget | null)[]; at: (ms: number) => void; latest: () => CarveTarget | null } {
  let clock = 0;
  let frames: (() => void)[] = [];
  const follower = createLiveFollower({ now: () => clock, frame: (fn) => { frames.push(fn); return frames.length; }, cancel: () => { frames = []; } });
  const seen: (CarveTarget | null)[] = [];
  follower.subscribe((t) => { seen.push(t); });
  return {
    follower,
    seen,
    at(ms) {
      // Runs the frames up to `ms`, one every 16 ms.
      while (clock < ms) {
        clock = Math.min(ms, clock + 16);
        const run = frames;
        frames = [];
        for (const f of run) f();
      }
    },
    latest: () => seen.at(-1) ?? null,
  };
}

describe('the live follower', () => {
  it('moves the tip with the drawn tool along the executing line, between reports', () => {
    const h = harness();
    h.follower.report(LIST, { target: 1, pos: [5, 10, -1] });
    expect(h.latest()).toEqual({ target: 1, tip: { vertex: 3, t: 0 } });
    h.at(250);
    h.follower.report(LIST, { target: 1, pos: [20, 10, -1] });
    // The drawn tool takes about a report interval to get there; so does the carve.
    h.at(375);
    const mid = h.latest();
    expect(mid?.target).toBe(1);
    expect(mid?.tip?.t ?? 0).toBeGreaterThan(0.1);
    expect(mid?.tip?.t ?? 1).toBeLessThan(0.5);
    h.at(600);
    expect(h.latest()).toEqual({ target: 1, tip: { vertex: 3, t: 0.5 } });
  });

  it('carves a finished line whole only once the drawn tool has left it', () => {
    const h = harness();
    h.follower.report(LIST, { target: 1, pos: [30, 10, -1] });
    h.at(250);
    // The board is on line 2 now; the drawn tool is still on its way along line 1.
    h.follower.report(LIST, { target: 2, pos: [35, 12, -1] });
    expect(h.latest()?.target).toBe(1);
    h.at(1000);
    expect(h.latest()).toEqual({ target: 2, tip: { vertex: 4, t: 0.25 } });
  });

  it('never goes past the newest report, and starts again for a new job or no job', () => {
    const h = harness();
    h.follower.report(LIST, { target: 1, pos: [20, 10, -1] });
    h.at(2000);
    expect(h.latest()).toEqual({ target: 1, tip: { vertex: 3, t: 0.5 } });
    h.follower.report(LIST, { target: 1, pos: null });
    expect(h.latest()).toEqual({ target: 1, tip: { vertex: 3, t: 0.5 } });
    h.follower.report(LIST, { target: 0, pos: [5, 10, 2] });
    expect(h.seen).toContain(null);
    expect(h.latest()?.target).toBe(0);
    h.follower.report(null, null);
    expect(h.latest()).toBeNull();
  });
});

describe('a tip source', () => {
  it('tells listeners only of a change, and the current target at once', () => {
    const s = createTipSource();
    const got: (CarveTarget | null)[] = [];
    s.set({ target: 2, tip: null });
    s.subscribe((t) => { got.push(t); });
    s.set({ target: 2, tip: null });
    s.set({ target: 2, tip: { vertex: 4, t: 0.5 } });
    expect(got).toEqual([{ target: 2, tip: null }, { target: 2, tip: { vertex: 4, t: 0.5 } }]);
  });
});
