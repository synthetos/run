/**
 * The Account panel in Preferences (ROADMAP A1-06: "the UI shows the signed-in name, plus a logout control denied
 * while LIVE").
 *
 * - Signed in: "Signed in as @login" and Sign out. Sign out is refused while a machine is connected (T-S58); the
 *   button says why instead of hiding.
 * - Signed out where the host offers sign-in: a Sign in link (accounts admits only the D37 allowlist for now).
 * - Elsewhere (no sign-in here, or the read failed): one plain line.
 * Pause, Stop job and the other stop controls never depend on any of this (D1).
 */
import { h, type ComponentChild } from 'preact';
import { SIGN_OUT_WHILE_LIVE, signInHref, type AccountState } from './account.ts';

export interface AccountPanelProps {
  readonly state: AccountState;
  /** A machine is connected (any LIVE state): sign-out is refused. */
  readonly live: boolean;
  readonly onSignOut: () => void;
}

export const ACCOUNT_HEAD = 'Account';
export const NOT_OFFERED = 'Signing in is not available on this site yet.';
export const UNAVAILABLE = 'Your account could not be checked. Check the connection.';
export const SIGNED_OUT = 'Not signed in. Connecting a machine needs a Synthetos account; for now sign-in is open to beta testers only.';

export function AccountPanel({ state, live, onSignOut }: AccountPanelProps): ComponentChild {
  let body: ComponentChild;
  if (state.status === 'checking') body = h('p', { class: 'fine', role: 'status' }, 'Checking your account…');
  else if (state.status === 'signed-in') {
    body = [
      h('p', { 'data-account': 'signed-in' }, 'Signed in as ', h('strong', null, h('bdi', null, state.display ?? 'your Synthetos account')), '.'),
      h(
        'button',
        { type: 'button', class: 'small', 'data-action': 'sign-out', disabled: live, title: live ? SIGN_OUT_WHILE_LIVE : undefined, onClick: onSignOut },
        'Sign out',
      ),
      live ? h('p', { class: 'fine', 'data-account': 'sign-out-refused' }, SIGN_OUT_WHILE_LIVE) : null,
    ];
  } else if (state.signIn) {
    body = [h('p', { 'data-account': 'signed-out' }, SIGNED_OUT), h('a', { class: 'button small', href: signInHref('/'), 'data-action': 'sign-in' }, 'Sign in')];
  } else body = h('p', { class: 'fine', 'data-account': state.status === 'unavailable' ? 'unavailable' : 'not-offered' }, state.status === 'unavailable' ? UNAVAILABLE : NOT_OFFERED);
  return h(
    'div',
    { class: 'panel', 'data-region': 'account' },
    h('div', { class: 'panel-head' }, h('h2', null, ACCOUNT_HEAD)),
    body,
    state.message === null ? null : h('p', { class: 'fine', role: 'alert' }, state.message),
  );
}
