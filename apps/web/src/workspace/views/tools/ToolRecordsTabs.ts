import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { formatChipload, formatSurfaceSpeed, type ToolUnit } from '../../tools/units.ts';
import { toRpmFeed } from '../../tools/cuttingSpeed.ts';
import { formatLength } from '../../tools/units.ts';
import { CuttingRowForm } from './CuttingRowForm.ts';
import { isOwnCuttingRow, ownCuttingRow } from '../../tools/cuttingData.ts';
import type { Tool, ToolCuttingData } from '@synthetos/library';
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
export function ToolCuttingTab({ tool, unit, set, onEditing }: { tool: Tool; unit: ToolUnit; set?: (patch: Partial<Tool>) => void; onEditing?: (editing: boolean) => void }): ComponentChild {
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ index: number | null; row: ToolCuttingData | null } | null>(null);
  const edit = (index: number | null, row: ToolCuttingData | null): void => { setEditing({ index, row }); onEditing?.(true); };
  const close = (): void => { setEditing(null); onEditing?.(false); };
  if (editing !== null && set !== undefined) return h(CuttingRowForm, { tool, row: editing.row, unit, onCancel: close, onApply: row => {
    set({ cuttingData: editing.index === null ? [...tool.cuttingData, row] : tool.cuttingData.map((c, i) => i === editing.index ? row : c) });
    setPage(Math.floor((editing.index ?? tool.cuttingData.length) / 4)); close();
  } });
  const hasSpeed = tool.cuttingData.some(c => c.vc !== undefined);
  return h('div', null, tool.cuttingData.length === 0 ? h('p', null, 'No cutting data for this tool yet.') : h('table', { class: 'tool-table cutting-table' },
    h('thead', null, h('tr', null, ...['Material', ...(hasSpeed ? [unit === 'in' ? 'Surface speed (SFM, ft/min)' : 'Surface speed (m/min)'] : []), unit === 'in' ? 'Chipload (in/tooth)' : 'Chipload (mm/tooth)', 'Source', ...(set === undefined ? [] : ['Actions'])].map(label => h('th', null, label)))),
    h('tbody', null, tool.cuttingData.slice(page * 4, page * 4 + 4).map((c, i) => h('tr', { key: String(i) }, h('td', null, c.materialName ?? material(c.materialRef.id)?.name ?? c.materialRef.id), hasSpeed ? h('td', null, c.vc === undefined ? '—' : formatSurfaceSpeed(c.vc, unit)) : null, h('td', null, c.fzMax === undefined ? formatChipload(c.fz, unit) : `${formatChipload(c.fz, unit)} – ${formatChipload(c.fzMax, unit)}`), h('td', null, h(CuttingSource, { row: c, manufacturer: tool.manufacturer }), h(DerivedSpeed, { tool, row: c, unit }), c.note === '' ? null : h('small', { class: 'cutting-note' }, c.note)), set === undefined ? null : h('td', null, h('div', { class: 'cutting-row-actions' }, isOwnCuttingRow(c) ? [
      h('button', { type: 'button', class: 'small', 'data-action': 'cutting-row-edit', onClick: () => edit(page * 4 + i, c) }, 'Edit'),
      h('button', { type: 'button', class: 'small', 'data-action': 'cutting-row-remove', onClick: () => { const next = tool.cuttingData.filter((_, j) => j !== page * 4 + i); set({ cuttingData: next }); setPage(Math.min(page, Math.max(0, Math.ceil(next.length / 4) - 1))); } }, 'Remove'),
    ] : h('button', { type: 'button', class: 'small', 'data-action': 'cutting-row-copy', disabled: tool.cuttingData.length >= 100, onClick: () => edit(null, ownCuttingRow(c)) }, 'Copy to my own row'))))))),
    h('div', { class: 'cutting-table-footer' }, set === undefined ? null : h('button', { type: 'button', class: 'small', 'data-action': 'cutting-row-add', disabled: tool.cuttingData.length >= 100, onClick: () => edit(null, null) }, 'Add a row'),
    h(Pager, { page, count: tool.cuttingData.length, size: 4, set: setPage })), tool.manufacturer === 'Onsrud' && tool.cuttingData.some(c => c.source === 'manufacturer') ? h('p', { class: 'fine' }, 'Onsrud publishes chipload ranges at a cut depth of one tool diameter. It publishes no spindle speeds for these tools.') : null, tool.cuttingData.some(c => c.placeholder === true) ? h('p', { class: 'fine' }, 'Placeholder values: not yet sourced. They show the shape of the data, not machining advice.') : null);
}

export function CuttingSource({ row, manufacturer }: { row: Tool['cuttingData'][number]; manufacturer?: string | undefined }): ComponentChild {
  const link = row.sourceUrl === undefined ? null : safeExternalLink(row.sourceUrl);
  return link === null ? h('span', null, row.source === 'user' ? 'Your own numbers' : SOURCE_LABELS[row.source]) : h('span', null, row.source === 'user' ? 'Your own numbers · ' : null, h('a', { ...link, href: row.sourcePage === undefined ? link.href : `${link.href}#page=${row.sourcePage}` }, row.sourcePage === undefined ? 'Source' : `${manufacturer === 'Onsrud' ? 'Onsrud 2025' : manufacturer ?? 'Source'} catalog, p. ${row.sourcePage}`));
}

function DerivedSpeed({ tool, row, unit }: { tool: Tool; row: ToolCuttingData; unit: ToolUnit }): ComponentChild {
  const speed = toRpmFeed(tool, row.vc, row.fz);
  return speed === null ? null : h('small', { class: 'cutting-note' }, `Derived: ${Math.round(speed.rpm)} RPM · ${formatLength(speed.feed, unit)} ${unit}/min`);
}
