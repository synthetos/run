/**
 * DEV ONLY. Signs `firmware/releases.json`, the signed firmware release list
 * (SAFETY §4.8 as amended 2026-11-03; packages/protocol/src/firmwareReleases.ts).
 * The browser only verifies; signing happens with a key that never enters
 * this repository or CI.
 *
 * Input: `firmware/releases.unsigned.json`, one reviewed payload per
 * environment. Output: each payload as `JSON.stringify` of its unsigned
 * object, signed over `FIRMWARE_RELEASES_SIGNING_PREFIX + payload` with
 * Ed25519. `tools/gates/test/firmware-releases.test.ts` checks the committed
 * signed file decodes to exactly the unsigned one, and that every listed
 * `.hex` the repository holds has the SHA-256 and size the list names.
 */
import type { webcrypto } from 'node:crypto';
import { FIRMWARE_RELEASES_FORMAT, FIRMWARE_RELEASES_SIGNING_PREFIX } from '../../../../packages/protocol/src/firmwareReleases.ts';

export const UNSIGNED_RELEASES_FORMAT = 'synthetos-run/firmware-releases-unsigned@1';

export interface UnsignedReleases {
  readonly format: typeof UNSIGNED_RELEASES_FORMAT;
  readonly manifests: readonly Record<string, unknown>[];
}

export interface SignedReleaseEntry {
  readonly env: string;
  readonly kid: string;
  readonly payload: string;
  readonly sig: string;
}

export interface SignedReleases {
  readonly format: typeof FIRMWARE_RELEASES_FORMAT;
  readonly manifests: readonly SignedReleaseEntry[];
}

export async function signReleases(unsigned: UnsignedReleases, key: webcrypto.CryptoKey, kid: string): Promise<SignedReleases> {
  if (unsigned.format !== UNSIGNED_RELEASES_FORMAT) throw new Error('not an unsigned firmware release list');
  const manifests: SignedReleaseEntry[] = [];
  for (const m of unsigned.manifests) {
    if (typeof m['env'] !== 'string') throw new Error('every manifest needs an "env"');
    const payload = JSON.stringify(m);
    const signature = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(FIRMWARE_RELEASES_SIGNING_PREFIX + payload));
    manifests.push({ env: m['env'], kid, payload, sig: Buffer.from(signature).toString('base64') });
  }
  return { format: FIRMWARE_RELEASES_FORMAT, manifests };
}

/** The signed file as committed: two-space JSON with a final newline. */
export function renderSignedReleases(signed: SignedReleases): string {
  return `${JSON.stringify(signed, null, 2)}\n`;
}
