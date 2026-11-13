/** First-visit UX only. The server session and document serial policy remain the actual gate. */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { environmentForOrigin } from '@synthetos/protocol';
import { accountState, signInHref, type AccountState } from './account.ts';
import { useDialogDismiss } from '../workspace/dialogs/useDialogDismiss.ts';
export const FIRST_VISIT_KEY = 'run.sign-in-continued';
export function continued(read: () => string | null = () => localStorage.getItem(FIRST_VISIT_KEY)): boolean {
  try { return read() === '1'; } catch { return false; }
}
export function rememberContinue(write: () => void = () => localStorage.setItem(FIRST_VISIT_KEY, '1')): void {
  try { write(); } catch { /* Dismiss this visit even when storage is unavailable. */ }
}
export function showFirstVisit(state: AccountState, environment: string | null): boolean {
  // Access-only staging keeps its existing Connect experience. No prompt during identity loading/failure.
  return state.status === 'signed-out' && state.signIn && environment !== 'staging';
}
export function FirstVisitCard(): ComponentChild {
  const environment = typeof location === 'undefined' ? null : environmentForOrigin(location.origin);
  return showFirstVisit(accountState.value, environment) ? h(SignInCard, null) : null;
}
export function SignInCard(): ComponentChild {
  const [hidden, setHidden] = useState(continued);
  const dismiss = (): void => { rememberContinue(); setHidden(true); };
  const { ref } = useDialogDismiss(dismiss, false, null, true);
  if (hidden) return null;
  const href = signInHref(typeof location === 'undefined' ? '/' : location.pathname);
  return h('div', { ref, class: 'first-visit-card', 'data-account': 'first-visit', role: 'region', 'aria-labelledby': 'first-visit-title' },
    h('h2', { id: 'first-visit-title' }, 'Sign in to connect to your machine'),
    h('p', null, 'You can open, preview and analyze G-code. Connecting needs an account.'),
    h('div', { class: 'first-visit-actions' },
      h('a', { class: 'button primary', href, 'data-action': 'sign-in' }, 'Sign in with GitHub'),
      h('a', { class: 'button', href, 'data-action': 'create-account' }, 'Create an account'),
      h('button', { type: 'button', 'data-action': 'continue-without-account', onClick: dismiss }, 'Continue without an account')));
}
