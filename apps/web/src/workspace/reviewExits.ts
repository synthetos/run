/**
 * NEEDS_REVIEW never traps the user (OD-13 §5): the banner above every view
 * carries its two ways out. "Keep the board's settings" is C23 (the default
 * resolution, SAFETY §4.1: the read becomes this computer's reference, nothing
 * is written, and the session clears the overlay for this link); "Review"
 * opens the Board view's settings compare. Until one is chosen the motion
 * controls stay gated, and the Position panel's control card says so (controlBlock.ts).
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { c23 } from '@synthetos/safety';
import { selectedMachine } from './library.ts';
import { connected, type LiveView, type WorkspaceModel } from './model.ts';
import { ConfirmCard } from './ui.ts';

/** True while the board's settings differ from the reference and the user has not chosen yet. */
export function reviewApplies(view: LiveView | null): boolean {
  if (view === null || !connected(view)) return false;
  const s = view.message?.snapshot ?? null;
  const phase = view.readout.phase;
  return s !== null && s.overlays.includes('NEEDS_REVIEW') && phase.kind === 'drift' && !phase.accepted;
}

export function ReviewExits({ model, onReview }: { readonly model: WorkspaceModel | null; readonly onReview: () => void }): ComponentChild {
  const [asking, setAsking] = useState(false);
  const view = model?.live.value ?? null;
  if (!reviewApplies(view)) return null;
  const actions = model?.actions.value ?? null;
  const phase = (view as LiveView).readout.phase;
  const revision = (phase.kind === 'drift' ? (phase.reference.revision ?? 1) : 1) + 1;
  const id = (view as LiveView).message?.snapshot.identity?.id;
  const boardId = typeof id === 'string' && id.length > 0 ? id : 'unknown board';
  const machineName = selectedMachine.value?.name ?? 'this machine';
  return h(
    'div',
    { class: 'overlay-banner overlay-banner-warn review-exits', 'data-region': 'review-exits', role: 'alert' },
    h('p', null, h('strong', null, 'Settings differ from the reference. '), 'Keep what the board has, or review the differences before moving.'),
    asking
      ? h(ConfirmCard, {
          text: c23({ machineName, boardId, revision }),
          confirm: 'Keep the board’s settings',
          safety: 'C23',
          onCancel: () => setAsking(false),
          onConfirm: () => {
            setAsking(false);
            actions?.keepBoardSettings();
          },
        })
      : h(
          'div',
          { class: 'notice-actions' },
          h('button', { type: 'button', class: 'small primary', 'data-action': 'review-keep', ...(actions === null ? { disabled: true } : { onClick: () => setAsking(true) }) }, 'Keep the board’s settings…'),
          h('button', { type: 'button', class: 'small', 'data-action': 'review-open', onClick: onReview }, 'Review…'),
        ),
  );
}
