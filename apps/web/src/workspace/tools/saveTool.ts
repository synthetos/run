import { readTool } from '@synthetos/library';
import { toolStore, type ToolEntry, type Tool } from '../library.ts';
import { toolNumberIssue } from '../toolNumbers.ts';
/** Validate everything before a single store write. Cancel never calls this. */
export function saveToolDraft(original: ToolEntry | null, tool: Tool, number: number): string | null {
  const list = toolStore.value.value;
  const clash = toolNumberIssue(list, tool.id, number);
  if (clash !== null) return clash;
  const current = list.find(e => e.tool.id === tool.id);
  if (original !== null && current !== original) return 'This tool changed. Close and open it again.';
  if (original === null && current !== undefined) return 'This tool already exists.';
  const checked = readTool({ ...tool, version: original === null ? 1 : original.tool.version + 1 });
  if (!checked.ok) return checked.issues[0]?.message ?? 'Check the tool fields.';
  const entry: ToolEntry = { number, store: original?.store ?? null, tool: checked.value };
  toolStore.set(original === null ? [...list, entry] : list.map(e => e === original ? entry : e));
  return null;
}
