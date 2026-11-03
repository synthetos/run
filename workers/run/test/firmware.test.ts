/**
 * The firmware asset proxy (OD-10, src/firmwareProxy.ts): only a listed
 * repository, tag and asset of this Worker's environment is fetched from
 * GitHub, and only a body whose SHA-256 and size equal the signed list's
 * (and, for a `.hex`, the release's SHA256SUMS) is served, same-origin,
 * immutable, with the security headers. Everything else is a 404 with no
 * detail; a GitHub failure is a 502. Nothing here touches the network: the
 * fetch is a fake.
 */
import { describe, expect, it } from 'vitest';
import worker from '../src/index.ts';
import { FIRMWARE_ASSETS, type FirmwareAsset } from '../src/firmwareAssets.ts';
import {
  FIRMWARE_ASSET_NAME_RE,
  FIRMWARE_REPOSITORIES,
  firmwareAssetPath,
  fetchListedAsset,
  GITHUB_RELEASES_ORIGIN,
  githubAssetUrl,
  MAX_FIRMWARE_ASSET_BYTES,
  memoryCache,
  proxyFirmwareAsset,
  releasesEnvironment,
  sumFor,
  type FirmwareProxyDeps,
} from '../src/firmwareProxy.ts';
import { HASHED_ASSET_CACHE_CONTROL, SECURITY_HEADERS, SERIAL_GRANTED_SECURITY_HEADERS } from '../src/headers.ts';
import { type Env, route } from '../src/routes.ts';

const STAGING = 'https://staging.run.synthetos.com';
const enc = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A small "release": a hex body, its hash, and the SHA256SUMS GitHub would publish for it. */
async function release(text = ':020000040000FA\n:00000001FF\n') {
  const bytes = enc.encode(text);
  const hash = await sha256(bytes);
  const entry: FirmwareAsset = { env: 'staging', repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex', sha256: hash, size: bytes.byteLength };
  const sums = `${hash}  tinyg-440.21.hex\n${'d'.repeat(64)}  tinyg-440.21.elf\n`;
  return { bytes, hash, entry, sums, text };
}

interface Fake {
  readonly calls: string[];
  readonly deps: FirmwareProxyDeps;
}

/** A fake GitHub: answers by URL; records every call. */
function github(answers: Record<string, () => Response | Promise<Response>>, cache = memoryCache(), assets?: readonly FirmwareAsset[]): Fake {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      cache,
      ...(assets === undefined ? {} : { assets }),
      fetch: (url) => {
        calls.push(url);
        const answer = answers[url];
        return answer === undefined ? Promise.resolve(new Response('not found', { status: 404 })) : Promise.resolve(answer());
      },
    },
  };
}

const assets: Env['ASSETS'] = { fetch: () => Promise.resolve(new Response('asset layer', { status: 404 })) };
const env = (runEnv = 'staging'): Env => ({ ASSETS: assets, RUN_ENV: runEnv });
const HEX_URL = `${GITHUB_RELEASES_ORIGIN}/synthetos/TinyG/releases/download/440.21/tinyg-440.21.hex`;
const SUMS_URL = `${GITHUB_RELEASES_ORIGIN}/synthetos/TinyG/releases/download/440.21/SHA256SUMS`;
const PATH = '/firmware/synthetos/TinyG/440.21/tinyg-440.21.hex';

