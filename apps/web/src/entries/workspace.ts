/**
 * Entry point for https://run.synthetos.com/ (the workspace page).
 *
 * Claims the two Trusted Types policy names as its first statement
 * (security/tt.ts; imported modules evaluate earlier, see there), then
 * starts the build channel (channel/channel.ts: nothing in a release build;
 * the bench build refuses any host but localhost and marks the page, P1-00),
 * hydrates the shell that the build prerendered into index.html, wires
 * the theme toggle, starts `machine.worker` (P0-14) and mounts LIVE entry
 * (P1-05, live/mount.ts). The stop controls (P1-06: the W2 button,
 * Escape, the cross-tab requests and the observer panel) start right after
 * hydration, before anything that can fail. Entries must never import @synthetos/testkit
 * (RUN_PLAN §5.3, enforced from P0-02).
 */
import { installTrustedTypes } from '../security/tt.ts';
import { h, hydrate, render } from 'preact';
import { effect, signal } from '@preact/signals';
import { checkBuildInfo } from '../build-info/buildInfo.ts';
import { startBuildChannel } from '../channel/channel.ts';
import { callMachineWorker, startMachineWorker } from '../machine-worker/client.ts';
import { RPC_VERSION } from '../machine-worker/rpc.ts';
import { browserLocks, openStopChannel } from '../machine-worker/stopChannel.ts';
import { mountLiveEntry } from '../live/mount.ts';
import { ObserverPanel } from '../live/ObserverPanel.ts';
import { StopControls } from '../live/stopControls.ts';
import { installEscapeStop, LockWatcher, TabStop, type Timers } from '../live/tabStop.ts';
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

// Stop controls (P1-06), before anything that could fail: Pause, Escape and the cross-tab requests are never gated.
const timers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const locks = browserLocks();
const tabStop = new TabStop({ channel: openStopChannel(), locks, timers, newId: () => crypto.randomUUID() });
let worker: Worker | null = null;
const stopControls = new StopControls({
  broadcast: (action) => tabStop.request(action),
  pauseOwnWorker: () => {
    if (worker !== null) void callMachineWorker(worker, { v: RPC_VERSION, kind: 'intent', intent: 'feedhold' });
  },
  timers,
});
hydrate(h(Shell, { build, previousSession, stop: stopControls.view, onPause: () => stopControls.pause() }), root);
installEscapeStop({ addEventListener: (type, listener, options) => addEventListener(type, listener, options) }, () => stopControls.pause());
const watcher = new LockWatcher(locks, () => stopControls.live, timers, (role) => stopControls.setRole(role));
watcher.start();
// After hydration, so the bench marking of the version chip is not reconciled away; before the worker starts.
const channel = startBuildChannel(document);
startTheme();
worker = startMachineWorker(trustedTypes);

// LIVE entry (P1-05): the D1 sign-in gate, the signed advisory, C1, W6. UI/auth layer only.
const centre = document.getElementById('main');
const bannerContainer = document.createElement('div');
bannerContainer.dataset['region'] = 'overlay-banners';
const container = document.createElement('div');
container.dataset['region'] = 'live-entry';
const observerContainer = document.createElement('div');
centre?.prepend(bannerContainer, observerContainer, container);
effect(() => {
  render(
    h(ObserverPanel, {
      role: stopControls.role.value,
      live: stopControls.liveState.value,
      onPauseRequest: () => stopControls.request('pause'),
      onStopJobRequest: () => stopControls.request('stopJob'),
      onDismiss: () => watcher.dismissReleased(),
    }),
    observerContainer,
  );
});
void mountLiveEntry({ channel, appSha: build.sha, worker, container, bannerContainer, previousSession, stopControls })
  .catch(() => undefined)
  .finally(() => {
    document.documentElement.dataset['ready'] = 'true';
  });
