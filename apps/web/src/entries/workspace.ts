/**
 * Entry point for https://run.synthetos.com/ (the workspace page).
 *
 * Claims the two Trusted Types policy names as its first statement
 * (security/tt.ts; imported modules evaluate earlier, see there), then
 * starts the build channel (channel/channel.ts: nothing in a release build;
 * the bench build refuses any host but localhost and marks the page, P1-00),
 * hydrates the shell that the build prerendered into index.html, wires
 * the theme toggle and starts `machine.worker` (P0-14; in Phase 0 it has no
 * transport and is sent nothing). Entries must never import @synthetos/testkit
 * (RUN_PLAN §5.3, enforced from P0-02).
 */
import { installTrustedTypes } from '../security/tt.ts';
import { h, hydrate } from 'preact';
import { checkBuildInfo } from '../build-info/buildInfo.ts';
import { startBuildChannel } from '../channel/channel.ts';
import { startMachineWorker } from '../machine-worker/client.ts';
import { Shell } from '../shell/Shell.ts';
import { startTheme } from '../theme/theme.ts';
import '../styles/base.css';

const trustedTypes = installTrustedTypes();

const root = document.getElementById('app');
if (root === null) {
  throw new Error('run: #app root element is missing from the page');
}
hydrate(h(Shell, { build: checkBuildInfo(__RUN_BUILD__) }), root);
// After hydration, so the bench marking of the version chip is not reconciled away; before the worker starts.
startBuildChannel(document);
startTheme();
startMachineWorker(trustedTypes);
document.documentElement.dataset['ready'] = 'true';
