/**
 * C5 for a settings apply (SAFETY §4.6, H57-H63, amendment 2026-11-02): a high-risk change is named with its
 * consequence, each needs its own tick, and the word WRITE must be typed. The rest of the settings UI lives beside
 * it: `SettingControl` (one setting), `editGate` (whether edits are possible), `PendingBar` and `ReviewPanel`
 * (pending changes, the diff, the run), `AllSettings`, and the Backups tab (views/board/backups.ts), whose Restore
 * stages pending changes through the firmware hub's one restore path.
 */
import { h, type ComponentChild } from 'preact';
import type { PlannedChange } from '@synthetos/schema';
import { ConfirmSettings } from '../../firmware/ConfirmSettings.ts';
import type { LiveView } from '../model.ts';
import { settingsWriteBlocked } from './pending.ts';

export function ApplyConfirm({ changes, view, onCancel, onConfirm }: { readonly changes: readonly PlannedChange[]; readonly view: LiveView | null; readonly onCancel: () => void; readonly onConfirm: () => void }): ComponentChild {
  return h(ConfirmSettings, { changes, boardId: view?.message?.snapshot.identity?.id ?? null, blocked: settingsWriteBlocked(view) !== null, onCancel, onConfirm });
}
