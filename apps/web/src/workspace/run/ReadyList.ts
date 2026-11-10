/**
 * The "Ready to start?" list (readyModel.ts): one line per item, its mark (✓ done, ! needs you, ✕ blocked, … still
 * checking), a few words, the button that clears it, and a link to its note when there is more to read. Zebra rows
 * (owner, 2026-11-09). Presentation only.
 */
import { h, type ComponentChild } from 'preact';
import { openDockTab } from '../dock/dockRequest.ts';
import type { ReadyActionId, ReadyItem } from './readyModel.ts';
import { MARK_TEXT, MARK_WORDS } from './runCopy.ts';

/**
 * A button's hooks: Connect and Disconnect call the Connect flow (shell.test.ts counts them with it); Home, the position check and Clear
 * alarm are machine controls (each asks its own confirmation first); the rest only open a view.
 */
function actionAttrs(id: ReadyActionId): Record<string, string> {
  if (id === 'connect' || id === 'disconnect') return { 'data-action': `ready-${id}` };
  if (id === 'home') return { 'data-action': 'ready-home', 'data-machine-control': 'home' };
  if (id === 'verify') return { 'data-action': 'ready-verify', 'data-machine-control': 'verify' };
  if (id === 'clear-alarm') return { 'data-action': 'ready-clear-alarm', 'data-machine-control': 'clear-alarm' };
  return { 'data-action': `ready-${id}` };
}

export function ReadyList({ items, onAction }: { readonly items: readonly ReadyItem[]; readonly onAction: (id: ReadyActionId) => void }): ComponentChild {
  return h(
    'ul',
    { class: 'ready-list rows', 'data-job': 'ready', 'aria-label': 'Ready to start?' },
    items.map((item) =>
      h(
        'li',
        { key: item.id, class: `ready-item mark-${item.mark}`, 'data-ready-item': item.id, 'data-mark': item.mark },
        h('span', { class: 'ready-mark', 'aria-hidden': 'true' }, MARK_TEXT[item.mark]),
        h('span', { class: 'sr-only' }, `${MARK_WORDS[item.mark]}: `),
        h('span', { class: 'ready-text' }, h('strong', { class: 'ready-label' }, item.label), h('span', { class: 'ready-summary', 'data-ready-summary': item.id }, item.summary)),
        item.actions.length === 0 && item.note === undefined
          ? null
          : h(
              'span',
              { class: 'ready-actions' },
              item.actions.map((a) => h('button', { type: 'button', key: a.id, class: 'small', ...actionAttrs(a.id), onClick: () => onAction(a.id) }, a.label)),
              item.note === undefined ? null : h('button', { type: 'button', class: 'link ready-more', 'data-action': 'ready-note', 'aria-label': `More about ${item.label}, in Notes`, onClick: () => openDockTab('notes') }, 'More'),
            ),
      ),
    ),
  );
}
