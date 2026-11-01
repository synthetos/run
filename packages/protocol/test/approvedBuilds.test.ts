/**
 * T-S75 (unit part): the signed approved-builds manifest. The production
 * origin rejects bench-environment entries by signature and `env`, never by a
 * build flag: the same code, given the same file, accepts or rejects purely
 * on the origin it runs at and what the signature covers.
 */
import type { webcrypto } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVED_BUILDS_FORMAT,
  CHANNEL_PAYLOAD_FORMAT,
  NO_APPROVED_BUILDS,
  RELEASE_KEYS,
  SIGNING_PREFIX,
  environmentForOrigin,
  findApproval,
  verifyApprovedBuilds,
} from '../src/index.ts';
import type { ApprovedBuilds, ReleaseKey } from '../src/index.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const PRODUCTION = 'https://run.synthetos.com';
const STAGING = 'https://staging.run.synthetos.com';
const NOW = new Date('2026-11-01T12:00:00Z');
const EN_COMMIT = 'ead639978c77601b150be7ef12774f47eed4c824';

const subtle = globalThis.crypto.subtle;
const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64');

interface TestKey {
  key: ReleaseKey;
  privateKey: webcrypto.CryptoKey;
}

async function makeKey(kid: string, environments: ReleaseKey['environments'], placeholder = false): Promise<TestKey> {
  const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
  const publicKey = b64(await subtle.exportKey('raw', pair.publicKey));
  return { key: { kid, publicKey, environments, placeholder }, privateKey: pair.privateKey };
}

function payload(channel: string, env: string, builds: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: CHANNEL_PAYLOAD_FORMAT,
    channel,
    env,
    issued: '2026-11-01T00:00:00Z',
    expires: '2027-05-01T00:00:00Z',
    builds,
    ...overrides,
  });
}

async function sign(k: TestKey, channel: string, body: string, kid = k.key.kid) {
  const sig = await subtle.sign({ name: 'Ed25519' }, k.privateKey, new TextEncoder().encode(SIGNING_PREFIX + body));
  return { channel, kid, payload: body, sig: b64(sig) };
}

const enBuild = { dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: EN_COMMIT, note: 'bench candidate' };
const file = (...channels: unknown[]) => ({ format: APPROVED_BUILDS_FORMAT, channels });

describe('environmentForOrigin', () => {
  it('knows exactly run and staging over https; everything else has no environment', () => {
    expect(environmentForOrigin(PRODUCTION)).toBe('production');
    expect(environmentForOrigin(STAGING)).toBe('staging');
    for (const o of [
      'http://run.synthetos.com',
      'https://run.synthetos.com:443',
      'https://run.synthetos.com.evil.example',
      'https://evil.run.synthetos.com',
      'https://synthetos.com',
      'https://run-abc.workers.dev',
      'http://localhost:8787',
      'null',
      '',
      'https://RUN.synthetos.com',
    ]) {
      expect(environmentForOrigin(o), o).toBeNull();
    }
  });
});

