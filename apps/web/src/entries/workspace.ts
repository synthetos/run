/**
 * Entry point for https://run.synthetos.com/ (the workspace page).
 *
 * Mounts the empty shell. Entries must never import @synthetos/testkit
 * (RUN_PLAN §5.3, enforced from P0-02).
 */
import { h, render } from 'preact';
import { Shell } from '../shell/Shell.tsx';

const root = document.getElementById('app');
if (root === null) {
  throw new Error('run: #app root element is missing from the page');
}
render(h(Shell, null), root);
