import { h, type ComponentChild } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import type { Tool, ToolCuttingData } from '@synthetos/library';
import { allMaterials } from '../../library.ts';
import { CUTTING_NUMBERS, cuttingDraft, cuttingUnit, readCuttingDraft, type CuttingNumber } from '../../tools/cuttingData.ts';
import { parseLength, type ToolUnit } from '../../tools/units.ts';
import { canConvertSpeed, fromRpmFeed, toRpmFeed } from '../../tools/cuttingSpeed.ts';
const LABELS: Record<CuttingNumber, string> = { fz: 'Chipload', fzMax: 'Upper chipload (optional)', vc: 'Surface speed (optional)', ap: 'Cut depth (optional)', ae: 'Stepover (optional)' };
export function CuttingRowForm({ row, tool, unit, onApply, onCancel }: { readonly row: ToolCuttingData | null; readonly tool: Tool; readonly unit: ToolUnit; readonly onApply: (row: ToolCuttingData) => void; readonly onCancel: () => void }): ComponentChild {
  const [draft, setDraft] = useState(() => cuttingDraft(row, unit));
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => setDraft(d => cuttingUnit(d, unit)), [unit]);
  const [rpmMode, setSpeedMode] = useState(false);
  const speedMode = rpmMode && canConvertSpeed(tool);
  const [speed, setSpeed] = useState({ rpm: '', feed: '', unit, feedInvalid: false });
  useLayoutEffect(() => setSpeed(s => {
    const mm = parseLength(s.feed, s.unit);
    return s.unit === unit ? s : { ...s, unit, feedInvalid: s.feedInvalid || mm === null, feed: mm === null ? s.feed : String(mm / (unit === 'in' ? 25.4 : 1)) };
  }), [unit]);
  const rpm = parseLength(speed.rpm, 'mm');
  const feed = speed.feedInvalid ? null : parseLength(speed.feed, speed.unit);
  const converted = rpm === null || feed === null ? null : fromRpmFeed(tool, rpm, feed);
  const active = speedMode && converted !== null ? { ...draft, raw: { ...draft.raw, vc: String(converted.vc / (draft.unit === 'in' ? 0.3048 : 1)), fz: String(converted.fz / (draft.unit === 'in' ? 25.4 : 1)) }, invalid: draft.invalid?.filter(k => k !== 'vc' && k !== 'fz') ?? [] } : draft;
  const checked = readCuttingDraft(active, tool);
  const speedErrors: Record<string, string> = {};
  if (speedMode) {
    if (rpm === null || !Number.isInteger(rpm) || rpm <= 0) speedErrors['rpm'] = 'Enter a positive whole number for RPM.';
    if (feed === null || feed <= 0) speedErrors['feed'] = 'Enter a positive, finite feed rate.';
    if (converted === null && Object.keys(speedErrors).length === 0) speedErrors['feed'] = 'These values cannot be converted. Check the speed and feed.';
  }
  const result = { row: Object.keys(speedErrors).length === 0 ? checked.row : null, errors: { ...checked.errors, ...speedErrors } };
  const changeMode = (next: boolean): void => {
    if (next === speedMode) return;
    if (next) {
      const row = readCuttingDraft(draft, tool).row;
      const derived = row === null ? null : toRpmFeed(tool, row.vc, row.fz);
      const rpm = derived === null ? '' : String(Math.round(derived.rpm));
      setSpeed({ rpm, feed: derived === null ? '' : String(derived.feed / (unit === 'in' ? 25.4 : 1)), unit, feedInvalid: false });
    } else if (converted !== null) setDraft(active);
    setSpeedMode(next);
  };
  const touch = (key: string): void => setTouched(t => new Set([...t, key]));
  const error = (key: string): ComponentChild => (!touched.has(key) && !(speedMode && (key === 'vc' || key === 'fz' || key === 'fzMax'))) || result.errors[key] === undefined ? null : h('small', { class: 'field-error', role: 'alert' }, result.errors[key]);
  const materials = allMaterials.value.map(m => m.material);
  return h('div', { class: 'cutting-row-form', 'data-cutting': 'form' },
    h('h3', null, row === null ? 'Add your cutting data' : 'Edit your cutting data'),
    h('p', { class: 'fine' }, 'Your own numbers. These are saved with the tool; they do not send commands to the machine.'),
    canConvertSpeed(tool) ? h('div', { class: 'cutting-row-actions' },
      h('button', { type: 'button', 'data-action': 'cutting-row-direct', 'aria-pressed': !speedMode, onClick: () => changeMode(false) }, 'Surface speed + chipload'),
      h('button', { type: 'button', 'data-action': 'cutting-row-rpm', 'aria-pressed': speedMode, onClick: () => changeMode(true) }, 'RPM + feed rate'))
      : h('p', { class: 'fine' }, 'RPM and feed entry needs a tool diameter and flute count. Enter surface speed and chipload directly.'),
    h('div', { class: 'field-grid' },
      h('label', { class: 'field' }, h('span', null, 'Material'), h('span', { class: 'select-wrap' }, h('select', { 'data-cutting-field': 'material', value: draft.row.materialRef.id, onChange: (e: Event) => {
        const m = materials.find(m => m.id === (e.currentTarget as HTMLSelectElement).value);
        if (m !== undefined) setDraft(d => ({ ...d, row: { ...d.row, materialRef: { id: m.id, version: m.version }, materialName: m.name } }));
        touch('material');
      } }, h('option', { value: '' }, 'Choose a material'),
        draft.row.materialRef.id !== '' && !materials.some(m => m.id === draft.row.materialRef.id) ? h('option', { value: draft.row.materialRef.id }, draft.row.materialName ?? draft.row.materialRef.id) : null,
        materials.map(m => h('option', { value: m.id, key: m.id }, m.name)))), error('material')),
      speedMode ? ['rpm', 'feed'].map(k => h('label', { class: 'field' }, h('span', null, k === 'rpm' ? 'Spindle speed (RPM)' : `Feed rate (${unit}/min)`), h('input', { type: 'text', inputMode: 'decimal', 'data-cutting-field': k, value: k === 'rpm' ? speed.rpm : speed.feed, onInput: (e: Event) => { const value = (e.currentTarget as HTMLInputElement).value; setSpeed(s => ({ ...s, [k]: value, feedInvalid: k === 'feed' ? false : s.feedInvalid })); touch(k); } }), error(k))) : null,
      CUTTING_NUMBERS.filter(k => !speedMode || (k !== 'vc' && k !== 'fz')).map(k => h('label', { class: 'field', key: k }, h('span', null, `${LABELS[k]} (${k === 'vc' ? unit === 'in' ? 'SFM' : 'm/min' : k === 'fz' || k === 'fzMax' ? `${unit}/tooth` : unit})`),
        h('input', { type: 'text', inputMode: 'decimal', value: draft.raw[k], 'data-cutting-field': k, 'aria-invalid': touched.has(k) && result.errors[k] !== undefined ? 'true' : undefined, onInput: (e: Event) => { const raw = (e.currentTarget as HTMLInputElement).value; setDraft(d => ({ ...d, raw: { ...d.raw, [k]: raw }, invalid: d.invalid?.filter(field => field !== k) ?? [] })); touch(k); } }), error(k)))),
    speedMode ? h('div', { class: 'fine' }, error('vc'), error('fz')) : null,
    h('label', { class: 'field' }, h('span', null, 'Notes'), h('textarea', { 'data-cutting-field': 'note', value: draft.row.note, maxLength: 500, onInput: (e: Event) => { const note = (e.currentTarget as HTMLTextAreaElement).value; setDraft(d => ({ ...d, row: { ...d.row, note } })); touch('note'); } }), error('note')),
    h('div', { class: 'cutting-row-actions' }, h('button', { type: 'button', 'data-action': 'cutting-row-cancel', onClick: onCancel }, 'Cancel row'), h('button', { type: 'button', class: 'primary', 'data-action': 'cutting-row-apply', disabled: result.row === null, onClick: () => { if (result.row !== null) onApply(result.row); } }, 'Use row')));
}
