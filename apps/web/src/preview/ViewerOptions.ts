/**
 * How the Run view reads and draws the file (Advanced only; Simple keeps the defaults, Auto included), in plain
 * words: the dialect and the detail level. Moved out of RunView.ts.
 */
import { h, type ComponentChild } from 'preact';
import type { DialectId } from '@synthetos/protocol';
import { PREVIEW_DIALECTS, type PreviewMode } from '../gcode-worker/pipeline.ts';
import type { PreviewParts } from './PreviewPanel.ts';
import { DIALECT_LABEL, on } from './PreviewView.ts';

/** The Run view's preview options, in plain words (the TB-03 sheet keeps PreviewView's own). */
const RUN_DIALECT_LABEL: Readonly<Record<string, string>> = { 'tinyg-en': 'TinyG edge-next', 'tinyg-440': 'TinyG 440.xx' };
const RUN_MODE_LABEL: Readonly<Record<PreviewMode, string>> = { auto: 'Auto', lite: 'Coarse', full: 'Full' };

export function ViewerOptions({ parts, disabled }: { readonly parts: PreviewParts; readonly disabled: boolean }): ComponentChild {
  const { state, actions } = parts;
  return h(
    'div',
    { class: 'seg viewer-options', role: 'group', 'aria-label': 'Preview options' },
    h(
      'label',
      { class: 'viewer-option' },
      h('span', { class: 'viewer-option-label' }, 'Read as:'),
      h(
        'span',
        { class: 'select-wrap compact' },
        h(
          'select',
          { 'aria-label': 'Read as', value: state.dialect, disabled, 'data-preview': 'dialect', ...on('onChange', actions.onDialect, (f) => (e: Event) => { f((e.currentTarget as HTMLSelectElement).value as DialectId); }) },
          PREVIEW_DIALECTS.map((d) => h('option', { value: d, key: d }, RUN_DIALECT_LABEL[d] ?? DIALECT_LABEL[d] ?? d)),
        ),
      ),
    ),
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
