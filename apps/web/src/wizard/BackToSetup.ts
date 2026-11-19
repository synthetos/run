/**
 * Board → Firmware → Update's way back to the setup wizard (owner 167): shown only while the person left the
 * wizard's firmware step for this page and the wizard would otherwise be open. The step re-checks the board when it
 * shows again, so after an update it offers Next.
 */
import { computed } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import { pageGate } from '../gate/SignInGate.ts';
import { setupView } from '../workspace/cloud/setupSync.ts';
import { backToSetup, setupAway } from './setupActions.ts';
import { wizardOpen } from './wizardState.ts';

export const BACK_TO_SETUP = 'Back to setup';
export const SETUP_PAUSED = 'Setup is paused at Firmware.';

/** The wizard is open but stepped aside for the Firmware page. */
export const setupWaiting = computed(() => setupAway.value && wizardOpen(pageGate(), setupView.value));

export function BackToSetup(): ComponentChild {
  if (!setupWaiting.value) return null;
  return h(
    'div',
    { class: 'setup-return', 'data-region': 'setup-return' },
    h('p', null, SETUP_PAUSED),
    h('button', { type: 'button', class: 'small primary', 'data-action': 'back-to-setup', onClick: backToSetup }, BACK_TO_SETUP),
  );
}
