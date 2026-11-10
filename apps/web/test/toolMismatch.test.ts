/**
 * The file's tools against the tool table (tool-mismatch, 2026-11-10): the docklight file says T1 is a 6 mm end mill,
 * the owner's table has 3.175 mm. Diameter beyond 0.05 mm or 2 %, type by family; the note's words, the Ready row's,
 * and what "Use the file's tool" does to the table.
 */
import { describe, expect, it } from 'vitest';
import type { Tool } from '@synthetos/library';
import { fileToolsFromLines, type FileTool } from '../src/gcode-worker/camTools.ts';
import { FROM_FILE_TAG, diametersDiffer, mismatchSummary, toolFromFile, toolMismatches, useFilePlan, type PlanEntry } from '../src/workspace/toolMismatch.ts';
import { mismatchNotes } from '../src/workspace/ToolMismatchNotes.ts';
import { readyModel, type ReadyInput } from '../src/workspace/run/readyModel.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { DOCKLIGHT } from './docklightSample.ts';

const tool = (over: Omit<Partial<Tool>, 'geometry'> & { geometry?: Partial<Tool['geometry']> } = {}): Tool => {
  const base = SEED_TOOLS[0]?.tool as Tool;
  return { ...base, ...over, geometry: { ...base.geometry, ...over.geometry } };
};
const entry = (number: number, over: Parameters<typeof tool>[0] = {}): PlanEntry => ({ number, store: null, tool: tool({ id: `t${number}`, name: `${number} tool name`, ...over }) });
const file = (over: Partial<FileTool>): FileTool => ({ number: 1, diameterMm: 6, type: 'flat', text: 'Boss top: T1 D6 flat end mill', line: 3, ...over });

describe('toolMismatches', () => {
  it('the docklight file against the owner’s table: T1 differs (6 mm against 3.175 mm), T2 matches, T3 is not in the table', () => {
    const table = [entry(1, { type: 'flat', geometry: { diameter: 3.175 } }), entry(2, { type: 'flat', geometry: { diameter: 3 } })];
    const list = toolMismatches(fileToolsFromLines(DOCKLIGHT), table);
    expect(list.map((m) => [m.number, m.diameter, m.type])).toEqual([[1, true, false]]);
    expect(list[0]?.fileText).toBe('The file says T1 is a 6 mm end mill.');
    expect(list[0]?.tableText).toBe('Your tool table’s T1 is 3.175 mm.');
  });

  it('diameter beyond 0.05 mm or 2 % of the larger, whichever is more', () => {
    expect(diametersDiffer(6, 6.05)).toBe(false);
    expect(diametersDiffer(6, 6.13)).toBe(true);
    expect(diametersDiffer(25, 25.5)).toBe(false);
    expect(diametersDiffer(25, 25.6)).toBe(true);
    expect(diametersDiffer(1, 1.06)).toBe(true);
    expect(diametersDiffer(6.35, 6.35)).toBe(false);
  });

  it('type by family: an O-flute is still flat; a ball against a flat differs and says what the table has; an unstated side is not compared', () => {
    const table = [entry(1, { type: 'o-flute', geometry: { diameter: 6 } }), entry(2, { type: 'flat', geometry: { diameter: 6 } }), entry(3, { type: 'v-bit', geometry: { diameter: 12.7 } }), entry(8, { type: 'flat', geometry: { diameter: 3 } })];
    const list = toolMismatches([file({}), file({ number: 2, type: 'ball' }), file({ number: 3, type: 'chamfer', diameterMm: 12.7 }), file({ number: 8, type: null, diameterMm: 8 })], table);
    expect(list.map((m) => m.number)).toEqual([2, 8]);
    expect(list[0]?.fileText).toBe('The file says T2 is a 6 mm ball nose.');
    expect(list[0]?.tableText).toBe('Your tool table’s T2 is a 6 mm end mill.');
    expect(list[1]?.fileText).toBe('The file says T8 is 8 mm.');
    expect(toolMismatches([file({ number: 2, type: null, diameterMm: null })], table)).toEqual([]);
  });

  it('the Ready row’s words and the note: Needs you, the table tool still drawn, [Edit T1] and [Use the file’s tool]', () => {
    const list = toolMismatches([file({}), file({ number: 3, diameterMm: 8 })], [entry(1, { geometry: { diameter: 3.175 } }), entry(3, { geometry: { diameter: 3.175 } })]);
    expect(mismatchSummary(list)).toBe('T1 and T3 don’t match the file.');
    expect(mismatchSummary(list.slice(0, 1))).toBe('T1 doesn’t match the file.');
    expect(mismatchSummary([])).toBeNull();
    const [note] = mismatchNotes(list.slice(0, 1));
    expect(note).toMatchObject({
      id: 'tool-mismatch/1',
      title: 'The file says T1 is a 6 mm end mill.',
      body: 'Your tool table’s T1 is 3.175 mm. The 3D view draws your table’s tool.',
      tone: 'warn',
      link: { kind: 'action', action: 'tool-edit-1', label: 'Edit T1' },
      links: [{ kind: 'action', action: 'tool-use-file-1', label: 'Use the file’s tool' }],
    });
    expect(note?.detail).toContain('Line 3 of the file: (Boss top: T1 D6 flat end mill)');
  });
});

