import { toolMaterialLabel, toolCoatingLabel } from '../../tools/labels.ts';
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { COATINGS, TOOL_MATERIALS, type Tool } from '@synthetos/library';
export function ToolDetailsTab({ tool, set, editing }: { readonly tool: Tool; readonly editing: boolean; readonly set: (patch: Partial<Tool>) => void }): ComponentChild {
  const [reset, askReset] = useState(false);
  const text = (label: string, key: 'name' | 'manufacturer' | 'partNumber'): ComponentChild => h('label', { class: 'field' }, h('span', null, label), h('input', { value: tool[key] ?? '', maxLength: 120, 'data-tool-field': key, placeholder: key === 'name' ? 'e.g. 1/4 in down-cut' : '', onInput: (e: Event) => set({ [key]: (e.currentTarget as HTMLInputElement).value }) }));
  const select = (label: string, key: 'toolMaterial' | 'coating', options: readonly string[]): ComponentChild => h('label', { class: 'field' }, h('span', null, label), h('span', { class: 'select-wrap' }, h('select', { 'aria-label': label, value: tool[key], onChange: (e: Event) => set({ [key]: (e.currentTarget as HTMLSelectElement).value }) }, options.map(v => h('option', { value: v }, key === 'toolMaterial' ? toolMaterialLabel(v) : toolCoatingLabel(v))))));
  return h('div', { class: 'tool-details-grid' }, text('Name', 'name'), text('Maker', 'manufacturer'), text('Part number', 'partNumber'), select('Material', 'toolMaterial', TOOL_MATERIALS), select('Coating', 'coating', COATINGS),
    !editing ? null : h('div', { class: 'tool-life' }, `Cut so far: ${tool.life.minutes} min`, reset ? h('span', { class: 'inline-confirm' }, 'Reset to 0?', h('button', { type: 'button', onClick: () => { set({ life: { minutes: 0, byMaterial: [] } }); askReset(false); } }, 'Reset'), h('button', { type: 'button', onClick: () => askReset(false) }, 'Keep')) : h('button', { type: 'button', onClick: () => askReset(true) }, 'Reset')),
    ...(['description', 'notes'] as const).map(key => h('label', { class: 'field' }, h('span', null, key === 'notes' ? 'Notes' : 'Description'), h('textarea', { rows: 3, maxLength: 2000, value: tool[key], onInput: (e: Event) => set({ [key]: (e.currentTarget as HTMLTextAreaElement).value }) }))),
  );
}
