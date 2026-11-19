/**
 * The Board's Backups tab (Board settings spec §5.8, mockup 2026-11-18-board-config-backups): one section with
 * Back up settings beside its heading and one way to bring a file in (Add a backup file…, which lists it as "Added
 * from a file"); a zebra list (Taken, Why, Firmware, Board, Settings) with Compare in plain words, Restore… (which
 * stages pending changes through the same restore path and opens the tab of the first change; absent on a read-only
 * board), Download and a quiet Delete. Restoring writes nothing: Review and apply does, after C5.
 */
import { h, type ComponentChild } from 'preact';
import { signal } from '@preact/signals';
import { boardText } from '@synthetos/safety';
import { backupBlocked } from '../../../live/backup.ts';
import { draftStore } from '../../boardFacts.ts';
import { boardTab, type BoardTab } from '../../boardNavigation.ts';
import { Icon } from '../../icons.ts';
import type { FirmwareActions, FirmwareHubView, LiveView, WorkspaceModel } from '../../model.ts';
import { defsFor } from '../../settings/defs.ts';
import { editBlocked } from '../../settings/editGate.ts';
import { boardInches, valueWordsOf } from '../../settings/meta.ts';
import { ConfirmCard } from '../../ui.ts';

type Row = FirmwareHubView['settings'][number];
type Compare = NonNullable<FirmwareHubView['compare']>;

/** The last message from a backup action (a refusal, a result), shown under the heading. */
export const backupMessage = signal<string | null>(null);

/** The backup whose Delete is waiting for its confirmation, or null. */
export const deleting = signal<string | null>(null);

const WHY: Readonly<Record<string, string>> = { manual: 'Manual', 'before-apply': 'Before an apply', 'before-update': 'Before a firmware update', import: 'Added from a file' };
const IMPORT_ID = 'board-backup-import';
const fbText = (fb: number | null): string => (fb === null ? 'unknown' : fb.toFixed(2));
const dateText = (iso: string): string => iso.replace('T', ' ').slice(0, 16);
const say = (p: Promise<string | null>): void => void p.then((m) => { backupMessage.value = m; });

function AddFile({ fw }: { readonly fw: FirmwareActions | undefined }): ComponentChild {
  return h(
    'label',
    { class: `button small file-pick${fw === undefined ? ' disabled' : ''}` },
    'Add a backup file…',
    h('input', {
      id: IMPORT_ID,
      type: 'file',
      accept: 'application/json,.json',
      class: 'sr-only',
      disabled: fw === undefined,
      'data-action': 'backup-import',
      onChange: (e: Event) => {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file !== undefined && fw !== undefined) void file.text().then((t) => say(fw.importSettings(t)));
        input.value = '';
      },
    }),
  );
}

/** Stages the backup's differing values as pending changes, then opens the tab of the first one. */
function restore(fw: FirmwareActions, id: string, view: LiveView | null): void {
  void fw.stageSettings(id).then((m) => {
    backupMessage.value = m;
    if (m !== null) return;
    const first = Object.keys(draftStore.value.value)[0];
    const tab = first === undefined ? undefined : defsFor(view)?.tokens.get(first)?.tab;
    boardTab.value = (tab ?? 'settings') as BoardTab;
  });
}

function CompareRows({ c, view }: { readonly c: Compare; readonly view: LiveView | null }): ComponentChild {
  const defs = defsFor(view);
  // Each column in the units it was read in: the backup's, and the board's now (G20 lengths are inches).
  const words = (key: string, v: unknown, inches: boolean): string => (typeof v === 'number' ? valueWordsOf(defs?.tokens.get(key) ?? null, v, inches) : v === undefined ? 'Not read' : String(v));
  const notes = (c.notes ?? []).map((n) => h('p', { key: n, class: 'fine' }, n));
  if (c.changes === 0) return [...notes, h('p', { key: 'same', class: 'fine' }, `Matches the board (${c.same} settings).`)];
  return [...notes, h(
    'table',
    { class: 'cfg-table compare-table' },
    h('thead', null, h('tr', null, ...['Setting', 'In the backup', 'On the board now'].map((t) => h('th', { scope: 'col', key: t }, t)))),
    h('tbody', null, (c.diffs ?? []).map((d) => h('tr', { key: d.key }, h('th', { scope: 'row' }, defs?.tokens.get(d.key)?.label ?? d.key), h('td', null, words(d.key, d.backup, c.backupInches === true)), h('td', null, words(d.key, d.board, boardInches(view)))))),
  )];
}

function BackupRow({ b, view, fw, thisBoard, canRestore }: { readonly b: Row; readonly view: LiveView | null; readonly fw: FirmwareActions | undefined; readonly thisBoard: string | null; readonly canRestore: boolean }): ComponentChild {
  const other = b.boardId !== null && thisBoard !== null && b.boardId !== thisBoard;
  const compare = view?.firmware?.compare;
  return [
    h(
      'tr',
      { key: b.id, 'data-backup-row': b.id, 'data-backup-trigger': b.trigger },
      h('td', null, dateText(b.takenAt)),
      h('td', { 'data-backup-why': '' }, WHY[b.trigger] ?? b.trigger),
      h('td', null, fbText(b.fb)),
      h('td', null, other ? h('span', { class: 'tag warn' }, 'another board') : b.boardId === null ? 'unknown' : 'this board', other && b.boardId !== null ? h('small', { class: 'block fine' }, boardText(b.boardId)) : null),
      h('td', { class: 'num' }, String(b.settingsCount)),
      h(
        'td',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'small', 'data-action': 'backup-compare', disabled: fw === undefined, onClick: () => fw !== undefined && say(fw.compareSettings(b.id)) }, 'Compare'),
        canRestore && fw !== undefined ? h('button', { type: 'button', class: 'small', 'data-machine-control': 'settings-write', 'data-action': 'backup-restore', onClick: () => restore(fw, b.id, view) }, 'Restore…') : null,
        h('button', { type: 'button', class: 'small', 'data-action': 'backup-export', disabled: fw === undefined, onClick: () => void fw?.exportSettings(b.id) }, 'Download'),
        h('button', { type: 'button', class: 'small quiet', 'data-action': 'backup-delete', disabled: fw === undefined, onClick: () => { deleting.value = b.id; } }, 'Delete'),
      ),
    ),
    compare?.id === b.id ? h('tr', { key: `${b.id}-compare`, class: 'compare-row' }, h('td', { colSpan: 6, 'data-compare': b.id }, h(CompareRows, { c: compare, view }))) : null,
  ];
}

