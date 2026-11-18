/**
 * The account menu in the top bar: who is signed in, where the data lives, and the way in or out. It reads the same
 * account state as the Preferences panel (live/account.ts) and decides nothing about the machine: Pause, Stop job
 * and the other stop controls never depend on it (D1). Sign-in is a plain link to `/auth/login`; sign-out is
 * refused while a machine is connected (T-S58), and the button says why instead of hiding.
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { Icon } from './icons.ts';
import { accountState, SIGN_OUT_WHILE_LIVE, signInHref, signOut, type AccountState } from '../live/account.ts';
import { openReport } from '../report/state.ts';
import { liveNow } from './liveNow.ts';
import type { WorkspaceModel } from './model.ts';

export interface AccountMenuProps {
  /** The workspace model, to refuse signing in or out while a machine is connected (any LIVE state). */
  readonly model: WorkspaceModel | null;
}

/** The menu's props from the shell's optional model, kept out of the shell so its complexity does not grow. */
export const accountMenuProps = (model?: WorkspaceModel): AccountMenuProps => ({ model: model ?? null });

export const SIGN_IN_WHILE_LIVE = 'Disconnect the machine before signing in.';
export const NOT_OFFERED = 'Signing in is not available on this site yet.';
/** The signed-in user's GitHub picture, served same-origin by the run Worker (avatarRoute.ts); the page never talks to GitHub. */
export const AVATAR_SRC = '/api/avatar';

/** The round avatar: the cloud icon, and when signed in the picture over it; a failed picture hides itself and leaves the icon. */
function avatar(state: AccountState, size: 32 | 40): ComponentChild {
  return h(
    'span',
    { class: size === 40 ? 'avatar large' : 'avatar', 'aria-hidden': 'true' },
    Icon('cloud', size === 40 ? 18 : 16),
    state.status === 'signed-in'
      ? h('img', { class: 'avatar-image', src: AVATAR_SRC, alt: '', width: size, height: size, decoding: 'async', referrerpolicy: 'no-referrer', onError: (e: Event) => { (e.currentTarget as HTMLImageElement).hidden = true; } })
      : null,
  );
}

export interface AccountSummary { readonly head: string; readonly note: string; readonly sync: 'account' | 'local' }

/** The one-line summary for the button's accessible name and the menu head. */
export function accountSummary(state: AccountState): AccountSummary {
  if (state.status === 'signed-in') return { head: `Signed in as ${state.display ?? 'your Synthetos account'}`, note: 'Your library, machines and projects are saved to your account.', sync: 'account' };
  if (state.status === 'checking') return { head: 'Checking your account…', note: 'Changes are kept in this browser.', sync: 'local' };
  return { head: 'Not signed in', note: 'Changes are kept in this browser.', sync: 'local' };
}

export interface AccountMenuViewProps {
  readonly state: AccountState;
  readonly open: boolean;
  /** A machine is connected: signing in or out is refused. */
  readonly live: boolean;
  readonly onToggle: () => void;
  readonly onSignOut: () => void;
  readonly onReport: () => void;
}

function entry(p: AccountMenuViewProps): ComponentChild {
  if (p.state.status === 'signed-in') {
    return h('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'data-action': 'sign-out', disabled: p.live, title: p.live ? SIGN_OUT_WHILE_LIVE : undefined, onClick: p.onSignOut }, Icon('cloud', 15), 'Sign out');
  }
  if (!p.state.signIn) return h('p', { class: 'menu-foot', 'data-account': 'not-offered' }, NOT_OFFERED);
  if (p.live) return h('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'data-action': 'sign-in', disabled: true, title: SIGN_IN_WHILE_LIVE }, Icon('cloud', 15), 'Sign in');
  return h('a', { class: 'menu-item', role: 'menuitem', href: signInHref('/'), 'data-action': 'sign-in' }, Icon('cloud', 15), 'Sign in');
}

function syncRow(sync: AccountSummary['sync']): ComponentChild {
  const account = sync === 'account';
  return h('div', { class: 'sync-row', 'data-sync': sync }, h('div', null, h('strong', null, account ? 'Saved to your account' : 'Saved in this browser'), h('small', null, account ? 'This browser keeps a copy and syncs it.' : 'Machines, tools and materials stay on this computer.')));
}

/** The menu without its own state: the shell's wrapper below owns open/closed. */
export function AccountMenuView(p: AccountMenuViewProps): ComponentChild {
  const summary = accountSummary(p.state);
  return h(
    'div',
    { class: 'account' },
    h(
      'button',
      { type: 'button', class: 'account-button', 'aria-haspopup': 'true', 'aria-expanded': p.open ? 'true' : 'false', 'aria-controls': 'account-menu', 'aria-label': `Account: ${summary.head}. ${summary.note}`, onClick: p.onToggle },
      avatar(p.state, 32),
      h('span', { class: 'sync-badge', 'data-sync': summary.sync, 'aria-hidden': 'true' }),
    ),
    p.open
      ? h(
          'div',
          { class: 'account-menu', id: 'account-menu', role: 'menu' },
          h('div', { class: 'account-id', 'data-account': p.state.status }, avatar(p.state, 40), h('div', null, h('strong', null, h('bdi', null, summary.head)), h('small', null, summary.note))),
          syncRow(summary.sync),
          entry(p),
          h('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'data-action': 'report-problem', onClick: p.onReport }, Icon('flag', 15), 'Report a problem'),
          p.state.message === null ? null : h('p', { class: 'menu-foot', role: 'alert' }, p.state.message),
        )
      : null,
  );
}

export function AccountMenu(props: AccountMenuProps): ComponentChild {
  const [open, setOpen] = useState(false);
  const isLive = (): boolean => liveNow(props.model);
  return h(AccountMenuView, {
    state: accountState.value,
    open,
    live: isLive(),
    onToggle: () => setOpen((v) => !v),
    onSignOut: () => { setOpen(false); void signOut(isLive); },
    onReport: () => { setOpen(false); openReport({ origin: 'menu' }); },
  });
}
