/**
 * What the wizard writes to the account's setup record (spec §6.1, §6.5): finishing or skipping a step, closing
 * the wizard (dismissed, progress kept) and "Run setup again" from Preferences. Every write goes through
 * setupSync.ts into the account record queue; nothing is kept in browser storage.
 */
import { signal } from '@preact/signals';
import { EMPTY_SETUP_RECORD } from '@synthetos/library';
import { openFirmwareUpdate, releaseRequest, startFirmwareUpdate, viewRequest } from '../workspace/boardNavigation.ts';
import { saveSetup, setupView, type SetupPatch } from '../workspace/cloud/setupSync.ts';
import { markDone, skip, type StepId } from './wizardState.ts';

/**
 * True while the person left the wizard for Board → Firmware → Update (owner 167): the wizard steps aside and the
 * page offers Back to setup. The step itself stays in the setup record; this page-only flag is never stored.
 */
export const setupAway = signal(false);

/**
 * Step 3's Update firmware: the full Firmware page with that release's flow started (owner 169: C6 opens when the row
 * could start it; otherwise the rows show, the release marked). Without a release, the page alone.
 */
export function leaveSetupForFirmware(release: string | null): void {
  setupAway.value = true;
  if (release !== null) return startFirmwareUpdate(release);
  openFirmwareUpdate();
  releaseRequest.value = null;
  viewRequest.value = 'board';
}

/** The Firmware page's Back to setup: the wizard again, on the step the record holds. */
export function backToSetup(): void {
  setupAway.value = false;
}

const record = () => setupView.peek().record ?? EMPTY_SETUP_RECORD;

export function finishStep(step: StepId, patch: SetupPatch = {}): void {
  saveSetup({ ...markDone(record(), step), ...patch });
}

export function skipStep(step: StepId): void {
  saveSetup(skip(record(), step));
}

/** R6: closing keeps the progress and hides the wizard until Preferences brings it back. */
export function closeSetup(): void {
  saveSetup({ dismissed: true });
}

export function restartSetup(): void {
  setupAway.value = false;
  saveSetup({ dismissed: false, step: 1, done: [] });
}
