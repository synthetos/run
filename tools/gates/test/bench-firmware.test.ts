/**
 * The bench server's firmware route (OD-10, tools/gates/src/bench/firmware.ts):
 * the Worker's proxy over the signed staging list, a fake GitHub and an
 * in-memory cache. The Host check and the bench headers still apply; a
 * mismatch or an unlisted path is a 404; GitHub down is a 502; other
 * `/firmware/...` paths stay site paths. No network: the fetch is a fake.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { benchFirmware, benchFirmwareAssets, isFirmwarePath } from '../src/bench/firmware.ts';
import { BENCH_BIND_ADDRESS, benchRespond, benchSite, listen } from '../src/bench/server.ts';
import { BENCH_MARKER } from '../src/bundle/scan.ts';
import type { TreeFile } from '../src/shared/files.ts';
import { HASHED_ASSET_CACHE_CONTROL, renderHeadersFile, SERIAL_GRANTED_SECURITY_HEADERS } from '../../../workers/run/src/headers.ts';
import type { FetchLike } from '../../../workers/run/src/firmwareProxy.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const enc = new TextEncoder();
const file = (path: string, text: string): TreeFile => ({ path, bytes: enc.encode(text) });
const tree = (): TreeFile[] => [
  file('index.html', '<!doctype html><script type="module" src="/assets/workspace-AAAAAAAA.js"></script>'),
  file('_headers', renderHeadersFile()),
  file('404.html', '<!doctype html><p data-page="not-found">Not found</p>'),
  file('assets/workspace-AAAAAAAA.js', 'import"./build-channel-BBBBBBBB.js";'),
  file('assets/build-channel-BBBBBBBB.js', `document.documentElement.dataset.buildMarker="${BENCH_MARKER}";`),
];

const IMAGE = readFileSync(join(REPO, 'firmware/tinyg-440.21.hex'));
const IMAGE_SHA = createHash('sha256').update(IMAGE).digest('hex');
const HEX_URL = 'https://github.com/synthetos/TinyG/releases/download/440.21/tinyg-440.21.hex';
const SUMS_URL = 'https://github.com/synthetos/TinyG/releases/download/440.21/SHA256SUMS';
const PATH = '/firmware/synthetos/TinyG/440.21/tinyg-440.21.hex';
const PORT = 8793;

/** A fake GitHub serving the repository's copy of the 440.21 release (and its SHA256SUMS), recording calls. */
function fakeGithub(overrides: Record<string, () => Response> = {}): { calls: string[]; fetch: FetchLike } {
  const calls: string[] = [];
  const answers: Record<string, () => Response> = {
    [HEX_URL]: () => new Response(new Uint8Array(IMAGE)),
    [SUMS_URL]: () => new Response(`${IMAGE_SHA}  tinyg-440.21.hex\n${'d'.repeat(64)}  tinyg-440.21.elf\n`),
    ...overrides,
  };
  return {
    calls,
    fetch: (url) => {
      calls.push(url);
      const a = answers[url];
      return Promise.resolve(a === undefined ? new Response('no', { status: 404 }) : a());
    },
  };
}

const releasesFile = (): unknown => JSON.parse(readFileSync(join(REPO, 'firmware/releases.json'), 'utf8'));

describe('benchFirmwareAssets: the signed staging list’s GitHub-released images', () => {
  it('lists 440.21 from the committed file, verified with the compiled-in keys', async () => {
    expect(await benchFirmwareAssets(releasesFile(), new Date('2026-11-03T12:00:00Z'))).toEqual([{ env: 'staging', repo: 'synthetos/TinyG', tag: '440.21', asset: 'tinyg-440.21.hex', sha256: IMAGE_SHA, size: IMAGE.length }]);
  });

  it('lists nothing from an unverifiable file (expired, malformed)', async () => {
    expect(await benchFirmwareAssets(releasesFile(), new Date('2030-01-01T00:00:00Z'))).toEqual([]);
    expect(await benchFirmwareAssets({ format: 'x' })).toEqual([]);
  });

  it('recognises only the four-segment proxy path', () => {
    expect(isFirmwarePath(PATH)).toBe(true);
    expect(isFirmwarePath('/firmware/tinyg-440.21.hex')).toBe(false);
    expect(isFirmwarePath('/firmware/sim/sim-edge-next-450.02.hex')).toBe(false);
  });
});

