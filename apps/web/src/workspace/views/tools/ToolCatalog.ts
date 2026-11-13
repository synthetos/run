import { fetchToolCatalog } from '../../../cloud/catalog.ts';
import { readCatalog } from '../../tools/catalogResponse.ts';
import { h, type ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Tool } from '@synthetos/library';
import { toolStore, TOOL_KINDS, type ToolEntry } from '../../library.ts';
import { matchesCatalog } from '../../tools/catalog.ts';
import { toolUnits } from '../../tools/preferences.ts';
import { type ToolUnit } from '../../tools/units.ts';
import { ToolModal } from './ToolModal.ts';
import { CatalogTable } from './CatalogTable.ts';
export function ToolCatalog({ active }: { active: boolean }): ComponentChild {
  const [tools, setTools] = useState<readonly Tool[] | null>(null);
  const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); setFailed(false); setTools(null);
    void fetchToolCatalog(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const parsed = result.ok ? readCatalog(result.body) : null;
      setTools(parsed); setFailed(parsed === null);
    });
    return () => controller.abort();
  }, [active, attempt]);
  const [query, setQuery] = useState(''); const [size, setSize] = useState('');
  const [maker, setMaker] = useState(''); const [type, setType] = useState('');
  const [selected, setSelected] = useState<Tool | null>(null);
  const unit = toolUnits.value.value;
  return h('div', { class: 'catalog-view' },
    h('div', { class: 'view-head' }, h('div', { class: 'title-block' }, h('h1', null, 'Tool catalog'), h('p', { class: 'fine' }, 'Shared catalog, maintained by Synthetos')),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Catalog units' }, ...(['mm', 'in'] as const).map(u => h('button', { type: 'button', 'data-action': `catalog-units-${u}`, class: u === unit ? 'selected' : undefined, 'aria-pressed': u === unit, onClick: () => toolUnits.set(u) }, u)))),
    failed ? h('div', { class: 'catalog-message', role: 'status' }, h('p', null, 'The catalog could not load. Check your connection and try again.'), h('button', { type: 'button', onClick: () => setAttempt(n => n + 1) }, 'Retry')) : tools === null ? h('p', { class: 'catalog-message', role: 'status' }, 'Loading catalog…') : h(CatalogChoices, { tools, query, size, maker, type, setQuery, setSize, setMaker, setType, onPick: setSelected, unit, entries: toolStore.value.value }),
    selected === null ? null : h(ToolModal, { entry: null, catalog: selected, onClose: () => setSelected(null) }));
}
export function CatalogChoices({ tools, query, size, maker, type, setQuery, setSize, setMaker, setType, onPick, unit, entries }: {
  tools: readonly Tool[]; query: string; size: string; maker: string; type: string; setQuery: (s: string) => void; setSize: (s: string) => void; setMaker: (s: string) => void; setType: (s: string) => void;
  onPick: (tool: Tool) => void; unit: ToolUnit; entries: readonly ToolEntry[];
}): ComponentChild {
  const matches = tools.filter(t => matchesCatalog(t, query, size, maker, type));
  return h('div', { class: 'list-panel' },
    h('div', { class: 'catalog-filters' },
      h('input', { type: 'search', 'aria-label': 'Search catalog', placeholder: 'Search by part number or name', value: query, onInput: (e: Event) => setQuery((e.currentTarget as HTMLInputElement).value) }),
      h('label', null, 'Maker', h('div', { class: 'select-wrap' }, h('select', { 'aria-label': 'Maker', value: maker, onChange: (e: Event) => setMaker((e.currentTarget as HTMLSelectElement).value) }, h('option', { value: '' }, 'All makers'), h('option', { value: 'Onsrud' }, 'Onsrud')))),
      h('div', { class: 'catalog-sizes', role: 'group', 'aria-label': 'Catalog size' }, ...[['', 'All sizes'], ['3.175', '1/8"'], ['6.35', '1/4"']].map(([value, label]) => h('button', { type: 'button', class: `chip${size === value ? ' selected' : ''}`, 'aria-pressed': size === value, onClick: () => setSize(value!) }, label))),
      h('label', null, 'Type', h('div', { class: 'select-wrap' }, h('select', { 'aria-label': 'Type', value: type, onChange: (e: Event) => setType((e.currentTarget as HTMLSelectElement).value) }, h('option', { value: '' }, 'All types'), ...(['flat', 'ball', 'o-flute'] as const).map(t => h('option', { value: t }, TOOL_KINDS[t])))))),
    matches.length === 0 ? h('p', null, 'No matching tools.') : h(CatalogTable, { tools: matches, entries, onPick, unit }));
}
