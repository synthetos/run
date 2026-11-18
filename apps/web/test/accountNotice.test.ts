/**
 * Connect where no one can sign in yet (owner 2026-11-08; first-time walk B1): production says connecting needs a
 * Synthetos account and that accounts are coming soon, with a Close. Staging and the bench
 * keep the sign-in refusal.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { ACCOUNT_TEXT, ACCOUNT_TITLE } from '../src/live/accountNotice.ts';
import { providersFor, RUN_SESSION_PROVIDER, signInAvailable } from '../src/live/authGate.ts';
import { ConnectPanel, refusalText, refusedTitle } from '../src/live/ConnectPanel.ts';
import { all, byAttr, root, text } from './tree.ts';

const props = { advisoryBlocked: null, onConnect: () => undefined, onConfirm: () => undefined, onCancel: () => undefined, onDisconnect: () => undefined };
const release = { kind: 'release' as const, benchIdentity: null };

describe('signInAvailable', () => {
  it('is false for every hosted release origin (the run session only; staging too since OD-40), true only with a bench identity', () => {
    expect(signInAvailable(providersFor(release, 'production'))).toBe(false);
    expect(signInAvailable(providersFor(release, null))).toBe(false);
    expect(signInAvailable(providersFor(release, 'staging'))).toBe(false);
    expect(signInAvailable([RUN_SESSION_PROVIDER])).toBe(false);
    expect(signInAvailable([])).toBe(false);
    const bench = { kind: 'bench' as const, current: () => Promise.resolve({ provider: 'bench' as const, subject: 'b' }) };
    expect(signInAvailable(providersFor({ kind: 'bench', benchIdentity: bench }, 'staging'))).toBe(true);
  });
});

describe('the account notice (B1)', () => {
  it('says plainly why, links the wiring guide, and offers Close, not OK', () => {
    const state = { step: 'refused' as const, refusal: { kind: 'signed-out' as const, signIn: false } };
    const tree = root(h(ConnectPanel, { ...props, state }));
    expect(tree.props['data-accounts']).toBe('coming-soon');
    expect(text(tree)).toContain(ACCOUNT_TEXT);
    expect(text(tree)).not.toContain('What works without an account');
    expect(all(tree, byAttr('data-account', 'wiring'))[0]?.props['href']).toBe('/wiring/');
    expect(text(tree)).not.toContain('Sign in');
    const dismiss = all(tree, byAttr('data-action', 'dismiss'));
    expect(dismiss).toHaveLength(1);
    expect(text(dismiss[0] as never)).toBe('Close');
    expect(refusedTitle(state)).toBe(ACCOUNT_TITLE);
  });
  it('where sign-in exists (staging) the refusal still asks to sign in, with OK', () => {
    const state = { step: 'refused' as const, refusal: { kind: 'signed-out' as const, signIn: true } };
    const tree = root(h(ConnectPanel, { ...props, state }));
    expect(text(tree)).toContain(refusalText(state.refusal));
    expect(tree.props['data-accounts']).toBeUndefined();
    expect(refusedTitle(state)).toBe('Not connected');
  });
});
