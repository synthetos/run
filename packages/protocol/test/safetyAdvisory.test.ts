/**
 * T-S75 / T-S31 (unit part): the signed safety advisory. Production rejects a
 * staging-signed entry by signature and `env`; an expired, unsigned,
 * malformed or ambiguous advisory is a rejection (fail closed); a listed
 * build SHA is revoked.
 */
import type { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ADVISORY_PAYLOAD_FORMAT,
  ADVISORY_SIGNING_PREFIX,
  SAFETY_ADVISORY_FORMAT,
  SIGNING_PREFIX,
  findRevocation,
  verifySafetyAdvisory,
} from '../src/index.ts';
import type { ReleaseKey } from '../src/index.ts';

const NOW = new Date('2026-11-01T12:00:00Z');
const SHA = 'a'.repeat(40);
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

function body(env: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: ADVISORY_PAYLOAD_FORMAT, env, issued: '2026-11-01T00:00:00Z', expires: '2026-12-01T00:00:00Z', revoked: [], ...overrides });
}

async function entry(k: TestKey, env: string, payload: string, prefix = ADVISORY_SIGNING_PREFIX) {
  const sig = await subtle.sign({ name: 'Ed25519' }, k.privateKey, new TextEncoder().encode(prefix + payload));
  return { env, kid: k.key.kid, payload, sig: b64(sig) };
}

const file = (...advisories: unknown[]) => ({ format: SAFETY_ADVISORY_FORMAT, advisories });

describe('verifySafetyAdvisory', () => {
  it('accepts a staging entry signed by a staging key, on staging', async () => {
    const k = await makeKey('s', ['staging']);
    const v = await verifySafetyAdvisory(file(await entry(k, 'staging', body('staging'))), { environment: 'staging', now: NOW, keys: [k.key] });
    expect(v.ok).toBe(true);
  });

  it('T-S75: production rejects a staging-signed entry, however it is relabelled', async () => {
    const k = await makeKey('s', ['staging']);
    const staging = await entry(k, 'staging', body('staging'));
    const keys = [k.key];
    expect(await verifySafetyAdvisory(file(staging), { environment: 'production', now: NOW, keys })).toEqual({ ok: false, rejection: 'no-entry' });
    // The outer label changed to production: the key may not sign for production.
    expect(await verifySafetyAdvisory(file({ ...staging, env: 'production' }), { environment: 'production', now: NOW, keys })).toEqual({
      ok: false,
      rejection: 'key-not-authorised-for-environment',
    });
    // A key that may sign both: the signed payload still names staging.
    const both = await makeKey('b', ['staging', 'production']);
    const relabelled = { ...(await entry(both, 'staging', body('staging'))), env: 'production' };
    expect(await verifySafetyAdvisory(file(relabelled), { environment: 'production', now: NOW, keys: [both.key] })).toEqual({
      ok: false,
      rejection: 'environment-mismatch',
    });
  });

  it('T-S75: an expired advisory fails closed; so does one not yet valid and an invalid clock', async () => {
    const k = await makeKey('s', ['staging']);
    const f = file(await entry(k, 'staging', body('staging')));
    const opts = { environment: 'staging' as const, keys: [k.key] };
    expect(await verifySafetyAdvisory(f, { ...opts, now: new Date('2026-12-01T00:00:00Z') })).toEqual({ ok: false, rejection: 'expired' });
    expect(await verifySafetyAdvisory(f, { ...opts, now: new Date('2026-10-31T23:59:59Z') })).toEqual({ ok: false, rejection: 'not-yet-valid' });
    expect(await verifySafetyAdvisory(f, { ...opts, now: new Date(Number.NaN) })).toEqual({ ok: false, rejection: 'invalid-clock' });
  });

  it('T-S31: unsigned, tampered, wrongly prefixed, malformed or ambiguous files are rejected', async () => {
    const k = await makeKey('s', ['staging']);
    const opts = { environment: 'staging' as const, now: NOW, keys: [k.key] };
    const good = await entry(k, 'staging', body('staging'));
    const cases: [unknown, string][] = [
      [null, 'malformed'],
      ['not json', 'malformed'],
      [{ format: 'other', advisories: [good] }, 'malformed'],
      [{ ...file(good), extra: 1 }, 'malformed'],
      [file(), 'no-entry'],
      [file(good, good), 'duplicate-entry'],
      [file({ ...good, sig: '' }), 'bad-signature'],
      [file({ ...good, payload: body('staging', { revoked: [] , expires: '2027-12-01T00:00:00Z' }) }), 'bad-signature'],
      [file(await entry(k, 'staging', body('staging'), SIGNING_PREFIX)), 'bad-signature'],
      [file({ ...good, kid: 'nobody' }), 'unknown-key'],
      [file({ ...good, note: 'x' }), 'malformed'],
      [file(await entry(k, 'staging', body('staging', { extra: true }))), 'malformed-payload'],
      [file(await entry(k, 'staging', body('staging', { revoked: [{ sha: 'abc', reason: '' }] }))), 'malformed-payload'],
      [file(await entry(k, 'staging', body('staging', { expires: '2026-02-31T00:00:00Z' }))), 'malformed-payload'],
    ];
    for (const [f, rejection] of cases) {
      expect(await verifySafetyAdvisory(f, opts), JSON.stringify(f).slice(0, 80)).toEqual({ ok: false, rejection });
    }
    expect(await verifySafetyAdvisory(file(good), { ...opts, environment: null })).toEqual({ ok: false, rejection: 'no-environment' });
  });

  it('T-S31: a listed SHA is revoked; a -dirty build of it too; other builds are not', async () => {
    const k = await makeKey('s', ['staging']);
    const v = await verifySafetyAdvisory(file(await entry(k, 'staging', body('staging', { revoked: [{ sha: SHA, reason: 'stop bug' }] }))), {
      environment: 'staging',
      now: NOW,
      keys: [k.key],
    });
    if (!v.ok) throw new Error(v.rejection);
    expect(findRevocation(v.advisory, SHA)?.reason).toBe('stop bug');
    expect(findRevocation(v.advisory, `${SHA}-dirty`)?.reason).toBe('stop bug');
    expect(findRevocation(v.advisory, 'b'.repeat(40))).toBeUndefined();
  });
});
