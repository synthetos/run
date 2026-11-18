/**
 * Step 5 (spec §6.3): two cards. Tools: the chosen tool, "Add from catalog" (the existing catalog picker, in place)
 * and "Create a tool" (the existing tool editor, on top). Stock: width, depth and thickness, saved to the setup
 * record by "Add stock". The state lives in module signals the mount owns; the view is pure.
 */
import { signal } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import type { Stock } from '@synthetos/library';
import type { ToolEntry } from '../../workspace/library.ts';
import { toolDisplayName } from '../../workspace/tools/displayName.ts';
import { ToolCatalog } from '../../workspace/views/tools/ToolCatalog.ts';
import { ToolModal } from '../../workspace/views/tools/ToolModal.ts';
import { stockFromFields, type StockFields } from '../stockFields.ts';

export const TOOLS_TITLE = 'Tools and stock';
export const TOOLS_LEAD = 'One of each is enough to run the demo.';
export const TOOLS_TEXT = 'One to start with. The catalog knows the Synthetos and common end mills; a new tool asks for diameter, flutes and length.';
export const STOCK_TEXT = 'The piece on the bed for the first job. The demo is cut from this size.';

export const stockFields = signal<StockFields | null>(null);
export const catalogOpen = signal(false);
export const creatingTool = signal(false);
/** The tool list when the step opened; the tool added since is the chosen one (stockFields.ts newToolSince). */
export const toolsBefore = signal<readonly ToolEntry[] | null>(null);

export interface ToolsStockProps {
  readonly tool: ToolEntry | null;
  readonly stock: Stock | null;
  readonly fields: StockFields;
  readonly onFields: (f: StockFields) => void;
  readonly onAddStock: () => void;
  readonly onCatalog: () => void;
  readonly onCreate: () => void;
  readonly catalogOpen: boolean;
  readonly creating: boolean;
  readonly onCloseModal: () => void;
}

function field(label: string, key: keyof StockFields, p: ToolsStockProps): ComponentChild {
  return h('label', { class: 'field f-num' }, h('span', null, label), h('span', { class: 'unit-input' }, h('input', { type: 'number', min: 0.1, step: 'any', value: p.fields[key], onInput: (e: Event) => p.onFields({ ...p.fields, [key]: (e.currentTarget as HTMLInputElement).value }) }), h('i', null, 'mm')));
}

function toolCard(p: ToolsStockProps): ComponentChild {
  if (p.catalogOpen) return h('div', { class: 'wizard-card' }, h('div', { class: 'wizard-actions' }, h('button', { type: 'button', class: 'small quiet', 'data-action': 'wizard-catalog-back', onClick: p.onCloseModal }, 'Back')), h('div', { class: 'wizard-embed' }, h(ToolCatalog, { active: true })));
  return h(
    'div',
    { class: 'wizard-card' },
    h('h3', null, 'Tools'),
    h('p', null, TOOLS_TEXT),
    p.tool === null ? null : h('p', { 'data-wizard': 'tool' }, h('strong', null, `T${p.tool.number} · ${toolDisplayName(p.tool.tool)}`)),
    h('div', { class: 'wizard-actions' }, h('button', { type: 'button', class: 'small primary', 'data-action': 'wizard-catalog', onClick: p.onCatalog }, 'Add from catalog'), h('button', { type: 'button', class: 'small', 'data-action': 'wizard-create-tool', onClick: p.onCreate }, 'Create a tool')),
  );
}

function stockCard(p: ToolsStockProps): ComponentChild {
  const valid = stockFromFields(p.fields) !== null;
  const saved = p.stock !== null && stockFromFields(p.fields) !== null && JSON.stringify(stockFromFields(p.fields)) === JSON.stringify(p.stock);
  return h(
    'div',
    { class: 'wizard-card' },
    h('h3', null, 'Stock'),
    h('p', null, STOCK_TEXT),
    h('div', { class: 'field-row' }, field('Width', 'width', p), field('Depth', 'depth', p)),
    h('div', { class: 'field-row' }, field('Thickness', 'thickness', p)),
    h('div', { class: 'wizard-actions' }, h('button', { type: 'button', class: 'small primary', 'data-action': 'wizard-add-stock', disabled: !valid || saved, onClick: p.onAddStock }, saved ? 'Stock saved' : 'Add stock')),
  );
}

export function ToolsStock(p: ToolsStockProps): ComponentChild {
  return h(
    'div',
    { class: 'wizard-tools-stock' },
    h('div', { class: 'wizard-cards' }, toolCard(p), stockCard(p)),
    p.creating ? h(ToolModal, { entry: null, onClose: p.onCloseModal }) : null,
  );
}
