/**
 * What the Connect refusal says where no one can sign in yet (owner, 2026-11-08; first-time walk B1).
 *
 * Production accepts only the run session (authGate.ts), which has not shipped, so a Connect there can never
 * succeed. "Sign in to connect" with only an OK was a dead end: the sign-in it asked for was greyed out. This says
 * plainly that connecting needs a Synthetos account and that accounts are coming soon, with a Close (the "what works
 * meanwhile" list went with the sign-in front door, 2026-11-17). Plain words, no signal word: it is not a SAFETY §5 warning. Bench and staging keep the sign-in text.
 *
 * A1-07 (owner, 2026-11-09: "staging first, just my github account for now"): where the host offers sign-in, the
 * notice keeps its words and adds one small link for beta testers. accounts admits only the D37 allowlist; anyone
 * else who follows it is told "Sign-in opens with the public beta" there and comes back to this same notice.
 */
import { h, type ComponentChild } from 'preact';

export const ACCOUNT_TITLE = 'Connecting needs a Synthetos account';
export const ACCOUNT_TEXT = 'Synthetos accounts are coming soon. Until then this site cannot connect to a machine.';
export const BETA_SIGN_IN = 'Beta testers can ';
export const BETA_SIGN_IN_LINK = 'sign in';

/**
 * The notice's body: the plain reason and the wiring guide (it opens in a new tab). With `signInHref` (the host
 * offers sign-in), a small link for beta testers.
 */
export function AccountNotice({ signInHref = null }: { readonly signInHref?: string | null } = {}): ComponentChild {
  return h(
    'div',
    { class: 'account-notice', 'data-account': 'coming-soon' },
    h('p', { role: 'alert' }, ACCOUNT_TEXT),
    signInHref === null ? null : h('p', { class: 'fine', 'data-account': 'beta-sign-in' }, BETA_SIGN_IN, h('a', { href: signInHref, 'data-action': 'sign-in' }, BETA_SIGN_IN_LINK), '.'),
    h('p', null, 'Read the ', h('a', { href: '/wiring/', target: '_blank', rel: 'noopener', 'data-account': 'wiring' }, 'wiring guide'), ' for your board (opens in a new tab).'),
  );
}
