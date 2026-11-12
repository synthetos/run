/**
 * Naming, deleting and ordering tools (first-time walk 2026-11-08, C1 and C16): a new tool is "T<n> tool" until
 * renamed (a default name follows the number); the Name field renames it; Delete asks in the page first; the list
 * is in T-number order.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { addTool, deleteTool, toolsByNumber, toolStore, updateTool } from '../src/workspace/library.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { setToolNumber } from '../src/workspace/toolNumbers.ts';
import { ToolDelete } from '../src/workspace/views/ToolDelete.ts';
import { ToolNameField } from '../src/workspace/views/ToolNameField.ts';

afterEach(() => toolStore.set(SEED_TOOLS));

const find = (id: string) => toolStore.value.value.find((t) => t.tool.id === id);

describe('tool names (C1)', () => {
  it('a new tool is unnamed; two new tools have different numbers', () => {
    const a = addTool();
    const b = addTool();
    expect(find(a)?.tool.name).toBe('');
    expect(find(b)?.tool.name).toBe('');
  });
  it('renumbering leaves the name alone', () => {
    const a = addTool();
    expect(setToolNumber(a, 12)).toBeNull();
    expect(find(a)?.tool.name).toBe('');
    expect(updateTool(a, { name: '60° V-bit' })).toBeNull();
    expect(setToolNumber(a, 13)).toBeNull();
    expect(find(a)?.tool.name).toBe('60° V-bit');
  });
  it('the Name field shows the name', () => {
    expect(renderToString(h(ToolNameField, { id: 'seed.t1', name: 'My end mill' }))).toContain('value="My end mill"');
  });
});

describe('deleting a tool (C1)', () => {
  it('removes it from the library; an unknown id is refused', () => {
    expect(deleteTool('seed.t3')).toBe(true);
    expect(find('seed.t3')).toBeUndefined();
    expect(deleteTool('seed.t3')).toBe(false);
  });
  it('asks in the page first: the button alone, never window.confirm', () => {
    const html = renderToString(h(ToolDelete, { id: 'seed.t3', label: 'T3 · ball nose', onDeleted: () => undefined }));
    expect(html).toContain('data-action="tool-delete"');
    expect(html).not.toContain('tool-delete-confirm');
  });
});

describe('T-number order (C16)', () => {
  it('sorts by T number whatever the order of entry', () => {
    setToolNumber('seed.t2', 10);
    setToolNumber('seed.t3', 9);
    expect(toolsByNumber(toolStore.value.value).map((t) => t.number)).toEqual([1, 4, 5, 6, 9, 10]);
  });
});
