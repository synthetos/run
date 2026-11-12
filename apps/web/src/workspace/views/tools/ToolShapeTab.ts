import { h, type ComponentChild } from 'preact';
import type { Tool } from '@synthetos/library';
import { ToolDrawingEditor } from '../../toolDrawing/ToolDrawingEditor.ts';
import { ToolShapeFields } from '../ToolShapeFields.ts';
import { LengthField } from './LengthField.ts';
import type { ToolUnit } from '../../tools/units.ts';
export function ToolShapeTab({ tool, number, numberIssue, onNumber, set, unit, onValidity }: {
  readonly tool: Tool; readonly number: number; readonly numberIssue: string | null;
  readonly onNumber: (n: number) => void; readonly set: (patch: Readonly<Record<string, unknown>>) => void;
  readonly unit: ToolUnit; readonly onValidity: (field: string, valid: boolean) => void;
}): ComponentChild {
  const geometry = (field: string, value: number | undefined): void => set({ geometry: { ...tool.geometry, [field]: value } });
  return h(ToolDrawingEditor, { tool, unit, controlled: true }, h('div', { class: 'field-grid' },
    h('label', { class: 'field' }, h('span', null, 'Number'), h('input', { type: 'number', min: 1, step: 1, value: Number.isFinite(number) ? number : '', 'data-tool-field': 'number', onInput: (e: Event) => onNumber(Number((e.currentTarget as HTMLInputElement).value)) }), numberIssue === null ? null : h('small', { class: 'field-error', 'data-tool-field': 'number-error' }, numberIssue)),
    h(LengthField, { field: 'diameter', label: 'Diameter', value: tool.geometry.diameter, unit, onChange: n => geometry('diameter', n), onValidity }),
    h(ToolShapeFields, { tool, set, unit, onValidity }),
    ...(['flutes', 'fluteLength', 'overallLength'] as const).map(field => h(LengthField, { key: field, field, label: { flutes: 'Flutes', fluteLength: 'Flute length', overallLength: 'Overall length' }[field], value: tool.geometry[field], unit: field === 'flutes' ? '' : unit, onChange: n => geometry(field, n), onValidity })),
  ));
}
