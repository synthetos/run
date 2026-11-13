import { DialogWrap } from '../dialogs/DialogWrap.ts';
/**
 * A blocker as a modal (owner, 2026-11-09): a plain title, one or two short sentences, and the buttons that fix it.
 * Centred below the machine strip like every confirmation (OD-16), never over W1, the strip or Pause and Stop job.
 */
import { h, type ComponentChild } from 'preact';
import { belowStrip, focusOnMount } from '../ui.ts';

export interface Choice {
  readonly id: string;
  readonly label: string;
  readonly primary?: boolean;
  /** A machine control's class (data-machine-control), for a choice that acts on the machine. */
  readonly machine?: string;
  readonly onClick: () => void;
}

export function ChoiceModal({ title, body, choices, safety, details, region, onDismiss }: { readonly onDismiss: () => void; readonly title: string; readonly body: string; readonly choices: readonly Choice[]; readonly safety?: string; readonly details?: ComponentChild; readonly region?: string }): ComponentChild {
  return h(
    DialogWrap,
    { class: 'dialog-wrap confirm-modal', role: 'presentation', setup: belowStrip, onDismiss },
    h(
      'div',
      { class: 'dialog motion-confirm choice-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title, ...(safety === undefined ? {} : { 'data-safety': safety }), ...(region === undefined ? {} : { 'data-region': region }) },
      h('h2', { class: 'choice-title' }, title),
      h('p', null, body),
      details ?? null,
      h(
        'div',
        { class: 'motion-confirm-actions' },
        choices.map((c, i) => h('button', { type: 'button', key: c.id, class: c.primary === true ? 'small primary' : 'small', 'data-action': c.id, ...(c.machine === undefined ? {} : { 'data-machine-control': c.machine }), ...(i === choices.length - 1 ? { ref: focusOnMount } : {}), onClick: c.onClick }, c.label)),
      ),
    ),
  );
}

/** "Details": the registered texts behind a short one, one click away. */
export function Details({ texts }: { readonly texts: readonly { readonly safety?: string; readonly text: string }[] }): ComponentChild {
  if (texts.length === 0) return null;
  return h('details', { class: 'choice-details', 'data-details': '' }, h('summary', null, 'Details'), texts.map((t, i) => h('p', { key: String(i), class: 'fine', ...(t.safety === undefined ? {} : { 'data-full': t.safety }) }, t.text)));
}
