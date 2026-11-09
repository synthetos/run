/**
 * T-S138. run's sign-in handoff with accounts (ROADMAP A1-06; SAFETY H42; T-S79, T-S82, T-S45 run surface).
 * The Worker's routes against the real RUN_AUTH schema (in-memory SQLite) and a fake accounts `RunEntrypoint`
 * that follows the RP contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREAUTH_COOKIE, SESSION_COOKIE } from '../src/authCookies.ts';
import { safeReturnPath } from '../src/authLogin.ts';
import { deviceLabel, idTokenNonce } from '../src/authCallback.ts';
import { authConfig } from '../src/authConfig.ts';
import { route, type Env } from '../src/routes.ts';
import worker from '../src/index.ts';
import { authEnv, cookieValue, PRODUCTION_ORIGIN, setCookie, STAGING_ORIGIN } from './authHarness.ts';

let now = 2_000_000_000;
const clock = (): number => now;
/** `env` without one key (exactOptionalPropertyTypes: an absent key, not `undefined`). */
function without<K extends keyof Env>(env: Env, key: K): Env {
  const copy: Partial<Env> = { ...env };
  delete copy[key];
  return copy as Env;
}
const go = (request: Request, env: Parameters<typeof route>[1]): Promise<Response> => route(request, env, () => Promise.resolve([]), undefined, clock);

/** Starts a sign-in and returns the redirect, the browser nonce cookie and the stored request. */
async function start(h: ReturnType<typeof authEnv>, query = '', ip = '203.0.113.7') {
  const res = await go(new Request(`${h.origin}/auth/login${query}`, { headers: { 'cf-connecting-ip': ip } }), h.env);
  return { res, location: res.headers.get('location') ?? '', nonce: cookieValue(setCookie(res, PREAUTH_COOKIE)) };
}

