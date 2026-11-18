import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { EMPTY_SETUP_RECORD } from '@synthetos/library';
import { AppShell } from '../src/workspace/AppShell.ts';
import { accountState, CHECKING } from '../src/live/account.ts';
import { setupView } from '../src/workspace/cloud/setupSync.ts';

const build = { version: '1.2.3', sha: '0123456789abcdef0123456789abcdef01234567' };
const split = (html: string): { app: string; after: string } => {
  const end = html.lastIndexOf('</footer></div>') + '</footer></div>'.length;
  return { app: html.slice(0, end), after: html.slice(end) };
};
const signedIn = (): void => {
  vi.stubGlobal('location', { origin: 'https://run.synthetos.com', pathname: '/' });
  accountState.value = { status: 'signed-in', signIn: true, display: '@owner', message: null };
};

describe('AppShell with the setup wizard', () => {
  afterEach(() => { accountState.value = CHECKING; setupView.value = { record: null, machines: 0, refreshed: false, account: false }; vi.unstubAllGlobals(); });
  it('a signed-in account with no machine gets the inert app and the wizard beside it, never the gate', () => {
    signedIn();
    setupView.value = { record: null, machines: 0, refreshed: true, account: true };
    const { app, after } = split(renderToString(h(AppShell, { build })));
    expect(app).toMatch(/^<div class="app" data-shell="workspace"[^>]* inert/);
    expect(after).toContain('data-wizard-step="1"');
    expect(after).toContain('role="dialog"');
    expect(after).not.toContain('data-gate');
  });
  it('with one machine record the shell is plain', () => {
    signedIn();
    setupView.value = { record: null, machines: 1, refreshed: true, account: true };
    const html = renderToString(h(AppShell, { build }));
    expect(html).not.toContain(' inert');
    expect(html).not.toContain('data-wizard-step');
  });
  it('a dismissed record keeps the shell plain; before the first read nothing opens', () => {
    signedIn();
    setupView.value = { record: { ...EMPTY_SETUP_RECORD, dismissed: true }, machines: 0, refreshed: true, account: true };
    expect(renderToString(h(AppShell, { build }))).not.toContain('data-wizard-step');
    setupView.value = { record: null, machines: 0, refreshed: false, account: true };
    expect(renderToString(h(AppShell, { build }))).not.toContain('data-wizard-step');
  });
  it('resumes on the record step', () => {
    signedIn();
    setupView.value = { record: { ...EMPTY_SETUP_RECORD, step: 4, done: [1, 2, 3] }, machines: 0, refreshed: true, account: true };
    expect(split(renderToString(h(AppShell, { build }))).after).toContain('data-wizard-step="4"');
  });
});