describe('Use the file’s tool', () => {
  it('a new tool from the file takes T1; the table’s T1 keeps its record under the next free number', () => {
    const list = [entry(1, { name: '3.175 mm 2-flute up-cut', geometry: { diameter: 3.175 } }), entry(4)];
    const plan = useFilePlan(list, file({}), 'new-id');
    expect(plan.text).toBe('A new tool, 6 mm end mill, becomes T1. Your 3.175 mm 2-flute up-cut moves to T5.');
    expect(plan.next.map((e) => [e.number, e.tool.id])).toEqual([[5, 't1'], [4, 't4'], [1, 'new-id']]);
    const made = plan.next.find((e) => e.number === 1)?.tool;
    expect(made).toMatchObject({ name: '6 mm end mill', type: 'flat', geometry: { diameter: 6, shank: 6 }, tags: [FROM_FILE_TAG] });
    expect(made?.description).toBe('From the file (line 3): Boss top: T1 D6 flat end mill');
  });

  it('a tool made from a file before is updated in place; a default name follows a moved tool’s number; a free T number is just added', () => {
    const fromFile = { ...entry(1), tool: { ...toolFromFile(file({ diameterMm: 3 }), 'ff'), version: 2 } };
    const update = useFilePlan([fromFile], file({ type: 'ball', diameterMm: 8 }), 'unused');
    expect(update.text).toBe('T1 becomes an 8 mm ball nose, as the file says.');
    expect(update.next).toHaveLength(1);
    expect(update.next[0]?.tool).toMatchObject({ id: 'ff', version: 3, type: 'ball', geometry: { diameter: 8 } });
    const moved = useFilePlan([entry(1, { name: 'T1 tool' })], file({}), 'n');
    expect(moved.next.find((e) => e.tool.id === 't1')?.tool.name).toBe('T2 tool');
    const added = useFilePlan([entry(2)], file({ vAngle: 60, type: 'v-bit', diameterMm: 12.7 }), 'v');
    expect(added.text).toBe('A new tool, 12.7 mm V-bit, is added as T1.');
    expect(added.next.find((e) => e.number === 1)?.tool.geometry.vAngle).toBe(60);
  });
});

describe('the Ready list row', () => {
  const READY = {
    connected: true, jobsOn: true, block: null, wait: null, fileName: 'docklight.gcode',
    check: { state: 'done', lines: 29717, toolChanges: 3, seconds: 600 }, zero: { state: 'match', comparable: true }, homed: true, homedBy: 'homing', canHome: true,
    travel: { kind: 'fits' }, modes: null, feeds: 'Feeds: within range', spindle: null,
  } as const satisfies ReadyInput;

  it('"Tools: T1 doesn’t match the file." with the note’s two buttons, marked needs you, never blocking Start', () => {
    const m = readyModel({ ...READY, toolMismatch: { number: 1, summary: 'T1 doesn’t match the file.' } });
    const row = m.items.find((i) => i.id === 'tool');
    expect(row).toEqual({ id: 'tool', label: 'Tools', mark: 'needs', summary: 'T1 doesn’t match the file.', actions: [{ id: 'edit-tool', label: 'Edit T1' }, { id: 'use-file-tool', label: 'Use the file’s tool' }], note: 'tool-mismatch/1' });
    expect(m.blocked).toBe(false);
    // Without a mismatch, the row is the tool change count as before.
    expect(readyModel(READY).items.find((i) => i.id === 'tool')?.mark).toBe('done');
  });
});
