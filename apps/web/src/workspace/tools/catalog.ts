import { formatLength, type ToolUnit } from './units.ts';
import type { Tool } from '@synthetos/library';
import { newTool, TOOL_KINDS, type ToolEntry } from '../library.ts';
import { freeToolNumber } from './freeNumber.ts';
/** A detached draft; only saveToolDraft may write it into the library. */
export function catalogDraft(template: Tool, entries: readonly ToolEntry[]): { tool: Tool; number: number } {
  const number = freeToolNumber(entries);
  return { number, tool: { ...structuredClone(template), id: newTool(number).id, name: '', forkOf: { id: template.id, version: template.version } } };
}
/** "2 flute", "2 flutes", "2-flute", "2fl": a flute count, matched against the count, not as digits in part numbers. */
const FLUTE_COUNT = /(?:^|\s)(\d+)\s*-?\s*(?:flutes?|fl)(?=\s|$)/gi;

/** Everything a person may type to find a tool: maker, part, name, type and its label, the words, size and flutes. */
export function catalogSearchText(tool: Tool): string {
  const d = tool.geometry.diameter;
  const mm = formatLength(d, 'mm');
  return [tool.manufacturer ?? '', tool.partNumber ?? '', tool.name, tool.type, TOOL_KINDS[tool.type] ?? '', tool.description, `${mm} mm ${mm}mm`, catalogCutLength(d, 'in'), `${tool.geometry.flutes} flute`].join(' ').toLowerCase();
}

/** Every word of the query must appear (owner, 2026-11-18, picture 147: not only a part number finds a tool). */
function matchesQuery(tool: Tool, query: string): boolean {
  let flutes: number | null = null;
  const rest = query.toLowerCase().replace(FLUTE_COUNT, (_m, n: string) => { flutes = Number(n); return ' '; });
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
  return `${size} ${tool.description.replace(/\s*\([^)]*\)/g, '').toLowerCase().replaceAll('upcut', 'up-cut').replaceAll('downcut', 'down-cut').replaceAll('o-flute', 'O-flute')}`;
}

/** Exact binary inch fractions through 1/64; other lengths keep the app's decimal formatting. */
export function catalogCutLength(mm: number, unit: ToolUnit): string {
  if (unit === 'mm') return `${formatLength(mm, unit)} mm`;
  const inches = mm / 25.4;
  for (const denominator of [1, 2, 4, 8, 16, 32, 64]) {
    const numerator = Math.round(inches * denominator);
    if (Math.abs(inches * denominator - numerator) > 1e-10) continue;
    const whole = Math.floor(numerator / denominator); const remainder = numerator % denominator;
    return remainder === 0 ? `${whole}"` : `${whole === 0 ? '' : `${whole} `}${remainder}/${denominator}"`;
  }
  return `${formatLength(mm, unit)} in`;
}
