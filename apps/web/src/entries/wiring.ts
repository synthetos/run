/**
 * Entry point for https://run.synthetos.com/wiring/ (the wiring editor,
 * ROADMAP TB-05). Claims the Trusted Types policy names first (security/tt.ts),
 * hydrates the prerendered page with the export handler, and wires the theme
 * toggle. It starts no machine worker: the editor never talks to a machine.
 * Entries must never import @synthetos/testkit (RUN_PLAN §5.3).
 */
import { installTrustedTypes } from '../security/tt.ts';
import { h, hydrate } from 'preact';
import { checkBuildInfo } from '../build-info/buildInfo.ts';
import { WiringPage } from '../pages/wiring/WiringPage.ts';
import { startTheme } from '../theme/theme.ts';
import { downloadSvgExport } from '../wiring/export.ts';
import '../styles/base.css';

const trustedTypes = installTrustedTypes();

const root = document.getElementById('app');
if (root === null) {
  throw new Error('run: #app root element is missing from the page');
}
hydrate(
  h(WiringPage, {
    build: checkBuildInfo(__RUN_BUILD__),
    onExport: (diagram, board, dialect, paper) => downloadSvgExport(trustedTypes, document, diagram, board, dialect, paper),
  }),
  root,
);
startTheme();
document.documentElement.dataset['ready'] = 'true';