function Status({ view }: { readonly view: LiveView | null }): ComponentChild {
  const status = view?.backup ?? { kind: 'idle' as const };
  const notice = view?.firmware?.notice ?? null;
  return h(
    'div',
    { class: 'backup-status' },
    status.kind === 'reading' ? h('p', { class: 'backup-progress', role: 'status', 'data-backup': 'reading' }, `Reading ${status.token === '' ? 'the last answer' : `"${status.token}"`}: ${status.done} of ${status.of}`) : null,
    status.kind === 'saved' ? h('p', { class: 'backup-progress ok', role: 'status', 'data-backup': 'saved' }, `Saved ${status.name}: ${status.answered} groups${status.unanswered === 0 ? '' : `, ${status.unanswered} unanswered (listed in the file)`}.`) : null,
    status.kind === 'failed' ? h('p', { class: 'backup-progress danger', role: 'alert', 'data-backup': 'failed' }, `The backup was not saved: ${status.message}`) : null,
    backupMessage.value === null ? null : h('p', { class: 'backup-progress', role: 'status', 'data-hub-message': 'true' }, backupMessage.value),
    notice === null ? null : h('p', { class: `backup-progress ${notice.kind === 'ok' ? 'ok' : 'danger'}`, role: 'status' }, notice.text),
  );
}

function List({ view, fw }: { readonly view: LiveView | null; readonly fw: FirmwareActions | undefined }): ComponentChild {
  const rows = view?.firmware?.settings ?? [];
  if (rows.length === 0) {
    return h('div', { class: 'hub-empty', 'data-settings-backups': '0' }, h('p', null, 'No backups of this board yet. A backup saves every setting on the board in one file. Make one before you change anything, so you can put it back.'), h('p', { class: 'fine' }, 'Have a backup file from before? ', h('label', { for: IMPORT_ID, class: 'link-label' }, 'Add a backup file…')));
  }
  const id = view?.message?.snapshot.identity?.id;
  const thisBoard = typeof id === 'string' ? id : null;
  const canRestore = editBlocked(view) === null;
  return h(
    'table',
    { class: 'cfg-table backup-table', 'data-settings-backups': String(rows.length) },
    h('thead', null, h('tr', null, ...['Taken', 'Why', 'Firmware', 'Board', 'Settings', ''].map((t) => h('th', { scope: 'col', key: t }, t)))),
    h('tbody', null, rows.map((b) => h(BackupRow, { key: b.id, b, view, fw, thisBoard, canRestore }))),
  );
}

function Head({ model, view, fw }: { readonly model: WorkspaceModel | null; readonly view: LiveView | null; readonly fw: FirmwareActions | undefined }): ComponentChild {
  const blocked = backupBlocked(view?.message?.snapshot ?? null);
  const reading = view?.readout.phase.kind === 'reading' || view?.backup.kind === 'reading';
  return [
    h(
      'header',
      { key: 'head', class: 'hub-head' },
      h('h2', { id: 'hub-settings' }, 'Settings backups'),
      h('button', { type: 'button', class: 'primary small', 'data-action': 'backup', 'data-machine-control': 'read', disabled: blocked !== null || reading || model === null, title: blocked ?? undefined, onClick: () => model?.actions.value?.backup() }, Icon('download', 16), view?.backup.kind === 'reading' ? 'Reading…' : 'Back up settings'),
      h('span', { class: 'grow' }),
      h(AddFile, { fw }),
    ),
    h('p', { key: 'lead', class: 'fine', 'data-backup': blocked !== null ? 'blocked' : reading ? 'waiting' : 'ready' }, blocked ?? 'Every setting on this board, saved on this computer. Run also backs up before every apply and every firmware update.'),
  ];
}

/** Delete asks first (review finding 12): the backup leaves this computer for good. */
function DeleteConfirm({ view, fw }: { readonly view: LiveView | null; readonly fw: FirmwareActions | undefined }): ComponentChild {
  const b = (view?.firmware?.settings ?? []).find((x) => x.id === deleting.value);
  if (b === undefined || fw === undefined) return null;
  return h(ConfirmCard, {
    text: `Delete the backup taken ${dateText(b.takenAt)}? It is removed from this computer. Download it first to keep a copy.`,
    confirm: 'Delete backup',
    safety: 'backup-delete',
    onCancel: () => { deleting.value = null; },
    onConfirm: () => {
      deleting.value = null;
      void fw.deleteSettings(b.id);
    },
  });
}

export function BackupsSection({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const fw = model?.actions.value?.firmware;
  return h(
    'div',
    { tabindex: 0, class: 'hub', 'data-region': 'backups-hub' },
    h('section', { class: 'hub-section', 'aria-labelledby': 'hub-settings' }, h(Head, { model, view, fw }), h(Status, { view }), h(List, { view, fw })),
    h(DeleteConfirm, { view, fw }),
  );
}
