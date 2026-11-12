import { formatLength, type ToolUnit } from './units.ts';
import type { Tool } from '@synthetos/library';
import { newTool, type ToolEntry } from '../library.ts';
import { freeToolNumber } from './freeNumber.ts';
/** A detached draft; only saveToolDraft may write it into the library. */
export function catalogDraft(template: Tool, entries: readonly ToolEntry[]): { tool: Tool; number: number } {
  const number = freeToolNumber(entries);
  return { number, tool: { ...structuredClone(template), id: newTool(number).id, name: '', forkOf: { id: template.id, version: template.version } } };
}
export function matchesCatalog(tool: Tool, query: string, size: string, maker = '', type = ''): boolean {
  return (maker === '' || tool.manufacturer === maker) && (type === '' || tool.type === type) && (size === '' || tool.geometry.diameter === Number(size)) && `${tool.manufacturer ?? ''} ${tool.partNumber ?? ''} ${tool.type} ${tool.description}`.toLowerCase().includes(query.trim().toLowerCase());
}

export function catalogDescription(tool: Tool, unit: ToolUnit): string {
  const diameter = tool.geometry.diameter;
  const size = unit === 'mm' ? `${formatLength(diameter, unit)} mm` : diameter === 6.35 ? '1/4"' : diameter === 3.175 ? '1/8"' : `${formatLength(diameter, unit)} in`;
  return `${size} ${tool.description.toLowerCase().replaceAll('upcut', 'up-cut').replaceAll('downcut', 'down-cut')}`;
}
