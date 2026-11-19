/**
 * The one notice above the Board tabs (Board settings spec §5.3): why Run
 * can't change settings here, with Back up settings and, when a listed
 * release fixes it, Update firmware. Also the one line after pending changes
 * for another board were discarded.
 */
import { h, type ComponentChild } from 'preact';
import { backupBlocked } from '../../live/backup.ts';
import { boardTab, startFirmwareUpdate } from '../boardNavigation.ts';
import type { LiveView, WorkspaceModel } from '../model.ts';
import { updateStart } from '../updateStart.ts';
import { discardNotice } from './boardChange.ts';
import { editBlocked, READING_BOARD, readOnlyNotice } from './editGate.ts';

/** Back up settings, under the same rule as the Backups section's button (backupBlocked, review finding 11). */
function NoticeBackup({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const blocked = backupBlocked(view?.message?.snapshot ?? null);
  const reading = view?.readout.phase.kind === 'reading' || view?.backup.kind === 'reading';
  return h('button', { type: 'button', class: 'small', 'data-action': 'notice-backup', 'data-machine-control': 'read', disabled: blocked !== null || reading || model === null, title: blocked ?? undefined, onClick: () => model?.actions.value?.backup() }, 'Back up settings');
}

/** Update firmware: starts the recommended release's flow (C6); not drawn when it could not act now (owner 169). */
function NoticeUpdate({ view }: { readonly view: LiveView | null }): ComponentChild {
  const release = updateStart(view);
  if (release === null) return null;
  return h('button', { type: 'button', class: 'small primary', 'data-action': 'notice-update', onClick: () => startFirmwareUpdate(release.file) }, 'Update firmware');
}

export function BoardNotices({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
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
          // The Backups tab has its own Back up settings beside its heading: never two on one screen.
          boardTab.value === 'backups' ? null : h(NoticeBackup, { model }),
          notice.update ? h(NoticeUpdate, { view }) : null,
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
