/**
 * Which tool the 3D marker shows (preview/activeTool.ts): the active T number at a line looked up in the tool
 * table as a true-size shape; a T number not in the table, an M6 with no T or no change before the first cut
 * gives the generic glyph and a note, never a guessed size.
 */
import { describe, expect, it } from 'vitest';
import { NO_TOOL, type ToolChanges } from '@synthetos/gcode';
import { TOOL_TYPES } from '@synthetos/library';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { PLACEHOLDER_NOTE, activeTool, noToolNamed, notInTable, previewToolLine, toolShapeOf, withJobChange } from '../src/preview/activeTool.ts';

const changes = (lines: number[], tools: number[], firstCut: number): ToolChanges => ({ lines: Uint32Array.from(lines), tools: Int32Array.from(tools), firstCut });

describe('active tool lookup (tool-sim slice 1)', () => {
  it('a known T number is the tool table entry, as a true-size shape', () => {
    const t = activeTool(changes([1, 40], [1, 4], 9), 20, SEED_TOOLS);
    expect(t).toMatchObject({ number: 1, name: '3.175 mm 2-flute up-cut', note: null, missing: null });
    expect(t.shape).toEqual({ tip: 'flat', diameter: 3.175, fluteLength: 12, shank: 3.175, length: 20 });
    expect(activeTool(changes([1, 40], [1, 4], 9), 40, SEED_TOOLS).shape).toMatchObject({ tip: 'v', diameter: 12.7, vAngle: 90 });
  });

  it('a T number not in the table: the generic glyph and a note that offers to add it', () => {
    const t = activeTool(changes([1], [9], 2), 5, SEED_TOOLS);
    expect(t).toEqual({ number: 9, shape: null, name: null, note: notInTable(9), missing: 9 });
    expect(t.note).toBe('T9 is not in your tool table');
  });

  it('no tool change before the first cut: a placeholder note; a file that changes first has none', () => {
    expect(activeTool(changes([30], [2], 5), 10, SEED_TOOLS)).toMatchObject({ number: null, shape: null, note: PLACEHOLDER_NOTE });
    expect(activeTool(changes([], [], 5), 10, SEED_TOOLS).note).toBe(PLACEHOLDER_NOTE);
    expect(activeTool(changes([1], [1], 9), 0, SEED_TOOLS).note).toBeNull();
    expect(activeTool(changes([], [], 0), 3, SEED_TOOLS).note).toBeNull();
  });

  it('an M6 with no T selected names no tool', () => {
    expect(activeTool(changes([7], [NO_TOOL], 9), 12, SEED_TOOLS)).toMatchObject({ number: null, shape: null, note: noToolNamed(7), missing: null });
  });

  it('the preview shows the scrubbed line, or with nothing scrubbed the first cut', () => {
    const c = changes([1], [1], 9);
    expect(previewToolLine(0, c)).toBe(9);
    expect(previewToolLine(4, c)).toBe(4);
  });

  it("the job's tool change wins at its own line; elsewhere the file's table stands", () => {
    const c = changes([5, 20], [1, 3], 6);
    expect(Array.from(withJobChange(c, { line: 20, tool: 4 }).tools)).toEqual([1, 4]);
    expect(withJobChange(c, { line: 20, tool: 3 })).toBe(c);
    expect(withJobChange(c, { line: 21, tool: 4 })).toBe(c);
    expect(withJobChange(c, { line: 20, tool: null })).toBe(c);
    expect(withJobChange(c, null)).toBe(c);
  });

  it('every tool type maps to a tip; an o-flute with a corner is a bull-nose; the stickout is the drawn length', () => {
    const g = { diameter: 6, shank: 6, flutes: 2, fluteLength: 18, overallLength: 50 };
    for (const type of TOOL_TYPES) expect(['flat', 'ball', 'bull-nose', 'v', 'drill']).toContain(toolShapeOf({ type, geometry: g }).tip);
    expect(toolShapeOf({ type: 'o-flute', geometry: { ...g, cornerRadius: 0.5 } })).toMatchObject({ tip: 'bull-nose', cornerRadius: 0.5 });
    expect(toolShapeOf({ type: 'engraver', geometry: { ...g, vAngle: 30, tipWidth: 0.2 } })).toMatchObject({ tip: 'v', vAngle: 30, tipWidth: 0.2 });
    expect(toolShapeOf({ type: 'drill', geometry: { ...g, pointAngle: 135, stickout: 30 } })).toMatchObject({ tip: 'drill', pointAngle: 135, length: 30 });
    expect(toolShapeOf({ type: 'flat', geometry: g }).length).toBe(50);
  });
});
