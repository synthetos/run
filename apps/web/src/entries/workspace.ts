/**
 * Entry point for https://run.synthetos.com/ (the workspace page).
 *
 * Claims the two Trusted Types policy names as its first statement
 * (security/tt.ts; imported modules evaluate earlier, see there), then
 * hydrates the shell that the build prerendered into index.html, and wires
 * the theme toggle. Entries must never import @synthetos/testkit
 * (RUN_PLAN §5.3, enforced from P0-02).
 */
import { installTrustedTypes } from '../security/tt.ts';
import { h, hydrate } from 'preact';
import { checkBuildInfo } from '../build-info/buildInfo.ts';
import { Shell } from '../shell/Shell.ts';
import { startTheme } from '../theme/theme.ts';
import '../styles/base.css';

installTrustedTypes();

const root = document.getElementById('app');
if (root === null) {
  throw new Error('run: #app root element is missing from the page');
}
hydrate(h(Shell, { build: checkBuildInfo(__RUN_BUILD__) }), root);
startTheme();
document.documentElement.dataset['ready'] = 'true';