describe('the route shape', () => {
  it('parses exactly /firmware/<owner>/<name>/<tag>/<asset> for an allowlisted repository', () => {
    expect(firmwareAssetPath(PATH)).toEqual({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' });
    expect(firmwareAssetPath('/firmware/synthetos/tg-xboot/v2.0.0/SHA256SUMS')).toEqual({ repo: 'synthetos/tg-xboot', tag: 'v2.0.0', asset: 'SHA256SUMS' });
    expect(firmwareAssetPath('/firmware/synthetos/tg-xboot/v2.0.0/TOOLCHAIN.txt')).not.toBeNull();
  });

  it.each([
    '/firmware/tinyg-440.21.hex',
    '/firmware/sim/sim-edge-next-450.02.hex',
    '/firmware/synthetos/TinyG/440.21',
    '/firmware/synthetos/TinyG/440.21/tinyg-440.21.hex/extra',
    '/firmware/evil/TinyG/440.21/tinyg-440.21.hex',
    '/firmware/synthetos/g2/101.03/g2.hex',
    '/firmware/synthetos/TinyG/../tinyg-440.21.hex',
    '/firmware/synthetos/TinyG/440.21/tinyg-440.21.elf',
    '/firmware/synthetos/TinyG/440.21/.hex',
    '/firmware/synthetos/TinyG/440.21/..hex',
    '/firmware/synthetos/TinyG/440.21/sha256sums',
    '/firmware/synthetos/TinyG//tinyg-440.21.hex',
    '/firmware/synthetos/TinyG/440.21/',
    '/firmwares/synthetos/TinyG/440.21/tinyg-440.21.hex',
    '/api/firmware/synthetos/TinyG/440.21/tinyg-440.21.hex',
  ])('leaves %s to the asset layer (or the 404)', (path) => {
    expect(firmwareAssetPath(path)).toBeNull();
  });

  it('the repository allowlist and asset-name rule are the reviewed ones', () => {
    expect(FIRMWARE_REPOSITORIES).toEqual(['synthetos/TinyG', 'synthetos/tg-xboot']);
    for (const ok of ['tinyg-440.21.hex', 'tg-xboot-v2.0.0-boot.hex', 'size.txt', 'TOOLCHAIN.txt', 'SHA256SUMS']) expect(FIRMWARE_ASSET_NAME_RE.test(ok), ok).toBe(true);
    for (const bad of ['tinyg-440.21.elf', 'x.HEX', 'a b.hex', 'SHA256SUMS.txt.exe', 'sha256sums', '.hex', 'x/y.hex']) expect(FIRMWARE_ASSET_NAME_RE.test(bad), bad).toBe(false);
  });

  it('builds the GitHub download URL under the reviewed origin only', () => {
    expect(githubAssetUrl({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' })).toBe(HEX_URL);
    expect(GITHUB_RELEASES_ORIGIN).toBe('https://github.com');
  });

  it('serves the staging list on staging and in local development, the production list in production, nothing otherwise', () => {
    expect(releasesEnvironment('staging')).toBe('staging');
    expect(releasesEnvironment('development')).toBe('staging');
    expect(releasesEnvironment('production')).toBe('production');
    expect(releasesEnvironment(undefined)).toBeNull();
    expect(releasesEnvironment('Staging')).toBeNull();
  });

  it('reads the asset’s line of a SHA256SUMS file', () => {
    expect(sumFor(`${'a'.repeat(64)}  x.hex\r\n${'b'.repeat(64)} *y.hex\n`, 'y.hex')).toBe('b'.repeat(64));
    expect(sumFor(`${'a'.repeat(64)}  x.hex\n`, 'x.hex')).toBe('a'.repeat(64));
    expect(sumFor(`${'a'.repeat(64)}  x.hex\n`, 'x.hexx')).toBeUndefined();
    expect(sumFor('garbage\n', 'x.hex')).toBeUndefined();
  });
});

describe('fetchListedAsset', () => {
  it('serves a body whose hash, size and SHA256SUMS line match the list, and caches it under the hash', async () => {
    const r = await release();
    const fake = github({ [HEX_URL]: () => new Response(r.bytes), [SUMS_URL]: () => new Response(r.sums) });
    const first = await fetchListedAsset({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' }, r.entry, fake.deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(new TextDecoder().decode(first.bytes)).toBe(r.text);
    expect(fake.calls).toEqual([HEX_URL, SUMS_URL]);
    // The second request is answered from the cache: GitHub is not asked again.
    const second = await fetchListedAsset({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' }, r.entry, fake.deps);
    expect(second.ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
    expect(await fake.deps.cache.get(r.hash)).toEqual(r.bytes);
  });

  it('a body with another hash is a mismatch, even at the right size, and is not cached', async () => {
    const r = await release();
    const other = enc.encode(r.text.replace('FA', 'FB'));
    expect(other.byteLength).toBe(r.bytes.byteLength);
    const fake = github({ [HEX_URL]: () => new Response(other), [SUMS_URL]: () => new Response(r.sums) });
    expect(await fetchListedAsset({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' }, r.entry, fake.deps)).toEqual({ ok: false, reason: 'mismatch' });
    expect(await fake.deps.cache.get(r.hash)).toBeUndefined();
  });

  it('a SHA256SUMS that disagrees with the signed list, or lacks the asset, is a mismatch', async () => {
    const r = await release();
    const disagree = github({ [HEX_URL]: () => new Response(r.bytes), [SUMS_URL]: () => new Response(`${'e'.repeat(64)}  tinyg-440.21.hex\n`) });
    expect(await fetchListedAsset({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' }, r.entry, disagree.deps)).toEqual({ ok: false, reason: 'mismatch' });
    const missing = github({ [HEX_URL]: () => new Response(r.bytes), [SUMS_URL]: () => new Response(`${r.hash}  other.hex\n`) });
    expect(await fetchListedAsset({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' }, r.entry, missing.deps)).toEqual({ ok: false, reason: 'mismatch' });
    const gone = github({ [HEX_URL]: () => new Response(r.bytes) });
    expect(await fetchListedAsset({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' }, r.entry, gone.deps)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('an oversized body is refused before it is buffered whole, by content-length or by reading', async () => {
    const r = await release();
    const big: FirmwareAsset = { ...r.entry, size: MAX_FIRMWARE_ASSET_BYTES };
    let pulled = 0;
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            controller.enqueue(new Uint8Array(256 * 1024));
          },
        }),
      );
    const streamed = github({ [HEX_URL]: endless });
    expect(await fetchListedAsset({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' }, big, streamed.deps)).toEqual({ ok: false, reason: 'mismatch' });
    expect(pulled).toBeLessThan(12);
    const declared = github({ [HEX_URL]: () => new Response(r.bytes, { headers: { 'content-length': String(MAX_FIRMWARE_ASSET_BYTES + 1) } }) });
    expect(await fetchListedAsset({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' }, big, declared.deps)).toEqual({ ok: false, reason: 'mismatch' });
    // A body longer than the listed size stops at that size: the list's size is the cap for a listed entry.
    const longer = github({ [HEX_URL]: () => new Response(enc.encode(`${r.text}\n`)), [SUMS_URL]: () => new Response(r.sums) });
    expect(await fetchListedAsset({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' }, r.entry, longer.deps)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('a GitHub 5xx or a network error is an upstream failure (for the hex and for SHA256SUMS); a 404 there is a mismatch', async () => {
    const r = await release();
    const at = { repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' };
    expect(await fetchListedAsset(at, r.entry, github({ [HEX_URL]: () => new Response('down', { status: 503 }) }).deps)).toEqual({ ok: false, reason: 'upstream' });
    expect(await fetchListedAsset(at, r.entry, github({ [HEX_URL]: () => new Response(r.bytes), [SUMS_URL]: () => new Response('down', { status: 502 }) }).deps)).toEqual({ ok: false, reason: 'upstream' });
    const offline: FirmwareProxyDeps = { cache: memoryCache(), fetch: () => Promise.reject(new Error('ENOTFOUND')) };
    expect(await fetchListedAsset(at, r.entry, offline)).toEqual({ ok: false, reason: 'upstream' });
    expect(await fetchListedAsset(at, r.entry, github({}).deps)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('a cached body of the wrong size is ignored, not served', async () => {
    const r = await release();
    const cache = memoryCache();
    await cache.put(r.hash, new Uint8Array(new ArrayBuffer(3)));
    const fake = github({ [HEX_URL]: () => new Response(r.bytes), [SUMS_URL]: () => new Response(r.sums) }, cache);
    const result = await fetchListedAsset({ repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex' }, r.entry, fake.deps);
    expect(result.ok).toBe(true);
    expect(fake.calls).toEqual([HEX_URL, SUMS_URL]);
  });
});

describe('proxyFirmwareAsset: only what the list names for this environment', () => {
  it('an unlisted tag, asset, or repository never reaches GitHub', async () => {
    const r = await release();
    const fake = github({ [HEX_URL]: () => new Response(r.bytes), [SUMS_URL]: () => new Response(r.sums) });
    const deps = { ...fake.deps, assets: [r.entry] };
    for (const path of ['/firmware/synthetos/TinyG/440.20/tinyg-440.20.hex', '/firmware/synthetos/TinyG/440.21/size.txt', '/firmware/synthetos/TinyG/440.21/SHA256SUMS', '/firmware/synthetos/tg-xboot/v2.0.0/tg-xboot-v2.0.0.hex', '/firmware/evil/TinyG/440.21/tinyg-440.21.hex']) {
      expect(await proxyFirmwareAsset(path, 'staging', deps), path).toEqual({ ok: false, reason: 'unlisted' });
    }
    // The staging entry is not served by the production Worker, nor by one with no environment.
    expect(await proxyFirmwareAsset(PATH, 'production', deps)).toEqual({ ok: false, reason: 'unlisted' });
    expect(await proxyFirmwareAsset(PATH, undefined, deps)).toEqual({ ok: false, reason: 'unlisted' });
    expect(fake.calls).toEqual([]);
    expect((await proxyFirmwareAsset(PATH, 'staging', deps)).ok).toBe(true);
  });

  it('the committed list names the one real TinyG release for staging only, and production lists nothing', () => {
    expect(FIRMWARE_ASSETS).toEqual([{ env: 'staging', repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex', sha256: 'c2c1693e82f0ed88ec8dec4338a0bc799059c10b3323acb1189564f6a2265e92', size: 334978 }]);
    expect(FIRMWARE_ASSETS.filter((a) => a.env === 'production')).toEqual([]);
    for (const a of FIRMWARE_ASSETS) expect(FIRMWARE_REPOSITORIES).toContain(a.repo);
  });
});

describe('GET /firmware/... through the Worker', () => {
  it('serves a listed, verified asset same-origin: text/plain, immutable; HEAD carries no body', async () => {
    const r = await release();
    const fake = github({ [HEX_URL]: () => new Response(r.bytes), [SUMS_URL]: () => new Response(r.sums) }, memoryCache(), [r.entry]);
    const res = await route(new Request(`${STAGING}${PATH}`), env('staging'), undefined, fake.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe(HASHED_ASSET_CACHE_CONTROL);
    expect(res.headers.get('content-length')).toBe(String(r.bytes.byteLength));
    expect(await res.text()).toBe(r.text);
    const head = await route(new Request(`${STAGING}${PATH}`, { method: 'HEAD' }), env('staging'), undefined, fake.deps);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(fake.calls).toEqual([HEX_URL, SUMS_URL]);
  });

  it('the committed list: a body that is not the real 440.21 image is a detail-free 404, and the Worker asked GitHub for it', async () => {
    const r = await release();
    const fake = github({ [HEX_URL]: () => new Response(r.bytes), [SUMS_URL]: () => new Response(r.sums) });
    const res = await route(new Request(`${STAGING}${PATH}`), env('staging'), undefined, fake.deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(fake.calls).toEqual([HEX_URL]);
  });

  it('a 404 for an unlisted path, a 405 for POST, and a 502 when GitHub is down, each with no detail', async () => {
    const r = await release();
    const down = github({ [HEX_URL]: () => new Response('down', { status: 503 }) }, memoryCache(), [r.entry]);
    const notFound = await route(new Request(`${STAGING}/firmware/synthetos/TinyG/440.20/tinyg-440.20.hex`), env('staging'), undefined, down.deps);
    expect(notFound.status).toBe(404);
    expect(await notFound.text()).toBe('{"error":"not_found"}\n');
    expect(down.calls).toEqual([]);
    const post = await route(new Request(`${STAGING}${PATH}`, { method: 'POST' }), env('staging'), undefined, down.deps);
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    const upstream = await route(new Request(`${STAGING}${PATH}`), env('staging'), undefined, down.deps);
    expect(upstream.status).toBe(502);
    expect(upstream.headers.get('cache-control')).toBe('no-store');
    expect(await upstream.text()).toBe('{"error":"upstream_unavailable"}\n');
    const mismatch = github({ [HEX_URL]: () => new Response(enc.encode('not the image')) }, memoryCache(), [r.entry]);
    expect((await route(new Request(`${STAGING}${PATH}`), env('staging'), undefined, mismatch.deps)).status).toBe(404);
  });

  it('through the handler every answer carries the security headers (serial granted on staging, not in production)', async () => {
    const staging = await worker.fetch(new Request(`${STAGING}/firmware/synthetos/TinyG/440.20/tinyg-440.20.hex`), env('staging'));
    expect(staging.status).toBe(404);
    for (const [name, value] of Object.entries(SERIAL_GRANTED_SECURITY_HEADERS)) expect(staging.headers.get(name), name).toBe(value);
    const production = await worker.fetch(new Request(`https://run.synthetos.com${PATH}`), env('production'));
    expect(production.status).toBe(404);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(production.headers.get(name), name).toBe(value);
  });

  it('other /firmware paths still go to the asset layer', async () => {
    const seen: string[] = [];
    const e: Env = { RUN_ENV: 'staging', ASSETS: { fetch: (req) => { seen.push(new URL(req.url).pathname); return Promise.resolve(new Response('hex', { status: 200 })); } } };
    expect((await route(new Request(`${STAGING}/firmware/sim/sim-edge-next-450.02.hex`), e)).status).toBe(200);
    expect((await route(new Request(`${STAGING}/firmware/tinyg-440.21.hex`), e)).status).toBe(200);
    expect(seen).toEqual(['/firmware/sim/sim-edge-next-450.02.hex', '/firmware/tinyg-440.21.hex']);
  });
});
