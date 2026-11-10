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
import { NotesPill } from './notes/NotesPill.ts';
import { usePublishNotes } from './notes/usePublishNotes.ts';
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

/**
 * Does what a block's button says (shared with the Run step's list): opens the Firmware tab, the settings compare or
 * the machines list, or disconnects. Clear alarm needs C13 first: the caller asks it when this returns
 * `ask-clear-alarm`.
 */
export function blockAction(id: BlockActionId, model: WorkspaceModel | null): 'ask-clear-alarm' | null {
  switch (id) {
    case 'trust':
    case 'update':
      boardTab.value = 'firmware';
      viewRequest.value = 'board';
      return null;
    case 'review':
      boardTab.value = 'settings';
      viewRequest.value = 'board';
      return null;
    case 'machines':
      viewRequest.value = 'machines';
      return null;
    case 'clear-alarm':
      return 'ask-clear-alarm';
    default:
      model?.actions.value?.disconnect();
      return null;
  }
}

/** The C13 confirmation behind Clear alarm, with the alarm's meaning; shared with the Run step's list. */
export function ClearAlarmConfirm({ model, onDone }: { readonly model: WorkspaceModel | null; readonly onDone: () => void }): ComponentChild {
  const stat = model?.live.value.message?.snapshot.live.stat;
  return h(ConfirmCard, {
    text: c13({ meaning: `The controller reports an alarm (state ${stat ?? 'unknown'}) and stopped any motion` }),
    confirm: 'Clear alarm',
    safety: 'C13',
    onCancel: onDone,
    onConfirm: () => {
      onDone();
      void model?.actions.value?.motion?.({ op: 'clearAlarm' });
    },
  });
}

export function ControlBlockCard({ block, model }: { readonly block: ControlBlock; readonly model: WorkspaceModel | null }): ComponentChild {
  const [asking, setAsking] = useState(false);
  const actions = model?.actions.value ?? null;
  const go = (id: BlockActionId): void => {
    if (blockAction(id, model) === 'ask-clear-alarm') setAsking(true);
  };
  const detail = block.detail ?? null;
  usePublishNotes('control-block', detail === null ? [] : [{ id: `block-${block.kind}`, topic: 'Connection', title: 'What the board said.', body: 'Run’s own words about this board, for help.', detail, link: { kind: 'board', tab: 'overview', label: 'Board' }, tone: 'info' }]);
  // A button that needs the LIVE actions (Clear alarm, Disconnect) is left out without them, never shown dead.
  const usable = block.actions.filter((a) => (a.id === 'clear-alarm' ? actions?.motion !== undefined : a.id === 'disconnect' ? actions !== null : true));
  return h(
    'div',
    { class: 'control-block', 'data-region': 'control-block', 'data-block': block.kind, ...(block.reason === undefined ? {} : { 'data-reason': block.reason }), role: 'status' },
    h('p', null, h('strong', null, block.title), ...block.lines.map((l) => ` ${l}`)),
    // The session's own words are a note (Notes tab), for whoever reads the log or asks for help.
    usable.length === 0
      ? null
      : h(
          'div',
          { class: 'control-block-actions' },
          usable.map((a) => h('button', { type: 'button', key: a.id, class: a.primary === true ? 'small primary' : 'small', 'data-action': `block-${a.id}`, ...(a.id === 'clear-alarm' ? { 'data-machine-control': 'clear-alarm' } : {}), onClick: () => go(a.id) }, a.label)),
          detail === null ? null : h(NotesPill, { topic: 'Connection' }),
        ),
    asking ? h(ClearAlarmConfirm, { model, onDone: () => setAsking(false) }) : null,
  );
}