describe('T-S75: production rejects bench entries by signature and env', async () => {
  const both = await makeKey('release-1', ['staging', 'production']);
  const keys = [both.key];

  it('staging accepts a genuine bench channel', async () => {
    const f = file(await sign(both, 'bench', payload('bench', 'staging', [enBuild])));
    const out = await verifyApprovedBuilds(f, { origin: STAGING, now: NOW, keys });
    expect(out.channels).toEqual([{ channel: 'bench', accepted: true }]);
    expect(out.approved.environment).toBe('staging');
    expect(out.approved.builds).toEqual([{ channel: 'bench', ...enBuild }]);
  });

  it('the same file at the production origin approves nothing (the bench channel is for staging)', async () => {
    const f = file(await sign(both, 'bench', payload('bench', 'staging', [enBuild])));
    const out = await verifyApprovedBuilds(f, { origin: PRODUCTION, now: NOW, keys });
    expect(out.approved.builds).toEqual([]);
    expect(out.channels).toEqual([{ channel: 'bench', accepted: false, rejection: 'wrong-environment-for-channel' }]);
  });

  it('relabelling a payload signed for staging as production breaks the signature', async () => {
    const genuine = await sign(both, 'release', payload('release', 'staging', [enBuild]));
    // An attacker moves staging approvals into the production channel by editing env, without the key.
    const forged = { ...genuine, payload: genuine.payload.replace('"env":"staging"', '"env":"production"') };
    expect(forged.payload).not.toBe(genuine.payload);
    const out = await verifyApprovedBuilds(file(forged), { origin: PRODUCTION, now: NOW, keys });
    expect(out.channels[0]).toEqual({ channel: 'release', accepted: false, rejection: 'bad-signature' });
    expect(out.approved.builds).toEqual([]);
  });

  it('a validly signed payload whose env is not the origin environment is refused', async () => {
    // Signed, in the release channel, but the payload itself says staging.
    const f = file(await sign(both, 'release', payload('release', 'staging', [enBuild])));
    const out = await verifyApprovedBuilds(f, { origin: PRODUCTION, now: NOW, keys });
    expect(out.channels[0]?.rejection).toBe('environment-mismatch');
  });

  it('production does accept a genuine release channel (so rejection is not blanket)', async () => {
    const f = file(await sign(both, 'release', payload('release', 'production', [enBuild])));
    const out = await verifyApprovedBuilds(f, { origin: PRODUCTION, now: NOW, keys });
    expect(out.approved.builds.map((b) => b.channel)).toEqual(['release']);
  });

  it('one file, two origins: the only input that differs is location.origin (no build flag)', async () => {
    const f = file(
      await sign(both, 'bench', payload('bench', 'staging', [enBuild])),
      await sign(both, 'release', payload('release', 'production', [])),
    );
    const staging = await verifyApprovedBuilds(f, { origin: STAGING, now: NOW, keys });
    const production = await verifyApprovedBuilds(f, { origin: PRODUCTION, now: NOW, keys });
    expect(staging.approved.builds.length).toBe(1);
    expect(production.approved.builds.length).toBe(0);
    expect(production.channels.map((c) => c.accepted)).toEqual([false, true]);
  });

  it('a key not authorised for production cannot approve for production, whatever it signs', async () => {
    const stagingOnly = await makeKey('bench-only', ['staging'], true);
    const f = file(await sign(stagingOnly, 'release', payload('release', 'production', [enBuild])));
    const out = await verifyApprovedBuilds(f, { origin: PRODUCTION, now: NOW, keys: [stagingOnly.key] });
    expect(out.channels[0]?.rejection).toBe('key-not-authorised-for-environment');
  });

  it('the protocol source reads no build flag or environment variable', () => {
    const src = join(REPO, 'packages/protocol/src');
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const text = readFileSync(join(src, f), 'utf8');
      expect(text, f).not.toMatch(/import\.meta\.env|process\.env|__BENCH__|\bBUILD_ENV\b/);
    }
  });
});

