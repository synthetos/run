/**
 * DEV ONLY. Signs `apps/web/public/safety-advisory.json` (ROADMAP P1-05;
 * SAFETY H27; RUN_PLAN §6.3) from the reviewed
 * `apps/web/advisory/safety-advisory.unsigned.json`. The browser only ever
 * verifies (packages/protocol/src/safetyAdvisory.ts); signing happens offline
 * with the release key, which never enters this repository or CI.
 *
 * Each environment's payload is `JSON.stringify` of its unsigned object,
 * signed over `ADVISORY_SIGNING_PREFIX + payload` with Ed25519.
 */
import type { webcrypto } from 'node:crypto';
import { ADVISORY_SIGNING_PREFIX, SAFETY_ADVISORY_FORMAT } from '../../../../packages/protocol/src/safetyAdvisory.ts';

export const UNSIGNED_ADVISORY_FORMAT = 'synthetos-run/safety-advisory-unsigned@1';

export interface UnsignedAdvisory {
  readonly format: typeof UNSIGNED_ADVISORY_FORMAT;
  readonly advisories: readonly Record<string, unknown>[];
}

export interface SignedAdvisoryEntry {
  readonly env: string;
  readonly kid: string;
  readonly payload: string;
  readonly sig: string;
}

export interface SignedAdvisory {
  readonly format: typeof SAFETY_ADVISORY_FORMAT;
  readonly advisories: readonly SignedAdvisoryEntry[];
}

/** Sign every environment's advisory with one key. */
export async function signAdvisory(unsigned: UnsignedAdvisory, key: webcrypto.CryptoKey, kid: string): Promise<SignedAdvisory> {
  if (unsigned.format !== UNSIGNED_ADVISORY_FORMAT) throw new Error('not an unsigned safety-advisory file');
  const advisories: SignedAdvisoryEntry[] = [];
  for (const entry of unsigned.advisories) {
    if (typeof entry['env'] !== 'string') throw new Error('every advisory needs an "env"');
    const payload = JSON.stringify(entry);
    const signature = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(ADVISORY_SIGNING_PREFIX + payload));
    advisories.push({ env: entry['env'], kid, payload, sig: Buffer.from(signature).toString('base64') });
  }
  return { format: SAFETY_ADVISORY_FORMAT, advisories };
}

/** The signed file as committed: two-space JSON with a final newline. */
export function renderSignedAdvisory(signed: SignedAdvisory): string {
  return `${JSON.stringify(signed, null, 2)}\n`;
}
