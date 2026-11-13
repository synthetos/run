import { useDialogDismiss } from '../../dialogs/useDialogDismiss.ts';
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
export function ToolModal({ entry, onClose, catalog, preview, focusTarget }: { readonly focusTarget?: HTMLElement | null; readonly preview?: { readonly tool: Tool; readonly existing?: ToolEntry; readonly onAdd: () => void; readonly onOpen: (entry: ToolEntry) => void }; readonly catalog?: Tool; readonly entry: ToolEntry | null; readonly onClose: () => void }): ComponentChild {
  const [number, setNumber] = useState(() => entry?.number ?? freeToolNumber(toolStore.value.value));
  const [tool, setTool] = useState<Tool>(() => preview?.tool ?? (entry === null ? (catalog === undefined ? newTool(number) : catalogDraft(catalog, toolStore.value.value).tool) : { ...entry.tool, name: customToolName(entry.tool.name) }));
  const [tab, setTab] = useState<Tab>('shape');
  const [error, setError] = useState<string | null>(null);
  const invalid = useRef(new Set<string>());
  const initial = useRef({ tool: JSON.stringify(tool), number });
  const [touched, setTouched] = useState(false);
  const readOnly = preview !== undefined;
  const dirty = !readOnly && (touched || number !== initial.current.number || JSON.stringify(tool) !== initial.current.tool);
  const dismiss = useDialogDismiss(onClose, dirty, focusTarget);
  const root = dismiss.ref;
  const unit = toolUnits.value.value;
  const issue = toolNumberIssue(toolStore.value.value, tool.id, number);
  const set = (patch: Readonly<Record<string, unknown>>): void => { if (!readOnly) setTool(t => ({ ...t, ...patch })); };
  const validity = (field: string, valid: boolean): void => { if (valid) invalid.current.delete(field); else invalid.current.add(field); };
  useLayoutEffect(() => {
    root.current?.querySelector<HTMLElement>(readOnly ? '#tool-tab-shape' : '[data-tool-field="number"]')?.focus();
  }, []);
  const save = (): void => {
    if (invalid.current.size > 0) { setError('Check the highlighted fields.'); setTab('shape'); return; }
    const result = saveToolDraft(entry, tool, number); setError(result);
    if (result === null) onClose();
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const items = [...root.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]') ?? []].filter(el => el.getClientRects().length > 0 && !el.matches(':disabled'));
    const first = items[0]; const last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  return h('div', { class: 'dialog-wrap tool-modal-wrap', onKeyDown: key, ref: root, onInput: () => { if (!readOnly) setTouched(true); } }, h('div', { class: 'dialog tool-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tool-modal-title', 'aria-label': 'Selected tool', 'data-tool': tool.id },
    h('header', { class: 'dialog-head' }, h('h2', { id: 'tool-modal-title' }, preview === undefined ? (entry === null ? 'Add a tool' : `Edit T${number} · ${toolDisplayName(tool)}`) : `${tool.manufacturer ?? ''} ${tool.partNumber ?? ''} · ${catalogDescription(tool, unit)}`), h('div', { class: 'seg', role: 'group', 'aria-label': 'Length units' }, ...(['mm', 'in'] as const).map(u => h('button', { type: 'button', 'data-action': `tool-units-${u}`, class: u === unit ? 'selected' : undefined, 'aria-pressed': u === unit ? 'true' : 'false', onClick: () => toolUnits.set(u) }, u)))),
    catalog === undefined ? null : h('p', { class: 'catalog-banner' }, `From the Onsrud catalog: ${catalog.partNumber}, ${catalogDescription(catalog, unit)}. It becomes T${number}. Change anything before you add it.`),
    h(TabBar<Tab>, { label: 'Tool', prefix: 'tool', variant: 'underline', current: tab, onSelect: setTab, tabs: [ { id: 'shape', label: 'Shape' }, { id: 'details', label: 'Details' }, { id: 'buy', label: 'Where to buy' }, { id: 'cutting', label: 'Cutting data' }] }),
    h(TabPane, { prefix: 'tool', id: 'shape', current: tab, class: 'tool-modal-pane' }, h(ToolShapeTab, { tool, readOnly, number, numberIssue: issue, onNumber: setNumber, set, unit, onValidity: validity })),
    h(TabPane, { prefix: 'tool', id: 'details', current: tab, class: 'tool-modal-pane' }, h(ToolDetailsTab, { tool, set, readOnly, editing: entry !== null && !readOnly })),
    h(TabPane, { prefix: 'tool', id: 'buy', current: tab, class: 'tool-modal-pane' }, h(ToolBuyTab, { tool, readOnly, store: entry?.store ?? null, set })),
    h(TabPane, { prefix: 'tool', id: 'cutting', current: tab, class: 'tool-modal-pane' }, h(ToolCuttingTab, { key: tool.id, tool, unit })),
    error === null ? null : h('p', { class: 'field-error', role: 'alert' }, error),
    h('footer', { class: 'dialog-actions' },
      dismiss.asking ? h('div', { class: 'dialog-discard', role: 'status' }, 'Discard your changes?',
        h('button', { type: 'button', 'data-action': 'dialog-keep-editing', onClick: dismiss.keepEditing }, 'Keep editing'),
        h('button', { type: 'button', 'data-action': 'dialog-discard', onClick: dismiss.discard }, 'Discard')) : null,
      catalog === undefined ? null : h('button', { type: 'button', 'data-action': 'catalog-back', onClick: onClose }, 'Back to catalog'),
      entry === null || readOnly ? null : h(ToolDelete, { id: entry.tool.id, label: `T${entry.number} · ${toolDisplayName(entry.tool)}`, onDeleted: onClose }),
      h('button', { type: 'button', 'data-action': 'cancel-tool', onClick: onClose }, 'Cancel'),
      preview === undefined ? h('button', { type: 'button', class: 'primary', 'data-action': 'save-tool', onClick: save }, entry === null ? 'Add tool' : 'Save')
        : preview.existing === undefined ? h('button', { type: 'button', class: 'primary', 'data-action': 'catalog-add', onClick: preview.onAdd }, 'Add to my tools')
          : h('div', { class: 'dialog-discard' }, h('span', { class: 'catalog-owned' }, `In your tools as T${preview.existing.number}`), h('button', { type: 'button', 'data-action': 'catalog-open-tool', onClick: () => preview.onOpen(preview.existing!) }, `Open T${preview.existing.number}`))),
  ));
}
