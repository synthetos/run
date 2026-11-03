/**
 * The signed firmware release list (SAFETY H22, H86, T-S120): verified per
 * environment with the release keys; production rejects a staging-signed
 * entry; anything malformed, expired or ambiguous offers nothing; the
 * old-firmware gate compares builds per hardware version.
 */
import type { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIRMWARE_RELEASES_FORMAT,
  FIRMWARE_RELEASES_PAYLOAD_FORMAT,
  FIRMWARE_RELEASES_SIGNING_PREFIX,
  SIGNING_PREFIX,
  belowMinimum,
  releasesForHardware,
  verifyFirmwareReleases,
  type ReleaseKey,
} from '../src/index.ts';

const NOW = new Date('2026-11-03T12:00:00Z');
const subtle = globalThis.crypto.subtle;
const b64 = (bytes: ArrayBuffer) => Buffer.from(new Uint8Array(bytes)).toString('base64');

interface TestKey {
  key: ReleaseKey;
  privateKey: webcrypto.CryptoKey;
}

async function makeKey(kid: string, environments: ReleaseKey['environments']): Promise<TestKey> {
  const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
  return { key: { kid, publicKey: b64(await subtle.exportKey('raw', pair.publicKey)), environments, placeholder: false }, privateKey: pair.privateKey };
}

const RELEASE = {
  fb: 450.02,
  fv: 0.97,
  dialect: 'tinyg-en',
  part: 'x192a3',
  file: 'tinyg-edge-next-450.02.hex',
  sha256: 'a'.repeat(64),
  size: 300000,
  date: '2026-11-03',
  changelog: 'Fixes.',
  recommended: true,
};

function body(env: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: FIRMWARE_RELEASES_PAYLOAD_FORMAT,
    env,
    issued: '2026-11-01T00:00:00Z',
    expires: '2027-05-01T00:00:00Z',
    boards: [{ hv: 8, minimumFb: 450.01, releases: [RELEASE, { ...RELEASE, fb: 450.01, file: 'tinyg-edge-next-450.01.hex', recommended: false }] }],
    ...overrides,
  });
}

async function entry(k: TestKey, env: string, payload: string, prefix = FIRMWARE_RELEASES_SIGNING_PREFIX) {
  const sig = await subtle.sign({ name: 'Ed25519' }, k.privateKey, new TextEncoder().encode(prefix + payload));
  return { env, kid: k.key.kid, payload, sig: b64(sig) };
}

const file = (...manifests: unknown[]) => ({ format: FIRMWARE_RELEASES_FORMAT, manifests });

