/**
 * The firmware release list signing tool and the committed files (SAFETY
 * §4.8 as amended 2026-11-03, H86, T-S120). The signed file must decode to
 * exactly the reviewed unsigned file; production has no entry until the
 * owner signs one with the release key; every `.hex` the repository holds for
 * a listed release has the SHA-256 and size the list names; what the tool
 * signs verifies in the app's own verifier; the run Worker's generated copy
 * of the GitHub-released entries (workers/run/src/firmwareAssets.ts, OD-10)
 * is what the committed signed file renders.
 */
import { createHash } from 'node:crypto';
import type { webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIRMWARE_RELEASE_REPOSITORIES, verifyFirmwareReleases } from '../../../packages/protocol/src/firmwareReleases.ts';
import { FIRMWARE_ASSETS } from '../../../workers/run/src/firmwareAssets.ts';
import { FIRMWARE_REPOSITORIES } from '../../../workers/run/src/firmwareProxy.ts';
import { renderSignedReleases, renderWorkerFirmwareAssets, signReleases, WORKER_FIRMWARE_ASSETS_PATH, workerFirmwareAssets, type SignedReleases, type UnsignedReleases } from '../src/release/firmwareReleases.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const read = <T>(path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8')) as T;
const subtle = globalThis.crypto.subtle;

interface ReleaseEntry {
  readonly file: string;
  readonly sha256: string;
  readonly size: number;
  readonly simulatorOnly?: boolean;
  readonly repo?: string;
  readonly tag?: string;
  readonly recommended: boolean;
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

  it('the two real TinyG releases from GitHub Releases, 450.01 (edge-next pre-release) and 440.21, are listed for hardware version 8, neither recommended yet (OD-10)', () => {
    const staging = unsigned.manifests.find((m) => m['env'] === 'staging') as { boards: { hv: number; minimumFb: number | null; releases: ReleaseEntry[] }[] };
    const hv8 = staging.boards.find((b) => b.hv === 8);
    expect(hv8?.releases).toEqual([
      // The published SHA256SUMS and asset size, verbatim (docs/ops/firmware-releases.md).
      expect.objectContaining({ file: 'tinyg-450.01.hex', dialect: 'tinyg-en', fb: 450.01, fv: 0.97, repo: 'synthetos/TinyG', tag: '450.01', sha256: 'b83763af4ecfe283d0c009fce3e6aa8df491b7f5b2a101693bccf534bb893811', size: 434318, recommended: false }),
      expect.objectContaining({ file: 'tinyg-440.21.hex', repo: 'synthetos/TinyG', tag: '440.21', sha256: 'c2c1693e82f0ed88ec8dec4338a0bc799059c10b3323acb1189564f6a2265e92', size: 334978, recommended: false }),
    ]);
    // Both listed, so neither is below the minimum: the owner raises it to 450+ once the maintainer calls a 450.xx build current (docs/ops/firmware-releases.md).
    expect(hv8?.minimumFb).toBe(440.21);
    // The repository holds a copy of the image for the tests (the Worker serves GitHub's); it is the listed bytes.
    const copy = readFileSync(join(REPO, 'firmware/tinyg-440.21.hex'));
    expect(createHash('sha256').update(copy).digest('hex')).toBe('c2c1693e82f0ed88ec8dec4338a0bc799059c10b3323acb1189564f6a2265e92');
  });

  it('the Worker’s generated asset list is what the committed signed file renders, under the same repository allowlist as protocol', () => {
    expect(readFileSync(join(REPO, WORKER_FIRMWARE_ASSETS_PATH), 'utf8')).toBe(renderWorkerFirmwareAssets(signed));
    expect(FIRMWARE_ASSETS).toEqual(workerFirmwareAssets(signed));
    expect(FIRMWARE_REPOSITORIES).toEqual(FIRMWARE_RELEASE_REPOSITORIES);
    for (const a of FIRMWARE_ASSETS) expect(FIRMWARE_REPOSITORIES, a.repo).toContain(a.repo);
    // Only GitHub-released entries are rendered; simulator and bundled images are not the Worker's to serve.
    expect(FIRMWARE_ASSETS.map((a) => a.asset)).toEqual(['tinyg-440.21.hex', 'tinyg-450.01.hex']);
    expect(workerFirmwareAssets({ format: signed.format, manifests: [{ env: 'staging', kid: 'k', sig: 's', payload: JSON.stringify({ boards: [{ hv: 8, releases: [{ file: 'a.hex', sha256: 'x', size: 1 }] }] }) }] })).toEqual([]);
    expect(() => workerFirmwareAssets({ format: signed.format, manifests: [{ env: 'staging', kid: 'k', sig: 's', payload: JSON.stringify({ boards: [{ hv: 8, releases: [{ file: 'a.hex', sha256: 'x', size: 1, repo: 'synthetos/TinyG' }] }] }) }] })).toThrow(/repo, tag/);
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
