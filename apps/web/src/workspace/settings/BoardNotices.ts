/**
 * The one notice above the Board tabs (Board settings spec §5.3): why Run
 * can't change settings here, with Back up settings and, when a listed
 * release fixes it, Update firmware. Also the one line after pending changes
 * for another board were discarded.
 */
import { h, type ComponentChild } from 'preact';
import { backupBlocked } from '../../live/backup.ts';
import type { WorkspaceModel } from '../model.ts';
import { discardNotice } from './boardChange.ts';
import { editBlocked, READING_BOARD, readOnlyNotice } from './editGate.ts';

/** Back up settings, under the same rule as the Backups section's button (backupBlocked, review finding 11). */
function NoticeBackup({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const blocked = backupBlocked(view?.message?.snapshot ?? null);
  const reading = view?.readout.phase.kind === 'reading' || view?.backup.kind === 'reading';
  return h('button', { type: 'button', class: 'small', 'data-action': 'notice-backup', 'data-machine-control': 'read', disabled: blocked !== null || reading || model === null, title: blocked ?? undefined, onClick: () => model?.actions.value?.backup() }, 'Back up settings');
}

export function BoardNotices({ model, onUpdate }: { readonly model: WorkspaceModel | null; readonly onUpdate: () => void }): ComponentChild {
  const view = model?.live.value ?? null;
  const notice = readOnlyNotice(view);
  const reading = editBlocked(view) === READING_BOARD;
  const discarded = discardNotice.value;
  if (notice === null && !reading && discarded === null) return null;
  return h(
    'div',
    { class: 'board-notices' },
    reading ? h('div', { class: 'board-notice', role: 'status', 'data-region': 'board-reading' }, h('p', null, READING_BOARD)) : null,
    notice === null
      ? null
      : h(
          'div',
          { class: 'board-notice', role: 'note', 'data-region': 'read-only-notice' },
          h('p', null, notice.text),
          h(NoticeBackup, { model }),
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
