/**
 * The settings-write UI (SAFETY §4.6, H57-H63, amendment 2026-11-02):
 *
 * - `SettingEditor`: one setting's new value (a number field or a list of
 *   its named values), kept as a pending change in this browser. Editing
 *   never writes anything.
 * - `PendingTray`: the pending changes as a diff (board value, new value,
 *   plain words, risk), with Apply and, after a failure, Revert. Apply and
 *   Revert are the only controls that write, and they are enabled only when
 *   the phase switch is on and the machine is idle (`settingsWriteBlocked`).
 * - `ApplyConfirm`: C5. A high-risk change is named with its consequence,
 *   each needs its own tick, and the word WRITE must be typed.
 * - `SettingsTable`: "All settings", grouped, searchable, with plain names,
 *   units and descriptions.
 * - `RestorePanel`: a backup file becomes pending changes by token name
 *   (identity, read-only and forbidden keys are skipped and listed).
 *
 * Strings that came from the board render as text through `boardText`
 * (T-S85). Nothing here talks to the machine except through the model's
 * `applySettings` and `revertSettings` actions.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { TYPED_WORDS, boardText, c5, w20 } from '@synthetos/safety';
import { restoreChanges, settingsReadGroups, type PlannedChange, type RestoreChanges, type SettingValue } from '@synthetos/schema';
import { draftStore, plainValue, setDraft, clearDraft, settingMeta } from '../boardFacts.ts';
import type { LiveView, WorkspaceModel } from '../model.ts';
import type { ApplyState, ApplyStep } from '../../live/settingsApply.ts';
import { pendingPlan, settingsWriteBlocked, writableKey } from './pending.ts';

type Settings = Readonly<Record<string, SettingValue>>;

/** Editing is possible once the board is read and the phase switch is on; writing needs the full gate. */
export function editBlocked(view: LiveView | null): string | null {
  const m = view?.message ?? null;
  if (m === null || m.snapshot.base === 'NOT_CONNECTED') return 'Connect a board to change its settings.';
  if (m.settingsWrites !== true) return 'Changing settings is not turned on in this build.';
  if (Object.keys(view?.readout.settings ?? {}).length === 0) return 'Wait for the settings read to finish.';
  return null;
}

/** One setting's pending value. */
export function SettingEditor({ k, view, compact = false }: { readonly k: string; readonly view: LiveView | null; readonly compact?: boolean }): ComponentChild {
  const dialect = view?.readout.dialectId ?? null;
  const settings: Settings = view?.readout.settings ?? {};
  const meta = settingMeta(k, dialect);
  if (!writableKey(k, dialect)) return compact ? null : h('span', { class: 'muted fine', title: 'Run does not write this setting: it is not reviewed for writing, it is read-only, or it is never written.' }, 'Read only');
  const blocked = editBlocked(view);
  const draft = draftStore.value.value[k];
  const board = settings[k];
  const pick = (raw: string): void => {
    if (raw.trim() === '') {
      setDraft(k, null);
      return;
    }
    const n = Number(raw);
    setDraft(k, !Number.isFinite(n) || (typeof board === 'number' && Math.abs(board - n) < 1e-9) ? null : n);
  };
  const label = `${meta.label}, draft`;
  const changed = draft !== undefined;
  if (meta.values !== null) {
    return h(
      'span',
      { class: `select-wrap setting-edit${changed ? ' changed' : ''}` },
      h(
        'select',
        { 'aria-label': label, 'data-setting-edit': k, disabled: blocked !== null, title: blocked ?? meta.description, value: draft === undefined ? '' : String(draft), onChange: (e: Event) => pick((e.currentTarget as HTMLSelectElement).value) },
        h('option', { value: '' }, typeof board === 'number' ? `Keep: ${plainValue(k, board, dialect) ?? board}` : 'Keep'),
        meta.values.map((o) => h('option', { value: String(o.value), key: o.value }, o.label)),
      ),
    );
  }
  return h(
    'span',
    { class: `unit-input setting-edit${changed ? ' changed' : ''}` },
    h('input', {
      type: 'number',
      step: 'any',
      inputMode: 'decimal',
      'aria-label': label,
      'data-setting-edit': k,
      disabled: blocked !== null,
      title: blocked ?? meta.description,
      placeholder: typeof board === 'number' ? String(board) : '',
      value: draft === undefined ? '' : String(draft),
      onChange: (e: Event) => pick((e.currentTarget as HTMLInputElement).value),
    }),
    meta.unit === '' ? null : h('i', null, meta.unit),
  );
}

// ---------------------------------------------------------------- the tray

