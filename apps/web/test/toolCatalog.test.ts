import { CatalogTable } from '../src/workspace/views/tools/CatalogTable.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { Tool } from '@synthetos/library';
import { ONSRUD_CATALOG as DATA } from '../../../workers/run/src/catalogData.ts';
const ONSRUD_CATALOG: readonly Tool[] = DATA;
import { toolStore } from '../src/workspace/library.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { catalogDraft, matchesCatalog, catalogDescription, catalogCutLength } from '../src/workspace/tools/catalog.ts';
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
    expect(renderToString(h(ToolCatalog, { active: true }))).toContain('Loading catalog');
  });
});
describe('cutting citations', () => {
  it('shows manufacturer ranges and page links without a placeholder warning', () => {
    const html = renderToString(h(ToolCuttingTab, { tool: template, unit: 'in' }));
    expect(html).toContain('Onsrud 2025 catalog, p. 129'); expect(html).toContain('#page=129');
    expect(renderToString(h(ToolCuttingTab, { tool: template, unit: 'mm' }))).toContain('>0.1778 – 0.2286</td>');
    expect(html).toContain('0.007 – 0.009'); expect(html).not.toContain('Surface speed'); expect(html).not.toContain('Lower end shown'); expect(html).not.toContain('Placeholder values');
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
  const props = { tools: ONSRUD_CATALOG, query, size, maker, type, entries: [], setMaker: (s: string) => { maker = s; }, setType: (s: string) => { type = s; }, unit: 'mm' as const, setQuery: (s: string) => { query = s; }, setSize: (s: string) => { size = s; }, onPreview: () => undefined, onPick: (t: typeof template) => { selected = t.id; } };
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
  const html = renderToString(h(CatalogTable, { tools: [template], entries, unit: 'in', onPreview: () => undefined, onPick: () => undefined }));
  expect(html).toContain('In your tools as T4'); expect(html).not.toContain('Add to my tools'); expect(html).toContain('Onsrud page');
  expect(html).toContain('7/8&quot;');
  for (const purchase of [[], [{ vendor: 'bad', url: 'javascript:bad', kind: 'link' as const }]]) {
    expect(renderToString(h(CatalogTable, { tools: [{ ...template, purchase }], entries: [], unit: 'mm', onPreview: () => undefined, onPick: () => undefined }))).not.toContain('<a');
  }
});

it('formats exact inch fractions and keeps other cut lengths decimal', () => {
  for (const [inches, expected] of [[0.875, '7/8"'], [0.75, '3/4"'], [0.5, '1/2"'], [1.5, '1 1/2"'], [2, '2"'], [0.123, '0.123 in']] as const) expect(catalogCutLength(inches * 25.4, 'in')).toBe(expected);
  expect(catalogCutLength(22.225, 'mm')).toBe('22.225 mm');
});
it('keeps full tool descriptions but shortens O-flute table labels', () => {
  const tool = { ...template, description: 'O-flute upcut spiral, 1 flute (hard plastic version)' };
  expect(catalogDescription(tool, 'in')).toBe('1/4" O-flute up-cut spiral, 1 flute');
  expect(tool.description).toContain('(hard plastic version)');
});
it('shows surface speeds only when supplied, and retains uncertain warnings', () => {
  const row = template.cuttingData[0]!;
  const mixed = { ...template, cuttingData: [row, { ...row, vc: 100 }] };
  expect(renderToString(h(ToolCuttingTab, { tool: mixed, unit: 'mm' }))).toContain('Surface speed (m/min)');
  expect(renderToString(h(ToolCuttingTab, { tool: mixed, unit: 'in' }))).toContain('328');
  const uncertain = { ...template, cuttingData: [{ ...row, note: 'Check the catalog: this value may be misprinted' }] };
  expect(renderToString(h(ToolCuttingTab, { tool: uncertain, unit: 'mm' }))).toContain('Check the catalog: this value may be misprinted');
});

it('catalog rows preview by click, Enter or Space, but leave links and buttons alone', () => {
  const seen: string[] = [];
  const tree = root(h(CatalogTable, { tools: [template], entries: [], unit: 'mm', onPick: () => seen.push('add'), onPreview: () => seen.push('preview') }));
  const row = one(tree, e => e.props['data-action'] === 'catalog-preview');
  expect(row.props['tabindex']).toBe(0);
  const el = { focus: () => undefined, closest: () => null };
  const click = row.props['onClick'] as (e: unknown) => void;
  click({ currentTarget: el, target: el });
  click({ currentTarget: el, target: { closest: () => ({}) } });
  const key = row.props['onKeyDown'] as (e: unknown) => void;
  for (const k of ['Enter', ' ', 'Escape']) key({ target: el, currentTarget: el, key: k, preventDefault: () => undefined });
  key({ target: {}, currentTarget: el, key: 'Enter' });
  expect(seen).toEqual(['preview', 'preview', 'preview']);
});
