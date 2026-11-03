/**
 * The firmware release list signing tool and the committed files (SAFETY
 * §4.8 as amended 2026-11-03, H86, T-S120). The signed file must decode to
 * exactly the reviewed unsigned file; production has no entry until the
 * owner signs one with the release key; every `.hex` the repository holds for
 * a listed release has the SHA-256 and size the list names; what the tool
 * signs verifies in the app's own verifier.
 */
import { createHash } from 'node:crypto';
import type { webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyFirmwareReleases } from '../../../packages/protocol/src/firmwareReleases.ts';
import { renderSignedReleases, signReleases, type SignedReleases, type UnsignedReleases } from '../src/release/firmwareReleases.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const read = <T>(path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8')) as T;
const subtle = globalThis.crypto.subtle;

interface ReleaseEntry {
  readonly file: string;
  readonly sha256: string;
  readonly size: number;
  readonly simulatorOnly?: boolean;
}

describe('committed firmware release files', () => {
  const unsigned = read<UnsignedReleases>('firmware/releases.unsigned.json');
  const signed = read<SignedReleases>('firmware/releases.json');

  it('the signed file decodes to exactly the reviewed unsigned file', () => {
    expect(signed.manifests.map((m) => m.env)).toEqual(unsigned.manifests.map((m) => m['env']));
    signed.manifests.forEach((m, i) => expect(m.payload).toBe(JSON.stringify(unsigned.manifests[i])));
  });

  it('production has no entry: it stays empty until the owner signs it with the release key', () => {
    expect(unsigned.manifests.map((m) => m['env'])).toEqual(['staging']);
  });

  it('every listed .hex in firmware/ has the SHA-256 and size the list names; simulator images only for hv 99', () => {
    let checked = 0;
    for (const m of unsigned.manifests) {
      for (const board of m['boards'] as { hv: number; releases: ReleaseEntry[] }[]) {
        for (const r of board.releases) {
          if (r.simulatorOnly === true) expect(board.hv, r.file).toBe(99);
          const path = join(REPO, 'firmware', r.simulatorOnly === true ? 'sim' : '', r.file);
          if (!existsSync(path)) continue;
          const bytes = readFileSync(path);
          expect(createHash('sha256').update(bytes).digest('hex'), r.file).toBe(r.sha256);
          expect(bytes.length, r.file).toBe(r.size);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the tool signs what the app verifies', async () => {
    const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
    const publicKey = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64');
    const out = await signReleases(unsigned, pair.privateKey, 'test');
    const verdict = await verifyFirmwareReleases(JSON.parse(renderSignedReleases(out)), {
      environment: 'staging',
      now: new Date('2026-12-01T00:00:00Z'),
      keys: [{ kid: 'test', publicKey, environments: ['staging'], placeholder: false }],
    });
    expect(verdict.ok).toBe(true);
    await expect(signReleases({ format: 'x' } as unknown as UnsignedReleases, pair.privateKey, 'k')).rejects.toThrow();
    await expect(signReleases({ ...unsigned, manifests: [{}] }, pair.privateKey, 'k')).rejects.toThrow('env');
  });
});
