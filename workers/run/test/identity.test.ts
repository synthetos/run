/**
 * `GET /api/identity` (ROADMAP P1-05, RUN_PLAN §2.2): the staging Worker on
 * the staging host verifies the Cloudflare Access JWT; production and every
 * other host answer no identity, so Connect is refused there.
 */
import { describe, expect, it } from 'vitest';
import { accessConfig, type Jwk, verifyAccessJwt } from '../src/accessIdentity.ts';
import { type Env, route } from '../src/routes.ts';

const TEAM = 'synthetos.cloudflareaccess.com';
const AUD = 'f'.repeat(64);
const STAGING = 'https://staging.run.synthetos.com/api/identity';
const subtle = globalThis.crypto.subtle;
function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function keyPair(kid: string): Promise<{ jwk: Jwk; sign: (claims: Record<string, unknown>, header?: Record<string, unknown>) => Promise<string> }> {
  const pair = (await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = (await subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return {
    jwk: { kid, kty: 'RSA', n: pub.n ?? '', e: pub.e ?? '' },
    async sign(claims, header = { alg: 'RS256', kid }) {
      const signing = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
      const sig = await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signing));
      return `${signing}.${b64url(new Uint8Array(sig))}`;
    },
  };
}

const nowS = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({ aud: [AUD], iss: `https://${TEAM}`, exp: nowS() + 600, iat: nowS(), email: 'owner@example.com', sub: 'u1', ...over });
const staging: Env = { ASSETS: { fetch: () => Promise.resolve(new Response('')) }, RUN_ENV: 'staging', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

describe('GET /api/identity', () => {
  it('staging host + staging Worker + a valid Access JWT: the verified identity', async () => {
    const k = await keyPair('k1');
    const req = new Request(STAGING, { headers: { 'cf-access-jwt-assertion': await k.sign(claims()) } });
    const res = await route(req, staging, () => Promise.resolve([k.jwk]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ identity: { provider: 'access', subject: 'owner@example.com' }, signIn: false });
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('production (and any other host) answers no identity, even with a valid token', async () => {
    const k = await keyPair('k1');
    const token = await k.sign(claims());
    for (const [url, env] of [
      ['https://run.synthetos.com/api/identity', { ...staging, RUN_ENV: 'production' }],
      ['https://run.synthetos.com/api/identity', staging],
      ['https://staging.run.synthetos.com/api/identity', { ...staging, RUN_ENV: 'production' }],
    ] as const) {
      const res = await route(new Request(url, { headers: { 'cf-access-jwt-assertion': token } }), env, () => Promise.resolve([k.jwk]));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ identity: null, reason: 'not-available-here', signIn: false });
    }
  });

  it('unconfigured Access on staging: no identity', async () => {
    const res = await route(new Request(STAGING), { ...staging, ACCESS_AUD: 'ACCESS_AUD_PLACEHOLDER' }, () => Promise.resolve([]));
    expect(await res.json()).toEqual({ identity: null, reason: 'not-configured', signIn: false });
  });

  it('a missing header is not signed in; POST is 405', async () => {
    expect(await (await route(new Request(STAGING), staging, () => Promise.resolve([]))).json()).toEqual({ identity: null, reason: 'not-signed-in', signIn: false });
    expect((await route(new Request(STAGING, { method: 'POST' }), staging)).status).toBe(405);
  });
});

describe('verifyAccessJwt', () => {
  const config = accessConfig(TEAM, AUD);
  if (config === null) throw new Error('config');

  it('rejects wrong audience, issuer, expiry, future nbf, alg, unknown kid, a forged signature and garbage', async () => {
    const k = await keyPair('k1');
    const other = await keyPair('k1');
    const certs = () => Promise.resolve([k.jwk]);
    const now = Date.now();
    const bad = [
      await k.sign(claims({ aud: ['0'.repeat(64)] })),
      await k.sign(claims({ iss: 'https://evil.cloudflareaccess.com' })),
      await k.sign(claims({ exp: nowS() - 1 })),
      await k.sign(claims({ nbf: nowS() + 3600 })),
      await k.sign(claims({ email: undefined, sub: '' })),
      await k.sign(claims(), { alg: 'HS256', kid: 'k1' }),
      await k.sign(claims(), { alg: 'RS256', kid: 'nope' }),
      await other.sign(claims()),
      'a.b.c',
      'x',
    ];
    for (const token of bad) expect(await verifyAccessJwt(token, config, now, certs), token.slice(0, 40)).toBeNull();
    expect(await verifyAccessJwt(null, config, now, certs)).toBeNull();
    expect(await verifyAccessJwt(await k.sign(claims({ email: undefined })), config, now, certs)).toEqual({ subject: 'u1' });
  });

  it('accessConfig refuses placeholders', () => {
    expect(accessConfig('ACCESS_TEAM_DOMAIN_PLACEHOLDER', AUD)).toBeNull();
    expect(accessConfig(TEAM, undefined)).toBeNull();
  });
});
