import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { formatChipload, formatSurfaceSpeed, type ToolUnit } from '../../tools/units.ts';
import type { Tool } from '@synthetos/library';
import { material, SOURCE_LABELS, safeExternalLink } from '../../library.ts';
import { AddLink, PurchaseLine } from '../PurchaseLinks.ts';
function Pager({ page, count, size, set }: { page: number; count: number; size: number; set: (n: number) => void }): ComponentChild {
  return count <= size ? null : h('div', { class: 'tool-pages' }, h('button', { type: 'button', disabled: page === 0, onClick: () => set(page - 1) }, 'Previous'), ` ${page + 1} of ${Math.ceil(count / size)} `, h('button', { type: 'button', disabled: (page + 1) * size >= count, onClick: () => set(page + 1) }, 'Next'));
}
export function ToolBuyTab({ tool, store, set, readOnly = false }: { readOnly?: boolean; tool: Tool; store: string | null; set: (p: Partial<Tool>) => void }): ComponentChild {
  const [requested, setPage] = useState(0);
  const page = Math.min(requested, Math.max(0, Math.ceil(tool.purchase.length / 4) - 1));
  return h('div', null, store === null ? null : h('p', null, `Synthetos · ${store} · Store mock`),
    h('ul', { class: 'purchases' }, tool.purchase.slice(page * 4, page * 4 + 4).map((p, i) => h(PurchaseLine, { key: String(i), p, ...(readOnly ? {} : { onRemove: () => set({ purchase: tool.purchase.filter((_, j) => j !== page * 4 + i) }) }) }))),
    h(Pager, { page, count: tool.purchase.length, size: 4, set: setPage }),
    readOnly ? null : h(AddLink, { onAdd: p => { if (tool.purchase.length >= 20) return 'Twenty links at most.'; set({ purchase: [...tool.purchase, p] }); setPage(Math.floor(tool.purchase.length / 4)); return null; } }));
}
export function ToolCuttingTab({ tool, unit }: { tool: Tool; unit: ToolUnit }): ComponentChild {
  const [page, setPage] = useState(0);
  const hasSpeed = tool.cuttingData.some(c => c.vc !== undefined);
  return h('div', null, tool.cuttingData.length === 0 ? h('p', null, 'No cutting data for this tool yet.') : h('table', { class: 'slot-table' },
    h('thead', null, h('tr', null, ...['Material', ...(hasSpeed ? [unit === 'in' ? 'Surface speed (SFM, ft/min)' : 'Surface speed (m/min)'] : []), unit === 'in' ? 'Chipload (in/tooth)' : 'Chipload (mm/tooth)', 'Source'].map(label => h('th', null, label)))),
    h('tbody', null, tool.cuttingData.slice(page * 4, page * 4 + 4).map((c, i) => h('tr', { key: String(i) }, h('td', null, c.materialName ?? material(c.materialRef.id)?.name ?? c.materialRef.id), hasSpeed ? h('td', null, c.vc === undefined ? '—' : formatSurfaceSpeed(c.vc, unit)) : null, h('td', null, c.fzMax === undefined ? formatChipload(c.fz, unit) : `${formatChipload(c.fz, unit)} – ${formatChipload(c.fzMax, unit)}`), h('td', null, h(CuttingSource, { row: c, manufacturer: tool.manufacturer }), c.note === '' ? null : h('small', { class: 'cutting-note' }, c.note)))))),
    h(Pager, { page, count: tool.cuttingData.length, size: 4, set: setPage }), tool.manufacturer === 'Onsrud' && tool.cuttingData.some(c => c.source === 'manufacturer') ? h('p', { class: 'fine' }, 'Onsrud publishes chipload ranges at a cut depth of one tool diameter. It publishes no spindle speeds for these tools.') : null, tool.cuttingData.some(c => c.placeholder === true) ? h('p', { class: 'fine' }, 'Placeholder values: not yet sourced. They show the shape of the data, not machining advice.') : null);
}

export function CuttingSource({ row, manufacturer }: { row: Tool['cuttingData'][number]; manufacturer?: string | undefined }): ComponentChild {
  const link = row.sourceUrl === undefined ? null : safeExternalLink(row.sourceUrl);
  return link === null ? h('span', null, SOURCE_LABELS[row.source]) : h('a', { ...link, href: row.sourcePage === undefined ? link.href : `${link.href}#page=${row.sourcePage}` }, row.sourcePage === undefined ? 'Source' : `${manufacturer === 'Onsrud' ? 'Onsrud 2025' : manufacturer ?? 'Source'} catalog, p. ${row.sourcePage}`);
}
