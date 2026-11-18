/**
 * What the wizard writes to the account's setup record (spec §6.1, §6.5): finishing or skipping a step, closing
 * the wizard (dismissed, progress kept) and "Run setup again" from Preferences. Every write goes through
 * setupSync.ts into the account record queue; nothing is kept in browser storage.
 */
import { EMPTY_SETUP_RECORD } from '@synthetos/library';
import { saveSetup, setupView, type SetupPatch } from '../workspace/cloud/setupSync.ts';
import { markDone, skip, type StepId } from './wizardState.ts';

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
  saveSetup({ dismissed: false, step: 1, done: [] });
}
