/**
 * The progress of an apply or a revert (SAFETY §4.6, amendment 2026-11-02):
 * backup first, then one setting at a time, each read back, with Revert to the
 * backup after a failure or after an apply. Moved unchanged from the old
 * pending tray (SettingsUi.ts); the run itself is live/settingsApply.ts.
 */
import { h, type ComponentChild } from 'preact';
import { w20 } from '@synthetos/safety';
import type { PlannedChange } from '@synthetos/schema';
import type { ApplyState, ApplyStep } from '../../live/settingsApply.ts';
import type { WorkspaceModel } from '../model.ts';

export function riskTag(c: PlannedChange): ComponentChild {
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

type RunState = Exclude<ApplyState, { readonly kind: 'idle' } | { readonly kind: 'backingUp' }>;

function headline(state: RunState): string {
  if (state.kind === 'writing') return `${state.mode === 'revert' ? 'Revert' : 'Apply'}: writing one setting at a time, each read back…`;
  if (state.kind === 'failed') return state.message;
  return state.mode === 'revert' ? 'Reverted: the backed-up values were written back and read back.' : 'Applied: every change was written and read back.';
}

/** Revert is offered after a failure that can be reverted, and after an apply that wrote something. */
function revertable(state: RunState): boolean {
  return (state.kind === 'failed' && state.revertable) || (state.kind === 'done' && state.mode === 'apply' && state.steps.length > 0);
}

function Actions({ state, model, blocked }: { readonly state: RunState; readonly model: WorkspaceModel | null; readonly blocked: string | null }): ComponentChild {
  return h(
    'div',
    { class: 'tray-actions' },
    revertable(state)
      ? h('button', { type: 'button', class: 'small danger', 'data-machine-control': 'settings-write', 'data-action': 'revert-settings', disabled: blocked !== null, title: blocked ?? 'Write the backed-up values back', onClick: () => model?.actions.value?.revertSettings() }, 'Revert to the backup')
      : null,
    state.kind === 'writing' ? null : h('button', { type: 'button', class: 'small quiet', 'data-action': 'clear-apply', onClick: () => model?.actions.value?.clearApply() }, 'Close'),
  );
}

export function ApplyProgress({ state, model, blocked }: { readonly state: ApplyState; readonly model: WorkspaceModel | null; readonly blocked: string | null }): ComponentChild {
  if (state.kind === 'idle') return null;
  if (state.kind === 'backingUp') {
    return h('div', { class: 'apply-progress', role: 'status', 'data-apply': 'backing-up' }, h('strong', null, 'Backing up every setting first…'), ` ${state.done} of ${state.of} groups read. Nothing is written until the backup is saved.`);
  }
  const backup = state.backupName === null || state.backupName === '' ? null : state.backupName;
  return h(
    'div',
    { class: `apply-progress ${state.kind}`, role: state.kind === 'failed' ? 'alert' : 'status', 'data-apply': state.kind, 'data-apply-mode': state.mode },
    h('strong', null, headline(state)),
    backup === null ? null : h('p', { class: 'fine', 'data-apply-backup': backup }, `Backup saved before writing: ${backup} (kept on this computer and downloaded).`),
    h(Steps, { steps: state.steps }),
    state.kind === 'done' && state.mode === 'apply' && state.steps.length > 0 ? h('p', { class: 'note' }, w20()) : null,
    h(Actions, { state, model, blocked }),
  );
}
