/**
 * The firmware asset proxy (OD-10, docs/ops/firmware-releases.md):
 * `GET /firmware/<owner>/<name>/<tag>/<asset>`.
 *
 * Official firmware images are GitHub Release assets, and a browser cannot
 * fetch them directly (the download redirects to
 * release-assets.githubusercontent.com, which sends no CORS header, and the
 * page's CSP is `connect-src 'self'` anyway). So the Worker fetches the asset
 * server-side and serves it on run's own origin, under these rules:
 *
 * - only a repository in FIRMWARE_REPOSITORIES and an asset name matching
 *   FIRMWARE_ASSET_NAME_RE are ever routed to GitHub;
 * - only a tag and asset the signed release list names (firmwareAssets.ts,
 *   generated from firmware/releases.json for this Worker's environment) is
 *   fetched, and its body is served only when its SHA-256 equals the list's
 *   and its size equals the list's. A `.hex` is also cross-checked against
 *   the release's own SHA256SUMS file. Anything else is a 404 with no detail;
 * - the body is buffered and capped at MAX_FIRMWARE_ASSET_BYTES (a full
 *   x192a3 image is about 540 KB of text);
 * - a verified body is cached under its hash (the Cache API on Cloudflare, a
 *   map on the bench) and served `text/plain` with the immutable cache policy
 *   of hashed assets, since the bytes under a listed hash never change.
 *
 * The Worker is never trusted for safety (RUN_PLAN §5.3): the page and then
 * the machine worker verify the signed list and hash the bytes again before
 * anything is parsed or flashed. This proxy only narrows what reaches them.
 *
 * `fetch` and the cache are injected so the unit tests and the bench server
 * use the same code with a fake GitHub and a map.
 */
import { FIRMWARE_ASSETS, type FirmwareAsset } from './firmwareAssets.ts';
import { HASHED_ASSET_CACHE_CONTROL } from './headers.ts';

/**
 * The GitHub repositories whose release assets may be proxied (OD-10). The
 * same list as packages/protocol FIRMWARE_RELEASE_REPOSITORIES (the Worker
 * may not import protocol; tools/gates/test/firmware-releases.test.ts holds
 * them equal). Widening it is a reviewed change.
 */
export const FIRMWARE_REPOSITORIES: readonly string[] = Object.freeze(['synthetos/TinyG', 'synthetos/tg-xboot']);

/** Asset names the route accepts: a `.hex` or `.txt` file, or the release's SHA256SUMS. */
export const FIRMWARE_ASSET_NAME_RE = /^(?!\.)[A-Za-z0-9._-]+\.(?:hex|txt)$|^SHA256SUMS$/;

