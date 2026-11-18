/**
 * `GET /api/identity` (ROADMAP P1-05, RUN_PLAN §2.2): the only identity is the
 * run session the Worker validated (A1-06, A1-07). Without one, every host
 * answers no identity, so Connect is refused. Since OD-40 staging is public
 * and has no Cloudflare Access identity of its own.
 */
import { describe, expect, it } from 'vitest';
import { type Env, route } from '../src/routes.ts';

const STAGING = 'https://staging.run.synthetos.com/api/identity';
const staging: Env = { ASSETS: { fetch: () => Promise.resolve(new Response('')) }, RUN_ENV: 'staging' };

describe('GET /api/identity without a run session', () => {
  it('a host without sign-in configured answers not-available-here, whatever headers the request carries', async () => {
    for (const [url, env] of [
      [STAGING, staging],
      ['https://run.synthetos.com/api/identity', { ...staging, RUN_ENV: 'production' }],
      ['https://run.synthetos.com/api/identity', staging],
      ['https://staging.run.synthetos.com/api/identity', { ...staging, RUN_ENV: 'production' }],
    ] as const) {
      const res = await route(new Request(url, { headers: { 'cf-access-jwt-assertion': 'a.b.c' } }), env);
      expect(res.status, url).toBe(401);
      expect(await res.json()).toEqual({ identity: null, reason: 'not-available-here', signIn: false });
      expect(res.headers.get('cache-control')).toMatch(/no-store/);
    }
  });

  it('POST is 405', async () => {
    expect((await route(new Request(STAGING, { method: 'POST' }), staging)).status).toBe(405);
  });
});
