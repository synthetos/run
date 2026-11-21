/** Step 1 (spec §6.3): what setup does and what to have ready. Not skippable. */
import { h, type ComponentChild } from 'preact';

export const WELCOME_TITLE = 'Welcome to Run';
export const WELCOME_LEAD = 'Setup gets your machine ready to run.';
export const WELCOME_TIME = 'Every step can be skipped and finished later from Preferences.';
export const WELCOME_ACCOUNT = 'Your Synthetos account also signs you in to the forum and to bug reports.';

const HAVE_READY: readonly string[] = [
  'Your controller board, plugged in by USB.',
  'Your machine’s bed size.',
];

export function Welcome(): ComponentChild {
  return h(
    'div',
    { class: 'wizard-welcome' },
    h('p', { class: 'wizard-line' }, 'Have ready:'),
    h('ul', { class: 'wizard-covers' }, HAVE_READY.map((line) => h('li', { key: line }, line))),
    h('p', { class: 'wizard-line' }, WELCOME_TIME),
    h('p', { class: 'wizard-line' }, WELCOME_ACCOUNT),
  );
}
