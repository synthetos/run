import { afterEach, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { FirstVisitCard, SignInCard, continued, rememberContinue, showFirstVisit } from '../src/live/FirstVisitCard.ts';
import { accountState, CHECKING } from '../src/live/account.ts';
afterEach(() => { vi.unstubAllGlobals(); accountState.value = CHECKING; });
it('only prompts signed-out users on a host offering sign-in, never Access staging', () => {
  const out = { status: 'signed-out' as const, signIn: true, display: null, message: null };
  expect(showFirstVisit(out, 'production')).toBe(true);
  expect(showFirstVisit(out, 'staging')).toBe(false);
  for (const status of ['signed-in', 'checking', 'unavailable'] as const) expect(showFirstVisit({ ...out, status }, 'production')).toBe(false);
  expect(showFirstVisit({ ...out, signIn: false }, 'production')).toBe(false);
  accountState.value = { ...out, status: 'signed-in' };
  expect(renderToString(h(FirstVisitCard, null))).toBe('');
});
it('uses the same local sign-in entry for both links and survives unavailable storage', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
  const html = renderToString(h(SignInCard, null));
  expect(html).toContain('Sign in to connect to your machine');
  expect(html.match(/href="\/auth\/login"/g)).toHaveLength(2);
  expect(html).not.toContain('aria-modal'); expect(html).not.toContain('dialog-wrap');
  expect(continued()).toBe(false); expect(() => rememberContinue()).not.toThrow();
  expect(continued(() => '1')).toBe(true); expect(continued(() => null)).toBe(false);
  const write = vi.fn(); rememberContinue(write); expect(write).toHaveBeenCalledOnce();
  vi.stubGlobal('localStorage', { getItem: () => '1' });
  expect(renderToString(h(SignInCard, null))).toBe('');
});
