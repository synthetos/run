/**
 * The approved-builds signing tool and the committed files (ROADMAP P0-08).
 * The signed file must decode to exactly the reviewed unsigned file, and what
 * the tool signs must verify in the app's own verifier.
 */
import { spawnSync } from 'node:child_process';
import type { webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyApprovedBuilds } from '../../../packages/protocol/src/approvedBuilds.ts';
import { importPrivateKey, renderSignedManifest, signManifest } from '../src/release/approvedBuilds.ts';
import type { SignedManifest, UnsignedManifest } from '../src/release/approvedBuilds.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const read = <T>(path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8')) as T;
const subtle = globalThis.crypto.subtle;

async function testKey(): Promise<{ pem: string; publicKey: string; privateKey: webcrypto.CryptoKey }> {
  const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
  const der = Buffer.from(await subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64'), privateKey: pair.privateKey };
}

describe('committed approved-builds files', () => {
  const unsigned = read<UnsignedManifest>('firmware/approved-builds.unsigned.json');
  const signed = read<SignedManifest>('firmware/approved-builds.json');

  it('the signed file decodes to exactly the reviewed unsigned file, channel by channel', () => {
    expect(signed.channels.map((c) => c.channel)).toEqual(unsigned.channels.map((c) => c['channel']));
    signed.channels.forEach((c, i) => {
      expect(JSON.parse(c.payload)).toEqual(unsigned.channels[i]);
      expect(c.payload).toBe(JSON.stringify(unsigned.channels[i]));
    });
  });

  it('the bench channel approves only the pinned edge-next commit; the release channel is empty', () => {
    const pins = read<{ pins: { EN: { commit: string; fb: number } } }>('vendor/firmware-pins.json');
    const [bench, release] = unsigned.channels as [Record<string, unknown>, Record<string, unknown>];
    expect(bench).toMatchObject({ channel: 'bench', env: 'staging' });
    expect(bench['builds']).toEqual([expect.objectContaining({ dialect: 'tinyg-en', fb: pins.pins.EN.fb, commit: pins.pins.EN.commit, fbs: null })]);
    expect(release).toMatchObject({ channel: 'release', env: 'production', builds: [] });
  });
});

describe('signManifest', () => {
  it('produces a file the app verifies, deterministically (Ed25519)', async () => {
    const key = await testKey();
    const unsigned: UnsignedManifest = read<UnsignedManifest>('firmware/approved-builds.unsigned.json');
    const imported = await importPrivateKey(key.pem);
    const a = renderSignedManifest(await signManifest(unsigned, imported, 'test-key'));
    const b = renderSignedManifest(await signManifest(unsigned, imported, 'test-key'));
    expect(a).toBe(b);
    expect(a.endsWith('}\n')).toBe(true);
    const out = await verifyApprovedBuilds(JSON.parse(a), {
      origin: 'https://staging.run.synthetos.com',
      now: new Date('2026-12-01T00:00:00Z'),
      keys: [{ kid: 'test-key', publicKey: key.publicKey, environments: ['staging'], placeholder: true }],
    });
    expect(out.channels[0]).toEqual({ channel: 'bench', accepted: true });
    expect(out.approved.builds.length).toBe(1);
  });

  it('refuses an input that is not an unsigned manifest, or a channel without a name', async () => {
    const key = await importPrivateKey((await testKey()).pem);
    await expect(signManifest({ format: 'nope' } as unknown as UnsignedManifest, key, 'k')).rejects.toThrow(/not an unsigned/);
    await expect(signManifest({ format: 'synthetos-run/approved-builds-unsigned@1', channels: [{}] }, key, 'k')).rejects.toThrow(/channel/);
  });
});

describe('sign-cli', () => {
  const cli = join(REPO, 'tools/gates/src/release/sign-cli.ts');

  it('refuses a key file inside the repository and requires both arguments', () => {
    const inside = spawnSync(process.execPath, [cli, '--key', join(REPO, 'package.json'), '--kid', 'x'], { encoding: 'utf8' });
    expect(inside.status).toBe(2);
    expect(inside.stderr).toMatch(/refusing a key file inside the repository/);
    const missing = spawnSync(process.execPath, [cli, '--kid', 'x'], { encoding: 'utf8' });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/usage/);
  });

  it('a key outside the repository passes the guard; a bad key then fails before anything is written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-sign-'));
    try {
      writeFileSync(join(dir, 'k.pem'), 'not a key');
      const r = spawnSync(process.execPath, [cli, '--key', join(dir, 'k.pem'), '--kid', 'x'], { encoding: 'utf8' });
      // Past the guard, the bad key fails at import: proof the guard let it through without writing anything.
      expect(r.status).not.toBe(0);
      expect(r.stderr).not.toMatch(/refusing a key file inside/);
      expect(readFileSync(join(REPO, 'firmware/approved-builds.json'), 'utf8')).toBe(
        renderSignedManifest(read<SignedManifest>('firmware/approved-builds.json')),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
