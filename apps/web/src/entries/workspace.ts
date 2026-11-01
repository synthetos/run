/**
 * Entry point for https://run.synthetos.com/ (the workspace page).
 *
 * Claims the two Trusted Types policy names as its first statement
 * (security/tt.ts; imported modules evaluate earlier, see there), then
 * mounts the empty shell. Entries must never import @synthetos/testkit
 * (RUN_PLAN §5.3, enforced from P0-02).
 */
import { installTrustedTypes } from '../security/tt.ts';
import { h, render } from 'preact';
import { Shell } from '../shell/Shell.tsx';
import '../styles/base.css';

installTrustedTypes();

const root = document.getElementById('app');
if (root === null) {
  throw new Error('run: #app root element is missing from the page');
}
render(h(Shell, null), root);
