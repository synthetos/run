/**
 * The top-bar account menu (workspace/AccountMenu.ts): it reflects the real account state instead of a placeholder.
 * Signed out where sign-in is offered: a Sign in link to /auth/login. Signed in: the name, "Saved to your account"
 * and Sign out, refused while a machine is connected (T-S58). Elsewhere: one plain line. The stop controls never
 * depend on any of this (D1).
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { CHECKING, SIGN_OUT_WHILE_LIVE, type AccountState } from '../src/live/account.ts';
import { AccountMenuView, accountSummary, NOT_OFFERED, SIGN_IN_WHILE_LIVE } from '../src/workspace/AccountMenu.ts';
import { all, byAttr, root, text } from './tree.ts';

const signedOut: AccountState = { status: 'signed-out', display: null, signIn: true, message: null };
const signedIn: AccountState = { status: 'signed-in', display: '@ril3y', signIn: true, message: null };
const noop = (): void => undefined;
const menu = (state: AccountState, live = false, open = true) => root(h(AccountMenuView, { state, open, live, onToggle: noop, onSignOut: noop, onReport: noop }));

describe('the account menu', () => {
  it('closed: the button names the state and the badge says where the data lives', () => {
    const closed = menu(signedOut, false, false);
    expect(all(closed, byAttr('id', 'account-menu'))).toHaveLength(0);
    expect(all(closed, byAttr('class', 'account-button'))[0]?.props['aria-label']).toBe('Account: Not signed in. Changes are kept in this browser.');
    expect(all(closed, byAttr('class', 'sync-badge'))[0]?.props['data-sync']).toBe('local');
    expect(all(menu(signedIn, false, false), byAttr('class', 'sync-badge'))[0]?.props['data-sync']).toBe('account');
  });

  it('signed out where sign-in is offered: a Sign in link to /auth/login, never a "coming soon" placeholder', () => {
    const open = menu(signedOut);
    expect(text(open)).toContain('Not signed in');
    expect(text(open)).toContain('Saved in this browser');
    expect(text(open)).not.toContain('coming soon');
    const link = all(open, byAttr('data-action', 'sign-in'))[0];
    expect(link?.tag).toBe('a');
    expect(link?.props['href']).toBe('/auth/login');
    expect(all(open, byAttr('data-action', 'report-problem'))).toHaveLength(1);
    // The sync row is state; the stop-controls reassurance line went with the text sweep (spec §7).
    expect(text(open)).not.toContain('never need');
  });

  it('T-S58: while a machine is connected, Sign in is disabled with the reason', () => {
    const control = all(menu(signedOut, true), byAttr('data-action', 'sign-in'))[0];
    expect(control?.tag).toBe('button');
    expect(control?.props['disabled']).toBe(true);
    expect(control?.props['title']).toBe(SIGN_IN_WHILE_LIVE);
  });

  it('signed in: the name, Saved to your account, and Sign out; disabled with the reason while connected', () => {
    const idle = menu(signedIn);
    expect(text(idle)).toContain('Signed in as @ril3y');
    expect(text(idle)).toContain('Saved to your account');
    expect(all(idle, byAttr('data-action', 'sign-out'))[0]?.props['disabled']).toBe(false);
    const live = all(menu(signedIn, true), byAttr('data-action', 'sign-out'))[0];
    expect(live?.props['disabled']).toBe(true);
    expect(live?.props['title']).toBe(SIGN_OUT_WHILE_LIVE);
  });

  it('elsewhere: one plain line, no control; a sign-out message shows as an alert', () => {
    const notOffered = menu({ status: 'signed-out', display: null, signIn: false, message: null });
    expect(all(notOffered, byAttr('data-action', 'sign-in'))).toHaveLength(0);
    expect(text(notOffered)).toContain(NOT_OFFERED);
    expect(accountSummary(CHECKING).head).toBe('Checking your account…');
    const failed = menu({ ...signedIn, message: 'Signing out did not work. Check the connection and try again.' });
    expect(all(failed, byAttr('role', 'alert'))[0]).toBeDefined();
  });
});