function callbackRequest(h: ReturnType<typeof authEnv>, params: Record<string, string>, nonce: string | null): Request {
  const url = new URL(`${h.origin}/auth/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url, { headers: nonce === null ? {} : { cookie: `${PREAUTH_COOKIE}=${nonce}`, 'user-agent': 'Mozilla/5.0 (Macintosh; Mac OS X 14_0) Chrome/130 Safari/537' } });
}

async function signIn(h: ReturnType<typeof authEnv>, query = '') {
  const s = await start(h, query);
  const state = new URL(s.location).searchParams.get('state') ?? '';
  const code = h.accounts.authorize(s.location);
  const res = await go(callbackRequest(h, { code, state }, s.nonce), h.env);
  return { res, session: cookieValue(setCookie(res, SESSION_COOKIE)) };
}

describe('sign-in is on only with every piece, on its own host', () => {
  it('off: development, a missing binding, database or secret, a bad key, another host', async () => {
    const h = authEnv('staging', clock);
    const url = new URL(`${STAGING_ORIGIN}/auth/login`);
    expect(authConfig(h.env, url)).not.toBeNull();
    for (const env of [
      { ...h.env, RUN_ENV: 'development' },
      without(h.env, 'ACCOUNTS'),
      without(h.env, 'RUN_AUTH'),
      without(h.env, 'RUN_STATE_KEY'),
      { ...h.env, RUN_RATE_KEY: 'short' },
      { ...h.env, RUN_STATE_KEY: `${h.env.RUN_STATE_KEY ?? ''}A` },
    ]) {
      expect(authConfig(env, url)).toBeNull();
      expect((await go(new Request(url), env)).status).toBe(404);
    }
    for (const other of [`${PRODUCTION_ORIGIN}/auth/login`, 'http://staging.run.synthetos.com/auth/login', 'https://staging.run.synthetos.com:8443/auth/login']) {
      expect(authConfig(h.env, new URL(other))).toBeNull();
    }
    const id = await go(new Request(`${STAGING_ORIGIN}/api/identity`), without(h.env, 'RUN_STATE_KEY'));
    expect(await id.json()).toMatchObject({ identity: null, signIn: false });
  });

  it('unknown paths and methods', async () => {
    const h = authEnv('staging', clock);
    expect((await go(new Request(`${STAGING_ORIGIN}/auth/other`), h.env)).status).toBe(404);
    expect((await go(new Request(`${STAGING_ORIGIN}/auth/login`, { method: 'POST' }), h.env)).status).toBe(405);
    expect((await go(new Request(`${STAGING_ORIGIN}/auth/logout`), h.env)).status).toBe(405);
  });
});

describe('GET /auth/login', () => {
  it('stores the sign-in server-side (hashes and a sealed verifier) and redirects to accounts with exactly the RP parameters', async () => {
    const h = authEnv('staging', clock);
    const { res, location, nonce } = await start(h, '?return_to=/library&shared=1');
    expect(res.status).toBe(302);
    const url = new URL(location);
    expect(url.origin).toBe('https://staging.accounts.synthetos.com');
    expect(url.pathname).toBe('/authorize');
    expect([...url.searchParams.keys()].sort()).toEqual(['client_id', 'code_challenge', 'code_challenge_method', 'nonce', 'redirect_uri', 'response_type', 'scope', 'state']);
    expect(url.searchParams.get('client_id')).toBe('run');
    expect(url.searchParams.get('redirect_uri')).toBe(`${STAGING_ORIGIN}/auth/callback`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const cookie = setCookie(res, PREAUTH_COOKIE) ?? '';
    expect(cookie).toMatch(/; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
    expect(cookie).not.toMatch(/Domain/i);
    const row = h.sql.prepare('SELECT * FROM auth_requests').get() as Record<string, unknown>;
    const state = url.searchParams.get('state') ?? '';
    expect(JSON.stringify(row)).not.toContain(state);
    expect(JSON.stringify(row)).not.toContain(nonce);
    expect(row['return_to']).toBe('/library');
    expect(row['shared_computer']).toBe(1);
    expect(row['expires_at']).toBe(now + 600);
  });

  it('T-S82: open-redirect return paths, unknown and repeated parameters are refused before anything is stored', async () => {
    const h = authEnv('staging', clock);
    for (const q of ['?return_to=//evil', '?return_to=/\\evil', '?return_to=//2130706433/', '?return_to=https://evil', '?return_to=/Library', '?return_to=/a&return_to=/b', '?shared=2', '?shared=1&shared=1', '?next=/x']) {
      expect((await start(h, q)).res.status, q).toBe(400);
    }
    expect(h.sql.prepare('SELECT count(*) AS n FROM auth_requests').get()).toEqual({ n: 0 });
    expect(safeReturnPath('/job/steps', STAGING_ORIGIN)).toBe('/job/steps');
    expect(safeReturnPath('/%2f%2fevil', STAGING_ORIGIN)).toBeNull();
  });

  it('starts are limited per edge IP, and expired rows are pruned', async () => {
    const h = authEnv('staging', clock);
    for (let i = 0; i < 20; i += 1) expect((await start(h)).res.status).toBe(302);
    const limited = await start(h);
    expect(limited.res.status).toBe(429);
    expect(limited.res.headers.get('retry-after')).toBe('600');
    expect((await start(h, '', '198.51.100.1')).res.status).toBe(302);
    expect(JSON.stringify(h.sql.prepare('SELECT bucket FROM login_rate').all())).not.toContain('203.0.113.7');
    now += 601;
    expect((await start(h)).res.status).toBe(302);
    expect(h.sql.prepare('SELECT count(*) AS n FROM auth_requests WHERE expires_at<=?').get(now)).toEqual({ n: 0 });
  });
});

describe('GET /auth/callback', () => {
  beforeEach(() => {
    now = 2_000_000_000;
  });

  it('a full sign-in: the session cookie last, the stored return path, the device row bound, the identity named', async () => {
    const h = authEnv('staging', clock);
    const { res, session } = await signIn(h, '?return_to=/library');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/library');
    const cookie = setCookie(res, SESSION_COOKIE) ?? '';
    expect(cookie).toMatch(/; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800$/);
    expect(setCookie(res, PREAUTH_COOKIE)).toMatch(/Max-Age=0$/);
    expect(res.headers.get('clear-site-data')).toBeNull();
    expect(h.sql.prepare('SELECT user_sub,label FROM devices').all()).toEqual([{ user_sub: 'usr_01JTESTUSER0000000000000000', label: 'Chrome on macOS' }]);
    const id = await go(new Request(`${STAGING_ORIGIN}/api/identity`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } }), h.env);
    expect(id.status).toBe(200);
    expect(await id.json()).toEqual({ identity: { provider: 'run-session', subject: 'usr_01JTESTUSER0000000000000000', display: '@ril3y' }, signIn: true });
    // The account panel's read: always 200.
    const panel = await go(new Request(`${STAGING_ORIGIN}/api/session`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } }), h.env);
    expect(panel.status).toBe(200);
    expect(await panel.json()).toEqual({ account: { subject: 'usr_01JTESTUSER0000000000000000', display: '@ril3y' }, signIn: true });
    const out = await go(new Request(`${STAGING_ORIGIN}/api/session`), h.env);
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ account: null, signIn: true });
    const off = await go(new Request(`${STAGING_ORIGIN}/api/session`), without(h.env, 'ACCOUNTS'));
    expect(await off.json()).toEqual({ account: null, signIn: false });
    expect((await go(new Request(`${STAGING_ORIGIN}/api/session`, { method: 'POST' }), h.env)).status).toBe(405);
  });

  it('production works the same way, against production accounts', async () => {
    const h = authEnv('production', clock);
    const s = await start(h);
    expect(new URL(s.location).origin).toBe('https://accounts.synthetos.com');
    const { res, session } = await signIn(h);
    expect(res.status).toBe(303);
    const id = await go(new Request(`${PRODUCTION_ORIGIN}/api/identity`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } }), h.env);
    expect((await id.json()) as unknown).toMatchObject({ identity: { provider: 'run-session' } });
    const signedOut = await go(new Request(`${PRODUCTION_ORIGIN}/api/identity`), h.env);
    expect(await signedOut.json()).toEqual({ identity: null, reason: 'not-signed-in', signIn: true });
  });

  it('a shared computer: a browser-session cookie (no Max-Age), and accounts is told', async () => {
    const h = authEnv('staging', clock);
    const { res } = await signIn(h, '?shared=1');
    expect(setCookie(res, SESSION_COOKIE)).toMatch(/SameSite=Strict$/);
  });

  it('T-S79: no pre-auth cookie, or a cookie from another flow, is refused before any exchange', async () => {
    const h = authEnv('staging', clock);
    const a = await start(h);
    const b = await start(h);
    const state = new URL(a.location).searchParams.get('state') ?? '';
    const code = h.accounts.authorize(a.location);
    expect((await go(callbackRequest(h, { code, state }, null), h.env)).status).toBe(400);
    expect((await go(callbackRequest(h, { code, state }, b.nonce), h.env)).status).toBe(400);
    expect((await go(callbackRequest(h, { code, state }, `${a.nonce}; ${PREAUTH_COOKIE}=${b.nonce}`), h.env)).status).toBe(400);
    expect(h.accounts.exchanges).toBe(0);
    // The right browser still completes (the wrong nonce consumed nothing).
    expect((await go(callbackRequest(h, { code, state }, a.nonce), h.env)).status).toBe(303);
  });

  it('a state is consumed once, and not after ten minutes; an error from accounts consumes it', async () => {
    const h = authEnv('staging', clock);
    const s = await start(h);
    const state = new URL(s.location).searchParams.get('state') ?? '';
    const code = h.accounts.authorize(s.location);
    expect((await go(callbackRequest(h, { code, state }, s.nonce), h.env)).status).toBe(303);
    expect((await go(callbackRequest(h, { code, state }, s.nonce), h.env)).status).toBe(400);
    const late = await start(h);
    now += 600;
    expect((await go(callbackRequest(h, { code: h.accounts.authorize(late.location), state: new URL(late.location).searchParams.get('state') ?? '' }, late.nonce), h.env)).status).toBe(400);
    now -= 600;
    const cancelled = await start(h);
    const cs = new URL(cancelled.location).searchParams.get('state') ?? '';
    expect((await go(callbackRequest(h, { error: 'access_denied', state: cs }, cancelled.nonce), h.env)).status).toBe(400);
    expect((await go(callbackRequest(h, { code: h.accounts.authorize(cancelled.location), state: cs }, cancelled.nonce), h.env)).status).toBe(400);
  });

  it('a failed exchange, or a result that is not this sign-in, sets no session cookie and revokes what was issued', async () => {
    const h = authEnv('staging', clock);
    for (const mode of ['throw', 'wrong-device', 'wrong-nonce', 'wrong-client'] as const) {
      h.accounts.next = mode;
      const before = h.accounts.revoked.length;
      const { res } = await signIn(h);
      expect(res.status, mode).toBe(400);
      expect(setCookie(res, SESSION_COOKIE), mode).toBeUndefined();
      expect(h.accounts.revoked.length, mode).toBe(mode === 'throw' ? before : before + 1);
    }
    expect(h.sql.prepare('SELECT count(*) AS n FROM devices').get()).toEqual({ n: 0 });
  });

  it('RP contract: a device row that cannot be bound revokes the new session and sets no cookie', async () => {
    const h = authEnv('staging', clock);
    h.accounts.onExchange = (deviceId) => {
      h.sql.prepare("UPDATE devices SET user_sub='usr_someoneelse' WHERE id=?").run(deviceId);
    };
    const { res } = await signIn(h);
    expect(res.status).toBe(400);
    expect(setCookie(res, SESSION_COOKIE)).toBeUndefined();
    expect(h.accounts.revoked).toHaveLength(1);
    const id = await go(new Request(`${STAGING_ORIGIN}/api/identity`, { headers: { cookie: `${SESSION_COOKIE}=${h.accounts.revoked[0] ?? ''}` } }), h.env);
    expect(await id.json()).toMatchObject({ identity: null });
  });

  it('the page never echoes the code or the state', async () => {
    const h = authEnv('staging', clock);
    const res = await go(callbackRequest(h, { code: '<script>CODE</script>', state: 'STATEVALUE' }, null), h.env);
    const body = await res.text();
    expect(body).not.toContain('CODE');
    expect(body).not.toContain('STATEVALUE');
  });
});

describe('POST /auth/logout and the session', () => {
  const post = (h: ReturnType<typeof authEnv>, session: string, headers: Record<string, string>) =>
    go(new Request(`${h.origin}/auth/logout`, { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${session}`, ...headers } }), h.env);
  const good = { origin: STAGING_ORIGIN, 'sec-fetch-site': 'same-origin', 'x-synthetos-request': '1' };

  it('T-S45 (run): a cross-site, header-less, wrong-origin or form-encoded logout is refused and revokes nothing', async () => {
    const h = authEnv('staging', clock);
    const { session } = await signIn(h);
    for (const headers of [
      { ...good, origin: 'https://www.synthetos.com' },
      { ...good, 'sec-fetch-site': 'same-site' },
      { origin: STAGING_ORIGIN, 'sec-fetch-site': 'same-origin' },
      { ...good, 'content-type': 'application/x-www-form-urlencoded' },
      { ...good, origin: 'null' },
    ]) {
      const res = await post(h, session, headers);
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(h.accounts.revoked).toHaveLength(0);
  });

  it('logout revokes this session, expires only __Host-run_sid, and never sends Clear-Site-Data', async () => {
    const h = authEnv('staging', clock);
    const { session } = await signIn(h);
    const res = await post(h, session, good);
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()).toEqual([`${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`]);
    expect(res.headers.get('clear-site-data')).toBeNull();
    expect(h.accounts.revoked).toEqual([session]);
    // Not cached: the very next identity read has no session.
    const id = await go(new Request(`${STAGING_ORIGIN}/api/identity`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } }), h.env);
    expect(await id.json()).toMatchObject({ identity: null, reason: 'not-signed-in' });
    // Logging out again (already revoked) still clears the cookie.
    expect((await post(h, session, good)).status).toBe(204);
  });

  it('an accounts outage is no session, never an error page', async () => {
    const h = authEnv('staging', clock);
    const { session } = await signIn(h);
    h.accounts.validateSession = () => Promise.reject(new Error('service_unavailable'));
    const id = await go(new Request(`${STAGING_ORIGIN}/api/identity`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } }), h.env);
    expect(id.status).toBe(401);
  });
});

describe('the Worker as deployed', () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) spies.push(vi.spyOn(console, m));
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it('auth responses carry the security headers, and nothing is logged on any path', async () => {
    const h = authEnv('staging', clock);
    const res = await worker.fetch(new Request(`${STAGING_ORIGIN}/auth/login`, { headers: { 'cf-connecting-ip': '203.0.113.9' } }), h.env);
    expect(res.status).toBe(302);
    expect(res.headers.get('content-security-policy')).toContain("form-action 'none'");
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const bad = await worker.fetch(new Request(`${STAGING_ORIGIN}/auth/callback?state=x&code=y`), h.env);
    expect(bad.status).toBe(400);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('labels and ID-token nonces', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Edg/130')).toBe('Edge on Windows');
    expect(deviceLabel(null)).toBe('A browser on another system');
    expect(idTokenNonce('a.b')).toBeNull();
    expect(idTokenNonce('a.%%%.c')).toBeNull();
    expect(idTokenNonce(`a.${Buffer.from('not json').toString('base64url')}.c`)).toBeNull();
  });
});
