import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import type { Tool } from '@synthetos/library';
import { material, SOURCE_LABELS } from '../../library.ts';
import { AddLink, PurchaseLine } from '../PurchaseLinks.ts';
function Pager({ page, count, size, set }: { page: number; count: number; size: number; set: (n: number) => void }): ComponentChild {
  return count <= size ? null : h('div', { class: 'tool-pages' }, h('button', { type: 'button', disabled: page === 0, onClick: () => set(page - 1) }, 'Previous'), ` ${page + 1} of ${Math.ceil(count / size)} `, h('button', { type: 'button', disabled: (page + 1) * size >= count, onClick: () => set(page + 1) }, 'Next'));
}
export function ToolBuyTab({ tool, store, set }: { tool: Tool; store: string | null; set: (p: Partial<Tool>) => void }): ComponentChild {
  const [requested, setPage] = useState(0);
  const page = Math.min(requested, Math.max(0, Math.ceil(tool.purchase.length / 4) - 1));
  return h('div', null, store === null ? null : h('p', null, `Synthetos · ${store} · Store mock`),
    h('ul', { class: 'purchases' }, tool.purchase.slice(page * 4, page * 4 + 4).map((p, i) => h(PurchaseLine, { key: String(i), p, onRemove: () => set({ purchase: tool.purchase.filter((_, j) => j !== page * 4 + i) }) }))),
    h(Pager, { page, count: tool.purchase.length, size: 4, set: setPage }),
    h(AddLink, { onAdd: p => { if (tool.purchase.length >= 20) return 'Twenty links at most.'; set({ purchase: [...tool.purchase, p] }); setPage(Math.floor(tool.purchase.length / 4)); return null; } }));
}
export function ToolCuttingTab({ tool }: { tool: Tool }): ComponentChild {
  const [page, setPage] = useState(0);
  return h('div', null, tool.cuttingData.length === 0 ? h('p', null, 'No cutting data yet.') : h('table', { class: 'slot-table' },
    h('thead', null, h('tr', null, ...['Material', 'Surface speed (m/min)', 'Chipload (mm/tooth)', 'Source'].map(label => h('th', null, label)))),
    h('tbody', null, tool.cuttingData.slice(page * 6, page * 6 + 6).map((c, i) => h('tr', { key: String(i) }, h('td', null, material(c.materialRef.id)?.name ?? c.materialRef.id), h('td', null, String(c.vc)), h('td', null, String(c.fz)), h('td', null, SOURCE_LABELS[c.source] ?? c.source))))),
    h(Pager, { page, count: tool.cuttingData.length, size: 6, set: setPage }), h('p', { class: 'fine' }, 'Placeholder values: not yet sourced. They show the shape of the data, not machining advice.'));
}
