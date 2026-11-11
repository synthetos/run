import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index.ts';
import { authEnv, PRODUCTION_ORIGIN } from './authHarness.ts';
import { SESSION_COOKIE } from '../src/authCookies.ts';
import type { AccountsSession } from '../src/authConfig.ts';

function harness() {
  const h = authEnv('production', () => Math.floor(Date.now() / 1000));
  const token = 'A'.repeat(43);
  let admitted = true;
  const session: AccountsSession = { id: 'ses_1', sub: 'usr_1', name: 'owner', client: 'run', identities: [{ provider: 'github', id: '1', login: 'owner' }], absoluteExpiresAt: Math.floor(Date.now() / 1000) + 600, deviceRecordId: 'dev_1', sharedComputer: false };
  h.env.ACCOUNTS!.validateSession = vi.fn(async value => admitted && value === token ? session : null);
  h.env.ASSETS.fetch = vi.fn(async req => new Response('asset', { headers: { 'content-type': new URL(req.url).pathname.startsWith('/assets/') ? 'text/javascript' : 'text/html; charset=utf-8', 'cache-control': 'public, max-age=1000', vary: 'Accept-Encoding' } }));
  const get = (path: string, cookie = '') => worker.fetch(new Request(`${PRODUCTION_ORIGIN}${path}`, { headers: { cookie } }), h.env);
  return { ...h, session, cookie: `${SESSION_COOKIE}=${token}`, get, revoke: () => { admitted = false; } };
}

describe('server-side production serial boundary', () => {
  it('the plain shell denies serial; a validated session grants it; neither HTML response can be cached', async () => {
    const h = harness();
    for (const [cookie, policy] of [['', 'serial=()'], [h.cookie, 'serial=(self)']] as const) {
      const res = await h.get('/', cookie);
      expect(res.status).toBe(200);
      expect(res.headers.get('permissions-policy')?.split(',')[0]).toBe(policy);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('vary')).toMatch(/Accept-Encoding.*Cookie/);
    }
    h.revoke();
    expect((await h.get('/', h.cookie)).headers.get('permissions-policy')).toContain('serial=()');
  });
  it('unconfigured, expired, wrong-client, duplicate-cookie and RPC failure all fail closed', async () => {
    const h = harness();
    const check = async () => expect((await h.get('/', h.cookie)).headers.get('permissions-policy')).toContain('serial=()');
    Object.assign(h.session, { absoluteExpiresAt: 0 }); // malformed/expired binding reply
    await check();
    Object.assign(h.session, { absoluteExpiresAt: Math.floor(Date.now() / 1000) + 600, client: 'forum' });
    await check();
    Object.assign(h.session, { client: 'run' });
    expect((await h.get('/', `${h.cookie}; ${h.cookie}`)).headers.get('permissions-policy')).toContain('serial=()');
    h.env.ACCOUNTS!.validateSession = vi.fn(async () => { throw new Error('offline'); });
    await check();
    h.env.ACCOUNTS!.validateSession = vi.fn(async () => h.session);
    const off = { ...h.env, RUN_STATE_KEY: '' };
    const res = await worker.fetch(new Request(`${PRODUCTION_ORIGIN}/`, { headers: { cookie: h.cookie } }), off);
    expect(res.headers.get('permissions-policy')).toContain('serial=()');
    expect(h.env.ACCOUNTS!.validateSession).not.toHaveBeenCalled();
  });
  it('serial assets require a fresh session and are private/no-store, including failures and encoded aliases', async () => {
    const h = harness();
    const path = '/assets/serial/web-serial-chooser-12345678.js';
    for (const cookie of ['', h.cookie]) {
      const res = await h.get(path, cookie);
      expect(res.status).toBe(cookie ? 200 : 403);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('vary')).toContain('Cookie');
    }
    h.revoke();
    expect((await h.get(path, h.cookie)).status).toBe(403);
    for (const path of ['/assets/%73erial/x.js', '/%61ssets/serial/x.js', '/assets%2fserial/x.js']) expect((await h.get(path)).status).toBe(404);
    expect((await h.get('/assets/plain-12345678.js')).headers.get('cache-control')).toContain('immutable');
  });
});
