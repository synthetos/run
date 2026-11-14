/** C5, shared by workspace changes and the open updater's required restore. */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { TYPED_WORDS, boardText, c5 } from '@synthetos/safety';
import type { PlannedChange } from '@synthetos/schema';
import { DialogWrap } from '../workspace/dialogs/DialogWrap.ts';
/** The C5 confirmation. High-risk changes need a tick each and the typed word. */
export function ConfirmSettings({ changes, boardId: rawBoardId, blocked, restoreOnly = false, onCancel, onConfirm }: { readonly changes: readonly PlannedChange[]; readonly boardId: string | null; readonly blocked: boolean; readonly restoreOnly?: boolean; readonly onCancel: () => void; readonly onConfirm: () => void }): ComponentChild {
  const high = changes.filter((c) => c.risk.highRisk);
  const [ticks, setTicks] = useState<readonly string[]>([]);
  const [typed, setTyped] = useState('');
  const boardId = boardText(rawBoardId) || 'no board id';
  const text = c5({ settings: changes.length, machineName: 'this board', boardId, changes: changes.map((c) => `${c.key} ${c.words}`).join('; '), highRisk: high.map((c) => c.label) });
  const ready = high.every((c) => ticks.includes(c.key)) && (high.length === 0 || typed.trim() === TYPED_WORDS.write);
  return h(
    DialogWrap,
    { class: 'dialog-wrap', 'data-dialog': 'apply-confirm', onDismiss: onCancel },
    h(
      'div',
      { class: 'dialog wide apply-confirm', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'apply-confirm-title' },
      h('div', { class: 'dialog-head' }, h('h2', { id: 'apply-confirm-title' }, high.length > 0 ? 'Confirm high-risk changes' : 'Write these settings?'), h('span', { class: high.length > 0 ? 'tag danger' : 'tag' }, `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`)),
      h('p', { 'data-c5': '' }, text),
      high.length === 0
        ? null
        : h(
            'ul',
            { class: 'risk-list' },
            high.map((c) =>
              h(
                'li',
                { key: c.key, 'data-risk-key': c.key },
                h('label', { class: 'c1-box' }, h('input', { type: 'checkbox', 'aria-label': `I understand: ${c.label}`, checked: ticks.includes(c.key), onChange: (e: Event) => setTicks((t) => ((e.currentTarget as HTMLInputElement).checked ? [...t, c.key] : t.filter((x) => x !== c.key))) }), h('span', null, h('strong', null, `${c.label} (${c.key}): ${c.words}. `), c.risk.consequence)),
              ),
            ),
          ),
      high.length === 0
        ? null
        : h('div', { class: 'field' }, h('label', { for: 'apply-typed' }, `Type ${TYPED_WORDS.write} to write ${high.length === 1 ? 'this high-risk change' : 'these high-risk changes'}`), h('input', { id: 'apply-typed', 'aria-label': `Type ${TYPED_WORDS.write}`, autocomplete: 'off', value: typed, onInput: (e: Event) => setTyped((e.currentTarget as HTMLInputElement).value) })),
      h('p', { class: 'fine' }, restoreOnly ? 'Run backs up every setting first, then restores one setting at a time and reads each back. It stops at the first problem.' : 'Run backs up every setting first, then writes one setting at a time and reads each back. It stops at the first problem and offers to put the backed-up values back. Keep your hand near the E-stop.'),
      h(
        'div',
        { class: 'dialog-actions' },
        // Cancel is focused by default (SAFETY §6).
        h('button', { type: 'button', class: 'quiet', autofocus: true, 'data-action': 'cancel-apply', onClick: onCancel }, 'Cancel'),
        h('button', { type: 'button', class: high.length > 0 ? 'danger' : 'primary', 'data-machine-control': 'settings-write', 'data-action': 'confirm-apply', disabled: !ready || blocked, onClick: onConfirm }, high.length > 0 ? 'Back up and write' : 'Back up and write'),
      ),
    ),
  );
}

