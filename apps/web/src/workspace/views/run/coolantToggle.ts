/**
 * The Job page's coolant control (owner, 2026-11-18, pictures 151 and 152): one toggle, named by what the machine
 * says is wired to the board's coolant output (coolant.ts). Pressed from the report (`cof` or `com` on). On sends M8
 * (flood, or no choice yet) or M7 (mist, air); off sends M9. Hidden when the machine says nothing is wired. While the
 * machine has no choice, "Set what is wired" opens Board → the coolant pin. The gating is the spindle card's: on
 * needs the motion gate, off is stop-class. A G-code file's own M7/M8/M9 are not touched; Pause never reads this.
 */
import { h, type ComponentChild } from 'preact';
import type { MachineCoolant } from '@synthetos/library';
import type { MotionCommand } from '../../../machine-worker/rpc.ts';
import { ContextHelp } from '../../../shell/ContextHelp.ts';
import { coolantPinRef } from '../../boardFacts.ts';
import { boardTab, pinRequest, viewRequest } from '../../boardNavigation.ts';
import { coolantHelp, coolantLabel, coolantOnCommand } from '../../coolant.ts';

export const SET_WIRING = 'Set what is wired';

export interface CoolantToggleProps {
  /** The machine's choice, or null while it has none (or no machine is chosen). */
  readonly kind: MachineCoolant | null;
  /** The board reports the output on. */
  readonly pressed: boolean;
  readonly canOn: boolean;
  readonly canOff: boolean;
  readonly run: (command: MotionCommand) => void;
}

function openWiring(): void {
  boardTab.value = 'overview';
  pinRequest.value = coolantPinRef();
  viewRequest.value = 'board';
}

export function CoolantToggle(p: CoolantToggleProps): ComponentChild {
  // "Not used" hides the row only while the output is off; on (a file's M8, the terminal) it shows the off toggle.
  if (p.kind === 'none' && !p.pressed) return null;
  const label = coolantLabel(p.kind);
  const enabled = p.pressed ? p.canOff : p.canOn;
  const click = (): void => p.run(p.pressed ? { op: 'coolantOff' } : coolantOnCommand(p.kind));
  return h(
    'div',
    { class: 'coolant-row', 'data-coolant': p.kind ?? 'unset' },
    h(
      'span',
      { class: 'seg', role: 'group', 'aria-label': 'Coolant output' },
      h('button', { type: 'button', class: p.pressed ? 'selected' : undefined, 'aria-pressed': p.pressed ? 'true' : 'false', 'data-machine-control': 'coolant', ...(enabled ? { onClick: click } : { disabled: true }) }, label),
    ),
    h(ContextHelp, { id: 'coolant-help', label: 'What the coolant button sends', end: true }, coolantHelp(p.kind)),
    p.kind === null ? h('button', { type: 'button', class: 'link', 'data-action': 'coolant-set-wiring', onClick: openWiring }, SET_WIRING) : null,
  );
}
