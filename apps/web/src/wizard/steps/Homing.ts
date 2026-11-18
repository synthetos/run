/**
 * Step 4 (spec §6.3; owner 2026-11-17: choice only). Two radio cards decide how the machine finds its zero; the
 * choice goes on the setup record, never on the board. Homing itself moves the machine, and Pause and Stop sit in
 * the machine strip under the wizard's lock (SAFETY §4.1: never a modal over the stop controls), so the wizard
 * never offers "Home": with switches it points to the Job page. Without switches it shows the existing
 * "Set machine zero" control (workspace/homing.ts HomeQuick, G28.3: no motion), its own confirmation included;
 * wizard.css hides HomeQuick's Home button beside it. Needs a connected board.
 */
import { h, type ComponentChild } from 'preact';
import type { HomingChoice } from '@synthetos/library';
import { HomeQuick } from '../../workspace/homing.ts';
import { connected, type WorkspaceModel } from '../../workspace/model.ts';
import { ConnectNotice } from '../../workspace/views/run/connect.ts';

export const HOMING_TITLE = 'Homing';
export const HOMING_LEAD = 'How this machine finds its zero.';
export const CONNECT_FOR_HOMING = 'Connect the machine to home it.';
export const HOME_LATER = 'Home from the Job page once setup is done. Pause and Stop are beside it there.';

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

function controls(p: HomingProps): ComponentChild {
  if (p.mismatch !== null) return h('p', { class: 'wizard-line', role: 'alert' }, p.mismatch);
  if (p.choice === 'switches') return h('p', { class: 'wizard-line', 'data-wizard': 'home-later' }, HOME_LATER);
  if (p.choice === 'none') return h(HomeQuick, { model: p.model });
  return null;
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
    on ? controls(p) : h('div', null, h('p', { class: 'wizard-line' }, CONNECT_FOR_HOMING), h(ConnectNotice, { model: p.model })),
  );
}
