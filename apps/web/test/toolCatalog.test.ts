import { CatalogTable, CatalogRow } from '../src/workspace/views/tools/CatalogTable.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { Tool } from '@synthetos/library';
import { ONSRUD_CATALOG as DATA } from '../../../workers/run/src/catalogData.ts';
const ONSRUD_CATALOG: readonly Tool[] = DATA;
import { toolStore } from '../src/workspace/library.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { catalogDraft, matchesCatalog, catalogDescription, catalogCutLength } from '../src/workspace/tools/catalog.ts';
import { catalogMaterialNote, catalogKindName, catalogFilterOptions, catalogSizeLabel } from '../src/workspace/tools/catalogText.ts';
import { saveToolDraft } from '../src/workspace/tools/saveTool.ts';
import { CuttingSource, ToolCuttingTab } from '../src/workspace/views/tools/ToolRecordsTabs.ts';
import { root, rootUntil, one, all } from './tree.ts';
import { CatalogChoices, ToolCatalog } from '../src/workspace/views/tools/ToolCatalog.ts';
afterEach(() => toolStore.set(SEED_TOOLS));
const template = ONSRUD_CATALOG[0]!;
describe('catalog drafts', () => {
  it('detaches a template and only saves on Add', () => {
    const before = toolStore.value.value;
    const draft = catalogDraft(template, before);
    expect(draft.number).toBe(7); expect(draft.tool.name).toBe('Up-cut spiral');
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
    expect(renderToString(h(ToolCuttingTab, { tool: { ...template, cuttingData: [{ ...template.cuttingData[0]!, placeholder: true }] }, unit: 'mm' }))).toContain('Placeholder values');
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
  const el = rootUntil(h(CatalogChoices, props), [CatalogTable]);
  (one(el, e => e.tag === 'input').props['onInput'] as (e: unknown) => void)({ currentTarget: { value: '52' } });
  (one(el, e => e.props['aria-label'] === 'Maker').props['onChange'] as (e: unknown) => void)({ currentTarget: { value: 'Onsrud' } });
  (all(el, e => e.tag === 'button')[2]!.props['onClick'] as () => void)();
  (one(el, e => e.props['aria-label'] === 'Type').props['onChange'] as (e: unknown) => void)({ currentTarget: { value: 'flat' } });
  (one(el, e => e.tag === 'CatalogTable').props['onPick'] as (t: typeof template) => void)(template);
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
  expect(catalogCutLength(22.225, 'mm')).toBe('22.2 mm');
});
describe('catalog text helpers', () => {
  it('names the kind of material a bit is for, or nothing', () => {
    const note = (description: string) => catalogMaterialNote({ description });
    expect(note('O-flute upcut spiral, 1 flute (hard plastic version)')).toBe('hard plastic');
    expect(note('O-flute upcut spiral, 1 flute (soft plastic version)')).toBe('soft plastic');
    expect(note('O-flute upcut spiral (aluminum)')).toBe('aluminum');
    expect(note('Upcut spiral')).toBe('');
    expect(note('Upcut spiral ("')).toBe('');
  });
  it('builds the name from the description without size or parentheses', () => {
    expect(catalogKindName({ description: 'Downcut spiral (aluminum)' })).toBe('Down-cut spiral');
    expect(catalogKindName({ description: 'O-flute upcut spiral, 1 flute (hard plastic version)' })).toBe('O-flute up-cut spiral, 1 flute');
  });
  it('searches the words as shown: up-cut, upcut, up cut and aluminium', () => {
    const o = { ...template, description: 'O-flute upcut spiral (aluminum)' };
    for (const q of ['up-cut', 'upcut', 'up cut', 'O-flute', 'aluminium', 'aluminum', 'Up-Cut Spiral']) expect(matchesCatalog(o, q, '')).toBe(true);
    expect(matchesCatalog(o, 'down-cut', '')).toBe(false);
  });
  it('derives maker, size and type options from the loaded catalog', () => {
    const options = catalogFilterOptions([template, { ...template, manufacturer: 'Other', type: 'ball', geometry: { ...template.geometry, diameter: 12.7 } }]);
    expect(options.makers).toEqual(['Onsrud', 'Other']);
    expect(options.sizes).toEqual([6.35, 12.7]);
    expect(options.types).toEqual(['flat', 'ball']);
    expect(catalogSizeLabel(12.7, 'in')).toBe('1/2"'); expect(catalogSizeLabel(6.35, 'mm')).toBe('6.35 mm');
  });
  it('shows the material note in a For column, and a count of tools', () => {
    const html = renderToString(h(CatalogTable, { tools: [{ ...template, description: 'O-flute upcut spiral (hard plastic version)' }], entries: [], unit: 'mm', onPreview: () => undefined, onPick: () => undefined }));
    expect(html).toContain('>For</th>'); expect(html).toContain('>hard plastic</td>'); expect(html).toContain('1 tool<');
  });
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

describe('catalog search without a part number (owner 147)', () => {
  const find = (q: string) => ONSRUD_CATALOG.filter((t) => matchesCatalog(t, q, ''));
  it('an empty query lists every tool, and the picker shows them all', () => {
    expect(find('')).toHaveLength(ONSRUD_CATALOG.length);
    expect(find('   ')).toHaveLength(ONSRUD_CATALOG.length);
    const props = { tools: ONSRUD_CATALOG, query: '', size: '', maker: '', type: '', entries: [], unit: 'mm' as const, setQuery: () => undefined, setSize: () => undefined, setMaker: () => undefined, setType: () => undefined, onPreview: () => undefined, onPick: () => undefined };
    expect(renderToString(h(CatalogChoices, props)).match(/data-catalog-part=/g)).toHaveLength(ONSRUD_CATALOG.length);
  });
  it('the diameter matches as millimetres or as an inch fraction', () => {
    const quarter = ONSRUD_CATALOG.filter((t) => t.geometry.diameter === 6.35);
    expect(quarter.length).toBeGreaterThan(0);
    for (const q of ['1/4', '1/4"', '6.35', '6.35mm', '6.35 mm']) expect(find(q).map((t) => t.id)).toEqual(quarter.map((t) => t.id));
    expect(find('1/8').every((t) => t.geometry.diameter === 3.175)).toBe(true);
  });
  it('a flute count filters by flutes, never by digits in part numbers', () => {
    for (const n of [1, 2, 3]) {
      const want = ONSRUD_CATALOG.filter((t) => t.geometry.flutes === n).map((t) => t.id);
      for (const q of [`${n} flute`, `${n} flutes`, `${n}-flute`, `${n}fl`]) expect(find(q).map((t) => t.id)).toEqual(want);
    }
    expect(find('2 flute').length).toBeGreaterThan(0);
  });
  it('the name, the tool words and the type label match; words combine', () => {
    expect(matchesCatalog({ ...template, name: 'Sign cutter' }, 'sign', '')).toBe(true);
    expect(find('spiral').length).toBeGreaterThan(0);
    expect(find('ball nose').every((t) => t.type === 'ball')).toBe(true);
    expect(find('ball nose').length).toBeGreaterThan(0);
    expect(find('end mill').every((t) => t.type === 'flat')).toBe(true);
    const combined = find('1/4 upcut 2 flute');
    expect(combined.length).toBeGreaterThan(0);
    expect(combined.every((t) => t.geometry.diameter === 6.35 && t.geometry.flutes === 2 && /upcut/i.test(t.description))).toBe(true);
    expect(find('52-280').map((t) => t.partNumber)).toContain('52-280');
    expect(find('52-280').every((t) => t.partNumber?.startsWith('52-280'))).toBe(true);
  });
  it('the search box says what it searches', () => {
    const props = { tools: ONSRUD_CATALOG, query: '', size: '', maker: '', type: '', entries: [], unit: 'mm' as const, setQuery: () => undefined, setSize: () => undefined, setMaker: () => undefined, setType: () => undefined, onPreview: () => undefined, onPick: () => undefined };
    expect(one(rootUntil(h(CatalogChoices, props), [CatalogTable]), (e) => e.tag === 'input').props['placeholder']).toBe('Search name, size, flutes or part');
  });
});

it('catalog rows preview by click, Enter or Space, but leave links and buttons alone', () => {
  const seen: string[] = [];
  const tree = root(h(CatalogRow, { tool: template, entries: [], unit: 'mm', onPick: () => seen.push('add'), onPreview: () => seen.push('preview') }));
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
