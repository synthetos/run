import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { ONSRUD_CATALOG, type Tool } from '@synthetos/library';
import { matchesCatalog } from '../../tools/catalog.ts';
import { formatLength, type ToolUnit } from '../../tools/units.ts';
export function ToolCatalog({ onPick, unit }: { onPick: (tool: Tool) => void; unit: ToolUnit }): ComponentChild {
  const [query, setQuery] = useState('');
  const [size, setSize] = useState('');
  return h(CatalogChoices, { query, size, setQuery, setSize, onPick, unit });
}
export function CatalogChoices({ query, size, setQuery, setSize, onPick, unit }: { query: string; size: string; setQuery: (s: string) => void; setSize: (s: string) => void; onPick: (tool: Tool) => void; unit: ToolUnit }): ComponentChild {
  const tools = ONSRUD_CATALOG.filter(t => matchesCatalog(t, query, size));
  return h('div', { class: 'tool-catalog' },
    h('p', { class: 'fine' }, 'Choose a template. It stays a draft until you add the tool.'),
    h('input', { type: 'search', 'aria-label': 'Search catalog', placeholder: 'Maker, part number or type', value: query, onInput: (e: Event) => setQuery((e.currentTarget as HTMLInputElement).value) }),
    h('div', { class: 'select-wrap' }, h('select', { 'aria-label': 'Catalog size', value: size, onChange: (e: Event) => setSize((e.currentTarget as HTMLSelectElement).value) }, h('option', { value: '' }, 'All sizes'), h('option', { value: '3.175' }, '1/8 in'), h('option', { value: '6.35' }, '1/4 in'))),
    tools.length === 0 ? h('p', null, 'No matching tools.') : h('ul', { class: 'catalog-results' }, tools.map(t => h('li', { key: t.id }, h('button', { type: 'button', onClick: () => onPick(t) }, h('strong', null, `Onsrud ${t.partNumber}`), h('span', null, `${formatLength(t.geometry.diameter, unit)} ${unit} · ${t.description}`))))));
}