function riskTag(c: PlannedChange): ComponentChild {
  if (c.risk.highRisk) return h('span', { class: 'tag danger', title: c.risk.consequence ?? '' }, 'High risk');
  if (c.risk.afterWrite === 'W20') return h('span', { class: 'tag warn' }, 'Check after');
  return null;
}

const STEP_WORDS: Readonly<Record<ApplyStep['status'], string>> = { pending: 'Waiting', writing: 'Writing…', verified: 'Written and read back', failed: 'Failed', notRun: 'Not written' };

function Steps({ steps }: { readonly steps: readonly ApplyStep[] }): ComponentChild {
  return h(
    'ol',
    { class: 'apply-steps', 'aria-label': 'Write progress' },
    steps.map((s) =>
      h(
        'li',
        { key: s.key, class: `step-${s.status}`, 'data-apply-step': s.key, 'data-step-status': s.status },
        h('span', { class: 'step-mark', 'aria-hidden': 'true' }, s.status === 'verified' ? '✓' : s.status === 'failed' ? '!' : s.status === 'writing' ? '…' : '·'),
        h('span', { class: 'step-name' }, s.label, h('code', { class: 'raw-key' }, s.key)),
        h('span', { class: 'step-words' }, s.words),
        h('span', { class: 'step-status' }, STEP_WORDS[s.status], s.detail === undefined || s.status === 'verified' ? null : h('small', { class: 'block' }, s.detail)),
      ),
    ),
  );
}

function ApplyProgress({ state, model, blocked }: { readonly state: ApplyState; readonly model: WorkspaceModel | null; readonly blocked: string | null }): ComponentChild {
  if (state.kind === 'idle') return null;
  if (state.kind === 'backingUp') {
    return h('div', { class: 'apply-progress', role: 'status', 'data-apply': 'backing-up' }, h('strong', null, 'Backing up every setting first…'), ` ${state.done} of ${state.of} groups read. Nothing is written until the backup is saved.`);
  }
  const verb = state.mode === 'revert' ? 'Revert' : 'Apply';
  return h(
    'div',
    { class: `apply-progress ${state.kind}`, role: state.kind === 'failed' ? 'alert' : 'status', 'data-apply': state.kind, 'data-apply-mode': state.mode },
    state.kind === 'writing' ? h('strong', null, `${verb}: writing one setting at a time, each read back…`) : null,
    state.kind === 'done' ? h('strong', null, state.mode === 'revert' ? 'Reverted: the backed-up values were written back and read back.' : 'Applied: every change was written and read back.') : null,
    state.kind === 'failed' ? h('strong', null, state.message) : null,
    state.backupName === null || state.backupName === '' ? null : h('p', { class: 'fine', 'data-apply-backup': state.backupName }, `Backup saved before writing: ${state.backupName} (kept on this computer and downloaded).`),
    h(Steps, { steps: state.steps }),
    state.kind === 'done' && state.mode === 'apply' && state.steps.length > 0 ? h('p', { class: 'note' }, w20()) : null,
    h(
      'div',
      { class: 'tray-actions' },
      (state.kind === 'failed' && state.revertable) || (state.kind === 'done' && state.mode === 'apply' && state.steps.length > 0)
        ? h('button', { type: 'button', class: 'small danger', 'data-machine-control': 'settings-write', 'data-action': 'revert-settings', disabled: blocked !== null, title: blocked ?? 'Write the backed-up values back', onClick: () => model?.actions.value?.revertSettings() }, 'Revert to the backup')
        : null,
      state.kind === 'writing' ? null : h('button', { type: 'button', class: 'small quiet', 'data-action': 'clear-apply', onClick: () => model?.actions.value?.clearApply() }, 'Close'),
    ),
  );
}

