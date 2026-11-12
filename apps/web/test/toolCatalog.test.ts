import { CatalogTable } from '../src/workspace/views/tools/CatalogTable.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { ONSRUD_CATALOG } from '@synthetos/library';
import { toolStore } from '../src/workspace/library.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { catalogDraft, matchesCatalog, catalogDescription } from '../src/workspace/tools/catalog.ts';
import { saveToolDraft } from '../src/workspace/tools/saveTool.ts';
import { CuttingSource, ToolCuttingTab } from '../src/workspace/views/tools/ToolRecordsTabs.ts';
import { root, one, all } from './tree.ts';
import { CatalogChoices, ToolCatalog } from '../src/workspace/views/tools/ToolCatalog.ts';
afterEach(() => toolStore.set(SEED_TOOLS));
const template = ONSRUD_CATALOG[0]!;
describe('catalog drafts', () => {
  it('detaches a template and only saves on Add', () => {
    const before = toolStore.value.value;
    const draft = catalogDraft(template, before);
    expect(draft.number).toBe(7); expect(draft.tool.name).toBe('');
    expect(draft.tool.geometry).toEqual(template.geometry); expect(draft.tool.geometry).not.toBe(template.geometry);
    expect(toolStore.value.value).toBe(before);
    expect(saveToolDraft(null, draft.tool, draft.number)).toBeNull();
    expect(toolStore.value.value.at(-1)?.tool.partNumber).toBe('52-280');
  });
  it('filters maker, part, type and size; optional maker fields are safe', () => {
    for (const q of [' Onsrud ', '52-280', 'flat', 'upcut']) expect(matchesCatalog(template, q, '')).toBe(true);
    expect(matchesCatalog(template, 'no match', '')).toBe(false);
    expect(matchesCatalog(template, '', '3.175')).toBe(false);
    expect(matchesCatalog(template, '', '6.35')).toBe(true);
    const { manufacturer: _m, partNumber: _p, ...bare } = template;
    expect(matchesCatalog(bare, '', '')).toBe(true);
  });
  it('renders the picker templates', () => {
    expect(renderToString(h(ToolCatalog, null))).toContain('52-280');
  });
});
describe('cutting citations', () => {
  it('shows manufacturer ranges and page links without a placeholder warning', () => {
    const html = renderToString(h(ToolCuttingTab, { tool: template, unit: 'in' }));
    expect(html).toContain('Onsrud 2025 catalog, p. 129'); expect(html).toContain('#page=129');
    expect(renderToString(h(ToolCuttingTab, { tool: template, unit: 'mm' }))).toContain('>0.1778</td>');
    expect(html).toContain('Range .007-.009'); expect(html).toContain('—'); expect(html).not.toContain('Placeholder values');
  });
  it('warns only for placeholder rows, not empty or user data', () => {
    expect(renderToString(h(ToolCuttingTab, { tool: SEED_TOOLS[0]!.tool, unit: 'mm' }))).toContain('Placeholder values');
    expect(renderToString(h(ToolCuttingTab, { tool: { ...template, cuttingData: [] }, unit: 'mm' }))).not.toContain('Placeholder values');
    const row = { materialRef: { id: 'unknown', version: 1 }, fz: 1, vc: 1, source: 'user' as const, note: '' };
    const html = renderToString(h(ToolCuttingTab, { tool: { ...template, cuttingData: [row] }, unit: 'mm' }));
    expect(html).toContain('unknown'); expect(html).not.toContain('Placeholder values');
    expect(renderToString(h(CuttingSource, { row: { ...row, sourceUrl: 'javascript:bad' } }))).not.toContain('<a');
    expect(renderToString(h(CuttingSource, { row: { ...row, sourceUrl: 'https://onsrud.com/' } }))).toContain('>Source</a>');
    expect(renderToString(h(CuttingSource, { row: { ...row, sourceUrl: 'https://onsrud.com/', sourcePage: 2 } }))).toContain('Source catalog, p. 2');
  });
});

it('catalog controls filter, select and show no matches', () => {
  let query = ''; let size = ''; let selected = ''; let maker = ''; let type = '';
  const props = { query, size, maker, type, entries: [], setMaker: (s: string) => { maker = s; }, setType: (s: string) => { type = s; }, unit: 'mm' as const, setQuery: (s: string) => { query = s; }, setSize: (s: string) => { size = s; }, onPick: (t: typeof template) => { selected = t.id; } };
  const el = root(h(CatalogChoices, props));
  (one(el, e => e.tag === 'input').props['onInput'] as (e: unknown) => void)({ currentTarget: { value: '52' } });
  (one(el, e => e.props['aria-label'] === 'Maker').props['onChange'] as (e: unknown) => void)({ currentTarget: { value: 'Onsrud' } });
  (all(el, e => e.tag === 'button')[2]!.props['onClick'] as () => void)();
  (one(el, e => e.props['aria-label'] === 'Type').props['onChange'] as (e: unknown) => void)({ currentTarget: { value: 'flat' } });
  (all(el, e => e.tag === 'button')[3]!.props['onClick'] as () => void)();
  expect(maker).toBe('Onsrud'); expect(type).toBe('flat'); expect(query).toBe('52'); expect(size).toBe('6.35'); expect(selected).toBe(template.id);
  expect(renderToString(h(CatalogChoices, { ...props, query: 'absent' }))).toContain('No matching tools.');
});

it('matches distinct maker and type filters and formats catalog sizes', () => {
  expect(matchesCatalog(template, '', '', 'Onsrud', 'flat')).toBe(true);
  expect(matchesCatalog(template, '', '', 'Other', '')).toBe(false);
  expect(matchesCatalog(template, '', '', '', 'ball')).toBe(false);
  expect(catalogDescription(template, 'in')).toBe('1/4" up-cut spiral');
  expect(catalogDescription({ ...template, geometry: { ...template.geometry, diameter: 3.175 } }, 'in')).toContain('1/8"');
  expect(catalogDescription({ ...template, geometry: { ...template.geometry, diameter: 25.4 } }, 'in')).toContain('1 in');
});

it('catalog rows identify existing maker/part matches and keep unsafe sources inert', () => {
  const entries = [{ tool: { ...template, manufacturer: 'Other' }, number: 3, store: null }, { tool: { ...template, partNumber: 'other' }, number: 2, store: null }, { tool: { ...template, id: 'mine.tool' }, number: 4, store: null }];
  const html = renderToString(h(CatalogTable, { tools: [template], entries, unit: 'in', onPick: () => undefined }));
  expect(html).toContain('In your tools as T4'); expect(html).not.toContain('Add to my tools'); expect(html).toContain('Onsrud page');
  expect(html).toContain('0.875 in');
  for (const purchase of [[], [{ vendor: 'bad', url: 'javascript:bad', kind: 'link' as const }]]) {
    expect(renderToString(h(CatalogTable, { tools: [{ ...template, purchase }], entries: [], unit: 'mm', onPick: () => undefined }))).not.toContain('<a');
  }
});
