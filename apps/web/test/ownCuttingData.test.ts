import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { readTool, type ToolCuttingData } from '@synthetos/library';
import { newTool } from '../src/workspace/library.ts';
import { cuttingDraft, cuttingUnit, isOwnCuttingRow, ownCuttingRow, readCuttingDraft } from '../src/workspace/tools/cuttingData.ts';
import { ToolCuttingTab, CuttingSource } from '../src/workspace/views/tools/ToolRecordsTabs.ts';
const tool = newTool(7);
const sourced: ToolCuttingData = { materialRef: { id: 'builtin.mdf', version: 1 }, materialName: 'MDF', fz: 0.1778, fzMax: 0.2286, vc: 100, ap: 1, ae: 0.5, coolant: 'none', source: 'manufacturer', sourceUrl: 'https://onsrud.com/catalog.pdf', sourcePage: 129, note: 'Original note' };
describe('own cutting data', () => {
  it('copies all values but removes the sourced claim without changing the catalog row', () => {
    const original = structuredClone(sourced);
    const own = ownCuttingRow({ ...sourced, placeholder: true });
    expect(sourced).toEqual(original); expect(own.source).toBe('user');
    expect(own.sourceUrl).toBeUndefined(); expect(own.sourcePage).toBeUndefined(); expect(own.placeholder).toBeUndefined();
    expect(own.materialRef).toEqual(original.materialRef); expect(own.ap).toBe(1);
    expect(isOwnCuttingRow(sourced)).toBe(false); expect(isOwnCuttingRow(own)).toBe(true);
    expect(isOwnCuttingRow({ ...own, sourceUrl: 'https://onsrud.com/catalog.pdf' })).toBe(true);
    expect(renderToString(h(CuttingSource, { row: own }))).toContain('Your own numbers');
  });
  it('round trips untouched values without rounding through mm/in switches', () => {
    const original = ownCuttingRow(sourced);
    let draft = cuttingDraft(original, 'mm');
    for (let i = 0; i < 20; i++) draft = cuttingUnit(cuttingUnit(draft, 'in'), 'mm');
    expect(readCuttingDraft(draft, tool)).toEqual({ row: original, errors: {} });
    const inches = cuttingUnit(draft, 'in');
    const edited = readCuttingDraft({ ...inches, raw: { ...inches.raw, fz: '0.008', vc: '100' } }, tool);
    expect(edited.row?.fz).toBeCloseTo(0.2032, 12); expect(edited.row?.vc).toBeCloseTo(30.48, 12);
    expect(readTool({ ...tool, cuttingData: [edited.row] }).ok).toBe(true);
  });
  it.each(['0', '-1', 'NaN', 'Infinity', '1e309', 'oops'])('refuses %s and does not make it valid with a unit switch', raw => {
    const draft = { ...cuttingDraft(sourced, 'mm'), raw: { ...cuttingDraft(sourced, 'mm').raw, fz: raw } };
    expect(readCuttingDraft(draft, tool).row).toBeNull();
    expect(readCuttingDraft(cuttingUnit(draft, 'in'), tool).row).toBeNull();
  });
  it('keeps an invalid mm fraction invalid after switching to inches, until edited', () => {
    const d = cuttingDraft(sourced, 'mm');
    const switched = cuttingUnit({ ...d, raw: { ...d.raw, fz: '1/4' } }, 'in');
    expect(readCuttingDraft(switched, tool).errors['fz']).toBeDefined();
  });
  it('requires material and chipload, validates ranges, limits, stepover and notes', () => {
    expect(readCuttingDraft(cuttingDraft(null, 'mm'), tool).errors).toMatchObject({ material: 'Choose a material.', fz: 'Enter a positive, finite number.' });
    const d = cuttingDraft(sourced, 'mm');
    for (const patch of [{ fzMax: '0.01' }, { fz: '11' }, { vc: '5001' }, { ap: '501' }, { ae: '100' }]) expect(readCuttingDraft({ ...d, raw: { ...d.raw, ...patch } }, tool).row).toBeNull();
    expect(readCuttingDraft({ ...d, row: { ...d.row, note: 'x'.repeat(501) } }, tool).errors['note']).toContain('500');
    const row = readCuttingDraft({ ...d, raw: { ...d.raw, fzMax: '', vc: '', ap: '', ae: '' } }, tool).row;
    expect(row?.fz).toBe(sourced.fz); expect(row?.vc).toBeUndefined(); expect(row?.fzMax).toBeUndefined();
  });
  it('offers own controls only in My tools, and never edit/remove on a sourced row', () => {
    const mixed = { ...tool, cuttingData: [sourced, ownCuttingRow(sourced)] };
    const own = renderToString(h(ToolCuttingTab, { tool: mixed, unit: 'mm', set: () => undefined }));
    expect(own.match(/data-action="cutting-row-edit"/g)).toHaveLength(1);
    expect(own.match(/data-action="cutting-row-remove"/g)).toHaveLength(1);
    expect(own.match(/data-action="cutting-row-copy"/g)).toHaveLength(1);
    expect(own).toContain('Add a row');
    const catalog = renderToString(h(ToolCuttingTab, { tool: mixed, unit: 'mm' }));
    expect(catalog).not.toContain('data-action="cutting-row-');
    expect(renderToString(h(ToolCuttingTab, { tool, unit: 'mm', set: () => undefined }))).toContain('Add a row');
  });
});
