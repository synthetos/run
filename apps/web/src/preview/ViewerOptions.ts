/**
 * How the Run view reads and draws the file (Advanced only; Simple keeps the defaults, Auto included), in plain
 * words: the automatic firmware check and the detail level. Moved out of RunView.ts.
 */
import { h, type ComponentChild } from 'preact';
import type { PreviewMode } from '../gcode-worker/pipeline.ts';
import type { PreviewParts } from './PreviewPanel.ts';
import { on } from './PreviewView.ts';

/** The Run view's preview options, in plain words (the TB-03 sheet keeps PreviewView's own). */
const RUN_MODE_LABEL: Readonly<Record<PreviewMode, string>> = { auto: 'Auto', lite: 'Coarse', full: 'Full' };

export function ViewerOptions({ parts, disabled, note }: { readonly parts: PreviewParts; readonly disabled: boolean; readonly note: string | null }): ComponentChild {
  const { state, actions } = parts;
  return h(
    'div',
    { class: 'seg viewer-options', role: 'group', 'aria-label': 'Preview options' },
    note === null ? null : h('span', { class: 'fine muted', 'data-preview': 'analysis-note' }, note),
    h(
      'label',
      { class: 'viewer-option' },
      h('span', { class: 'viewer-option-label' }, 'Detail:'),
      h(
        'span',
        { class: 'select-wrap compact' },
        h(
          'select',
          { 'aria-label': 'Detail', value: state.mode, disabled, 'data-preview': 'mode', ...on('onChange', actions.onMode, (f) => (e: Event) => { f((e.currentTarget as HTMLSelectElement).value as PreviewMode); }) },
          (['auto', 'lite', 'full'] as const).map((m) => h('option', { value: m, key: m }, RUN_MODE_LABEL[m])),
        ),
      ),
    ),
  );
}
