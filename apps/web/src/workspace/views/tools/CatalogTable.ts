import { h, type ComponentChild } from 'preact';
import type { Tool } from '@synthetos/library';
import { safeExternalLink, type ToolEntry } from '../../library.ts';
import { type ToolUnit } from '../../tools/units.ts';
import { catalogDescription, catalogCutLength } from '../../tools/catalog.ts';
export function CatalogTable({ tools, entries, onPick, onPreview, unit }: { tools: readonly Tool[]; entries: readonly ToolEntry[]; onPick: (tool: Tool) => void; onPreview: (tool: Tool) => void; unit: ToolUnit }): ComponentChild {
  return h('div', { class: 'tool-table-wrap' }, h('table', { class: 'tool-table catalog-table' },
    h('thead', null, h('tr', null, ...['Part', 'Tool', 'Flutes', 'Cut length', 'Source', ''].map(label => h('th', { scope: 'col' }, label)))),
    h('tbody', null, tools.map(tool => {
      const existing = entries.find(e => e.tool.manufacturer === tool.manufacturer && e.tool.partNumber === tool.partNumber);
      const link = safeExternalLink(tool.purchase[0]?.url ?? '');
      return h('tr', { key: tool.id, 'data-catalog-part': tool.partNumber, 'data-action': 'catalog-preview', tabindex: 0, onClick: (e: MouseEvent) => { if (!(e.target as Element).closest('a, button')) { (e.currentTarget as HTMLElement).focus(); onPreview(tool); } }, onKeyDown: (e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPreview(tool); } } },
        h('td', { class: 'num' }, tool.partNumber), h('td', null, catalogDescription(tool, unit)),
        h('td', null, String(tool.geometry.flutes)), h('td', { class: 'num' }, catalogCutLength(tool.geometry.fluteLength, unit)),
        h('td', null, link === null ? '—' : h('a', { ...link }, 'Onsrud page')),
        h('td', null, existing === undefined ? h('button', { type: 'button', class: 'small', 'data-action': 'catalog-add', onClick: () => onPick(tool) }, 'Add to my tools') : h('span', { class: 'catalog-owned' }, `In your tools as T${existing.number}`)));
    }))));
}