describe('verifyApprovedBuilds fails closed', async () => {
  const k = await makeKey('release-1', ['staging', 'production']);
  const keys = [k.key];
  const verify = (f: unknown, origin = STAGING, now = NOW) => verifyApprovedBuilds(f, { origin, now, keys });
  const rejection = async (f: unknown, origin = STAGING, now = NOW) => (await verify(f, origin, now)).channels[0]?.rejection;

  it('refuses a file of the wrong shape', async () => {
    for (const f of [null, 'x', [], {}, { format: 'other', channels: [] }, { format: APPROVED_BUILDS_FORMAT, channels: {} }]) {
      const out = await verify(f);
      expect(out.approved.builds).toEqual([]);
      expect(out.channels).toEqual([{ channel: '?', accepted: false, rejection: 'malformed' }]);
    }
  });

  it('approves nothing on an origin with no environment (localhost, previews)', async () => {
    const f = file(await sign(k, 'bench', payload('bench', 'staging', [enBuild])));
    const out = await verify(f, 'http://localhost:8787');
    expect(out.approved).toEqual({ environment: null, builds: [] });
    expect(out.channels[0]?.rejection).toBe('no-environment');
  });

  it('refuses malformed channel entries', async () => {
    const good = await sign(k, 'bench', payload('bench', 'staging', [enBuild]));
    expect(await rejection(file('nope'))).toBe('malformed');
    expect(await rejection(file({ ...good, channel: 'beta' }))).toBe('malformed');
    expect(await rejection(file({ ...good, kid: 1 }))).toBe('malformed');
    expect(await rejection(file({ ...good, payload: {} }))).toBe('malformed');
    expect(await rejection(file({ ...good, sig: null }))).toBe('malformed');
    const out = await verify(file('nope'));
    expect(out.channels[0]?.channel).toBe('?');
  });

  it('refuses an unknown key id and a bad signature encoding', async () => {
    const good = await sign(k, 'bench', payload('bench', 'staging', [enBuild]));
    expect(await rejection(file({ ...good, kid: 'someone-else' }))).toBe('unknown-key');
    expect(await rejection(file({ ...good, sig: 'not base64!' }))).toBe('bad-signature');
    expect(await rejection(file({ ...good, sig: 'AAAA' }))).toBe('bad-signature');
    const other = await makeKey('release-1', ['staging']);
    const wrongKey = await sign(other, 'bench', payload('bench', 'staging', [enBuild]));
    expect(await rejection(file(wrongKey))).toBe('bad-signature');
  });

  it('refuses a bad public key without throwing', async () => {
    const good = await sign(k, 'bench', payload('bench', 'staging', [enBuild]));
    const broken = [{ ...k.key, publicKey: 'AAAA' }];
    const out = await verifyApprovedBuilds(file(good), { origin: STAGING, now: NOW, keys: broken });
    expect(out.channels[0]?.rejection).toBe('bad-signature');
  });

  it('checks the signed payload strictly', async () => {
    const signed = async (body: string) => rejection(file(await sign(k, 'bench', body)));
    expect(await signed('not json')).toBe('malformed-payload');
    expect(await signed(payload('bench', 'staging', [enBuild], { format: 'v0' }))).toBe('malformed-payload');
    expect(await signed(payload('release', 'staging', [enBuild]))).toBe('channel-mismatch');
    expect(await signed(payload('bench', 'production', [enBuild]))).toBe('environment-mismatch');
    expect(await signed(payload('bench', 'staging', [enBuild], { issued: '2026-11-01' }))).toBe('malformed-payload');
    expect(await signed(payload('bench', 'staging', [enBuild], { expires: 7 }))).toBe('malformed-payload');
    expect(await signed(payload('bench', 'staging', [enBuild], { expires: '2026-13-45T99:00:00Z' }))).toBe('malformed-payload');
    expect(await signed(payload('bench', 'staging', [enBuild], { expires: '2026-10-01T00:00:00Z' }))).toBe('malformed-payload');
    expect(await signed(payload('bench', 'staging', [enBuild], { builds: {} }))).toBe('malformed-payload');
  });

  it('honours the validity window: not before issued, not at or after expires', async () => {
    const f = file(await sign(k, 'bench', payload('bench', 'staging', [enBuild])));
    expect(await rejection(f, STAGING, new Date('2026-10-31T23:59:59Z'))).toBe('not-yet-valid');
    expect(await rejection(f, STAGING, new Date('2027-05-01T00:00:00Z'))).toBe('expired');
    expect((await verify(f, STAGING, new Date('2027-04-30T23:59:59Z'))).approved.builds.length).toBe(1);
  });

  it('refuses a channel with any invalid build, including any entry for a read-only dialect', async () => {
    const bad = [
      { ...enBuild, dialect: 'tinyg-449-stock' },
      { ...enBuild, dialect: 'g2core-edge' },
      { ...enBuild, dialect: 'tinyg-9000' },
      { ...enBuild, fb: '450.01' },
      { ...enBuild, fb: 0 },
      { ...enBuild, fb: Number.MAX_VALUE * 10 },
      { ...enBuild, fbs: '' },
      { ...enBuild, fbs: 5 },
      { ...enBuild, commit: 'ead63997' },
      { ...enBuild, commit: EN_COMMIT.toUpperCase() },
      { ...enBuild, note: undefined },
      'tinyg-en',
    ];
    for (const b of bad) {
      // JSON.stringify drops undefined and turns Infinity into null: both still refused.
      expect(await rejection(file(await sign(k, 'bench', payload('bench', 'staging', [enBuild, b])))), JSON.stringify(b)).toBe('malformed-payload');
    }
    const fbs = { ...enBuild, fbs: 'a4103ff8' };
    expect((await verify(file(await sign(k, 'bench', payload('bench', 'staging', [fbs]))))).approved.builds[0]?.fbs).toBe('a4103ff8');
  });

  it('results are frozen', async () => {
    const out = await verify(file(await sign(k, 'bench', payload('bench', 'staging', [enBuild]))));
    expect(Object.isFrozen(out.approved)).toBe(true);
    expect(Object.isFrozen(out.approved.builds)).toBe(true);
    expect(Object.isFrozen(out.approved.builds[0])).toBe(true);
    expect(Object.isFrozen(NO_APPROVED_BUILDS)).toBe(true);
  });
});

