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
 *
 * The same tool writes `workers/run/src/firmwareAssets.ts`
 * (`renderWorkerFirmwareAssets`): the GitHub-released entries of the signed
 * list (environment, repository, tag, asset, SHA-256, size), which the run
 * Worker's firmware proxy serves (OD-10). The Worker may import nothing
 * outside its own directory (tools/gates/src/build/worker.ts), so the list
 * is generated into it; the same test holds the generated file equal to
 * what the committed signed file renders.
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

/** The path, from the repository root, of the Worker's generated asset list. */
export const WORKER_FIRMWARE_ASSETS_PATH = 'workers/run/src/firmwareAssets.ts';

export interface WorkerFirmwareAsset {
  readonly env: string;
  readonly repo: string;
  readonly tag: string;
  readonly asset: string;
  readonly sha256: string;
  readonly size: number;
}

/** The GitHub-released entries of a signed list, in a stable order. Throws on a malformed payload. */
export function workerFirmwareAssets(signed: SignedReleases): WorkerFirmwareAsset[] {
  const out: WorkerFirmwareAsset[] = [];
  for (const m of signed.manifests) {
    const payload = JSON.parse(m.payload) as { boards?: { releases?: Record<string, unknown>[] }[] };
    for (const board of payload.boards ?? []) {
      for (const r of board.releases ?? []) {
        const { repo, tag, file, sha256, size } = r;
        if (repo === undefined && tag === undefined) continue;
        if (typeof repo !== 'string' || typeof tag !== 'string' || typeof file !== 'string' || typeof sha256 !== 'string' || typeof size !== 'number') {
          throw new Error(`${m.env}: a GitHub-released entry needs repo, tag, file, sha256 and size (${String(file)})`);
        }
        out.push({ env: m.env, repo, tag, asset: file, sha256, size });
      }
    }
  }
  const key = (a: WorkerFirmwareAsset) => `${a.env}\0${a.repo}\0${a.tag}\0${a.asset}`;
  out.sort((a, z) => (key(a) < key(z) ? -1 : key(a) > key(z) ? 1 : 0));
  return out;
}

/** The Worker module as committed. A plain data module: no imports, so the Worker build takes it as is. */
export function renderWorkerFirmwareAssets(signed: SignedReleases): string {
  const q = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const entries = workerFirmwareAssets(signed).map((a) => `  { env: ${q(a.env)}, repo: ${q(a.repo)}, tag: ${q(a.tag)}, asset: ${q(a.asset)}, sha256: ${q(a.sha256)}, size: ${a.size} },`);
  return [
    '/**',
    ' * GENERATED from firmware/releases.json by `pnpm sign:releases`. Do not edit:',
    ' * tools/gates/test/firmware-releases.test.ts fails unless this file matches',
    ' * the generator byte for byte (tools/gates/src/release/firmwareReleases.ts).',
    ' *',
    ' * The GitHub-released images the signed release list names, per',
    ' * environment: what the firmware proxy (firmwareProxy.ts) may fetch, and',
    ' * the SHA-256 and size each body must have to be served (OD-10).',
    ' */',
    '',
    'export interface FirmwareAsset {',
    "  readonly env: 'staging' | 'production';",
    '  /** `owner/name` on GitHub. */',
    '  readonly repo: string;',
    '  readonly tag: string;',
    '  /** The release asset name (the listed `.hex`). */',
    '  readonly asset: string;',
    '  readonly sha256: string;',
    '  readonly size: number;',
    '}',
    '',
    'export const FIRMWARE_ASSETS: readonly FirmwareAsset[] = Object.freeze([',
    ...entries,
    ']);',
    '',
  ].join('\n');
}
