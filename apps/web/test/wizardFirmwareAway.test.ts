import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { EMPTY_SETUP_RECORD } from '@synthetos/library';
import { AppShell } from '../src/workspace/AppShell.ts';
import { accountState, CHECKING } from '../src/live/account.ts';
import { setupView } from '../src/workspace/cloud/setupSync.ts';
import { boardTab, firmwareSubTab, releaseRequest, updateRequest, viewRequest } from '../src/workspace/boardNavigation.ts';
import { backToSetup, leaveSetupForFirmware, restartSetup, setupAway } from '../src/wizard/setupActions.ts';
import { BackToSetup, FLASHING_TITLE } from '../src/wizard/BackToSetup.ts';

const build = { version: '1.2.3', sha: '0123456789abcdef0123456789abcdef01234567' };
const signedIn = (): void => {
  vi.stubGlobal('location', { origin: 'https://run.synthetos.com', pathname: '/' });
  accountState.value = { status: 'signed-in', signIn: true, display: '@owner', message: null };
};
const onStep3 = (): void => {
  setupView.value = { record: { ...EMPTY_SETUP_RECORD, step: 3, done: [1, 2] }, machines: 1, refreshed: true, account: true };
};

// Owner 167 (2026-11-19): the firmware step opens the full Board → Firmware page instead of a scrolling copy inside
// the frame, and that page has a way back to the step. The step stays in the setup record, so nothing is lost.
describe('the firmware step leaves the wizard for Board → Firmware → Update and comes back', () => {
  afterEach(() => {
    setupAway.value = false;
    boardTab.value = 'overview';
    firmwareSubTab.value = null;
    releaseRequest.value = null;
    updateRequest.value = null;
    viewRequest.value = null;
    accountState.value = CHECKING;
    setupView.value = { record: null, machines: 0, refreshed: false, account: false };
    vi.unstubAllGlobals();
  });

  it('Update firmware hides the wizard, unlocks the app and opens Firmware → Update with the offered release marked', () => {
    signedIn();
    onStep3();
    expect(renderToString(h(AppShell, { build }))).toContain('data-wizard-step="3"');
    leaveSetupForFirmware('tinyg-450.06.hex');
    expect(setupAway.value).toBe(true);
    expect(boardTab.value).toBe('firmware');
    expect(firmwareSubTab.value).toBe('update');
    expect(releaseRequest.value).toBe('tinyg-450.06.hex');
    // Owner 169: it starts that release's flow (C6), as the release row's own button does.
    expect(updateRequest.value).toBe('tinyg-450.06.hex');
    const html = renderToString(h(AppShell, { build }));
    expect(html).not.toContain('data-wizard-step');
    expect(html).not.toContain(' inert');
    // A quiet action at the right end of the Firmware sub-tab row, not a bordered box (owner 169).
    expect(html).toMatch(/class="subtabs-bar"[\s\S]*?role="tablist"[\s\S]*?data-action="back-to-setup"[^>]*>← Back to setup</);
    expect(html).not.toContain('setup-return');
  });

  it('Back to setup is disabled while the flash writes, with why, so the wizard never covers a running update', () => {
    signedIn();
    onStep3();
    setupAway.value = true;
    const idle = renderToString(h(BackToSetup, { flashing: false }));
    expect(idle).not.toContain('disabled');
    const flashing = renderToString(h(BackToSetup, { flashing: true }));
    expect(flashing).toMatch(/data-action="back-to-setup"[^>]*disabled/);
    expect(flashing).toContain(`title="${FLASHING_TITLE}"`);
    expect(FLASHING_TITLE).toBe('Wait until the update finishes.');
  });

  it('Back to setup returns to the same step; without a pending setup the Firmware page has no such button', () => {
    signedIn();
    onStep3();
    leaveSetupForFirmware(null);
    expect(releaseRequest.value).toBeNull();
    backToSetup();
    const html = renderToString(h(AppShell, { build }));
    expect(html).toContain('data-wizard-step="3"');
    expect(html).not.toContain('data-action="back-to-setup"');
    // Setup closed for good: no way back from the Firmware page, even if the flag was left set.
    setupView.value = { record: { ...EMPTY_SETUP_RECORD, step: 3, dismissed: true }, machines: 1, refreshed: true, account: true };
    setupAway.value = true;
    boardTab.value = 'firmware';
    expect(renderToString(h(AppShell, { build }))).not.toContain('data-action="back-to-setup"');
  });

  it('"Run setup again" from Preferences always shows the wizard', () => {
    setupAway.value = true;
    restartSetup();
    expect(setupAway.value).toBe(false);
  });
});
