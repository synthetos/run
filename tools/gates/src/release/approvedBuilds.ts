/**
 * DEV ONLY. Signs `firmware/approved-builds.json` (ROADMAP P0-08; RUN_PLAN
 * §6.3). The browser only ever verifies; signing happens offline with the
 * release key, which never enters this repository or CI.
 *
 * Input: `firmware/approved-builds.unsigned.json`, the human-reviewed list of
 * channels. Output: the signed file the app ships. Each channel's payload is
 * `JSON.stringify` of its unsigned object, signed over
 * `SIGNING_PREFIX + payload` with Ed25519.
 * `tools/gates/test/approved-builds.test.ts` checks that the committed signed
 * file decodes to exactly the committed unsigned file, so they cannot drift.
 */
import type { webcrypto } from 'node:crypto';
import { APPROVED_BUILDS_FORMAT, SIGNING_PREFIX } from '../../../../packages/protocol/src/approvedBuilds.ts';

export interface UnsignedManifest {
  readonly format: 'synthetos-run/approved-builds-unsigned@1';
  readonly channels: readonly Record<string, unknown>[];
}

export interface SignedChannel {
  readonly channel: string;
  readonly kid: string;
  readonly payload: string;
  readonly sig: string;
}

export interface SignedManifest {
  readonly format: typeof APPROVED_BUILDS_FORMAT;
  readonly channels: readonly SignedChannel[];
}

/** Read a PKCS#8 PEM Ed25519 private key into a WebCrypto signing key. */
export async function importPrivateKey(pem: string): Promise<webcrypto.CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(Buffer.from(body, 'base64'));
  return globalThis.crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
}

/** Sign every channel of the unsigned manifest with one key. */
export async function signManifest(unsigned: UnsignedManifest, key: webcrypto.CryptoKey, kid: string): Promise<SignedManifest> {
  if (unsigned.format !== 'synthetos-run/approved-builds-unsigned@1') throw new Error('not an unsigned approved-builds file');
  const channels: SignedChannel[] = [];
  for (const channel of unsigned.channels) {
    if (typeof channel['channel'] !== 'string') throw new Error('every channel needs a "channel" name');
    const payload = JSON.stringify(channel);
    const signature = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(SIGNING_PREFIX + payload));
    channels.push({ channel: channel['channel'], kid, payload, sig: Buffer.from(signature).toString('base64') });
  }
  return { format: APPROVED_BUILDS_FORMAT, channels };
}

/** The signed file as committed: two-space JSON with a final newline. */
export function renderSignedManifest(signed: SignedManifest): string {
  return `${JSON.stringify(signed, null, 2)}\n`;
}
