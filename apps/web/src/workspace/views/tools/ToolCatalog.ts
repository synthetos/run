import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { ONSRUD_CATALOG, type Tool } from '@synthetos/library';
import { toolStore, TOOL_KINDS, type ToolEntry } from '../../library.ts';
import { matchesCatalog } from '../../tools/catalog.ts';
import { toolUnits } from '../../tools/preferences.ts';
import { type ToolUnit } from '../../tools/units.ts';
import { ToolModal } from './ToolModal.ts';
import { CatalogTable } from './CatalogTable.ts';
export function ToolCatalog(): ComponentChild {
  const [query, setQuery] = useState(''); const [size, setSize] = useState('');
  const [maker, setMaker] = useState(''); const [type, setType] = useState('');
  const [selected, setSelected] = useState<Tool | null>(null);
  const unit = toolUnits.value.value;
  return h('div', { class: 'catalog-view' },
    h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, 'Tool catalog'), h('p', { class: 'fine' }, 'Shared catalog, maintained by Synthetos')),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Catalog units' }, ...(['mm', 'in'] as const).map(u => h('button', { type: 'button', class: u === unit ? 'selected' : undefined, 'aria-pressed': u === unit, onClick: () => toolUnits.set(u) }, u)))),
    h(CatalogChoices, { query, size, maker, type, setQuery, setSize, setMaker, setType, onPick: setSelected, unit, entries: toolStore.value.value }),
    selected === null ? null : h(ToolModal, { entry: null, catalog: selected, onClose: () => setSelected(null) }));
}
export function CatalogChoices({ query, size, maker, type, setQuery, setSize, setMaker, setType, onPick, unit, entries }: {
  query: string; size: string; maker: string; type: string; setQuery: (s: string) => void; setSize: (s: string) => void; setMaker: (s: string) => void; setType: (s: string) => void;
  onPick: (tool: Tool) => void; unit: ToolUnit; entries: readonly ToolEntry[];
}): ComponentChild {
  const tools = ONSRUD_CATALOG.filter(t => matchesCatalog(t, query, size, maker, type));
  return h('div', { class: 'list-panel' },
    h('div', { class: 'catalog-filters' },
      h('input', { type: 'search', 'aria-label': 'Search catalog', placeholder: 'Search by part number or name', value: query, onInput: (e: Event) => setQuery((e.currentTarget as HTMLInputElement).value) }),
      h('label', null, 'Maker', h('div', { class: 'select-wrap' }, h('select', { 'aria-label': 'Maker', value: maker, onChange: (e: Event) => setMaker((e.currentTarget as HTMLSelectElement).value) }, h('option', { value: '' }, 'All makers'), h('option', { value: 'Onsrud' }, 'Onsrud')))),
      h('div', { class: 'catalog-sizes', role: 'group', 'aria-label': 'Catalog size' }, ...[['', 'All sizes'], ['3.175', '1/8"'], ['6.35', '1/4"']].map(([value, label]) => h('button', { type: 'button', class: `chip${size === value ? ' selected' : ''}`, 'aria-pressed': size === value, onClick: () => setSize(value!) }, label))),
      h('label', null, 'Type', h('div', { class: 'select-wrap' }, h('select', { 'aria-label': 'Type', value: type, onChange: (e: Event) => setType((e.currentTarget as HTMLSelectElement).value) }, h('option', { value: '' }, 'All types'), ...(['flat', 'ball', 'o-flute'] as const).map(t => h('option', { value: t }, TOOL_KINDS[t])))))),
    tools.length === 0 ? h('p', null, 'No matching tools.') : h(CatalogTable, { tools, entries, onPick, unit }));
}
