/**
 * The localhost bench server (P1-00, tools/gates/src/bench/server.ts): it
 * serves only a clean bench build, only to loopback Host names, only over
 * GET and HEAD, with the production headers except `serial=(self)`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { BENCH_BIND_ADDRESS, BenchSiteRefused, benchResponse, benchSite, listen } from '../src/bench/server.ts';
import type { TreeFile } from '../src/shared/files.ts';
import { BENCH_MARKER, TESTKIT_MARKER } from '../src/bundle/scan.ts';
import { HASHED_ASSET_CACHE_CONTROL, renderHeadersFile, SECURITY_HEADERS, SERIAL_GRANTED_SECURITY_HEADERS } from '../../../workers/run/src/headers.ts';

const enc = new TextEncoder();
const file = (path: string, text: string): TreeFile => ({ path, bytes: enc.encode(text) });

/** A minimal clean bench tree: a page, the generated _headers, a marked channel chunk, a 404 page and a sub-page. */
function benchTree(extra: TreeFile[] = []): TreeFile[] {
  return [
    file('index.html', '<!doctype html><script type="module" src="/assets/workspace-AAAAAAAA.js"></script>'),
    file('_headers', renderHeadersFile()),
    file('404.html', '<!doctype html><p data-page="not-found">Not found</p>'),
    file('safety/index.html', '<!doctype html><p>safety</p>'),
    file('assets/workspace-AAAAAAAA.js', 'import"./build-channel-BBBBBBBB.js";'),
    file('assets/build-channel-BBBBBBBB.js', `document.documentElement.dataset.buildMarker="${BENCH_MARKER}";`),
    ...extra,
  ];
}

const PORT = 8793;
const site = benchSite(benchTree());
const get = (url: string, host: string | undefined = `localhost:${PORT}`, method = 'GET') => benchResponse(site, PORT, { method, url, host });
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('benchSite: only a clean bench build is served', () => {
  it('accepts the clean bench tree', () => {
    expect(site.files.size).toBe(6);
  });

  it('refuses the release build (no bench marker)', () => {
    const release = benchTree().filter((f) => !f.path.startsWith('assets/build-channel'));
    expect(() => benchSite(release)).toThrow(BenchSiteRefused);
    try {
      benchSite(release);
    } catch (error) {
      expect((error as BenchSiteRefused).findings.map((f) => f.rule)).toContain('bench-marker-missing');
    }
  });

  it('refuses a tree with the test kit (the fake-serial build)', () => {
    expect(() => benchSite(benchTree([file('assets/machine-transport-CCCCCCCC.js', `"${TESTKIT_MARKER}"`)]))).toThrow(/testkit-marker/);
  });

  it('refuses Web Serial outside the transport chunk, and an origin literal', () => {
    expect(() => benchSite(benchTree([file('assets/x-DDDDDDDD.js', 'navigator.serial.getPorts()')]))).toThrow(/web-serial/);
    expect(() => benchSite(benchTree([file('assets/y-EEEEEEEE.js', 'const u="https://evil.example/x";')]))).toThrow(/origin-literal/);
  });
});

describe('benchResponse', () => {
  it('serves a page with the serial-granted headers, exactly', () => {
    const res = get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
    for (const [name, value] of Object.entries(SERIAL_GRANTED_SECURITY_HEADERS)) expect(res.headers[name], name).toBe(value);
    expect(res.headers['permissions-policy']).toContain('serial=(self)');
    expect(res.headers['permissions-policy']).not.toBe(SECURITY_HEADERS['permissions-policy']);
  });

  it('serves hashed assets immutable, and HEAD without a body', () => {
    const res = get('/assets/workspace-AAAAAAAA.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['cache-control']).toBe(HASHED_ASSET_CACHE_CONTROL);
    expect(get('/assets/workspace-AAAAAAAA.js', undefined, 'HEAD').body).toHaveLength(0);
  });

  it.each([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `LOCALHOST:${PORT}`])('answers Host %s', (host) => {
    expect(get('/', host).status).toBe(200);
  });

  it.each([undefined, 'localhost', '127.0.0.1', `localhost:${PORT + 1}`, `evil.example:${PORT}`, `localhost.evil.example:${PORT}`, `[::1]:${PORT}`, `192.168.1.5:${PORT}`])(
    'refuses Host %s with 421 (DNS rebinding), still with the headers',
    (host) => {
      const res = benchResponse(site, PORT, { method: 'GET', url: '/', host });
      expect(res.status).toBe(421);
      expect(text(res.body)).not.toContain('<script');
      expect(res.headers['x-frame-options']).toBe('DENY');
    },
  );

  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'])('refuses %s', (method) => {
    const res = get('/', `localhost:${PORT}`, method);
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBe('GET, HEAD');
  });

  it.each(['/../etc/passwd', '/assets/../_headers', '/%2e%2e/x', '/a\\\\b', '/%00', '/%E0%A4%A', '//evil.example/x', 'evil', '/./index.html'])('refuses the path %s', (url) => {
    expect(get(url).status).toBe(400);
  });

  it('never serves _headers', () => {
    const res = get('/_headers');
    expect(res.status).toBe(404);
    expect(text(res.body)).toContain('data-page="not-found"');
  });

  it('serves the 404 page for anything missing, and redirects a directory to its slash form', () => {
    const missing = get('/nope');
    expect(missing.status).toBe(404);
    expect(text(missing.body)).toContain('data-page="not-found"');
    expect(missing.headers['permissions-policy']).toBe(SERIAL_GRANTED_SECURITY_HEADERS['permissions-policy']);
    const dir = get('/safety');
    expect(dir.status).toBe(308);
    expect(dir.headers['location']).toBe('/safety/');
    expect(get('/safety/').status).toBe(200);
    expect(get('/safety/?q=1').status).toBe(200);
  });
});

describe('listen: a real socket on 127.0.0.1', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  function raw(port: number, host: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: BENCH_BIND_ADDRESS, port, path: '/', method: 'GET', headers: { host } }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('binds 127.0.0.1 only, serves loopback Host names and refuses others', async () => {
    const started = await listen(site, 0);
    server = started.server;
    const address = server.address();
    expect(typeof address === 'object' && address !== null ? address.address : '').toBe('127.0.0.1');
    const ok = await raw(started.port, `localhost:${started.port}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['permissions-policy']).toBe(SERIAL_GRANTED_SECURITY_HEADERS['permissions-policy']);
    expect((await raw(started.port, `attacker.example:${started.port}`)).status).toBe(421);
  });
});
