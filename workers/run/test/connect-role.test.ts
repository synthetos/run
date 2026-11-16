import { describe, expect, it } from 'vitest';
import worker from '../src/index.ts';
import { SESSION_COOKIE } from '../src/authCookies.ts';
import { authEnv } from './authHarness.ts';

const roles = ['member', 'tester', 'moderator', 'admin'] as const;

function harness(role: typeof roles[number]) {
  const h = authEnv('production', () => Math.floor(Date.now() / 1000));
  const seeded = h.accounts.seedSession(role);
  h.env.ASSETS.fetch = async () => new Response('page', { headers: { 'content-type': 'text/html' } });
  const get = (path: string, signedIn = true) => worker.fetch(new Request(`${h.origin}${path}`, {
    headers: signedIn ? { cookie: `${SESSION_COOKIE}=${seeded.token}` } : {},
  }), h.env);
  return { ...h, ...seeded, get };
}

describe('production Connect follows the validated accounts capability', () => {
  it.each(roles)('%s: document, action gate and display agree; update stays open', async role => {
    const h = harness(role);
    const allowed = role !== 'member';
    const page = await h.get('/');
    expect(page.headers.get('permissions-policy')?.split(',')[0]).toBe(allowed ? 'serial=(self)' : 'serial=()');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('vary')).toContain('Cookie');
    const gate = await h.get('/api/identity');
    expect(gate.status).toBe(allowed ? 200 : 401);
    expect(await gate.json()).toMatchObject(allowed ? { identity: { canConnect: true } } : { identity: null, reason: 'connect-not-allowed' });
    expect(await (await h.get('/api/session')).json()).toMatchObject({ account: { canConnect: allowed, display: '@ril3y' } });
    expect((await h.get('/update/')).headers.get('permissions-policy')).toContain('serial=(self)');
  });

  it('signed out has no port or action identity, with sign-in still offered', async () => {
    const h = harness('tester');
    expect((await h.get('/', false)).headers.get('permissions-policy')).toContain('serial=()');
    expect((await h.get('/api/identity', false)).status).toBe(401);
    expect(await (await h.get('/api/session', false)).json()).toEqual({ account: null, signIn: true });
  });

  it.each(['member', null] as const)('removing access (%s) takes effect on the next request with the same cookie', async role => {
    const h = harness('tester');
    expect((await h.get('/')).headers.get('permissions-policy')).toContain('serial=(self)');
    expect((await h.get('/api/identity')).status).toBe(200);
    h.accounts.setRole(h.token, role);
    expect((await h.get('/')).headers.get('permissions-policy')).toContain('serial=()');
    expect((await h.get('/api/identity')).status).toBe(401);
  });

  it.each([undefined, [], ['other'], 'run.connect', ['run.connect', 42]])('fails closed for missing/malformed grants %j, even with an admin role', async capabilities => {
    const h = harness('admin');
    Object.assign(h.session, { capabilities });
    expect((await h.get('/')).headers.get('permissions-policy')).toContain('serial=()');
    expect((await h.get('/api/identity')).status).toBe(401);
  });

  it('uses the capability, without a second role mapping in run', async () => {
    const h = harness('member');
    Object.assign(h.session, { capabilities: ['run.connect'] });
    expect((await h.get('/')).headers.get('permissions-policy')).toContain('serial=(self)');
  });
});
