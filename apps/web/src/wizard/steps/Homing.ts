/**
 * Step 4 (spec §6.3; owner 2026-11-17: choice only). Two radio cards decide how the machine finds its zero; the
 * choice goes on the setup record, never on the board. The buttons are the existing Home controls
 * (workspace/homing.ts HomeQuick: Home all, Set machine zero here, each with its own confirmation); the choice
 * picks which one the step shows (wizard.css on `data-choice`). Needs a connected board.
 */
import { h, type ComponentChild } from 'preact';
import type { HomingChoice } from '@synthetos/library';
import { HomeQuick } from '../../workspace/homing.ts';
import { connected, type WorkspaceModel } from '../../workspace/model.ts';
import { ConnectNotice } from '../../workspace/views/run/connect.ts';

export const HOMING_TITLE = 'Homing';
export const HOMING_LEAD = 'How this machine finds its zero.';
export const CONNECT_FOR_HOMING = 'Connect the machine to home it.';

const CARDS: readonly { readonly value: HomingChoice; readonly title: string; readonly text: string }[] = [
  { value: 'switches', title: 'Limit switches fitted', text: 'Homing seeks each switch, then backs off.' },
  { value: 'none', title: 'No limit switches', text: 'You set the home position by hand. Run remembers it for this machine.' },
];

export interface HomingProps {
  readonly model: WorkspaceModel | null;
  readonly choice: HomingChoice | null;
  readonly onChoice: (c: HomingChoice) => void;
  /** The connected board is not the machine's (homingStep.ts), or null. */
  readonly mismatch: string | null;
}

export function Homing(p: HomingProps): ComponentChild {
  const view = p.model?.live.value ?? null;
  const on = view !== null && connected(view);
  return h(
    'div',
    { class: 'wizard-homing', 'data-choice': p.choice ?? 'switches' },
    CARDS.map((c) =>
      h('label', { key: c.value, class: 'pick-card' }, h('input', { type: 'radio', name: 'wizard-homing', value: c.value, checked: p.choice === c.value, onChange: () => p.onChoice(c.value) }), h('strong', null, c.title), h('p', null, c.text)),
    ),
    !on ? h('div', null, h('p', { class: 'wizard-line' }, CONNECT_FOR_HOMING), h(ConnectNotice, { model: p.model })) : null,
    on && p.mismatch !== null ? h('p', { class: 'wizard-line', role: 'alert' }, p.mismatch) : null,
    on && p.mismatch === null ? h(HomeQuick, { model: p.model }) : null,
  );
}
