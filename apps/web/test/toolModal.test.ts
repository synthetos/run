import { afterEach, describe, expect, it } from 'vitest';
import { readTool } from '@synthetos/library';
import { newTool, toolStore } from '../src/workspace/library.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { parseLength, formatLength, formatChipload, formatSurfaceSpeed } from '../src/workspace/tools/units.ts';
import { freeToolNumber } from '../src/workspace/tools/freeNumber.ts';
import { toolDisplayName } from '../src/workspace/tools/displayName.ts';
import { saveToolDraft } from '../src/workspace/tools/saveTool.ts';
afterEach(() => toolStore.set(SEED_TOOLS));
describe('tool units', () => {
  it.each([['0.25', 6.35], ['1/4', 6.35], ['1 1/4', 31.75]])('accepts %s inches', (raw, mm) => expect(parseLength(raw, 'in')).toBe(mm));
  it.each(['1/0', '1/4junk', '-1', 'Infinity', '', '1e2', '1 2', '1//4'])('refuses %s', raw => expect(parseLength(raw, 'in')).toBeNull());
  it('round trips a quarter inch exactly and trims display precision', () => {
    expect(formatLength(6.35, 'in')).toBe('0.25'); expect(parseLength(formatLength(6.35, 'in'), 'in')).toBe(6.35);
    expect(formatLength(6.35, 'mm')).toBe('6.35'); expect(formatLength(3.175, 'in')).toBe('0.125');
    expect(parseLength('1/4', 'mm')).toBeNull();
  });
});
it('fills the first gap, including in an unsorted table', () => expect(freeToolNumber([9, 1, 2, 7, 4, 6, 3, 5].map(number => ({ number })))).toBe(8));
it('empty and old generated names follow diameter; custom names stay', () => {
  const t = newTool(9); expect(readTool(t).ok).toBe(true); expect(toolDisplayName(t)).toBe('3.175 mm end mill');
  expect(toolDisplayName({ ...t, name: 'T9 tool', type: 'ball', geometry: { ...t.geometry, diameter: 6.35 } })).toBe('6.35 mm ball nose');
  expect(toolDisplayName({ ...t, name: 'My cutter' })).toBe('My cutter');
});
it('unsaved drafts do not create or alter a tool; save validates before writing', () => {
  const t = newTool(7); const before = toolStore.value.value;
  expect(toolStore.value.value).toBe(before);
  expect(saveToolDraft(null, t, 1)).toContain('already'); expect(toolStore.value.value).toBe(before);
  expect(saveToolDraft(null, { ...t, geometry: { ...t.geometry, diameter: -1 } }, 7)).not.toBeNull(); expect(toolStore.value.value).toBe(before);
  expect(saveToolDraft(null, t, 7)).toBeNull(); expect(toolStore.value.value).toHaveLength(before.length + 1);
});
it('saving an edit is atomic and refuses concurrent edits', () => {
  const original = SEED_TOOLS[0]!; const draft = { ...original.tool, name: 'Edited' };
  expect(saveToolDraft(original, draft, 8)).toBeNull();
  expect(toolStore.value.value.find(e => e.number === 8)?.tool).toMatchObject({ name: 'Edited', version: original.tool.version + 1 });
  expect(saveToolDraft(original, draft, 9)).toContain('changed');
});

it('converts chipload to inches per tooth with four-decimal rounding', () => {
  expect(formatChipload(0.0508, 'in')).toBe('0.002');
  expect(formatChipload(0.07, 'in')).toBe('0.0028');
  expect(formatChipload(0.07, 'mm')).toBe('0.07');
});
it('converts surface speed to whole feet per minute', () => {
  expect(formatSurfaceSpeed(30.48, 'in')).toBe('100');
  expect(formatSurfaceSpeed(100, 'in')).toBe('328');
  expect(formatSurfaceSpeed(30.48, 'mm')).toBe('30.48');
});
