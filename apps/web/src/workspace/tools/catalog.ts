import type { Tool } from '@synthetos/library';
import { newTool, type ToolEntry } from '../library.ts';
import { freeToolNumber } from './freeNumber.ts';
/** A detached draft; only saveToolDraft may write it into the library. */
export function catalogDraft(template: Tool, entries: readonly ToolEntry[]): { tool: Tool; number: number } {
  const number = freeToolNumber(entries);
  return { number, tool: { ...structuredClone(template), id: newTool(number).id, name: '', forkOf: { id: template.id, version: template.version } } };
}
export function matchesCatalog(tool: Tool, query: string, size: string): boolean {
  return (size === '' || tool.geometry.diameter === Number(size)) && `${tool.manufacturer ?? ''} ${tool.partNumber ?? ''} ${tool.type} ${tool.description}`.toLowerCase().includes(query.trim().toLowerCase());
}
