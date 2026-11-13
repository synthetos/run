/** Drawing detail only: Fine refines automatically; Coarse keeps the lightweight drawing. */
import { h, type ComponentChild } from 'preact';
import type { PreviewParts } from './PreviewPanel.ts';
import type { DialectId } from '@synthetos/protocol';
import { analysisDialect } from './analysisDialect.ts';
import { Icon } from '../workspace/icons.ts';

export function ViewerOptions({ parts, disabled }: { readonly parts: PreviewParts; readonly disabled: boolean }): ComponentChild {
  const coarse = parts.state.mode === 'lite';
  const label = `Drawing detail: ${coarse ? 'Coarse' : 'Fine'}. Click for ${coarse ? 'Fine' : 'Coarse (faster on big files)'}.`;
  return h('span', { class: 'preview-detail-wrap' }, h('button', {
    type: 'button', class: 'small preview-detail', 'data-action': 'preview-detail',
    'aria-pressed': coarse, 'aria-label': label, 'aria-describedby': 'preview-detail-help', disabled,
    onClick: () => parts.actions.onMode?.(coarse ? 'auto' : 'lite'),
  }, Icon('search', 14), coarse ? 'Coarse' : 'Fine'), h('span', { class: 'preview-detail-help', id: 'preview-detail-help', role: 'tooltip' }, label));
}

/** The connected-board warning belongs to Check, in both Simple and Advanced. */
export function AnalysisWarning({ connected, dialect }: { readonly connected: boolean; readonly dialect: DialectId | null | undefined }): ComponentChild {
  const note = connected ? analysisDialect(true, dialect).note : null;
  return note === null ? null : h('p', { class: 'notice tone-warn', 'data-preview': 'analysis-note' }, note);
}
