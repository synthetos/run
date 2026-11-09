/**
 * T-S139. A1-06/A1-07 in the page: the run session provider for the D1 gate, the account reads, the sign-in link, sign-out
 * refused while LIVE (T-S58), the Account panel, and production's "coming soon" notice with a beta sign-in link
 * (owner, 2026-11-09: staging first, only the owner's GitHub account for now).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { fetchAccount, postSignOut } from '../src/cloud/account.ts';
import { accountState, CHECKING, refreshAccount, signInHref, signOut, SIGN_OUT_FAILED, SIGN_OUT_WHILE_LIVE, stateFrom } from '../src/live/account.ts';
import { AccountPanel, NOT_OFFERED, SIGNED_OUT, UNAVAILABLE } from '../src/live/AccountPanel.ts';
import { ACCOUNT_TEXT, BETA_SIGN_IN } from '../src/live/accountNotice.ts';
import { AuthGate, runSessionProvider } from '../src/live/authGate.ts';
import { ConnectPanel } from '../src/live/ConnectPanel.ts';
import { all, byAttr, root, text } from './tree.ts';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
const replying = (status: number, body: unknown): Fetch => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('the run session provider (D1 gate)', () => {
  it('yields only a run-session identity, and asks every time', async () => {
    let calls = 0;
    let answer: { provider: string; subject: string } | null = { provider: 'run-session', subject: 'usr_1' };
    const gate = new AuthGate([
      runSessionProvider(() => {
        calls += 1;
        return Promise.resolve(answer);
      }),
    ]);
    expect(await gate.check('connect')).toEqual({ allowed: true, identity: { provider: 'run-session', subject: 'usr_1' } });
    answer = { provider: 'access', subject: 'x' };
    expect(await gate.check('connect')).toEqual({ allowed: false, reason: 'signed-out' });
    answer = null;
    expect(await gate.check('jog')).toEqual({ allowed: false, reason: 'signed-out' });
    const failing = new AuthGate([runSessionProvider(() => Promise.reject(new Error('offline')))]);
    expect(await failing.check('connect')).toEqual({ allowed: false, reason: 'signed-out' });
    expect(calls).toBe(3);
  });
});

describe('the account reads', () => {
  it('signed in, signed out with sign-in offered, not offered, and a failed read', async () => {
    expect(await fetchAccount(replying(200, { account: { subject: 'usr_1', display: '@ril3y' }, signIn: true }))).toEqual({ signedIn: { subject: 'usr_1', display: '@ril3y' }, signIn: true, failed: false });
    expect(await fetchAccount(replying(200, { account: null, signIn: true }))).toEqual({ signedIn: null, signIn: true, failed: false });
    expect(await fetchAccount(replying(200, { account: null, signIn: false }))).toEqual({ signedIn: null, signIn: false, failed: false });
    expect(await fetchAccount(replying(200, { account: { subject: '' }, signIn: true }))).toEqual({ signedIn: null, signIn: true, failed: false });
    expect(await fetchAccount(replying(500, { error: 'x' }))).toEqual({ signedIn: null, signIn: false, failed: true });
    expect(await fetchAccount(() => Promise.reject(new Error('offline')))).toEqual({ signedIn: null, signIn: false, failed: true });
  });

  it('sign-out is a same-origin POST with the custom header, never a form', async () => {
    let seen: RequestInit | null = null;
    let url = '';
    expect(
      await postSignOut((input, init) => {
        url = input;
        seen = init;
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    ).toBe(true);
    expect(url).toBe('/auth/logout');
    expect(seen).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'x-synthetos-request': '1' } });
    expect(await postSignOut(() => Promise.resolve(new Response(null, { status: 403 })))).toBe(false);
    expect(await postSignOut(() => Promise.reject(new Error('offline')))).toBe(false);
  });
});

describe('the account state', () => {
  beforeEach(() => {
    accountState.value = CHECKING;
  });

  it('follows the reads', async () => {
    expect(stateFrom({ signedIn: { subject: 'usr_1', display: '@ril3y' }, signIn: true, failed: false })).toEqual({ status: 'signed-in', display: '@ril3y', signIn: true, message: null });
    expect(stateFrom({ signedIn: null, signIn: false, failed: true }).status).toBe('unavailable');
    await refreshAccount(() => Promise.resolve({ signedIn: null, signIn: true, failed: false }));
    expect(accountState.value).toEqual({ status: 'signed-out', display: null, signIn: true, message: null });
  });

  it('T-S58: sign-out is refused while connected, and says why; a failure is said too', async () => {
    accountState.value = { status: 'signed-in', display: '@ril3y', signIn: true, message: null };
    let posted = 0;
    const post = () => {
      posted += 1;
      return Promise.resolve(true);
    };
    expect(await signOut(() => true, post)).toBe(false);
    expect(posted).toBe(0);
    expect(accountState.value.message).toBe(SIGN_OUT_WHILE_LIVE);
    expect(await signOut(() => false, () => Promise.resolve(false))).toBe(false);
    expect(accountState.value).toMatchObject({ status: 'signed-in', message: SIGN_OUT_FAILED });
    expect(await signOut(() => false, post)).toBe(true);
    expect(accountState.value).toEqual({ status: 'signed-out', display: null, signIn: true, message: null });
  });

  it('the sign-in link comes back only to a path the Worker accepts (T-S82)', () => {
    expect(signInHref('/')).toBe('/auth/login');
    expect(signInHref('/library')).toBe('/auth/login?return_to=%2Flibrary');
    for (const bad of ['//evil', '/\\evil', '/Library', '/a?b']) expect(signInHref(bad)).toBe('/auth/login');
  });
});

describe('the Account panel (Preferences)', () => {
  const panel = (state: Parameters<typeof AccountPanel>[0]['state'], live = false) => root(h(AccountPanel, { state, live, onSignOut: () => undefined }));

  it('signed in: the name and Sign out; while connected Sign out is disabled with the reason', () => {
    const signedIn = { status: 'signed-in' as const, display: '@ril3y', signIn: true, message: null };
    const idle = panel(signedIn);
    expect(text(idle)).toContain('Signed in as @ril3y.');
    expect(all(idle, byAttr('data-action', 'sign-out'))[0]?.props['disabled']).toBe(false);
    const live = panel(signedIn, true);
    expect(all(live, byAttr('data-action', 'sign-out'))[0]?.props['disabled']).toBe(true);
    expect(text(live)).toContain(SIGN_OUT_WHILE_LIVE);
  });

  it('signed out where sign-in is offered: a Sign in link; elsewhere one plain line', () => {
    const offered = panel({ status: 'signed-out', display: null, signIn: true, message: null });
    expect(text(offered)).toContain(SIGNED_OUT);
    expect(all(offered, byAttr('data-action', 'sign-in'))[0]?.props['href']).toBe('/auth/login');
    expect(text(panel({ status: 'signed-out', display: null, signIn: false, message: null }))).toContain(NOT_OFFERED);
    expect(text(panel({ status: 'unavailable', display: null, signIn: false, message: null }))).toContain(UNAVAILABLE);
    expect(text(panel(CHECKING))).toContain('Checking');
  });
});

describe('production Connect for signed-out and non-allowlisted visitors', () => {
  const props = { advisoryBlocked: null, onConnect: () => undefined, onConfirm: () => undefined, onCancel: () => undefined, onDisconnect: () => undefined };
  const comingSoon = { step: 'refused' as const, refusal: { kind: 'signed-out' as const, signIn: false } };

  it('keeps the "coming soon" notice; with sign-in offered it adds one beta sign-in link', () => {
    const plain = root(h(ConnectPanel, { ...props, state: comingSoon }));
    expect(text(plain)).toContain(ACCOUNT_TEXT);
    expect(all(plain, byAttr('data-action', 'sign-in'))).toHaveLength(0);
    const beta = root(h(ConnectPanel, { ...props, state: comingSoon, signInHref: '/auth/login' }));
    expect(text(beta)).toContain(ACCOUNT_TEXT);
    expect(text(beta)).toContain(BETA_SIGN_IN);
    expect(all(beta, byAttr('data-action', 'sign-in')).map((n) => n.props['href'])).toEqual(['/auth/login']);
  });

  it('where the gate can sign in (staging), the refusal offers Sign in when the host does', () => {
    const state = { step: 'refused' as const, refusal: { kind: 'signed-out' as const, signIn: true } };
    expect(all(root(h(ConnectPanel, { ...props, state, signInHref: '/auth/login' })), byAttr('data-action', 'sign-in'))).toHaveLength(1);
    expect(all(root(h(ConnectPanel, { ...props, state })), byAttr('data-action', 'sign-in'))).toHaveLength(0);
  });
});
