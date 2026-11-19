/**
 * The sticky bar at the bottom of the Board view (Board settings spec §5.2):
 * it appears with the first pending change and shows the count, the
 * high-risk count, the consequence when there is one change, Discard and
 * Review and apply… A read-only board gets none (it gets the notice above
 * the tabs instead). The bar writes nothing.
 */
import { h, type ComponentChild } from 'preact';
import type { PlannedChange } from '@synthetos/schema';
import { clearDraft, draftStore } from '../boardFacts.ts';
import type { LiveView, WorkspaceModel } from '../model.ts';
import type { ApplyState } from '../../live/settingsApply.ts';
import { editBlocked, readOnlyNotice } from './editGate.ts';
import { pendingPlan, settingsWriteBlocked } from './pending.ts';
import { reviewOpen } from './reviewState.ts';

const RUN_WORDS: Readonly<Record<Exclude<ApplyState['kind'], 'idle'>, string>> = { backingUp: 'Backing up…', writing: 'Writing changes…', done: 'Changes written', failed: 'Writing stopped' };

function countWords(n: number, apply: ApplyState): string {
  if (n === 0 && apply.kind !== 'idle') return RUN_WORDS[apply.kind];
  return `${n} ${n === 1 ? 'change' : 'changes'} pending`;
}

interface BarState {
  readonly drafts: number;
  readonly apply: ApplyState;
  readonly changes: readonly PlannedChange[];
  readonly blocked: string | null;
}

function barState(view: LiveView | null): BarState {
  const plan = pendingPlan(view);
  return {
    drafts: Object.keys(draftStore.value.value).length,
    apply: view?.apply ?? { kind: 'idle' },
    changes: plan !== null && plan.ok ? plan.changes : [],
    blocked: editBlocked(view) ?? settingsWriteBlocked(view),
  };
}

function BarActions({ s }: { readonly s: BarState }): ComponentChild {
  const idle = s.apply.kind === 'idle';
  const running = s.apply.kind === 'backingUp' || s.apply.kind === 'writing';
  return h(
    'span',
    { class: 'bar-actions' },
    h('button', { type: 'button', class: 'small quiet', 'data-action': 'discard-pending', disabled: running || s.drafts === 0, onClick: () => clearDraft() }, 'Discard'),
    h(
      'button',
      { type: 'button', class: 'small primary', 'data-action': 'review-apply', disabled: idle && (s.blocked !== null || s.changes.length === 0), title: s.blocked ?? 'See every change before it is written', onClick: () => { reviewOpen.value = true; } },
      idle ? 'Review and apply…' : 'Show progress',
    ),
  );
}

export function PendingBar({ model }: { readonly model: WorkspaceModel | null }): ComponentChild {
  const view = model?.live.value ?? null;
  const s = barState(view);
  if (s.apply.kind === 'idle' && (s.drafts === 0 || readOnlyNotice(view) !== null)) return null;
  const high = s.changes.filter((c) => c.risk.highRisk).length;
  const one = s.changes.length === 1 ? (s.changes[0]?.risk.consequence ?? null) : null;
  return h(
    'div',
    { class: 'pending-bar', 'data-region': 'pending-bar', role: 'region', 'aria-label': 'Pending changes' },
    h('strong', { class: 'pending-count', 'data-pending-count': '' }, countWords(s.drafts, s.apply)),
    high === 0 ? null : h('span', { class: 'tag danger' }, `${high} high risk`),
    one === null ? null : h('span', { class: 'pending-one', 'data-pending-one': '', title: one }, one),
    s.blocked === null ? null : h('span', { class: 'pending-why fine' }, s.blocked),
    h('span', { class: 'grow' }),
    h(BarActions, { s }),
  );
}