describe('verifyFirmwareReleases', () => {
  it('accepts a staging entry signed by a staging key, sorted newest first', async () => {
    const k = await makeKey('s', ['staging']);
    const v = await verifyFirmwareReleases(file(await entry(k, 'staging', body('staging'))), { environment: 'staging', now: NOW, keys: [k.key] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const hw = releasesForHardware(v.releases, 8);
    expect(hw?.minimumFb).toBe(450.01);
    expect(hw?.releases.map((r) => r.fb)).toEqual([450.02, 450.01]);
    expect(hw?.releases[0]).toMatchObject({ hv: 8, simulatorOnly: false, recommended: true });
    expect(releasesForHardware(v.releases, 7)).toBeNull();
    expect(releasesForHardware(v.releases, null)).toBeNull();
    expect(releasesForHardware(null, 8)).toBeNull();
  });

  it('production rejects a staging-signed entry, however it is relabelled', async () => {
    const k = await makeKey('s', ['staging']);
    const staging = await entry(k, 'staging', body('staging'));
    const keys = [k.key];
    expect(await verifyFirmwareReleases(file(staging), { environment: 'production', now: NOW, keys })).toEqual({ ok: false, rejection: 'no-entry' });
    expect(await verifyFirmwareReleases(file({ ...staging, env: 'production' }), { environment: 'production', now: NOW, keys })).toEqual({ ok: false, rejection: 'key-not-authorised-for-environment' });
    const both = await makeKey('b', ['staging', 'production']);
    const relabelled = await entry(both, 'production', body('staging'));
    expect(await verifyFirmwareReleases(file(relabelled), { environment: 'production', now: NOW, keys: [both.key] })).toEqual({ ok: false, rejection: 'environment-mismatch' });
  });

  it('refuses another file type’s signature, a bad signature, an unknown key, no environment and a bad clock', async () => {
    const k = await makeKey('s', ['staging']);
    const keys = [k.key];
    const replay = await entry(k, 'staging', body('staging'), SIGNING_PREFIX);
    expect(await verifyFirmwareReleases(file(replay), { environment: 'staging', now: NOW, keys })).toEqual({ ok: false, rejection: 'bad-signature' });
    const good = await entry(k, 'staging', body('staging'));
    expect(await verifyFirmwareReleases(file({ ...good, kid: 'other' }), { environment: 'staging', now: NOW, keys })).toEqual({ ok: false, rejection: 'unknown-key' });
    expect(await verifyFirmwareReleases(file(good), { environment: null, now: NOW, keys })).toEqual({ ok: false, rejection: 'no-environment' });
    expect(await verifyFirmwareReleases(file(good), { environment: 'staging', now: new Date('x'), keys })).toEqual({ ok: false, rejection: 'invalid-clock' });
    expect(await verifyFirmwareReleases(file(good, good), { environment: 'staging', now: NOW, keys })).toEqual({ ok: false, rejection: 'duplicate-entry' });
    expect(await verifyFirmwareReleases(file(good), { environment: 'staging', now: new Date('2027-06-01T00:00:00Z'), keys })).toEqual({ ok: false, rejection: 'expired' });
    expect(await verifyFirmwareReleases(file(good), { environment: 'staging', now: new Date('2026-10-01T00:00:00Z'), keys })).toEqual({ ok: false, rejection: 'not-yet-valid' });
  });

  it('refuses malformed outer files and entries', async () => {
    const k = await makeKey('s', ['staging']);
    const keys = [k.key];
    const opts = { environment: 'staging' as const, now: NOW, keys };
    const good = await entry(k, 'staging', body('staging'));
    for (const f of [null, [], { format: 'x', manifests: [] }, { format: FIRMWARE_RELEASES_FORMAT, manifests: {} }, { ...file(good), extra: 1 }]) {
      expect(await verifyFirmwareReleases(f, opts)).toEqual({ ok: false, rejection: 'malformed' });
    }
    expect(await verifyFirmwareReleases(file({ ...good, more: 1 }), opts)).toEqual({ ok: false, rejection: 'malformed' });
    expect(await verifyFirmwareReleases(file({ ...good, sig: 5 }), opts)).toEqual({ ok: false, rejection: 'malformed' });
  });

  it('refuses payloads with a wrong field, an unknown field, or an ambiguous release', async () => {
    const k = await makeKey('s', ['staging']);
    const keys = [k.key];
    const opts = { environment: 'staging' as const, now: NOW, keys };
    const bad = async (payload: string) => verifyFirmwareReleases(file(await entry(k, 'staging', payload)), opts);
    const board = (releases: unknown[], extra: Record<string, unknown> = {}) => ({ boards: [{ hv: 8, minimumFb: 450.01, releases, ...extra }] });
    const cases: string[] = [
      'not json',
      JSON.stringify({ format: 'x' }),
      body('staging', { extra: true }),
      body('staging', { issued: '2027-06-01T00:00:00Z' }),
      body('staging', { issued: 'yesterday' }),
      body('staging', { boards: {} }),
      body('staging', { boards: [{ hv: 8, minimumFb: 450.01, releases: [] }, { hv: 8, minimumFb: null, releases: [] }] }),
      body('staging', { boards: [{ hv: 0, minimumFb: null, releases: [] }] }),
      body('staging', { boards: [{ hv: 8, minimumFb: -1, releases: [] }] }),
      body('staging', { boards: [{ hv: 8, minimumFb: null, releases: {} }] }),
      body('staging', { boards: [{ hv: 8, minimumFb: null, releases: [], more: 1 }] }),
      body('staging', board([{ ...RELEASE, extra: 1 }])),
      body('staging', board([{ ...RELEASE, fb: 0 }])),
      body('staging', board([{ ...RELEASE, fv: 'x' }])),
      body('staging', board([{ ...RELEASE, dialect: 'g2core-edge' }])),
      body('staging', board([{ ...RELEASE, part: 'm328p' }])),
      body('staging', board([{ ...RELEASE, file: '../x.hex' }])),
      body('staging', board([{ ...RELEASE, file: 'x.bin' }])),
      body('staging', board([{ ...RELEASE, sha256: 'A'.repeat(64) }])),
      body('staging', board([{ ...RELEASE, size: 0 }])),
      body('staging', board([{ ...RELEASE, size: 3 * 1024 * 1024 }])),
      body('staging', board([{ ...RELEASE, date: '2026-02-31' }])),
      body('staging', board([{ ...RELEASE, date: 'today' }])),
      body('staging', board([{ ...RELEASE, changelog: 'x'.repeat(4001) }])),
      body('staging', board([{ ...RELEASE, recommended: 'yes' }])),
      body('staging', board([{ ...RELEASE, simulatorOnly: 1 }])),
      body('staging', board([RELEASE, { ...RELEASE, fb: 450.03 }])),
      body('staging', board([RELEASE, { ...RELEASE, file: 'b.hex' }])),
      body('staging', board([RELEASE, { ...RELEASE, fb: 450.03, file: 'b.hex' }])),
    ];
    for (const payload of cases) expect(await bad(payload), payload).toEqual({ ok: false, rejection: 'malformed-payload' });
    // A simulator image may share a build number with a real one.
    const sim = await bad(body('staging', board([RELEASE, { ...RELEASE, file: 'sim.hex', simulatorOnly: true, recommended: false }])));
    expect(sim.ok).toBe(true);
  });

  it('the committed file verifies for staging with the compiled-in keys, and production has no entry (stays empty)', async () => {
    const committed = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../firmware/releases.json'), 'utf8')) as unknown;
    const staging = await verifyFirmwareReleases(committed, { environment: 'staging', now: NOW });
    expect(staging.ok).toBe(true);
    expect(await verifyFirmwareReleases(committed, { environment: 'production', now: NOW })).toEqual({ ok: false, rejection: 'no-entry' });
  });
});

describe('belowMinimum (the old-firmware gate)', () => {
  it('compares to the hundredth, per hardware, and treats unknown values as not below', async () => {
    const k = await makeKey('s', ['staging']);
    const v = await verifyFirmwareReleases(file(await entry(k, 'staging', body('staging'))), { environment: 'staging', now: NOW, keys: [k.key] });
    if (!v.ok) throw new Error(v.rejection);
    expect(belowMinimum(v.releases, 8, 440.21)).toEqual({ below: true, minimumFb: 450.01 });
    expect(belowMinimum(v.releases, 8, 450.01)).toEqual({ below: false, minimumFb: 450.01 });
    expect(belowMinimum(v.releases, 8, 450.009)).toEqual({ below: false, minimumFb: 450.01 });
    expect(belowMinimum(v.releases, 8, 451)).toEqual({ below: false, minimumFb: 450.01 });
    expect(belowMinimum(v.releases, 8, undefined)).toEqual({ below: false, minimumFb: 450.01 });
    expect(belowMinimum(v.releases, 7, 1)).toEqual({ below: false, minimumFb: null });
    expect(belowMinimum(null, 8, 1)).toEqual({ below: false, minimumFb: null });
  });
});
