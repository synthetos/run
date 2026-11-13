/** Form state for the existing library row. Only validated ToolCuttingData enters the tool draft. */
import { readTool, type Tool, type ToolCuttingData } from '@synthetos/library';
import { parseLength, type ToolUnit } from './units.ts';
export const CUTTING_NUMBERS = ['fz', 'fzMax', 'vc', 'ap', 'ae'] as const;
export type CuttingNumber = typeof CUTTING_NUMBERS[number];
export interface CuttingDraft {
  readonly row: ToolCuttingData;
  readonly unit: ToolUnit;
  readonly invalid?: readonly CuttingNumber[];
  readonly raw: Readonly<Record<CuttingNumber, string>>;
}
export const isOwnCuttingRow = (row: ToolCuttingData): boolean => row.source === 'user';
/** Copy values, not the manufacturer's claim. The original row is never mutated. */
export function ownCuttingRow(row: ToolCuttingData): ToolCuttingData {
  const { sourceUrl, sourcePage, placeholder, ...values } = row;
  void sourceUrl; void sourcePage; void placeholder;
  return { ...values, materialRef: { ...row.materialRef }, source: 'user' };
}
const factor = (key: CuttingNumber, unit: ToolUnit): number => unit === 'mm' ? 1 : key === 'vc' ? 0.3048 : 25.4;
const display = (row: ToolCuttingData, key: CuttingNumber, unit: ToolUnit): string => row[key] === undefined ? '' : String(row[key]! / factor(key, unit));
export function cuttingDraft(row: ToolCuttingData | null, unit: ToolUnit): CuttingDraft {
  const own = row === null ? { materialRef: { id: '', version: 1 }, fz: 0, source: 'user' as const, note: '' } : isOwnCuttingRow(row) ? { ...row, materialRef: { ...row.materialRef } } : ownCuttingRow(row);
  return { row: own, unit, raw: Object.fromEntries(CUTTING_NUMBERS.map(k => [k, row === null ? '' : display(own, k, unit)])) as Record<CuttingNumber, string> };
}
function value(draft: CuttingDraft, key: CuttingNumber): number | null | undefined {
  if (draft.invalid?.includes(key)) return null;
  const raw = draft.raw[key];
  if (raw.trim() === '') return key === 'fz' ? null : undefined;
  // An untouched display value retains the exact stored number (no rounding on unit switches).
  if (raw === display(draft.row, key, draft.unit)) return draft.row[key];
  const n = parseLength(raw, key === 'vc' ? 'mm' : draft.unit);
  return n === null ? null : key === 'vc' ? n * factor(key, draft.unit) : n;
}
export function cuttingUnit(draft: CuttingDraft, unit: ToolUnit): CuttingDraft {
  if (unit === draft.unit) return draft;
  const row = { ...draft.row };
  const raw = { ...draft.raw };
  const invalid: CuttingNumber[] = [];
  for (const k of CUTTING_NUMBERS) {
    const n = value(draft, k);
    // Keep invalid input visible and invalid until explicitly corrected.
    if (n === null) { invalid.push(k); continue; }
    if (n === undefined) delete row[k]; else row[k] = n;
    raw[k] = display(row, k, unit);
  }
  return { row, raw, unit, invalid };
}
export function readCuttingDraft(draft: CuttingDraft, tool: Tool): { row: ToolCuttingData | null; errors: Readonly<Record<string, string>> } {
  const errors: Record<string, string> = {};
  const row = { ...draft.row };
  if (row.materialRef.id.trim() === '') errors['material'] = 'Choose a material.';
  for (const k of CUTTING_NUMBERS) {
    const n = value(draft, k);
    if (n === null || (n !== undefined && (!Number.isFinite(n) || n <= 0))) errors[k] = 'Enter a positive, finite number.';
    else if (n === undefined) delete row[k]; else row[k] = n;
  }
  if (row.fzMax !== undefined && row.fzMax < row.fz) errors['fzMax'] = 'The upper chipload must be at least the lower chipload.';
  if (row.note.length > 500) errors['note'] = 'Use at most 500 characters.';
  const checked = readTool({ ...tool, cuttingData: [row] });
  if (!checked.ok) for (const issue of checked.issues) {
    const key = issue.path.replace(/^\/cuttingData\/0\//, '');
    if (issue.path.startsWith('/cuttingData/0/') && errors[key] === undefined) errors[key] = issue.message;
  }
  return { row: Object.keys(errors).length === 0 ? row : null, errors };
}
