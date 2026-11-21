import { formatLength, type ToolUnit } from './units.ts';
import type { Tool } from '@synthetos/library';
import { newTool, TOOL_KINDS, type ToolEntry } from '../library.ts';
import { freeToolNumber } from './freeNumber.ts';
import { catalogCutLength, catalogKind, catalogKindName, normaliseCatalogText } from './catalogText.ts';
export { catalogCutLength } from './catalogText.ts';
/** A detached draft; only saveToolDraft may write it into the library. */
export function catalogDraft(template: Tool, entries: readonly ToolEntry[]): { tool: Tool; number: number } {
  const number = freeToolNumber(entries);
  return { number, tool: { ...structuredClone(template), id: newTool(number).id, name: catalogKindName(template), forkOf: { id: template.id, version: template.version } } };
}
/** "2 flute", "2 flutes", "2-flute", "2fl": a flute count, matched against the count, not as digits in part numbers. */
const FLUTE_COUNT = /(?:^|\s)(\d+)\s*-?\s*(?:flutes?|fl)(?=\s|$)/gi;

/** Everything a person may type to find a tool: maker, part, name, type and its label, the words as shown, size and flutes. */
export function catalogSearchText(tool: Tool): string {
  const d = tool.geometry.diameter;
  const mm = formatLength(d, 'mm');
  return normaliseCatalogText([tool.manufacturer ?? '', tool.partNumber ?? '', tool.name, tool.type, TOOL_KINDS[tool.type] ?? '', tool.description, catalogKind(tool), `${mm} mm ${mm}mm`, catalogCutLength(d, 'in'), `${tool.geometry.flutes} flute`].join(' '));
}

/** Every word of the query must appear (owner, 2026-11-18, picture 147: not only a part number finds a tool). */
function matchesQuery(tool: Tool, query: string): boolean {
  let flutes: number | null = null;
  const rest = normaliseCatalogText(query.replace(FLUTE_COUNT, (_m, n: string) => { flutes = Number(n); return ' '; }));
  if (flutes !== null && tool.geometry.flutes !== flutes) return false;
  const text = catalogSearchText(tool);
  return rest.split(/\s+/).every((word) => word === '' || text.includes(word));
}

export function matchesCatalog(tool: Tool, query: string, size: string, maker = '', type = ''): boolean {
  return (maker === '' || tool.manufacturer === maker) && (type === '' || tool.type === type) && (size === '' || tool.geometry.diameter === Number(size)) && matchesQuery(tool, query);
}

export function catalogDescription(tool: Tool, unit: ToolUnit): string {
  const diameter = tool.geometry.diameter;
  const size = unit === 'mm' ? `${formatLength(diameter, unit)} mm` : diameter === 6.35 ? '1/4"' : diameter === 3.175 ? '1/8"' : `${formatLength(diameter, unit)} in`;
  return `${size} ${catalogKind(tool)}`;
}