/** A release tag as a single clean path segment. */
const TAG_RE = /^(?!\.+$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The largest asset body served; anything longer is not the listed file. */
export const MAX_FIRMWARE_ASSET_BYTES = 2 * 1024 * 1024;

/** The largest SHA256SUMS file read for the cross-check. */
const MAX_SUMS_BYTES = 64 * 1024;

/**
 * The only upstream origin this proxy fetches from: GitHub's release
 * downloads, `https://github.com/<owner>/<name>/releases/download/<tag>/<asset>`
 * (which redirect to GitHub's asset store). The reviewed allowance for this
 * literal is tools/gates/test/worker-upstreams.test.ts.
 */
export const GITHUB_RELEASES_ORIGIN = 'https://github.com';

/** A verified asset is immutable under its hash: the same policy as content-hashed build assets. */
export const FIRMWARE_CACHE_CONTROL = HASHED_ASSET_CACHE_CONTROL;

export const FIRMWARE_CONTENT_TYPE = 'text/plain; charset=utf-8';

export interface FirmwareAssetPath {
  readonly repo: string;
  readonly tag: string;
  readonly asset: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A store of verified bodies by their SHA-256. Failures are swallowed: the cache only saves a fetch. */
export interface FirmwareCache {
  get(sha256: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  put(sha256: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}

export interface FirmwareProxyDeps {
  readonly fetch: FetchLike;
  readonly cache: FirmwareCache;
  /** Tests and the bench: the list to serve instead of the generated FIRMWARE_ASSETS. */
  readonly assets?: readonly FirmwareAsset[];
}

export type FirmwareFetchFailure = 'unlisted' | 'upstream' | 'mismatch';

export type FirmwareFetch = { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer>; readonly entry: FirmwareAsset } | { readonly ok: false; readonly reason: FirmwareFetchFailure };

/** A cache that stores nothing (tests, and a Worker without the Cache API). */
export const NO_CACHE: FirmwareCache = Object.freeze({
  get: () => Promise.resolve(undefined),
  put: () => Promise.resolve(),
});

/** A map-backed cache (the bench server, and the tests). */
export function memoryCache(): FirmwareCache {
  const store = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    get: (sha256) => Promise.resolve(store.get(sha256)),
    put: (sha256, bytes) => {
      store.set(sha256, bytes);
      return Promise.resolve();
    },
  };
}

/**
 * The parts of `/firmware/<owner>/<name>/<tag>/<asset>`, or null for any other
 * path (including `/firmware/<file>` and `/firmware/sim/<file>`, which stay
 * with the asset layer), an unlisted repository, or a tag or asset name
 * outside the accepted forms. Exactly four segments, none empty, no decoding
 * tricks: the raw pathname must already be clean.
 */
export function firmwareAssetPath(pathname: string): FirmwareAssetPath | null {
  if (!pathname.startsWith('/firmware/')) return null;
  const segments = pathname.slice('/firmware/'.length).split('/');
  if (segments.length !== 4) return null;
  const [owner, name, tag, asset] = segments as [string, string, string, string];
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  const repo = `${owner}/${name}`;
  if (!FIRMWARE_REPOSITORIES.includes(repo)) return null;
  if (!TAG_RE.test(tag) || !FIRMWARE_ASSET_NAME_RE.test(asset)) return null;
  return Object.freeze({ repo, tag, asset });
}

/** The GitHub download URL of a release asset. */
export function githubAssetUrl(path: FirmwareAssetPath): string {
  return `${GITHUB_RELEASES_ORIGIN}/${path.repo}/releases/download/${encodeURIComponent(path.tag)}/${encodeURIComponent(path.asset)}`;
}

/** The release-list environment a Worker serves: its own, with the local dev Worker reading the staging list. */
export function releasesEnvironment(runEnv: unknown): FirmwareAsset['env'] | null {
  if (runEnv === 'production') return 'production';
  if (runEnv === 'staging' || runEnv === 'development') return 'staging';
  return null;
}

/** The list entry for a path in an environment, or undefined. */
export function listedAsset(path: FirmwareAssetPath, env: FirmwareAsset['env'] | null, assets: readonly FirmwareAsset[] = FIRMWARE_ASSETS): FirmwareAsset | undefined {
  if (env === null) return undefined;
  return assets.find((a) => a.env === env && a.repo === path.repo && a.tag === path.tag && a.asset === path.asset);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Reads a body up to `limit` bytes. Returns undefined once the body exceeds
 * the limit (the read stops there; nothing larger is buffered) or the
 * response is not a 200.
 */
async function readCapped(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (response.status !== 200) return undefined;
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > limit) return undefined;
  const body = response.body;
  if (body === null) return new Uint8Array(new ArrayBuffer(0));
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const UPSTREAM_INIT: RequestInit = Object.freeze({ method: 'GET', redirect: 'follow', headers: { accept: 'application/octet-stream' } });

/** The hash SHA256SUMS names for `asset` (`<hash>  <name>` lines), or undefined. */
export function sumFor(sums: string, asset: string): string | undefined {
  for (const line of sums.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(line.replace(/\r$/, ''));
    if (m !== null && m[2] === asset) return m[1];
  }
  return undefined;
}

/**
 * Fetches one listed asset: the cache first, then GitHub; the body must hash
 * to the list's SHA-256 and have its size, and a `.hex` must also be named
 * with that hash in the release's SHA256SUMS. Never throws.
 */
export async function fetchListedAsset(path: FirmwareAssetPath, entry: FirmwareAsset, deps: FirmwareProxyDeps): Promise<FirmwareFetch> {
  const cached = await deps.cache.get(entry.sha256).catch(() => undefined);
  if (cached !== undefined && cached.byteLength === entry.size) return { ok: true, bytes: cached, entry };
  let response: Response;
  try {
    response = await deps.fetch(githubAssetUrl(path), UPSTREAM_INIT);
  } catch {
    return { ok: false, reason: 'upstream' };
  }
  if (response.status >= 500) return { ok: false, reason: 'upstream' };
  const bytes = await readCapped(response, Math.min(MAX_FIRMWARE_ASSET_BYTES, entry.size)).catch(() => undefined);
  if (bytes === undefined) return { ok: false, reason: 'mismatch' };
  if (bytes.byteLength !== entry.size || (await sha256Hex(bytes)) !== entry.sha256) return { ok: false, reason: 'mismatch' };
  if (path.asset.endsWith('.hex')) {
    let sums: Response;
    try {
      sums = await deps.fetch(githubAssetUrl({ ...path, asset: 'SHA256SUMS' }), UPSTREAM_INIT);
    } catch {
      return { ok: false, reason: 'upstream' };
    }
    if (sums.status >= 500) return { ok: false, reason: 'upstream' };
    const text = await readCapped(sums, MAX_SUMS_BYTES).catch(() => undefined);
    if (text === undefined || sumFor(new TextDecoder().decode(text), path.asset) !== entry.sha256) return { ok: false, reason: 'mismatch' };
  }
  await deps.cache.put(entry.sha256, bytes).catch(() => undefined);
  return { ok: true, bytes, entry };
}

/** The headers of a served asset (the caller adds the security headers). */
export function firmwareHeaders(bytes: Uint8Array): Readonly<Record<string, string>> {
  return Object.freeze({ 'content-type': FIRMWARE_CONTENT_TYPE, 'cache-control': FIRMWARE_CACHE_CONTROL, 'content-length': String(bytes.byteLength) });
}

/**
 * The route: the listed asset for this environment, fetched and verified, or
 * a failure the caller turns into a 404 (`unlisted`, `mismatch`) or a 502
 * (`upstream`). Never throws.
 */
export async function proxyFirmwareAsset(pathname: string, runEnv: unknown, deps: FirmwareProxyDeps): Promise<FirmwareFetch> {
  const path = firmwareAssetPath(pathname);
  if (path === null) return { ok: false, reason: 'unlisted' };
  const entry = listedAsset(path, releasesEnvironment(runEnv), deps.assets ?? FIRMWARE_ASSETS);
  if (entry === undefined) return { ok: false, reason: 'unlisted' };
  return fetchListedAsset(path, entry, deps);
}
