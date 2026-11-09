/**
 * T numbers in the tool table: the link between a file's `T1 M6` and a tool's shape in the 3D view
 * (docs/design/tool-sim.md). A T number is a positive whole number, unique in the table; a clash names the
 * tool that has it and never swaps the two. Also the "Add T1 to your tool table" request from the scene's key,
 * which the tool table view answers by selecting that tool.
 */
import { signal } from '@preact/signals';
import { addTool, toolStore, type ToolEntry } from './library.ts';

/** Why `value` cannot be the T number of tool `id`, or null when it can. */
export function toolNumberIssue(list: readonly ToolEntry[], id: string, value: number): string | null {
  if (!Number.isInteger(value) || value < 1) return 'A T number is a whole number from 1 up.';
  const other = list.find((t) => t.number === value && t.tool.id !== id);
  return other === undefined ? null : `T${String(value)} is already ${other.tool.name}. Give that tool another number first.`;
}

/** Sets the T number of tool `id`. Returns why it was refused, or null. */
export function setToolNumber(id: string, value: number): string | null {
  const list = toolStore.value.value;
  if (!list.some((t) => t.tool.id === id)) return 'No such tool.';
  const issue = toolNumberIssue(list, id, value);
  if (issue !== null) return issue;
  // A tool still called by its default name ("T7 tool", C1) follows its new number; a name the user chose stays.
  toolStore.set(list.map((t) => (t.tool.id !== id ? t : { ...t, number: value, tool: t.tool.name === `T${t.number} tool` ? { ...t.tool, name: `T${value} tool` } : t.tool })));
  return null;
}

/** The tool the tool table view should select next (an id), set by `openToolNumber`; the view clears it. */
export const toolFocus = signal<string | null>(null);

/** The tool numbered `number`, made when the table has none, selected in the tool table view. Returns its id. */
export function openToolNumber(number: number): string {
  const found = toolStore.value.value.find((t) => t.number === number);
  const id = found === undefined ? addTool(number) : found.tool.id;
  toolFocus.value = id;
  return id;
}
