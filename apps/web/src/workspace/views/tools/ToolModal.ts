import { catalogDraft, catalogDescription } from '../../tools/catalog.ts';
import { h, type ComponentChild } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { type ToolEntry, type Tool, newTool, toolStore } from '../../library.ts';
import { freeToolNumber } from '../../tools/freeNumber.ts';
import { customToolName, toolDisplayName } from '../../tools/displayName.ts';
import { saveToolDraft } from '../../tools/saveTool.ts';
import { toolNumberIssue } from '../../toolNumbers.ts';
import { toolUnits } from '../../tools/preferences.ts';
import { TabBar, TabPane } from '../../ui.ts';
import { ToolDelete } from '../ToolDelete.ts';
import { ToolBuyTab, ToolCuttingTab } from './ToolRecordsTabs.ts';
import { ToolShapeTab } from './ToolShapeTab.ts';
import { ToolDetailsTab } from './ToolDetailsTab.ts';

type Tab = 'shape' | 'details' | 'buy' | 'cutting';
export function ToolModal({ entry, onClose, catalog }: { readonly catalog?: Tool; readonly entry: ToolEntry | null; readonly onClose: () => void }): ComponentChild {
  const [number, setNumber] = useState(() => entry?.number ?? freeToolNumber(toolStore.value.value));
  const [tool, setTool] = useState<Tool>(() => entry === null ? (catalog === undefined ? newTool(number) : catalogDraft(catalog, toolStore.value.value).tool) : { ...entry.tool, name: customToolName(entry.tool.name) });
  const [tab, setTab] = useState<Tab>('shape');
  const [error, setError] = useState<string | null>(null);
  const invalid = useRef(new Set<string>());
  const root = useRef<HTMLDivElement>(null);
  const unit = toolUnits.value.value;
  const issue = toolNumberIssue(toolStore.value.value, tool.id, number);
  const set = (patch: Readonly<Record<string, unknown>>): void => setTool(t => ({ ...t, ...patch }));
  const validity = (field: string, valid: boolean): void => { if (valid) invalid.current.delete(field); else invalid.current.add(field); };
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLInputElement>('[data-tool-field="number"]')?.focus();
    // Restore after the DOM commit: deleting a tool also removes its opener row.
    return () => queueMicrotask(() => { if (opener?.isConnected) opener.focus(); else document.querySelector<HTMLElement>('[data-action="add-tool"]')?.focus(); });
  }, []);
  const save = (): void => {
    if (invalid.current.size > 0) { setError('Check the highlighted fields.'); setTab('shape'); return; }
    const result = saveToolDraft(entry, tool, number); setError(result);
    if (result === null) onClose();
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...root.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]') ?? []].filter(el => el.getClientRects().length > 0 && !el.hasAttribute('disabled'));
    const first = items[0]; const last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  return h('div', { class: 'dialog-wrap tool-modal-wrap', onKeyDown: key }, h('div', { class: 'dialog tool-modal', ref: root, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tool-modal-title', 'aria-label': 'Selected tool', 'data-tool': tool.id },
    h('header', { class: 'dialog-head' }, h('h2', { id: 'tool-modal-title' }, entry === null ? 'Add a tool' : `Edit T${number} · ${toolDisplayName(tool)}`), h('div', { class: 'seg', role: 'group', 'aria-label': 'Length units' }, ...(['mm', 'in'] as const).map(u => h('button', { type: 'button', class: u === unit ? 'selected' : undefined, 'aria-pressed': u === unit ? 'true' : 'false', onClick: () => toolUnits.set(u) }, u)))),
    catalog === undefined ? null : h('p', { class: 'catalog-banner' }, `From the Onsrud catalog: ${catalog.partNumber}, ${catalogDescription(catalog, unit)}. It becomes T${number}. Change anything before you add it.`),
    h(TabBar<Tab>, { label: 'Tool', prefix: 'tool', variant: 'underline', current: tab, onSelect: setTab, tabs: [ { id: 'shape', label: 'Shape' }, { id: 'details', label: 'Details' }, { id: 'buy', label: 'Where to buy' }, { id: 'cutting', label: 'Cutting data' }] }),
    h(TabPane, { prefix: 'tool', id: 'shape', current: tab, class: 'tool-modal-pane' }, h(ToolShapeTab, { tool, number, numberIssue: issue, onNumber: setNumber, set, unit, onValidity: validity })),
    h(TabPane, { prefix: 'tool', id: 'details', current: tab, class: 'tool-modal-pane' }, h(ToolDetailsTab, { tool, set, editing: entry !== null })),
    h(TabPane, { prefix: 'tool', id: 'buy', current: tab, class: 'tool-modal-pane' }, h(ToolBuyTab, { tool, store: entry?.store ?? null, set })),
    h(TabPane, { prefix: 'tool', id: 'cutting', current: tab, class: 'tool-modal-pane' }, h(ToolCuttingTab, { key: tool.id, tool, unit })),
    error === null ? null : h('p', { class: 'field-error', role: 'alert' }, error),
    h('footer', { class: 'dialog-actions' }, catalog === undefined ? null : h('button', { type: 'button', onClick: onClose }, 'Back to catalog'), entry === null ? null : h(ToolDelete, { id: entry.tool.id, label: `T${entry.number} · ${toolDisplayName(entry.tool)}`, onDeleted: onClose }), h('button', { type: 'button', 'data-action': 'cancel-tool', onClick: onClose }, 'Cancel'), h('button', { type: 'button', class: 'primary', 'data-action': 'save-tool', onClick: save }, entry === null ? 'Add tool' : 'Save')),
  ));
}
