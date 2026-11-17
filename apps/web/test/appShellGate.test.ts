import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { AppShell } from '../src/workspace/AppShell.ts';
import { accountState, CHECKING } from '../src/live/account.ts';

const build = { version: '1.2.3', sha: '0123456789abcdef0123456789abcdef01234567' };
/** The prerendered shell ends with its footer; the gate, when present, follows as a sibling. */
const split = (html: string): { app: string; after: string } => {
  const end = html.lastIndexOf('</footer></div>') + '</footer></div>'.length;
  return { app: html.slice(0, end), after: html.slice(end) };
};

describe('AppShell under the sign-in gate', () => {
  afterEach(() => { accountState.value = CHECKING; vi.unstubAllGlobals(); });
  it('makes the whole app inert and shows the dialog beside it when sign-in is offered and nobody is signed in', () => {
    vi.stubGlobal('location', { origin: 'https://run.synthetos.com', pathname: '/' });
    accountState.value = { status: 'signed-out', signIn: true, display: null, message: null };
    const { app, after } = split(renderToString(h(AppShell, { build })));
    expect(app).toMatch(/^<div class="app" data-shell="workspace"[^>]* inert/);
    expect(app).not.toContain('data-gate');
    expect(after).toContain('data-gate="sign-in"');
    expect(after).toContain('role="dialog"');
    expect(app).not.toContain('data-account="first-visit"');
  });
  it('shows the scrim alone, with the app inert, while the session is still being read on a hosted origin', () => {
    vi.stubGlobal('location', { origin: 'https://run.synthetos.com', pathname: '/' });
    const { app, after } = split(renderToString(h(AppShell, { build })));
    expect(app).toMatch(/^<div class="app" data-shell="workspace"[^>]* inert/);
    expect(after).toContain('gate-scrim');
    expect(after).not.toContain('role="dialog"');
  });
  it('is the plain shell when signed in', () => {
    vi.stubGlobal('location', { origin: 'https://run.synthetos.com', pathname: '/' });
    accountState.value = { status: 'signed-in', signIn: true, display: '@owner', message: null };
    const html = renderToString(h(AppShell, { build }));
    expect(html).not.toContain(' inert');
    expect(html).not.toContain('gate-scrim');
    expect(split(html).after).toBe('');
  });
});
