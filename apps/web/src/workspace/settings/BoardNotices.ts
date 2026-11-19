/**
 * The one notice above the Board tabs (Board settings spec §5.3): why Run
 * can't change settings here, with Back up settings and, when a listed
 * release fixes it, Update firmware. Also the one line after pending changes
 * for another board were discarded.
 */
import { h, type ComponentChild } from 'preact';
import type { WorkspaceModel } from '../model.ts';
import { discardNotice } from './boardChange.ts';
import { readOnlyNotice } from './editGate.ts';

export function BoardNotices({ model, onUpdate }: { readonly model: WorkspaceModel | null; readonly onUpdate: () => void }): ComponentChild {
  const notice = readOnlyNotice(model?.live.value ?? null);
  const discarded = discardNotice.value;
  if (notice === null && discarded === null) return null;
  return h(
    'div',
    { class: 'board-notices' },
    notice === null
      ? null
      : h(
          'div',
          { class: 'board-notice', role: 'note', 'data-region': 'read-only-notice' },
          h('p', null, notice.text),
          h('button', { type: 'button', class: 'small', 'data-action': 'notice-backup', onClick: () => model?.actions.value?.backup() }, 'Back up settings'),
          notice.update ? h('button', { type: 'button', class: 'small primary', 'data-action': 'notice-update', onClick: onUpdate }, 'Update firmware') : null,
        ),
    discarded === null
      ? null
      : h(
          'div',
          { class: 'board-notice', role: 'status', 'data-region': 'drafts-discarded' },
          h('p', null, discarded),
          h('button', { type: 'button', class: 'icon-button quiet', 'aria-label': 'Dismiss', onClick: () => { discardNotice.value = null; } }, '×'),
        ),
  );
}
