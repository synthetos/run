/**
 * The safety-advisory signing tool and the committed files (ROADMAP P1-05).
 * What the tool signs verifies in the app's own verifier, and the committed
 * signed file never disagrees with the reviewed unsigned file. Until the
 * owner signs (docs/ops/release-key.md) the committed file has no entries, so
 * every origin refuses LIVE (fail closed, H27).
 */
import type { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifySafetyAdvisory } from '../../../packages/protocol/src/safetyAdvisory.ts';
import { signAdvisory } from '../src/release/safetyAdvisory.ts';
import type { SignedAdvisory, UnsignedAdvisory } from '../src/release/safetyAdvisory.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const read = <T>(path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8')) as T;

describe('committed safety-advisory files', () => {
  const unsigned = read<UnsignedAdvisory>('apps/web/advisory/safety-advisory.unsigned.json');
  const signed = read<SignedAdvisory>('apps/web/public/safety-advisory.json');

  it('the signed file is empty (not yet signed) or decodes to exactly the unsigned file', () => {
    if (signed.advisories.length === 0) return;
    expect(signed.advisories.map((a) => a.env)).toEqual(unsigned.advisories.map((a) => a['env']));
    signed.advisories.forEach((a, i) => expect(a.payload).toBe(JSON.stringify(unsigned.advisories[i])));
  });

  it('the unsigned file never has a production entry signed by a placeholder (production stays refused until the release key)', () => {
    expect(unsigned.advisories.map((a) => a['env'])).toEqual(['staging']);
  });
});

describe('signAdvisory', () => {
  it('signs what the app verifies, for the named environment only', async () => {
    const subtle = globalThis.crypto.subtle;
    const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
    const publicKey = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64');
    const keys = [{ kid: 't', publicKey, environments: ['staging'] as const, placeholder: true }];
    const unsigned = read<UnsignedAdvisory>('apps/web/advisory/safety-advisory.unsigned.json');
    const signed = await signAdvisory(unsigned, pair.privateKey, 't');
    const now = new Date('2026-11-15T00:00:00Z');
    expect((await verifySafetyAdvisory(signed, { environment: 'staging', now, keys })).ok).toBe(true);
    expect(await verifySafetyAdvisory(signed, { environment: 'production', now, keys })).toEqual({ ok: false, rejection: 'no-entry' });
  });
});
