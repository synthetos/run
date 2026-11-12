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
