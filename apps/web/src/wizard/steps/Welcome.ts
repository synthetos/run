/** Step 1 (spec §6.3): what the account now covers and how long setup takes. Not skippable. */
import { h, type ComponentChild } from 'preact';

export const WELCOME_TITLE = 'Welcome to Run';
export const WELCOME_LEAD = 'Your Synthetos account is ready. One sign-in now covers three things.';
export const WELCOME_TIME = 'Setup takes about five minutes. Every step can be skipped and finished later from Preferences.';

const COVERS: readonly string[] = [
  'Run: your machines, tools, materials and projects, saved to your account',
  'The forum: post and reply as you',
  'Bug reports: file them from Run, straight to GitHub',
];

export function Welcome(): ComponentChild {
  return h(
    'div',
    { class: 'wizard-welcome' },
    h('ul', { class: 'wizard-covers' }, COVERS.map((line) => h('li', { key: line }, line))),
    h('p', { class: 'wizard-line' }, WELCOME_TIME),
  );
}
