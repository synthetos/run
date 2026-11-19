/**
 * Review and apply (Board settings spec §5.2): the pending changes as a diff
 * (setting, on the board, new value, what changes, risk), then C5
 * (`ApplyConfirm`) before anything is written, then the run's progress. Apply
 * and Revert are the only controls that write, through the model's
 * `applySettings` and `revertSettings` (live/settingsApply.ts: backup first,
 * one setting at a time, each read back).
 */
import { h, type ComponentChild } from 'preact';
import type { PlannedChange } from '@synthetos/schema';
import { draftStore, plainValue, setDraft } from '../boardFacts.ts';
import { uiLevel } from '../jobWorkflow.ts';
import type { LiveView, WorkspaceModel } from '../model.ts';
import { ApplyProgress, riskTag } from './ApplyProgress.ts';
import { boardBuild } from './defs.ts';
import { editBlocked, readOnlyNotice } from './editGate.ts';
import { pendingPlan, settingsWriteBlocked } from './pending.ts';
import { confirming, reviewOpen } from './reviewState.ts';
import { ApplyConfirm } from './SettingsUi.ts';

function DiffTable({ changes, view, running }: { readonly changes: readonly PlannedChange[]; readonly view: LiveView | null; readonly running: boolean }): ComponentChild {
  const dialect = view?.readout.dialectId ?? null;
  const fb = boardBuild(view);
  return h(
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
          h('td', null, plainValue(c.key, c.from ?? undefined, dialect, fb) ?? 'Not read'),
          h('td', { class: 'new-value' }, plainValue(c.key, c.to, dialect, fb) ?? String(c.to)),
          h('td', { class: 'change-words' }, riskTag(c), c.risk.consequence === null ? null : h('small', { class: 'block' }, c.risk.consequence)),
          h('td', null, h('button', { type: 'button', class: 'icon-button quiet', 'data-action': 'remove-pending', 'aria-label': `Remove the change to ${c.label}`, disabled: running, onClick: () => setDraft(c.key, null) }, '×')),
        ),
      ),
    ),
  );
}

function confirmDialog(model: WorkspaceModel | null, view: LiveView | null, changes: readonly PlannedChange[]): ComponentChild {
  return h(ApplyConfirm, {
    changes,
    view,
    onCancel: () => { confirming.value = false; },
    onConfirm: () => {
      confirming.value = false;
      model?.actions.value?.applySettings(changes);
    },
  });
}

function applyWords(running: boolean, count: number): string {
  if (running) return 'Writing…';
  return count === 0 ? 'Apply' : `Apply ${count} ${count === 1 ? 'change' : 'changes'}`;
}

function ReviewHead({ blocked, running, count }: { readonly blocked: string | null; readonly running: boolean; readonly count: number }): ComponentChild {
  return h(
    'header',
    { class: 'review-head' },
    h('h2', { id: 'review-title' }, 'Review changes'),
    h('span', { class: 'review-why fine', 'data-settings-write': blocked === null ? 'ready' : 'blocked' }, blocked ?? 'The board is idle. Apply backs up first, then writes one setting at a time.'),
    h('span', { class: 'grow' }),
    h('button', { type: 'button', class: 'small primary', 'data-machine-control': 'settings-write', 'data-action': 'apply-settings', disabled: blocked !== null || running || count === 0, title: blocked ?? `Write ${count} settings`, onClick: () => { confirming.value = true; } }, applyWords(running, count)),
    h('button', { type: 'button', class: 'small quiet', 'data-action': 'close-review', disabled: running, onClick: () => { reviewOpen.value = false; } }, 'Close'),
  );
}

function PlanNotes({ plan }: { readonly plan: ReturnType<typeof pendingPlan> }): ComponentChild {
  if (plan === null) return null;
  if (!plan.ok) {
    // The reason names the setting in words; the token sits beside it at Advanced only (OD-44).
    const advanced = uiLevel.value.value === 'advanced';
    return h('div', { class: 'tray-refused', role: 'alert' }, h('strong', null, 'These changes cannot be written as they are:'), h('ul', null, plan.refused.map((i) => h('li', { key: `${i.key}${i.code}` }, advanced ? h('code', null, i.key) : null, advanced ? ` ${i.message}` : i.message))));
  }
  return plan.changes.length === 0 && Object.keys(draftStore.value.value).length > 0 ? h('p', { class: 'fine' }, 'Every pending value already matches the board.') : null;
}

/** The review panel: open after Review and apply…, and while a run or its result is shown. */
export function ReviewPanel({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const apply = view?.apply ?? { kind: 'idle' as const };
  // Nothing to review on a board Run can't change: the bar offers Discard only (review finding 4).
  if (apply.kind === 'idle' && (!reviewOpen.value || readOnlyNotice(view) !== null)) return null;
  const plan = pendingPlan(view);
  const blocked = editBlocked(view) ?? settingsWriteBlocked(view);
  const running = apply.kind === 'backingUp' || apply.kind === 'writing';
  const changes = plan !== null && plan.ok ? plan.changes : [];
  return h(
    'section',
    { class: 'review-panel', 'data-region': 'pending-changes', 'aria-labelledby': 'review-title' },
    h(ReviewHead, { blocked, running, count: changes.length }),
    h(PlanNotes, { plan }),
    changes.length === 0 ? null : h(DiffTable, { changes, view, running }),
    h(ApplyProgress, { state: apply, model, blocked }),
    confirming.value ? confirmDialog(model, view, changes) : null,
  );
}
