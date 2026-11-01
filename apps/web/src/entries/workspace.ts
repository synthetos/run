/**
 * Entry point for https://run.synthetos.com/ (the workspace page).
 *
 * Claims the two Trusted Types policy names as its first statement
 * (security/tt.ts; imported modules evaluate earlier, see there), then
 * starts the build channel (channel/channel.ts: nothing in a release build;
 * the bench build refuses any host but localhost and marks the page, P1-00),
 * hydrates the shell that the build prerendered into index.html, wires
 * the theme toggle, starts `machine.worker` (P0-14) and mounts LIVE entry
 * (P1-05, live/mount.ts). Entries must never import @synthetos/testkit
 * (RUN_PLAN §5.3, enforced from P0-02).
 */
import { installTrustedTypes } from '../security/tt.ts';
import { h, hydrate } from 'preact';
import { signal } from '@preact/signals';
import { checkBuildInfo } from '../build-info/buildInfo.ts';
import { startBuildChannel } from '../channel/channel.ts';
import { startMachineWorker } from '../machine-worker/client.ts';
import { mountLiveEntry } from '../live/mount.ts';
import { Shell } from '../shell/Shell.ts';
import { startTheme } from '../theme/theme.ts';
import '../styles/base.css';

const trustedTypes = installTrustedTypes();

const root = document.getElementById('app');
if (root === null) {
  throw new Error('run: #app root element is missing from the page');
}
const build = checkBuildInfo(__RUN_BUILD__);
const previousSession = signal(false);
hydrate(h(Shell, { build, previousSession }), root);
// After hydration, so the bench marking of the version chip is not reconciled away; before the worker starts.
const channel = startBuildChannel(document);
startTheme();
const worker = startMachineWorker(trustedTypes);

// LIVE entry (P1-05): the D1 sign-in gate, the signed advisory, C1, W6. UI/auth layer only.
const centre = document.getElementById('main');
const bannerContainer = document.createElement('div');
bannerContainer.dataset['region'] = 'overlay-banners';
const container = document.createElement('div');
container.dataset['region'] = 'live-entry';
centre?.prepend(bannerContainer, container);
void mountLiveEntry({ channel, appSha: build.sha, worker, container, bannerContainer, previousSession })
  .catch(() => undefined)
  .finally(() => {
    document.documentElement.dataset['ready'] = 'true';
  });
