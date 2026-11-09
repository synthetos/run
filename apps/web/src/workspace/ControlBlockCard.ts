/**
 * The card at the top of the Position panel while the machine controls are blocked (controlBlock.ts): why, in short
 * sentences, and the action that clears it as buttons. Each button opens an existing flow: the Firmware tab (the
 * flasher, and the trusted-build offer with C38), the settings compare, the machines list, Clear alarm with C13, or
 * Disconnect. UNKNOWN keeps its own exits (homing.ts UnknownExits), drawn in the same place.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { c13 } from '@synthetos/safety';
import { boardTab, viewRequest } from './boardNavigation.ts';
import { uiLevel } from './jobWorkflow.ts';
import { controlBlock, type BlockActionId, type ControlBlock } from './controlBlock.ts';
import type { WorkspaceModel } from './model.ts';
import { observingElsewhere } from './tabControl.ts';
import { trustOffered } from './trustOffer.ts';
import { ConfirmCard } from './ui.ts';

/** The block that holds for this page now, or null (controlBlock.ts with this page's tab role and trust offer). */
export function currentBlock(model: WorkspaceModel | null | undefined): ControlBlock | null {
  const view = model?.live.value ?? null;
  return controlBlock(view, { observing: observingElsewhere.value, trustOffered: trustOffered(view, view?.firmware ?? null) });
}

export function ControlBlockCard({ block, model }: { readonly block: ControlBlock; readonly model: WorkspaceModel | null }): ComponentChild {
  const [asking, setAsking] = useState(false);
  const actions = model?.actions.value ?? null;
  const stat = model?.live.value.message?.snapshot.live.stat;
  const go = (id: BlockActionId): void => {
    switch (id) {
      case 'trust':
      case 'update':
        boardTab.value = 'firmware';
        viewRequest.value = 'board';
        return;
      case 'review':
        boardTab.value = 'settings';
        viewRequest.value = 'board';
        return;
      case 'machines':
        viewRequest.value = 'machines';
        return;
      case 'clear-alarm':
        setAsking(true);
        return;
      default:
        actions?.disconnect();
    }
  };
  // A button that needs the LIVE actions (Clear alarm, Disconnect) is left out without them, never shown dead.
  const usable = block.actions.filter((a) => (a.id === 'clear-alarm' ? actions?.motion !== undefined : a.id === 'disconnect' ? actions !== null : true));
  return h(
    'div',
    { class: 'control-block', 'data-region': 'control-block', 'data-block': block.kind, ...(block.reason === undefined ? {} : { 'data-reason': block.reason }), role: 'status' },
    h('p', null, h('strong', null, block.title), ...block.lines.map((l) => ` ${l}`)),
    // Advanced: the session's own words, for whoever reads the log or asks for help.
    block.detail === null || block.detail === undefined || uiLevel.value.value !== 'advanced' ? null : h('p', { class: 'fine control-block-detail', 'data-block-detail': '' }, block.detail),
    usable.length === 0
      ? null
      : h(
          'div',
          { class: 'control-block-actions' },
          usable.map((a) => h('button', { type: 'button', key: a.id, class: a.primary === true ? 'small primary' : 'small', 'data-action': `block-${a.id}`, ...(a.id === 'clear-alarm' ? { 'data-machine-control': 'clear-alarm' } : {}), onClick: () => go(a.id) }, a.label)),
        ),
    asking
      ? h(ConfirmCard, {
          text: c13({ meaning: `The controller reports an alarm (state ${stat ?? 'unknown'}) and stopped any motion` }),
          confirm: 'Clear alarm',
          safety: 'C13',
          onCancel: () => setAsking(false),
          onConfirm: () => {
            setAsking(false);
            void actions?.motion?.({ op: 'clearAlarm' });
          },
        })
      : null,
  );
}
