/**
 * The sign-in front door (docs/superpowers/specs/2026-11-16-first-run-design.md §5.2): the workspace dimmed under
 * one dialog with the run wordmark and a single "Continue with GitHub" link. The link is a plain `<a>` to the
 * Worker's `/auth/login` (run's CSP has `form-action 'none'`); nothing here touches browser storage. The rest of the
 * page is `inert` while locked (AppShell), which keeps Tab inside the dialog.
 */
import { h, type ComponentChild } from 'preact';
import { GitHubMark } from '../brand/GitHubMark.ts';
import { RunWordmark } from '../brand/RunWordmark.ts';
import { accountState, signInHref } from '../live/account.ts';
import { Icon } from '../workspace/icons.ts';
import { gateState, hostedOrigin, type GateKind } from './gateState.ts';

export const GATE_TITLE = 'Sign in to use Run';
export const GATE_TEXT = 'Run keeps your machines, tools, materials and projects in your Synthetos account. Signing in takes one click with GitHub.';
export const GATE_BUTTON = 'Continue with GitHub';
export const GATE_NEW = 'New here? The same button creates your Synthetos account.';
export const GATE_STORE = 'What we store';
export const GATE_OVERVIEW = 'What is Run? Read the overview';
export const GATE_SOON = 'Sign-in opens on this site soon.';
export const GATE_DOWN = 'The account service did not answer. Try again in a minute.';
export const STORE_HREF = 'https://accounts.synthetos.com/privacy';
export const OVERVIEW_HREF = 'https://github.com/synthetos/run#readme';

/** Stable identity: Preact then calls it on mount and unmount only, never on a parent's re-render. */
const focusOnMount = (el: HTMLElement | null): void => { el?.focus(); };

function gateBody(kind: GateKind, href: string): ComponentChild[] {
  const offered = kind === 'sign-in' || kind === 'unavailable';
  return [
    h(RunWordmark, { height: 44, label: 'run' }),
    h('h2', { id: 'gate-title' }, GATE_TITLE),
    h('p', { class: 'gate-text' }, GATE_TEXT),
    offered ? h('a', { class: 'button primary gate-button', href, 'data-action': 'sign-in', ref: focusOnMount }, GitHubMark(18), GATE_BUTTON) : null,
    kind === 'unavailable' ? h('p', { class: 'gate-fine', role: 'alert' }, GATE_DOWN) : null,
    kind === 'not-offered' ? h('p', { class: 'gate-fine', 'data-gate-note': 'soon' }, GATE_SOON) : null,
    offered ? h('p', { class: 'gate-fine' }, GATE_NEW, ' ', h('a', { href: STORE_HREF, rel: 'noopener', target: '_blank' }, GATE_STORE)) : null,
    h('hr', { class: 'gate-rule' }),
    h('a', { class: 'gate-learn', href: OVERVIEW_HREF, rel: 'noopener', target: '_blank' }, Icon('book', 15), GATE_OVERVIEW),
  ];
}

/** Pure: null when open, the scrim alone while checking, the scrim and the dialog for the locked kinds. */
export function SignInGateView(p: { readonly kind: GateKind; readonly href: string }): ComponentChild {
  if (p.kind === 'open') return null;
  const scrim = h('div', { class: 'gate-scrim', 'aria-hidden': 'true' });
  if (p.kind === 'checking') return scrim;
  return h(
    'div',
    null,
    scrim,
    h(
      'div',
      { class: 'gate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gate-title', 'data-gate': p.kind, tabindex: -1 },
      h('div', { class: 'dialog gate-dialog' }, ...gateBody(p.kind, p.href)),
    ),
  );
}

/** Reads the account state and the page location; a prerender has no `location` and renders nothing. */
export function SignInGate(): ComponentChild {
  const here = typeof location === 'undefined' ? null : location;
  const kind = gateState(accountState.value, here === null ? false : hostedOrigin(here.origin));
  return SignInGateView({ kind, href: signInHref(here === null ? '/' : here.pathname) });
}