describe('the bench firmware route', () => {
  const assets = () => benchFirmwareAssets(releasesFile(), new Date('2026-11-03T12:00:00Z'));
  const req = (url: string, method = 'GET', host: string | undefined = `localhost:${PORT}`) => ({ method, url, host });

  it('serves the listed image after checking its hash, size and SHA256SUMS, with the bench headers and the immutable policy; then from memory', async () => {
    const gh = fakeGithub();
    const site = benchSite(tree(), benchFirmware(await assets(), gh.fetch));
    const res = await benchRespond(site, PORT, req(PATH));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['cache-control']).toBe(HASHED_ASSET_CACHE_CONTROL);
    expect(res.headers['content-length']).toBe(String(IMAGE.length));
    for (const [name, value] of Object.entries(SERIAL_GRANTED_SECURITY_HEADERS)) expect(res.headers[name], name).toBe(value);
    expect(Buffer.from(res.body).equals(IMAGE)).toBe(true);
    expect(gh.calls).toEqual([HEX_URL, SUMS_URL]);
    const again = await benchRespond(site, PORT, req(PATH, 'HEAD'));
    expect(again.status).toBe(200);
    expect(again.body).toHaveLength(0);
    expect(gh.calls).toHaveLength(2);
  });

  it('a body that is not the listed image is a 404; GitHub down is a 502; an unlisted path never reaches GitHub', async () => {
    const wrong = fakeGithub({ [HEX_URL]: () => new Response(new Uint8Array(IMAGE.subarray(0, IMAGE.length - 1))) });
    const siteWrong = benchSite(tree(), benchFirmware(await assets(), wrong.fetch));
    expect((await benchRespond(siteWrong, PORT, req(PATH))).status).toBe(404);
    const down = fakeGithub({ [HEX_URL]: () => new Response('maintenance', { status: 503 }) });
    const siteDown = benchSite(tree(), benchFirmware(await assets(), down.fetch));
    const res = await benchRespond(siteDown, PORT, req(PATH));
    expect(res.status).toBe(502);
    expect(new TextDecoder().decode(res.body)).not.toContain('maintenance');
    expect(res.headers['x-frame-options']).toBe('DENY');
    const gh = fakeGithub();
    const site = benchSite(tree(), benchFirmware(await assets(), gh.fetch));
    expect((await benchRespond(site, PORT, req('/firmware/synthetos/TinyG/440.20/tinyg-440.20.hex'))).status).toBe(404);
    expect((await benchRespond(site, PORT, req('/firmware/synthetos/TinyG/440.21/SHA256SUMS'))).status).toBe(404);
    expect(gh.calls).toEqual([]);
  });

  it('keeps the Host check, the method rule and the site paths', async () => {
    const gh = fakeGithub();
    const site = benchSite(tree(), benchFirmware(await assets(), gh.fetch));
    expect((await benchRespond(site, PORT, req(PATH, 'GET', `evil.example:${PORT}`))).status).toBe(421);
    expect((await benchRespond(site, PORT, req(PATH, 'POST'))).status).toBe(405);
    expect((await benchRespond(site, PORT, req('/'))).status).toBe(200);
    expect((await benchRespond(site, PORT, req('/firmware/tinyg-440.21.hex'))).status).toBe(404);
    expect(gh.calls).toEqual([]);
    // Without a firmware route the proxy path is a site path: the 404 page.
    const plainSite = benchSite(tree());
    const res = await benchRespond(plainSite, PORT, req(PATH));
    expect(res.status).toBe(404);
    expect(new TextDecoder().decode(res.body)).toContain('data-page="not-found"');
  });
});

describe('over a real socket', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  function get(port: number, path: string): Promise<{ status: number; body: Buffer; headers: Record<string, string | string[] | undefined> }> {
    return new Promise((resolve, reject) => {
      const r = request({ host: BENCH_BIND_ADDRESS, port, path, method: 'GET', headers: { host: `localhost:${port}` } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers }));
      });
      r.on('error', reject);
      r.end();
    });
  }

  it('serves the image through node:http', async () => {
    const gh = fakeGithub();
    const started = await listen(benchSite(tree(), benchFirmware(await benchFirmwareAssets(releasesFile(), new Date('2026-11-03T12:00:00Z')), gh.fetch)), 0);
    server = started.server;
    const res = await get(started.port, PATH);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(HASHED_ASSET_CACHE_CONTROL);
    expect(res.body.equals(IMAGE)).toBe(true);
    expect((await get(started.port, '/')).status).toBe(200);
  });
});
