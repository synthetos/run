/**
 * Entry point for https://run.synthetos.com/ (the workspace page).
 *
 * Claims the two Trusted Types policy names as its first statement
 * (security/tt.ts; imported modules evaluate earlier, see there), then
 * starts the build channel (channel/channel.ts: nothing in a release build;
 * the bench build refuses any host but localhost and marks the page, P1-00),
 * hydrates the workspace shell that the build prerendered into index.html
 * (Stage 1: workspace/AppShell.ts, one page that never reloads), wires the
 * theme toggle, loads the local libraries, starts `machine.worker` (P0-14)
 * and mounts LIVE entry (P1-05, live/mount.ts), the session owner that
 * publishes into the workspace model. The stop controls (P1-06: the W2 button,
 * Escape, the cross-tab requests and the observer panel) start before
 * hydration, and hydration runs guarded, so a rendering failure cannot
 * remove them (live/stopBoot.ts). The G-code preview (TB-03)
 * starts `gcode.worker` on its first file; that worker has no transport. Entries must never import @synthetos/testkit
 * (RUN_PLAN §5.3, enforced from P0-02).
 */
import { installTrustedTypes } from '../security/tt.ts';
import { h, hydrate } from 'preact';
import { signal } from '@preact/signals';
import { checkBuildInfo } from '../build-info/buildInfo.ts';
import { startBuildChannel } from '../channel/channel.ts';
import { gcodeWorkerSpawner } from '../gcode-worker/spawn.ts';
import { callMachineWorker, startMachineWorker } from '../machine-worker/client.ts';
import { RPC_VERSION } from '../machine-worker/rpc.ts';
import { browserLocks, openStopChannel } from '../machine-worker/stopChannel.ts';
import { mountLiveEntry } from '../live/mount.ts';
import { renderGuarded, startStopPaths } from '../live/stopBoot.ts';
import type { Timers } from '../live/tabStop.ts';
import type { LiveMarkerView } from '../preview/PreviewPanel.ts';
import { startTheme } from '../theme/theme.ts';
import { AppShell } from '../workspace/AppShell.ts';
import { createWorkspaceModel } from '../workspace/model.ts';
import { loadStoredLibraries } from '../workspace/storage.ts';
import '../styles/base.css';
import '../styles/workspace.css';
import '../styles/gcode-list.css';

const trustedTypes = installTrustedTypes();

const root = document.getElementById('app');
if (root === null) {
  throw new Error('run: #app root element is missing from the page');
}
const build = checkBuildInfo(__RUN_BUILD__);
const previousSession = signal(false);
// P1-07: the live position marker (polled `mpo`), drawn by the preview, set by LIVE entry.
const marker = signal<LiveMarkerView | null>(null);
// The document-lifetime session model the views read (workspace/model.ts).
const model = createWorkspaceModel();

// Stop controls (P1-06), before anything that could fail, hydration included: Pause, Escape and the
// cross-tab requests are never gated, and a rendering failure cannot remove them (SAFETY §4.3).
const timers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
let worker: Worker | null = null;
const { stopControls, watcher } = startStopPaths({
  target: { addEventListener: (type, listener, options) => addEventListener(type, listener, options) },
  channel: openStopChannel(),
  locks: browserLocks(),
  timers,
  newId: () => crypto.randomUUID(),
  pauseOwnWorker: () => {
    if (worker !== null) void callMachineWorker(worker, { v: RPC_VERSION, kind: 'intent', intent: 'feedhold' });
  },
  stopJobOwnWorker: () => {
    if (worker !== null) void callMachineWorker(worker, { v: RPC_VERSION, kind: 'intent', intent: 'stopJob' });
  },
});
renderGuarded(
  () =>
    hydrate(
      h(AppShell, {
        build,
        model,
        previousSession,
        stop: stopControls.view,
        onPause: () => stopControls.pause(),
        onStopJob: () => stopControls.stopJob(),
        role: stopControls.role,
        liveTab: stopControls.liveState,
        onPauseRequest: () => stopControls.request('pause'),
        onStopJobRequest: () => stopControls.request('stopJob'),
        onDismissReleased: () => watcher.dismissReleased(),
        spawn: gcodeWorkerSpawner(trustedTypes),
        marker,
      }),
      root,
    ),
  (error) => console.error('run: the workspace shell failed to render; Escape and the cross-tab stop still work', error),
);
// After hydration, so the bench marking of the version chip is not reconciled away; before the worker starts.
const channel = startBuildChannel(document);
startTheme();
loadStoredLibraries();
worker = startMachineWorker(trustedTypes);

// LIVE entry (P1-05): the D1 sign-in gate, the signed advisory, C1, W6. UI/auth layer only.
void mountLiveEntry({ channel, appSha: build.sha, worker, model, previousSession, stopControls, marker })
  .catch(() => undefined)
  .finally(() => {
    document.documentElement.dataset['ready'] = 'true';
  });