describe('findApproval', () => {
  const manifest: ApprovedBuilds = {
    environment: 'staging',
    builds: [
      { channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: EN_COMMIT, note: '' },
      { channel: 'bench', dialect: 'tinyg-en', fb: 450.02, fbs: 'a4103ff8', commit: EN_COMMIT, note: '' },
    ],
  };
  it('matches dialect, fb and fbs exactly', () => {
    expect(findApproval(manifest, 'tinyg-en', 450.01, undefined)?.fb).toBe(450.01);
    expect(findApproval(manifest, 'tinyg-en', 450.02, 'a4103ff8')?.fb).toBe(450.02);
    expect(findApproval(manifest, 'tinyg-en', undefined, undefined)).toBeUndefined();
    expect(findApproval(manifest, 'tinyg-440', 450.01, undefined)).toBeUndefined();
    expect(findApproval(manifest, 'tinyg-en', 450.0, undefined)).toBeUndefined();
    // A build reporting an fbs is not the build approved without one, and vice versa.
    expect(findApproval(manifest, 'tinyg-en', 450.01, 'deadbeef')).toBeUndefined();
    expect(findApproval(manifest, 'tinyg-en', 450.02, undefined)).toBeUndefined();
    expect(findApproval(NO_APPROVED_BUILDS, 'tinyg-en', 450.01, undefined)).toBeUndefined();
  });
});

describe('the committed firmware/approved-builds.json', () => {
  const committed = JSON.parse(readFileSync(join(REPO, 'firmware/approved-builds.json'), 'utf8')) as unknown;

  it('verifies with the compiled-in keys at staging: the edge-next candidate at the pinned commit', async () => {
    const out = await verifyApprovedBuilds(committed, { origin: STAGING, now: NOW });
    expect(out.channels).toEqual([
      { channel: 'bench', accepted: true },
      { channel: 'release', accepted: false, rejection: 'wrong-environment-for-channel' },
    ]);
    expect(out.approved.builds).toEqual([expect.objectContaining({ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: EN_COMMIT })]);
    const pins = JSON.parse(readFileSync(join(REPO, 'vendor/firmware-pins.json'), 'utf8')) as { pins: { EN: { commit: string; fb: number } } };
    expect(out.approved.builds[0]?.commit).toBe(pins.pins.EN.commit);
    expect(out.approved.builds[0]?.fb).toBe(pins.pins.EN.fb);
  });

  it('approves nothing in production: the release channel is empty and the placeholder key cannot sign for it', async () => {
    const out = await verifyApprovedBuilds(committed, { origin: PRODUCTION, now: NOW });
    expect(out.approved.builds).toEqual([]);
    expect(out.channels).toEqual([
      { channel: 'bench', accepted: false, rejection: 'wrong-environment-for-channel' },
      { channel: 'release', accepted: false, rejection: 'key-not-authorised-for-environment' },
    ]);
  });

  it('no placeholder key is ever authorised for production', () => {
    for (const key of RELEASE_KEYS) {
      if (key.placeholder) expect(key.environments, key.kid).not.toContain('production');
      expect(Buffer.from(key.publicKey, 'base64').length, key.kid).toBe(32);
    }
    expect(new Set(RELEASE_KEYS.map((k) => k.kid)).size).toBe(RELEASE_KEYS.length);
  });
});
