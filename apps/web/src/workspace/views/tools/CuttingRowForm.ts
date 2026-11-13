import { h, type ComponentChild } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import type { Tool, ToolCuttingData } from '@synthetos/library';
import { allMaterials } from '../../library.ts';
import { CUTTING_NUMBERS, cuttingDraft, cuttingUnit, readCuttingDraft, type CuttingNumber } from '../../tools/cuttingData.ts';
import type { ToolUnit } from '../../tools/units.ts';
const LABELS: Record<CuttingNumber, string> = { fz: 'Chipload', fzMax: 'Upper chipload (optional)', vc: 'Surface speed (optional)', ap: 'Cut depth (optional)', ae: 'Stepover (optional)' };
export function CuttingRowForm({ row, tool, unit, onApply, onCancel }: { readonly row: ToolCuttingData | null; readonly tool: Tool; readonly unit: ToolUnit; readonly onApply: (row: ToolCuttingData) => void; readonly onCancel: () => void }): ComponentChild {
  const [draft, setDraft] = useState(() => cuttingDraft(row, unit));
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => setDraft(d => cuttingUnit(d, unit)), [unit]);
  const result = readCuttingDraft(draft, tool);
  const touch = (key: string): void => setTouched(t => new Set([...t, key]));
  const error = (key: string): ComponentChild => !touched.has(key) || result.errors[key] === undefined ? null : h('small', { class: 'field-error', role: 'alert' }, result.errors[key]);
  const materials = allMaterials.value.map(m => m.material);
  return h('div', { class: 'cutting-row-form', 'data-cutting': 'form' },
    h('h3', null, row === null ? 'Add your cutting data' : 'Edit your cutting data'),
    h('p', { class: 'fine' }, 'Your own numbers. These are saved with the tool; they do not send commands to the machine.'),
    h('div', { class: 'field-grid' },
      h('label', { class: 'field' }, h('span', null, 'Material'), h('span', { class: 'select-wrap' }, h('select', { 'data-cutting-field': 'material', value: draft.row.materialRef.id, onChange: (e: Event) => {
        const m = materials.find(m => m.id === (e.currentTarget as HTMLSelectElement).value);
        if (m !== undefined) setDraft(d => ({ ...d, row: { ...d.row, materialRef: { id: m.id, version: m.version }, materialName: m.name } }));
        touch('material');
      } }, h('option', { value: '' }, 'Choose a material'),
        draft.row.materialRef.id !== '' && !materials.some(m => m.id === draft.row.materialRef.id) ? h('option', { value: draft.row.materialRef.id }, draft.row.materialName ?? draft.row.materialRef.id) : null,
        materials.map(m => h('option', { value: m.id, key: m.id }, m.name)))), error('material')),
      CUTTING_NUMBERS.map(k => h('label', { class: 'field', key: k }, h('span', null, `${LABELS[k]} (${k === 'vc' ? unit === 'in' ? 'SFM' : 'm/min' : k === 'fz' || k === 'fzMax' ? `${unit}/tooth` : unit})`),
        h('input', { type: 'text', inputMode: 'decimal', value: draft.raw[k], 'data-cutting-field': k, 'aria-invalid': touched.has(k) && result.errors[k] !== undefined ? 'true' : undefined, onInput: (e: Event) => { const raw = (e.currentTarget as HTMLInputElement).value; setDraft(d => ({ ...d, raw: { ...d.raw, [k]: raw }, invalid: d.invalid?.filter(field => field !== k) ?? [] })); touch(k); } }), error(k)))),
    h('label', { class: 'field' }, h('span', null, 'Notes'), h('textarea', { 'data-cutting-field': 'note', value: draft.row.note, maxLength: 500, onInput: (e: Event) => { const note = (e.currentTarget as HTMLTextAreaElement).value; setDraft(d => ({ ...d, row: { ...d.row, note } })); touch('note'); } }), error('note')),
    h('div', { class: 'cutting-row-actions' }, h('button', { type: 'button', 'data-action': 'cutting-row-cancel', onClick: onCancel }, 'Cancel row'), h('button', { type: 'button', class: 'primary', 'data-action': 'cutting-row-apply', disabled: result.row === null, onClick: () => { if (result.row !== null) onApply(result.row); } }, 'Use row')));
}
