import { h, Fragment, type ComponentChild } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Tool } from '@synthetos/library';
import { safeExternalLink, type ToolEntry } from '../../library.ts';
import { type ToolUnit } from '../../tools/units.ts';
import { catalogDescription, catalogCutLength } from '../../tools/catalog.ts';
import { catalogMaterialNote } from '../../tools/catalogText.ts';
import { Pager, pageOf, usePageSize } from '../../paging.ts';

type Props = { tools: readonly Tool[]; entries: readonly ToolEntry[]; onPick: (tool: Tool) => void; onPreview: (tool: Tool) => void; unit: ToolUnit };
/** Row height before the first row has been measured. */
const FIRST_ROW_PX = 37;

export function CatalogRow({ tool, entries, onPick, onPreview, unit }: Omit<Props, 'tools'> & { tool: Tool }): ComponentChild {
  const existing = entries.find(e => e.tool.manufacturer === tool.manufacturer && e.tool.partNumber === tool.partNumber);
  const link = safeExternalLink(tool.purchase[0]?.url ?? '');
  return h('tr', { 'data-catalog-part': tool.partNumber, 'data-action': 'catalog-preview', tabindex: 0, onClick: (e: MouseEvent) => { if (!(e.target as Element).closest('a, button')) { (e.currentTarget as HTMLElement).focus(); onPreview(tool); } }, onKeyDown: (e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPreview(tool); } } },
    h('td', { class: 'num' }, tool.partNumber), h('td', null, catalogDescription(tool, unit)), h('td', { class: 'for-cell' }, catalogMaterialNote(tool)),
    h('td', null, String(tool.geometry.flutes)), h('td', { class: 'num' }, catalogCutLength(tool.geometry.fluteLength, unit)),
    h('td', null, link === null ? '—' : h('a', { ...link }, 'Onsrud page')),
    h('td', null, existing === undefined ? h('button', { type: 'button', class: 'small', 'data-action': 'catalog-add', onClick: () => onPick(tool) }, 'Add to my tools') : h('span', { class: 'catalog-owned' }, `In your tools as T${existing.number}`)));
}

/** One page of the catalog, sized to the room there is, with the count and Back / Next under it. */
export function CatalogTable({ tools, entries, onPick, onPreview, unit }: Props): ComponentChild {
  const box = useRef<HTMLDivElement | null>(null);
  const [rowPx, setRowPx] = useState(FIRST_ROW_PX);
  const [page, setPage] = useState(0);
  const fit = usePageSize(box, rowPx);
  const size = Number.isFinite(fit) ? Math.max(1, fit - 1) : fit; // the heading row takes one line
  const shown = pageOf(tools, page, size);
  const signature = `${tools.length}:${tools[0]?.id ?? ''}:${tools.at(-1)?.id ?? ''}`;
  useEffect(() => { setPage(0); }, [signature]);
  useLayoutEffect(() => {
    const px = box.current?.querySelector('tbody tr')?.getBoundingClientRect().height ?? 0;
    if (px > 0 && Math.abs(px - rowPx) > 0.5) setRowPx(px);
  });
  return h(Fragment, null,
    h('div', { class: 'tool-table-wrap', ref: box }, h('table', { class: 'tool-table catalog-table' },
      h('thead', null, h('tr', null, ...['Part', 'Tool', 'For', 'Flutes', 'Cut length', 'Source', ''].map(label => h('th', { scope: 'col' }, label)))),
      h('tbody', null, shown.items.map(tool => h(CatalogRow, { key: tool.id, tool, entries, onPick, onPreview, unit }))))),
    h('div', { class: 'catalog-foot' }, h('span', { class: 'fine', 'data-catalog-count': String(tools.length) }, `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}`), h(Pager, { name: 'catalog', page: shown.page, pages: shown.pages, onPage: setPage })));
}
