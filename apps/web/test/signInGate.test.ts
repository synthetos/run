import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { all, byAttr, one, root, text } from './tree.ts';
import { GATE_BUTTON, GATE_DOWN, GATE_SOON, GATE_TITLE, OVERVIEW_HREF, STORE_HREF, SignInGate, SignInGateView } from '../src/gate/SignInGate.ts';
import { accountState, CHECKING } from '../src/live/account.ts';

describe('SignInGateView', () => {
  it('renders nothing when open', () => {
    expect(SignInGateView({ kind: 'open', href: '/auth/login' })).toBeNull();
  });
  it('checking shows the scrim and no dialog', () => {
    const el = root(h('div', null, SignInGateView({ kind: 'checking', href: '/auth/login' })));
    expect(all(el, (e) => e.props['class'] === 'gate-scrim')).toHaveLength(1);
    expect(all(el, byAttr('role', 'dialog'))).toHaveLength(0);
  });
  it('sign-in: dialog with the wordmark alone, the title, one GitHub button to the return path, and the two links', () => {
    const el = root(h('div', null, SignInGateView({ kind: 'sign-in', href: '/auth/login?return_to=%2Fupdate%2F' })));
    const dialog = one(el, byAttr('role', 'dialog'));
    expect(dialog.props['aria-modal']).toBe('true');
    expect(dialog.props['aria-labelledby']).toBe('gate-title');
    expect(dialog.props['data-gate']).toBe('sign-in');
    expect(all(dialog, byAttr('role', 'img')).map((e) => e.props['aria-label'])).toEqual(['run']);
    expect(text(one(dialog, (e) => e.tag === 'h2'))).toBe(GATE_TITLE);
    const button = one(dialog, byAttr('data-action', 'sign-in'));
    expect(button.tag).toBe('a');
    expect(button.props['href']).toBe('/auth/login?return_to=%2Fupdate%2F');
    expect(text(button)).toContain(GATE_BUTTON);
    expect(all(dialog, (e) => e.tag === 'a').map((a) => a.props['href'])).toEqual(['/auth/login?return_to=%2Fupdate%2F', STORE_HREF, OVERVIEW_HREF]);
    expect(all(dialog, (e) => e.tag === 'button')).toHaveLength(0);
    expect(text(dialog)).not.toMatch(/E-stop|never need|Saved in this browser/);
  });
  it('not-offered: no button, the soon line', () => {
    const dialog = one(root(h('div', null, SignInGateView({ kind: 'not-offered', href: '/auth/login' }))), byAttr('role', 'dialog'));
    expect(all(dialog, byAttr('data-action', 'sign-in'))).toHaveLength(0);
    expect(text(one(dialog, byAttr('data-gate-note', 'soon')))).toBe(GATE_SOON);
    expect(all(dialog, (e) => e.tag === 'a').map((a) => a.props['href'])).toEqual([OVERVIEW_HREF]);
  });
  it('unavailable: the button stays, with the retry line as an alert', () => {
    const dialog = one(root(h('div', null, SignInGateView({ kind: 'unavailable', href: '/auth/login' }))), byAttr('role', 'dialog'));
    expect(all(dialog, byAttr('data-action', 'sign-in'))).toHaveLength(1);
    expect(text(one(dialog, byAttr('role', 'alert')))).toBe(GATE_DOWN);
  });
});

describe('SignInGate', () => {
  afterEach(() => { accountState.value = CHECKING; vi.unstubAllGlobals(); });
  it('is open on a non-hosted origin while checking, and locked once sign-in is offered', () => {
    vi.stubGlobal('location', { origin: 'http://127.0.0.1:4173', pathname: '/' });
    expect(SignInGate()).toBeNull();
    accountState.value = { status: 'signed-out', signIn: true, display: null, message: null };
    const dialog = one(root(h('div', null, h(SignInGate, null))), byAttr('role', 'dialog'));
    expect(one(dialog, byAttr('data-action', 'sign-in')).props['href']).toBe('/auth/login');
  });
  it('shows the scrim alone while checking on a hosted origin', () => {
    vi.stubGlobal('location', { origin: 'https://staging.run.synthetos.com', pathname: '/' });
    const el = root(h('div', null, h(SignInGate, null)));
    expect(all(el, (e) => e.props['class'] === 'gate-scrim')).toHaveLength(1);
    expect(all(el, byAttr('role', 'dialog'))).toHaveLength(0);
  });
});
