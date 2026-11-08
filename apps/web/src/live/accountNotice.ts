/**
 * What the Connect refusal says where no one can sign in yet (owner, 2026-11-08; first-time walk B1).
 *
 * Production accepts only the run session (authGate.ts), which has not shipped, so a Connect there can never
 * succeed. "Sign in to connect" with only an OK was a dead end: the sign-in it asked for was greyed out. This says
 * plainly that connecting needs a Synthetos account, that accounts are coming soon, and what works meanwhile, with
 * a Close. Plain words, no signal word: it is not a SAFETY §5 warning. Bench and staging keep the sign-in text.
 */
import { h, type ComponentChild } from 'preact';

export const ACCOUNT_TITLE = 'Connecting needs a Synthetos account';
export const ACCOUNT_TEXT = 'Synthetos accounts are coming soon. Until then this site cannot connect to a machine.';
export const ACCOUNT_MEANWHILE = 'What works without an account:';

/** What a visitor can do without an account, in this site. */
export const WITHOUT_ACCOUNT: readonly string[] = Object.freeze([
  'Open a G-code file or a sample and check it, with the 3D preview.',
  'Set up your machine, tools and materials in the Library.',
  'Plan the stock, workholding and work zero for a job.',
  'Keep files, photos and notes together in Projects.',
]);

export const ACCOUNT_STOPS = 'Pause and Stop job never need an account.';

/** The notice's body: the plain reason, what works meanwhile, and the wiring guide (it opens in a new tab). */
export function AccountNotice(): ComponentChild {
  return h(
    'div',
    { class: 'account-notice', 'data-account': 'coming-soon' },
    h('p', { role: 'alert' }, ACCOUNT_TEXT),
    h('p', { class: 'account-meanwhile' }, ACCOUNT_MEANWHILE),
    h(
      'ul',
      { class: 'account-works', 'data-account': 'works' },
      WITHOUT_ACCOUNT.map((item) => h('li', { key: item }, item)),
      h('li', { key: 'wiring' }, 'Read the ', h('a', { href: '/wiring/', target: '_blank', rel: 'noopener', 'data-account': 'wiring' }, 'wiring guide'), ' for your board (opens in a new tab).'),
    ),
    h('p', { class: 'fine' }, ACCOUNT_STOPS),
  );
}