/** The C5 confirmation. High-risk changes need a tick each and the typed word. */
export function ApplyConfirm({ changes, view, onCancel, onConfirm }: { readonly changes: readonly PlannedChange[]; readonly view: LiveView | null; readonly onCancel: () => void; readonly onConfirm: () => void }): ComponentChild {
  const high = changes.filter((c) => c.risk.highRisk);
  const [ticks, setTicks] = useState<readonly string[]>([]);
  const [typed, setTyped] = useState('');
  const boardId = boardText(view?.message?.snapshot.identity?.id) || 'no board id';
  const text = c5({ settings: changes.length, machineName: 'this board', boardId, changes: changes.map((c) => `${c.key} ${c.words}`).join('; '), highRisk: high.map((c) => c.label) });
  const ready = high.every((c) => ticks.includes(c.key)) && (high.length === 0 || typed.trim() === TYPED_WORDS.write);
  return h(
    'div',
    { class: 'dialog-wrap', 'data-dialog': 'apply-confirm' },
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
      h('p', { class: 'fine' }, 'Run backs up every setting first, then writes one setting at a time and reads each back. It stops at the first problem and offers to put the backed-up values back. Keep your hand near the E-stop.'),
      h(
        'div',
        { class: 'dialog-actions' },
        // Cancel is focused by default (SAFETY §6).
        h('button', { type: 'button', class: 'quiet', autofocus: true, 'data-action': 'cancel-apply', onClick: onCancel }, 'Cancel'),
        h('button', { type: 'button', class: high.length > 0 ? 'danger' : 'primary', 'data-machine-control': 'settings-write', 'data-action': 'confirm-apply', disabled: !ready || settingsWriteBlocked(view) !== null, onClick: onConfirm }, high.length > 0 ? 'Back up and write' : 'Back up and write'),
      ),
    ),
  );
}

