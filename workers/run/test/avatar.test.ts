/**
 * `GET /api/avatar` (owner, 2026-11-18: the GitHub picture in the top-right account button). The page's CSP keeps
 * the browser off GitHub, so the Worker fetches the signed-in user's avatar server-side and serves it same-origin:
 * only with a validated run session, only for a numeric GitHub identity id, only an image type, at most 256 KB,
 * cached per id for a day, `private` with `vary: Cookie`. Everything else is a detail-free 401 or 404, and every
 * answer carries the security headers (index.ts).
 */
import { describe, expect, it } from 'vitest';
import { githubIdentityId, validRunSession } from '../src/authSession.ts';
import { authConfig } from '../src/authConfig.ts';
import { SESSION_COOKIE } from '../src/authCookies.ts';
import { authEnv } from './authHarness.ts';

const identities = (...ids: string[]) => ({ identities: ids.map((id) => ({ provider: 'github', id, login: 'x' })) });

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
