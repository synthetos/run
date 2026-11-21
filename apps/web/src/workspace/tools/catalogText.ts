import type { Tool } from '@synthetos/library';
import { formatLength, type ToolUnit } from './units.ts';

/** A parenthetical, closed or cut off by a malformed tail. */
const PAREN = /\s*\(([^)]*)(?:\)|$)/g;

/** The catalog words for a kind of tool, without size or parentheses: "up-cut spiral", "O-flute up-cut spiral, 1 flute". */
export function catalogKind(tool: Pick<Tool, 'description'>): string {
  return tool.description.replace(PAREN, '').trim().toLowerCase().replaceAll('upcut', 'up-cut').replaceAll('downcut', 'down-cut').replaceAll('o-flute', 'O-flute');
}

/** The same, with a capital first letter, for a tool name: "Up-cut spiral". */
export function catalogKindName(tool: Pick<Tool, 'description'>): string {
  const kind = catalogKind(tool);
  return kind === '' ? '' : kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** What the bit is made for, from the catalog parenthetical: "hard plastic", "aluminum", or ''. */
export function catalogMaterialNote(tool: Pick<Tool, 'description'>): string {
  const first = [...tool.description.matchAll(PAREN)][0]?.[1];
  if (first === undefined || /["()]/.test(first)) return '';
  return first.replace(/\bversion\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Lowercase, no hyphens, aluminium as aluminum: "up-cut", "upcut" and "Aluminium" match what the table shows. */
export function normaliseCatalogText(text: string): string {
  return text.toLowerCase().replaceAll('aluminium', 'aluminum').replaceAll('-', '');
}

/** Exact binary inch fractions through 1/64; other lengths keep the app's decimal formatting. Metric lengths show one decimal. */
export function catalogCutLength(mm: number, unit: ToolUnit): string {
  if (unit === 'mm') return `${mm.toFixed(1)} mm`;
  const inches = mm / 25.4;
  for (const denominator of [1, 2, 4, 8, 16, 32, 64]) {
    const numerator = Math.round(inches * denominator);
    if (Math.abs(inches * denominator - numerator) > 1e-10) continue;
    const whole = Math.floor(numerator / denominator); const remainder = numerator % denominator;
    return remainder === 0 ? `${whole}"` : `${whole === 0 ? '' : `${whole} `}${remainder}/${denominator}"`;
  }
  return `${formatLength(mm, unit)} in`;
}

/** A diameter as a filter label: exact for millimetres, an inch fraction where there is one. */
export function catalogSizeLabel(mm: number, unit: ToolUnit): string {
  return unit === 'mm' ? `${formatLength(mm, 'mm')} mm` : catalogCutLength(mm, 'in');
}

/** The filter choices that exist in the loaded catalog. */
export function catalogFilterOptions(tools: readonly Tool[]): { makers: string[]; sizes: number[]; types: Tool['type'][] } {
  const makers = [...new Set(tools.map(t => t.manufacturer ?? '').filter(m => m !== ''))].sort();
  const sizes = [...new Set(tools.map(t => t.geometry.diameter))].sort((a, b) => a - b);
  const types = [...new Set(tools.map(t => t.type))];
  return { makers, sizes, types };
}
