/**
 * `GET /api/avatar` (owner, 2026-11-18: the GitHub picture in the top-right account button). The page's CSP keeps
 * the browser off GitHub, so the Worker fetches the signed-in user's avatar server-side and serves it same-origin:
 * only with a validated run session, only for a numeric GitHub identity id, only an image type, at most 256 KB,
 * cached per id for a day, `private` with `vary: Cookie`. Everything else is a detail-free 401 or 404, and every
 * answer carries the security headers (index.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.ts';
import { githubIdentityId, validRunSession } from '../src/authSession.ts';
import { authConfig } from '../src/authConfig.ts';
import { SESSION_COOKIE } from '../src/authCookies.ts';
import { AVATAR_CACHE_CONTROL, AVATAR_MAX_BYTES, avatarRoute, memoryAvatarCache, type AvatarDeps } from '../src/avatarRoute.ts';
import { SECURITY_HEADERS } from '../src/headers.ts';
import { authEnv } from './authHarness.ts';

const identities = (...ids: string[]) => ({ identities: ids.map((id) => ({ provider: 'github', id, login: 'x' })) });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const UPSTREAM = 'https://avatars.githubusercontent.com/u/231731?s=96&v=4';

/** A signed-in production env, a fake GitHub that records every call, and a request maker. */
function harness(answer: (url: string) => Response = () => new Response(PNG, { headers: { 'content-type': 'image/png' } })) {
  const h = authEnv('production', () => Math.floor(Date.now() / 1000));
  const seeded = h.accounts.seedSession();
  const calls: { url: string; init: RequestInit }[] = [];
  const deps: AvatarDeps = { cache: memoryAvatarCache(), fetch: (url, init) => { calls.push({ url, init }); return Promise.resolve(answer(url)); } };
  const get = (signedIn = true, method = 'GET') => avatarRoute(new Request(`${h.origin}/api/avatar`, { method, headers: signedIn ? { cookie: `${SESSION_COOKIE}=${seeded.token}` } : {} }), h.env, deps);
  return { ...h, ...seeded, calls, deps, get };
}

describe('GET /api/avatar', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('without a session: 401, and GitHub is never asked', async () => {
    const h = harness();
    const res = await h.get(false);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(h.calls).toEqual([]);
  });

  it('a session without a GitHub identity: 404, nothing fetched', async () => {
    const h = harness();
    Object.assign(h.session, { identities: [] });
    const res = await h.get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(h.calls).toEqual([]);
  });

  it('proxies a PNG from the one upstream, without following redirects, private for a day, varying on the cookie', async () => {
    const h = harness();
    const res = await h.get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(AVATAR_CACHE_CONTROL);
    expect(AVATAR_CACHE_CONTROL).toBe('private, max-age=86400');
    expect(res.headers.get('vary')).toBe('Cookie');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(h.calls.map((c) => c.url)).toEqual([UPSTREAM]);
    expect(h.calls[0]?.init.redirect).toBe('manual');
    expect(h.calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses text/html, a redirect, a non-200 and a failing fetch with a detail-free 404', async () => {
    for (const answer of [
      () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
      () => new Response('nope', { status: 404, headers: { 'content-type': 'image/png' } }),
    ]) {
      const res = await harness(answer).get();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    const h = authEnv('production', () => Math.floor(Date.now() / 1000));
    const seeded = h.accounts.seedSession();
    const offline: AvatarDeps = { cache: memoryAvatarCache(), fetch: () => Promise.reject(new Error('ENOTFOUND')) };
    const res = await avatarRoute(new Request(`${h.origin}/api/avatar`, { headers: { cookie: `${SESSION_COOKIE}=${seeded.token}` } }), h.env, offline);
    expect(res.status).toBe(404);
  });

});

describe('GET /api/avatar: the size cap, the cache and the handler', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('caps the body at 256 KB: exactly the cap is served, one byte more is a 404', async () => {
    expect(AVATAR_MAX_BYTES).toBe(256 * 1024);
    const image = (n: number) => () => new Response(new Uint8Array(n), { headers: { 'content-type': 'image/jpeg' } });
    expect((await harness(image(AVATAR_MAX_BYTES)).get()).status).toBe(200);
    expect((await harness(image(AVATAR_MAX_BYTES + 1)).get()).status).toBe(404);
    const declared = () => new Response(new Uint8Array(8), { headers: { 'content-type': 'image/jpeg', 'content-length': String(AVATAR_MAX_BYTES + 1) } });
    expect((await harness(declared).get()).status).toBe(404);
  });

  it('serves the second request for the same GitHub id from the cache; another id is another fetch', async () => {
    const h = harness();
    expect((await h.get()).status).toBe(200);
    expect((await h.get()).status).toBe(200);
    expect(h.calls).toHaveLength(1);
    Object.assign(h.session, identities('7'));
    const other = await h.get();
    expect(other.status).toBe(200);
    expect(h.calls.map((c) => c.url)).toEqual([UPSTREAM, 'https://avatars.githubusercontent.com/u/7?s=96&v=4']);
  });

  it('POST is 405', async () => {
    expect((await harness().get(true, 'POST')).status).toBe(405);
  });

  it('through the handler: the image and the fail-closed security headers; signed out, a 401 with the same headers', async () => {
    const h = authEnv('production', () => Math.floor(Date.now() / 1000));
    const seeded = h.accounts.seedSession();
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { asked.push(String(input instanceof Request ? input.url : input)); return new Response(PNG, { headers: { 'content-type': 'image/png' } }); });
    const signedIn = await worker.fetch(new Request(`${h.origin}/api/avatar`, { headers: { cookie: `${SESSION_COOKIE}=${seeded.token}` } }), h.env);
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get('content-type')).toBe('image/png');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(signedIn.headers.get(name), name).toBe(value);
    expect(asked).toEqual([UPSTREAM]);
    const signedOut = await worker.fetch(new Request(`${h.origin}/api/avatar`), h.env);
    expect(signedOut.status).toBe(401);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(signedOut.headers.get(name), name).toBe(value);
    expect(asked).toHaveLength(1);
  });
});

describe('the GitHub identity id of a session', () => {
  it('is the github identity id when it is a plain number, else null', () => {
    expect(githubIdentityId(identities('231731'))).toBe('231731');
    for (const bad of ['12a', '', '1/2', '-1', '1'.repeat(21), '0x10']) expect(githubIdentityId(identities(bad)), bad).toBeNull();
    expect(githubIdentityId({ identities: [{ provider: 'google', id: '42', login: 'x' }] })).toBeNull();
    expect(githubIdentityId({ identities: [] })).toBeNull();
  });
});

describe('validRunSession', () => {
  it('is the accounts session behind a valid cookie, and null without one or for another client', async () => {
    const h = authEnv('production', () => Math.floor(Date.now() / 1000));
    const seeded = h.accounts.seedSession();
    const auth = authConfig(h.env, new URL(`${h.origin}/api/avatar`));
    if (auth === null) throw new Error('sign-in is configured in this harness');
    const withCookie = new Request(`${h.origin}/api/avatar`, { headers: { cookie: `${SESSION_COOKIE}=${seeded.token}` } });
    expect((await validRunSession(withCookie, auth))?.sub).toBe(seeded.session.sub);
    expect(await validRunSession(new Request(`${h.origin}/api/avatar`), auth)).toBeNull();
    Object.assign(seeded.session, { client: 'forum-synthetos' });
    expect(await validRunSession(withCookie, auth)).toBeNull();
  });
});
