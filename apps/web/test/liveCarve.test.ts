/**
 * The carve during a job (preview/liveCarve.ts, tool-sim slice 3): carved to the line before the one the board
 * reports executing, never further; only forward within a job; held when the job pauses, stops or ends; reset by
 * a new job; and the marker's tool before the first tool change from the spindle choice (activeTool.ts).
 */
import { describe, expect, it } from 'vitest';
import type { ToolChanges } from '@synthetos/gcode';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { carveTarget, linesBefore, nextLiveCarve, type LiveCarve, type LiveCarveJob } from '../src/preview/liveCarve.ts';
import { activeTool } from '../src/preview/activeTool.ts';

// File lines of the sent lines: line 3 was split in two by the sanitiser; lines 1, 5 and 7 send nothing.
const SOURCE = Uint32Array.from([2, 3, 3, 4, 6, 8, 9]);
const job = (over: Partial<LiveCarveJob> = {}): LiveCarveJob => ({ id: 1, hash: 'abc', startedAt: 1000, executing: null, active: true, ...over });

describe('linesBefore', () => {
  it('counts the sent lines before a file line', () => {
    expect(linesBefore(SOURCE, 1)).toBe(0);
    expect(linesBefore(SOURCE, 3)).toBe(1);
    expect(linesBefore(SOURCE, 4)).toBe(3);
    expect(linesBefore(SOURCE, 7)).toBe(5);
    expect(linesBefore(SOURCE, 100)).toBe(7);
  });
});

describe('nextLiveCarve', () => {
  it('carves the lines the board has finished: every sent line before the executing one', () => {
    let c = nextLiveCarve(null, job(), 'abc', SOURCE);
    expect(c).toEqual({ key: '1:1000', target: 0, active: true });
    c = nextLiveCarve(c, job({ executing: 4 }), 'abc', SOURCE);
    // Both halves of line 3 are done; line 4 is running, so it is not carved.
    expect(c?.target).toBe(3);
  });

  it('never goes back within a job, and holds when the board stops reporting a line', () => {
    let c: LiveCarve | null = nextLiveCarve(null, job({ executing: 6 }), 'abc', SOURCE);
    expect(c?.target).toBe(4);
    c = nextLiveCarve(c, job({ executing: 3 }), 'abc', SOURCE);
    expect(c?.target).toBe(4);
    c = nextLiveCarve(c, job({ executing: null, active: false }), 'abc', SOURCE);
    expect(c).toEqual({ key: '1:1000', target: 4, active: false });
  });

  it('starts again for a new job or a new start of the same one', () => {
    const c = nextLiveCarve(null, job({ executing: 9 }), 'abc', SOURCE);
    expect(c?.target).toBe(6);
    expect(nextLiveCarve(c, job({ startedAt: 2000, executing: 2 }), 'abc', SOURCE)).toEqual({ key: '1:2000', target: 0, active: true });
    expect(nextLiveCarve(c, job({ id: 2, executing: 3 }), 'abc', SOURCE)).toEqual({ key: '2:1000', target: 1, active: true });
  });

  it('ignores a job of another file, or one not started', () => {
    expect(nextLiveCarve(null, job({ hash: 'other', executing: 4 }), 'abc', SOURCE)).toBeNull();
    expect(nextLiveCarve(null, job({ startedAt: null, executing: 4 }), 'abc', SOURCE)).toBeNull();
    expect(nextLiveCarve(null, null, 'abc', SOURCE)).toBeNull();
  });
});

describe('carveTarget', () => {
  const live: LiveCarve = { key: '1:1', target: 5, active: true };
  it('follows the board while the job runs, whatever is scrubbed', () => {
    expect(carveTarget(live, 0)).toBe(5);
    expect(carveTarget(live, 2)).toBe(5);
  });
  it('holds after the job until the user scrubs', () => {
    expect(carveTarget({ ...live, active: false }, 0)).toBe(5);
    expect(carveTarget({ ...live, active: false }, 2)).toBe(2);
  });
  it('without a job: the scrubbed lines, or the whole file', () => {
    expect(carveTarget(null, 3)).toBe(3);
    expect(carveTarget(null, 0)).toBeNull();
  });
});

describe('the marker before the first tool change', () => {
  const changes: ToolChanges = { lines: Uint32Array.from([20]), tools: Int32Array.from([4]), firstCut: 5 };
  it('shows the tool the user chose as already in the spindle, as the carve does', () => {
    expect(activeTool(changes, 10, SEED_TOOLS, 1)).toMatchObject({ number: 1, note: null });
    expect(activeTool(changes, 10, SEED_TOOLS, 1).shape?.tip).toBe('flat');
    expect(activeTool(changes, 25, SEED_TOOLS, 1).number).toBe(4);
    expect(activeTool(changes, 10, SEED_TOOLS, 9)).toMatchObject({ number: 9, shape: null, note: 'T9 is not in your tool table' });
    expect(activeTool(changes, 10, SEED_TOOLS).number).toBeNull();
  });
});
