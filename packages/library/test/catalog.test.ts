import { describe, expect, it } from 'vitest';
import { ONSRUD_CATALOG, readTool } from '../src/index.ts';
import { readFileSync } from 'node:fs';
const source = JSON.parse(readFileSync(new URL('../../../tools/catalog/onsrud-source.json', import.meta.url), 'utf8')) as { cutting_diameter_decimal_in: number; shank_diameter_decimal_in: number; length_of_cut_decimal_in: number; overall_length_decimal_in: number; source: string; cutting_data: { chipload_min_in: number; chipload_max_in: number; chipload_per_tooth_in: string; source: string; pdf_page: number }[] }[];
describe('Onsrud templates', () => {
  it('validates all 30 immutable templates and preserves exact source geometry and ranges', () => {
    expect(ONSRUD_CATALOG).toHaveLength(30);
    for (const [i, t] of ONSRUD_CATALOG.entries()) {
      expect(readTool(t), JSON.stringify(readTool(t))).toMatchObject({ ok: true });
      expect(Object.isFrozen(t.geometry)).toBe(true);
      const raw = source[i]!;
      expect(t.geometry.diameter).toBe(raw.cutting_diameter_decimal_in * 25.4);
      expect(t.geometry.shank).toBe(raw.shank_diameter_decimal_in * 25.4);
      expect(t.geometry.fluteLength).toBe(raw.length_of_cut_decimal_in * 25.4);
      expect(t.geometry.overallLength).toBe(raw.overall_length_decimal_in * 25.4);
      expect(t.purchase[0]?.url).toBe(raw.source);
      for (const [j, c] of t.cuttingData.entries()) {
        expect(c.fz).toBe(raw.cutting_data[j]!.chipload_min_in * 25.4);
        expect(c.fzMax).toBe(raw.cutting_data[j]!.chipload_max_in * 25.4);
        expect(c.sourceUrl).toBe(raw.cutting_data[j]!.source);
        expect(c.sourcePage).toBe(raw.cutting_data[j]!.pdf_page);
        expect(c.vc).toBeUndefined(); expect(c.ap).toBeUndefined(); expect(c.ae).toBeUndefined(); expect(c.coolant).toBeUndefined();
      }
    }
  });
  it('keeps the uncertain chart warning visible', () => {
    const row = ONSRUD_CATALOG.find(t => t.partNumber === '57-280')!.cuttingData.find(c => c.note.includes('misprinted'));
    expect(row?.note).toContain('Check the catalog: this value may be misprinted');
  });
  it('rejects unsafe citations, invalid pages and excessive engagement', () => {
    const t = ONSRUD_CATALOG[0]!;
    for (const patch of [{ sourceUrl: 'javascript:alert(1)' }, { sourcePage: 0 }, { sourcePage: 1.5 }, { ae: 100 }]) {
      expect(readTool({ ...t, cuttingData: [{ ...t.cuttingData[0], ...patch }] }).ok).toBe(false);
    }
    expect(readTool({ ...t, cuttingData: [{ ...t.cuttingData[0], ae: 1 }] }).ok).toBe(true);
  });
});

it('accepts optional range bounds and refuses reversed or invalid ranges', () => {
  const t = ONSRUD_CATALOG[0]!; const c = t.cuttingData[0]!;
  for (const fzMax of [0, -1, 11, c.fz / 2]) expect(readTool({ ...t, cuttingData: [{ ...c, fzMax }] }).ok).toBe(false);
  expect(readTool({ ...t, cuttingData: [{ ...c, fzMax: c.fz }] }).ok).toBe(true);
  const { fzMax: _max, ...single } = c;
  expect(readTool({ ...t, cuttingData: [single] }).ok).toBe(true);
});
