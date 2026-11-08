/**
 * T numbers in the tool table (workspace/toolNumbers.ts) and the 3D view's planned marker (preview/previewMarker.ts):
 * a T number is a positive whole number, unique in the table, and a clash names the tool that has it; "Add T1"
 * makes a tool numbered 1, or selects the one that has it. The planned marker sits at the end of the scrubbed line.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { toolStore } from '../src/workspace/library.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { openToolNumber, setToolNumber, toolFocus, toolNumberIssue } from '../src/workspace/toolNumbers.ts';
import { scrubbedToolAt } from '../src/preview/previewMarker.ts';
import { toolNumbered } from '../src/preview/activeTool.ts';

afterEach(() => {
  toolStore.set(SEED_TOOLS);
  toolFocus.value = null;
});

describe('tool numbers (tool-sim slice 1)', () => {
  it('a T number is a whole number from 1, unique: a clash names the tool and nothing is swapped', () => {
    expect(toolNumberIssue(SEED_TOOLS, 'seed.t1', 0)).toMatch(/whole number from 1/);
    expect(toolNumberIssue(SEED_TOOLS, 'seed.t1', 2.5)).toMatch(/whole number from 1/);
    expect(toolNumberIssue(SEED_TOOLS, 'seed.t1', 1)).toBeNull();
    expect(toolNumberIssue(SEED_TOOLS, 'seed.t1', 3)).toBe('T3 is already 3.175 mm ball nose. Give that tool another number first.');
    expect(setToolNumber('seed.t1', 3)).toMatch(/already/);
    expect(toolStore.value.value.map((t) => t.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(setToolNumber('seed.t1', 12)).toBeNull();
    expect(toolStore.value.value.find((t) => t.tool.id === 'seed.t1')?.number).toBe(12);
    expect(setToolNumber('nope', 7)).toBe('No such tool.');
  });

  it('"Add T9" makes a tool numbered 9 and selects it; "Add T3" selects the tool that has 3', () => {
    const id = openToolNumber(9);
    expect(toolStore.value.value.find((t) => t.tool.id === id)?.number).toBe(9);
    expect(toolFocus.value).toBe(id);
    expect(openToolNumber(3)).toBe('seed.t3');
    expect(toolStore.value.value.length).toBe(SEED_TOOLS.length + 1);
  });

  it('the board-reported tool looks up the table; T0 has no add link', () => {
    expect(toolNumbered(3, SEED_TOOLS).shape?.tip).toBe('ball');
    expect(toolNumbered(0, SEED_TOOLS)).toMatchObject({ shape: null, note: 'T0 is not in your tool table', missing: null });
  });
});

describe('planned marker at the scrubbed line', () => {
  // Three lines: a move to (1,2,3), a line with no vertex, a move to (4,5,6).
  const segments = { vertices: new Float32Array([0, 0, 0, 1, 2, 3, 4, 5, 6]), lineToVertex: new Uint32Array([0, 2, 2, 3]) };
  it('is the end of the last scrubbed line, holding over a line that does not move; none with nothing scrubbed', () => {
    expect(scrubbedToolAt(segments, 0)).toBeNull();
    expect(scrubbedToolAt(segments, 1)).toEqual([1, 2, 3]);
    expect(scrubbedToolAt(segments, 2)).toEqual([1, 2, 3]);
    expect(scrubbedToolAt(segments, 3)).toEqual([4, 5, 6]);
    expect(scrubbedToolAt(segments, 99)).toEqual([4, 5, 6]);
    expect(scrubbedToolAt(null, 2)).toBeNull();
  });
});
