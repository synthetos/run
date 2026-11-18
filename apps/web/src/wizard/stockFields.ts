/**
 * Step 5's stock fields and tool choice (spec §6.3 step 5), pure. The stock is a `Stock` on the setup record with
 * the builtin MDF as its material (there is no stock record); the tool is whichever entry the catalog picker or the
 * tool editor added while the step was open.
 */
import type { Stock } from '@synthetos/library';
import { SEED_SETUP, type ToolEntry } from '../workspace/library.ts';

export interface StockFields { readonly width: string; readonly depth: string; readonly thickness: string }

export const DEFAULT_STOCK_FIELDS: StockFields = Object.freeze({ width: '180', depth: '120', thickness: '6.35' });

const positive = (s: string): number | null => {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 && /^\s*\d/.test(s) ? n : null;
};

/** The stock for the fields, or null unless all three are positive numbers (Review Focus 4). */
export function stockFromFields(f: StockFields): Stock | null {
  const width = positive(f.width); const depth = positive(f.depth); const thickness = positive(f.thickness);
  if (width === null || depth === null || thickness === null) return null;
  return { ...SEED_SETUP.stock, shape: 'block', width, depth, thickness };
}

export function fieldsFromStock(s: Stock | null): StockFields {
  return s === null ? DEFAULT_STOCK_FIELDS : { width: String(s.width), depth: String(s.depth), thickness: String(s.thickness) };
}

/** The entry added since the step opened, or null. */
export function newToolSince(before: readonly ToolEntry[], after: readonly ToolEntry[]): ToolEntry | null {
  const known = new Set(before.map((e) => e.tool.id));
  return after.find((e) => !known.has(e.tool.id)) ?? null;
}
