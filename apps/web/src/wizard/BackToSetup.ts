/**
 * Board → Firmware's way back to the setup wizard (owners 167, 169): a quiet action at the right end of the Firmware
 * sub-tab row, shown only while the person left the wizard's firmware step for this page and the wizard would
 * otherwise be open. It stays through C6, the update and after it. While the flash runs it is disabled, with why:
 * the wizard would cover the update's progress and its Do not unplug warning (the flash itself runs in the worker).
 * The step re-checks the board when it shows again, so after an update it offers Next.
 */
import { computed } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import { pageGate } from '../gate/SignInGate.ts';
import { setupView } from '../workspace/cloud/setupSync.ts';
import { backToSetup, setupAway } from './setupActions.ts';
import { wizardOpen } from './wizardState.ts';

export const BACK_TO_SETUP = '← Back to setup';
export const FLASHING_TITLE = 'Wait until the update finishes.';

/** The wizard is open but stepped aside for the Firmware page. */
export const setupWaiting = computed(() => setupAway.value && wizardOpen(pageGate(), setupView.value));

export function BackToSetup({ flashing }: { readonly flashing: boolean }): ComponentChild {
  if (!setupWaiting.value) return null;
  return h('button', { type: 'button', class: 'small quiet setup-back', 'data-action': 'back-to-setup', disabled: flashing, title: flashing ? FLASHING_TITLE : undefined, onClick: backToSetup }, BACK_TO_SETUP);
}
