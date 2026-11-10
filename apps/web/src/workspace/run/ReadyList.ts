/**
 * The "Ready to start?" list (readyModel.ts): one line per item, its mark (✓ done, ! needs you, ✕ blocked, … still
 * checking), a few words, the button that clears it, and a link to its note when there is more to read. Zebra rows
 * (owner, 2026-11-09). Presentation only.
 */
import { h, type ComponentChild } from 'preact';
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

function Item({ item, onAction }: { readonly item: ReadyItem; readonly onAction: (id: ReadyActionId) => void }): ComponentChild {
  return h(
    'li',
    { class: `ready-item mark-${item.mark}`, 'data-ready-item': item.id, 'data-mark': item.mark },
    h('span', { class: 'ready-mark', 'aria-hidden': 'true' }, MARK_TEXT[item.mark]),
    h('span', { class: 'sr-only' }, `${MARK_WORDS[item.mark]}: `),
    h('span', { class: 'ready-text' }, h('strong', { class: 'ready-label' }, item.label), h('span', { class: 'ready-summary', 'data-ready-summary': item.id }, item.summary)),
    item.actions.length === 0
      ? null
      : h(
          'span',
          { class: 'ready-actions' },
          item.actions.map((a) => h('button', { type: 'button', key: a.id, class: 'small', ...actionAttrs(a.id), onClick: () => onAction(a.id) }, a.label)),
        ),
  );
}

/**
 * What needs attention (!, ✕, …) in full; what passed folds into one row, "✓ 6 checks passed", that opens in place
 * (owner, 2026-11-09: no data in scroll areas: the list, the tick and Start fit without scrolling).
 */
export function ReadyList({ items, onAction }: { readonly items: readonly ReadyItem[]; readonly onAction: (id: ReadyActionId) => void }): ComponentChild {
  // While the machine itself blocks, the other checks wait for it: they fold away under one row.
  const machineBlocked = items.some((i) => i.id === 'machine' && i.mark === 'blocked');
  // Feeds needs no board (Analyze works offline), so its Review stays in view either way.
  const shown = (i: ReadyItem): boolean => (machineBlocked ? i.id === 'machine' || (i.id === 'feeds' && i.mark !== 'done') : i.mark !== 'done');
  const attention = items.filter(shown);
  const passed = items.filter((i) => !shown(i));
  const foldText = machineBlocked ? `${passed.length} more ${passed.length === 1 ? 'check waits' : 'checks wait'} for the board` : `${passed.length} ${passed.length === 1 ? 'check' : 'checks'} passed`;
  return h(
    'div',
    { class: 'ready-list', 'data-job': 'ready', 'aria-label': 'Ready to start?' },
    attention.length === 0 ? null : h('ul', { class: 'rows ready-attention' }, attention.map((item) => h(Item, { key: item.id, item, onAction }))),
    passed.length === 0
      ? null
      : h(
          'details',
          { class: 'ready-passed', 'data-job': 'ready-passed' },
          h('summary', null, h('span', { class: 'ready-mark', 'aria-hidden': 'true' }, machineBlocked ? MARK_TEXT.waiting : MARK_TEXT.done), ` ${foldText}`),
          h('ul', { class: 'rows' }, passed.map((item) => h(Item, { key: item.id, item, onAction }))),
        ),
  );
}