/** The pending changes tray, shown in the Board view while there are changes or a write result. */
export function PendingTray({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const [open, setOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const drafts = Object.keys(draftStore.value.value);
  const apply = view?.apply ?? { kind: 'idle' as const };
  if (drafts.length === 0 && apply.kind === 'idle') return null;
  const plan = pendingPlan(view);
  const blocked = settingsWriteBlocked(view);
  const running = apply.kind === 'backingUp' || apply.kind === 'writing';
  const changes = plan !== null && plan.ok ? plan.changes : [];
  const highCount = changes.filter((c) => c.risk.highRisk).length;
  return h(
    'section',
    { class: `pending-tray${open ? ' open' : ''}`, 'data-region': 'pending-changes', 'aria-labelledby': 'pending-title' },
    h(
      'header',
      { class: 'tray-head' },
      h('button', { type: 'button', class: 'tray-toggle', 'data-action': 'toggle-pending', 'aria-expanded': open ? 'true' : 'false', onClick: () => setOpen((o) => !o) }, h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'), h('h2', { id: 'pending-title' }, 'Pending changes'), h('span', { class: 'tab-badge' }, String(drafts.length))),
      highCount === 0 ? null : h('span', { class: 'tag danger' }, `${highCount} high risk`),
      h('span', { class: 'tray-why fine', 'data-settings-write': blocked === null ? 'ready' : 'blocked' }, blocked ?? 'Ready: the board is idle. Apply backs up first, then writes one setting at a time.'),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'small quiet', 'data-action': 'discard-pending', disabled: running || drafts.length === 0, onClick: () => clearDraft() }, 'Discard all'),
      h(
        'button',
        { type: 'button', class: 'small primary', 'data-machine-control': 'settings-write', 'data-action': 'apply-settings', disabled: blocked !== null || running || changes.length === 0, title: blocked ?? `Write ${changes.length} settings`, onClick: () => setConfirming(true) },
        running ? 'Writing…' : `Apply ${changes.length === 0 ? '' : changes.length} ${changes.length === 1 ? 'change' : 'changes'}`.replace('  ', ' '),
      ),
    ),
    open
      ? h(
          'div',
          { class: 'tray-body' },
          plan !== null && !plan.ok
            ? h('div', { class: 'tray-refused', role: 'alert' }, h('strong', null, 'These changes cannot be written as they are:'), h('ul', null, plan.refused.map((i) => h('li', { key: `${i.key}${i.code}` }, h('code', null, i.key), ` ${i.message}`))))
            : null,
          changes.length === 0 && plan !== null && plan.ok && drafts.length > 0 ? h('p', { class: 'fine' }, 'Every pending value already matches the board.') : null,
          changes.length === 0
            ? null
            : h(
                'table',
                { class: 'cfg-table pending-table' },
                h('thead', null, h('tr', null, ...['Setting', 'On the board', 'New value', 'What changes', ''].map((t) => h('th', { scope: 'col', key: t }, t)))),
                h(
                  'tbody',
                  null,
                  changes.map((c) =>
                    h(
                      'tr',
                      { key: c.key, 'data-pending-key': c.key, class: c.risk.highRisk ? 'high-risk' : undefined },
                      h('th', { scope: 'row' }, c.label, h('code', { class: 'raw-key' }, c.key)),
                      h('td', null, plainValue(c.key, c.from ?? undefined, view?.readout.dialectId ?? null) ?? 'Not read'),
                      h('td', { class: 'new-value' }, plainValue(c.key, c.to, view?.readout.dialectId ?? null) ?? String(c.to)),
                      h('td', { class: 'change-words' }, riskTag(c), c.risk.consequence === null ? null : h('small', { class: 'block' }, c.risk.consequence)),
                      h('td', null, h('button', { type: 'button', class: 'icon-button quiet', 'data-action': 'remove-pending', 'aria-label': `Remove the change to ${c.label}`, disabled: running, onClick: () => setDraft(c.key, null) }, '×')),
                    ),
                  ),
                ),
              ),
          h(ApplyProgress, { state: apply, model, blocked }),
        )
      : null,
    confirming
      ? h(ApplyConfirm, {
          changes,
          view,
          onCancel: () => setConfirming(false),
          onConfirm: () => {
            setConfirming(false);
            model?.actions.value?.applySettings(changes);
          },
        })
      : null,
  );
}

// ---------------------------------------------------------------- all settings

/** "All settings": grouped, searchable, plain names, units and descriptions, with an editor where writable. */
export function SettingsTable({ view }: { readonly view: LiveView | null }): ComponentChild {
  const [query, setQuery] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const dialect = view?.readout.dialectId ?? null;
  const settings: Settings = view?.readout.settings ?? {};
  const groups = dialect === null ? [] : settingsReadGroups(dialect);
  const q = query.trim().toLowerCase();
  const drafts = draftStore.value.value;
  const rows = groups
    .map((g) => {
      const members = g.members.filter((k) => {
        if (changedOnly && drafts[k] === undefined) return false;
        if (q === '') return true;
        const m = settingMeta(k, dialect);
        return [k, m.label, m.description, g.title].some((x) => x.toLowerCase().includes(q));
      });
      return { g, members };
    })
    .filter((x) => x.members.length > 0);
  const total = rows.reduce((n, r) => n + r.members.length, 0);
  return h(
    'section',
    { class: 'settings-table', 'data-region': 'all-settings', 'aria-labelledby': 'all-settings-title' },
    h(
      'div',
      { class: 'settings-tools' },
      h('h2', { id: 'all-settings-title' }, 'All settings'),
      h('input', { type: 'search', class: 'settings-search', placeholder: 'Search by name, key or description', 'aria-label': 'Search settings', value: query, onInput: (e: Event) => setQuery((e.currentTarget as HTMLInputElement).value) }),
      h('label', { class: 'settings-filter' }, h('input', { type: 'checkbox', 'aria-label': 'Only pending changes', checked: changedOnly, onChange: (e: Event) => setChangedOnly((e.currentTarget as HTMLInputElement).checked) }), ' Only pending changes'),
      h('span', { class: 'fine' }, Object.keys(settings).length === 0 ? '' : `${total} settings`),
    ),
    Object.keys(settings).length === 0
      ? null
      : h(
          'table',
          { class: 'cfg-table all-settings' },
          h('thead', null, h('tr', null, ...['Setting', 'On the board', 'New value', 'Units', 'What it does'].map((t) => h('th', { scope: 'col', key: t }, t)))),
          rows.map(({ g, members }) =>
            h(
              'tbody',
              { key: g.token, 'data-group': g.token },
              h('tr', { class: 'group-row' }, h('th', { colSpan: 5, scope: 'rowgroup' }, h('span', null, g.title), h('small', null, g.explanation))),
              members.map((k) => {
                const m = settingMeta(k, dialect);
                const v = settings[k];
                return h(
                  'tr',
                  { key: k, 'data-key': k, class: drafts[k] !== undefined ? 'drafted' : undefined },
                  h('th', { scope: 'row' }, m.label === k ? h('span', null, k) : [h('span', { key: 'l' }, m.label), h('code', { key: 'k', class: 'raw-key' }, k)]),
                  h('td', { 'data-value': '' }, v === undefined ? h('span', { class: 'muted' }, 'Not read') : (plainValue(k, v, dialect) ?? '').replace(` ${m.unit}`, '')),
                  h('td', null, h(SettingEditor, { k, view })),
                  h('td', { class: 'muted' }, m.unit),
                  h('td', { class: 'settings-desc' }, m.description),
                );
              }),
            ),
          ),
        ),
  );
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
    { class: 'insp', 'data-region': 'restore' },
    h('header', null, h('h2', null, 'Restore'), h('span', { class: 'tag' }, 'From a backup file')),
    h('p', { class: 'fine' }, 'Choose a backup file. Its values become pending changes, matched by setting name; identity, read-only and never-written settings are skipped. Review them in Pending changes, then Apply: Run backs up the board first and writes one setting at a time.'),
    h(
      'label',
      { class: `button wide file-pick${blocked === null ? '' : ' disabled'}` },
      'Restore a backup…',
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
