/**
 * The settings-write UI (SAFETY §4.6, H57-H63, amendment 2026-11-02):
 *
 * - One setting's control is `SettingControl` (SettingControl.ts) and the
 *   edit gate is `editBlocked` (editGate.ts).
 * - Pending changes: the sticky `PendingBar` and the `ReviewPanel` (diff,
 *   C5, progress). Apply and Revert are the only controls that write.
 * - `ApplyConfirm`: C5. A high-risk change is named with its consequence,
 *   each needs its own tick, and the word WRITE must be typed.
 * - All settings is `AllSettings` (AllSettings.ts).
 * - `RestorePanel`: a backup file becomes pending changes by token name
 *   (identity, read-only and forbidden keys are skipped and listed).
 *
 * Strings that came from the board render as text through `boardText`
 * (T-S85). Nothing here talks to the machine.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { boardText } from '@synthetos/safety';
import { restoreChanges, type PlannedChange, type RestoreChanges } from '@synthetos/schema';
import { ConfirmSettings } from '../../firmware/ConfirmSettings.ts';
import { setDraft } from '../boardFacts.ts';
import type { LiveView } from '../model.ts';
import { editBlocked } from './editGate.ts';
import { settingsWriteBlocked } from './pending.ts';

export function ApplyConfirm({ changes, view, onCancel, onConfirm }: { readonly changes: readonly PlannedChange[]; readonly view: LiveView | null; readonly onCancel: () => void; readonly onConfirm: () => void }): ComponentChild {
  return h(ConfirmSettings, { changes, boardId: view?.message?.snapshot.identity?.id ?? null, blocked: settingsWriteBlocked(view) !== null, onCancel, onConfirm });
}

// ---------------------------------------------------------------- restore

/** Parses a backup file (live/backup.ts format) and stages its values as pending changes by token name. */
export function stageRestore(text: string, view: LiveView | null): { readonly ok: true; readonly result: RestoreChanges; readonly takenAt: string; readonly boardId: string | null } | { readonly ok: false; readonly message: string } {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, message: 'This is not a JSON file.' };
  }
  if (typeof file !== 'object' || file === null || (file as { format?: unknown }).format !== 'synthetos-run-settings-backup') return { ok: false, message: 'This is not a Run settings backup.' };
  const f = file as { tokens?: unknown; takenAt?: unknown; board?: { id?: unknown; dialect?: unknown }; units?: { unit?: unknown } };
  const dialect = view?.readout.dialectId ?? null;
  if (dialect === null) return { ok: false, message: 'Connect the board first.' };
  if (f.board?.dialect !== dialect) return { ok: false, message: `This backup is from ${String(f.board?.dialect)}, not ${dialect}.` };
  if (f.units?.unit !== 1) return { ok: false, message: 'This backup was not read in millimetres, so its lengths cannot be restored safely.' };
  if (typeof f.tokens !== 'object' || f.tokens === null) return { ok: false, message: 'The backup has no settings.' };
  const result = restoreChanges(dialect, f.tokens as Record<string, unknown>, view?.readout.settings ?? {});
  for (const c of result.changes) setDraft(c.key, c.value);
  return { ok: true, result, takenAt: typeof f.takenAt === 'string' ? f.takenAt : '', boardId: typeof f.board?.id === 'string' ? f.board.id : null };
}

export function RestorePanel({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [outcome, setOutcome] = useState<ReturnType<typeof stageRestore> | null>(null);
  const blocked = editBlocked(view);
  const thisBoard = view?.message?.snapshot.identity?.id ?? null;
  return h(
    'section',
    { class: 'hub-restore', 'data-region': 'restore' },
    h(
      'label',
      { class: `button small file-pick${blocked === null ? '' : ' disabled'}`, title: blocked ?? 'Its values become pending changes, matched by setting name; identity and read-only settings are skipped. Review them, then Apply.' },
      'Restore from a file…',
      h('input', {
        type: 'file',
        disabled: blocked !== null,
        accept: 'application/json,.json',
        class: 'sr-only',
        'data-machine-control': 'settings-write',
        'data-action': 'restore-file',
        onChange: (e: Event) => {
          const input = e.currentTarget as HTMLInputElement;
          const file = input.files?.[0];
          if (file === undefined) return;
          void file.text().then((text) => {
            setOutcome(stageRestore(text, view));
            input.value = '';
          });
        },
      }),
    ),
    blocked === null ? null : h('p', { class: 'fine' }, blocked),
    outcome === null
      ? null
      : outcome.ok
        ? h(
            'div',
            { class: 'restore-result', role: 'status', 'data-restore': 'staged' },
            h('p', null, `${outcome.result.changes.length} ${outcome.result.changes.length === 1 ? 'setting differs' : 'settings differ'} and ${outcome.result.changes.length === 1 ? 'is' : 'are'} now pending; ${outcome.result.same} already match.`),
            outcome.boardId !== null && thisBoard !== null && outcome.boardId !== thisBoard ? h('p', { class: 'note' }, `This backup is from board ${boardText(outcome.boardId)}, not this board (${boardText(thisBoard)}). Check every change before you apply it.`) : null,
            outcome.result.skipped.length === 0 ? null : h('details', { class: 'more' }, h('summary', null, `${outcome.result.skipped.length} skipped`), h('ul', null, outcome.result.skipped.map((s) => h('li', { key: s.key }, h('code', null, s.key), ` ${s.reason}`)))),
          )
        : h('p', { class: 'backup-progress danger', role: 'alert' }, outcome.message),
  );
}
