/**
 * The localhost bench server (P1-00; owner decision D41, accepted 2026-11-02:
 * docs/ops/owner-decisions.md). It is how the owner opens the bench build
 * (`pnpm build:bench`, apps/web/build/bench.ts) next to a real TinyG.
 *
 * What it guarantees, each tested in tools/gates/test/bench-server.test.ts:
 *
 * - It serves only a tree that passes the bundle scan for the `bench`
 *   target: the bench marker must be there, no test kit, Web Serial only in
 *   the transport's chunk. The release build (no marker) and the fake-serial
 *   test build (test kit) are refused. The tree is read into memory once and
 *   scanned, and only those bytes are served, so what was scanned is what
 *   the browser gets.
 * - It listens on 127.0.0.1 only (the CLI has no option to change that), and
 *   answers only requests whose Host is `127.0.0.1:<port>` or
 *   `localhost:<port>` (421 otherwise), so a DNS-rebinding page under
 *   another name gets nothing from it.
 * - Every response carries SERIAL_GRANTED_SECURITY_HEADERS
 *   (workers/run/src/headers.ts): the production set with `serial=(self)`.
 *   The CSP, Trusted Types and every other header are the production ones.
 * - GET and HEAD only; no dot segments, backslashes, NUL or undecodable
 *   paths; `_headers` is not served; `/assets/*` gets the immutable cache
 *   policy and everything else `no-cache`; directories follow the asset
 *   layer's `auto-trailing-slash` (308 to the slash form), and anything
 *   missing gets the built 404 page.
 * - `/firmware/<owner>/<name>/<tag>/<asset>` (OD-10) is the run Worker's
 *   firmware proxy, run here with the signed release list and Node's fetch
 *   (firmware.ts), when the site was given one; otherwise it is a site path
 *   like any other (a 404).
 *
 * It is a dev tool: nothing deploys it, and ci-policy `bench-never-in-ci`
 * refuses any workflow line that runs it. Dependency-free (node: only).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { TreeFile } from '../shared/files.ts';
import { HASHED_ASSET_CACHE_CONTROL, SERIAL_GRANTED_SECURITY_HEADERS } from '../../../../workers/run/src/headers.ts';
import { type ScanFinding, scanBundle } from '../bundle/scan.ts';
import { isFirmwarePath, type BenchFirmware } from './firmware.ts';
import { consoleRespond, isConsolePath, type BenchConsole } from './console.ts';

/** The only interface the server binds. */
export const BENCH_BIND_ADDRESS = '127.0.0.1';

/** The default port (the e2e suites use 8790-8792). */
export const BENCH_DEFAULT_PORT = 8793;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

/** A site the server may serve: the scanned bytes by path, and the firmware route when the CLI set one up. */
export interface BenchSite {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly firmware?: BenchFirmware;
  /** The console route (`/console`): the page's wire transcript, for readers on this computer. */
  readonly console?: BenchConsole;
}

export class BenchSiteRefused extends Error {
  override readonly name = 'BenchSiteRefused';
  readonly findings: readonly ScanFinding[];
  constructor(findings: readonly ScanFinding[]) {
    super(`not a clean bench build (${findings.length} bundle scan finding(s) for the bench target): ${findings.slice(0, 5).map((f) => `${f.rule} ${f.file}`).join('; ')}`);
    this.findings = findings;
  }
}

/** Accepts a tree only if it passes the bundle scan for the bench target. */
export function benchSite(files: readonly TreeFile[], firmware?: BenchFirmware, console?: BenchConsole): BenchSite {
  const findings = scanBundle(files, 'bench');
  if (findings.length > 0) throw new BenchSiteRefused(findings);
  return { files: new Map(files.map((f) => [f.path, f.bytes])), ...(firmware === undefined ? {} : { firmware }), ...(console === undefined ? {} : { console }) };
}

export interface BenchRequest {
  readonly method: string;
  /** The request target as sent (`/path?query`). */
  readonly url: string;
  readonly host: string | undefined;
  /** The request body, when the server read one (POST). */
  readonly body?: Uint8Array;
}

export interface BenchResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

const enc = new TextEncoder();

function plain(status: number, text: string, extra: Record<string, string> = {}): BenchResponse {
  return {
    status,
    headers: { ...SERIAL_GRANTED_SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra },
    body: enc.encode(`${text}\n`),
  };
}

/** The decoded path of a request target, or undefined when it is not a clean absolute path. */
function cleanPath(target: string): string | undefined {
  if (!target.startsWith('/') || target.startsWith('//')) return undefined;
  const raw = target.split(/[?#]/, 1)[0] ?? '';
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  if (path.includes('\0') || path.includes('\\')) return undefined;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return undefined;
  return path;
}

/** The Host check every request passes first: loopback names with this port only (DNS rebinding). */
function hostRefused(port: number, host: string | undefined): BenchResponse | undefined {
  const allowedHosts = [`${BENCH_BIND_ADDRESS}:${port}`, `localhost:${port}`];
  if (host === undefined || !allowedHosts.includes(host.toLowerCase())) {
    return plain(421, `the bench server answers only ${allowedHosts.join(' and ')}`);
  }
  return undefined;
}

/** Answers one request from the site's files. Pure, for the tests; `benchRespond` adds the firmware route. */
export function benchResponse(site: BenchSite, port: number, req: BenchRequest): BenchResponse {
  const refused = hostRefused(port, req.host);
  if (refused !== undefined) return refused;
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405, 'GET and HEAD only', { allow: 'GET, HEAD' });
  const path = cleanPath(req.url);
  if (path === undefined) return plain(400, 'bad request path');

  const key = path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1);
  const bytes = key === '_headers' ? undefined : site.files.get(key);
  if (bytes === undefined) {
    if (!path.endsWith('/') && site.files.has(`${key}/index.html`)) {
      return { status: 308, headers: { ...SERIAL_GRANTED_SECURITY_HEADERS, location: `${path}/`, 'cache-control': 'no-store' }, body: new Uint8Array() };
    }
    const notFound = site.files.get('404.html');
    return notFound === undefined
      ? plain(404, 'not found')
      : { status: 404, headers: { ...SERIAL_GRANTED_SECURITY_HEADERS, 'content-type': CONTENT_TYPES['.html'] as string, 'cache-control': 'no-store' }, body: notFound };
  }
  const type = CONTENT_TYPES[extension(key)] ?? 'application/octet-stream';
  const cache = key.startsWith('assets/') ? HASHED_ASSET_CACHE_CONTROL : 'no-cache';
  return { status: 200, headers: { ...SERIAL_GRANTED_SECURITY_HEADERS, 'content-type': type, 'cache-control': cache }, body: req.method === 'HEAD' ? new Uint8Array() : bytes };
}

/** Answers one request: the Host check, then the firmware route when the site has one, else the site's files. */
export async function benchRespond(site: BenchSite, port: number, req: BenchRequest): Promise<BenchResponse> {
  const refused = hostRefused(port, req.host);
  if (refused !== undefined) return refused;
  const path = cleanPath(req.url);
  if (site.console !== undefined && path !== undefined && isConsolePath(path)) {
    const answer = consoleRespond(site.console, req.method, req.url, req.body);
    return { ...answer, headers: { ...SERIAL_GRANTED_SECURITY_HEADERS, ...answer.headers } };
  }
  if (site.firmware !== undefined && path !== undefined && isFirmwarePath(path)) return site.firmware.respond(req.method, path);
  return benchResponse(site, port, req);
}

/** The most a request body may hold (the console transcript); anything larger is cut and refused by the route. */
const MAX_BODY_BYTES = 16 * 1024 * 1024 + 1;

/** Collects a POST body, keeping at most `limit` bytes (`limit` 0: bodies are not read). Other methods carry none. */
function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array | undefined> {
  if (req.method !== 'POST' || limit === 0) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const parts: Uint8Array[] = [];
    let size = 0;
    req.on('data', (chunk: Uint8Array) => {
      if (size >= limit) return; // past the limit: the rest is drained and dropped; the route refuses the cut body
      const keep = chunk.subarray(0, limit - size);
      parts.push(keep);
      size += keep.byteLength;
    });
    req.on('end', () => {
      const out = new Uint8Array(size);
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.byteLength;
      }
      resolve(out);
    });
    /* c8 ignore next -- a socket error ends the request before its body: answered as a bodiless POST (400) */
    req.on('error', () => resolve(undefined));
  });
}

/** Starts the server on 127.0.0.1:`port` (0 picks a free port). Resolves with the server and the bound port. */
export function listen(site: BenchSite, port: number): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    let bound = port;
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void readBody(req, site.console === undefined ? 0 : MAX_BODY_BYTES)
        .then((body) => benchRespond(site, bound, { method: req.method ?? '', url: req.url ?? '', host: req.headers.host, ...(body === undefined ? {} : { body }) }))
        .then(
        (answer) => {
          res.writeHead(answer.status, answer.headers);
          res.end(answer.body);
        },
        () => {
          const answer = plain(500, 'internal error');
          res.writeHead(answer.status, answer.headers);
          res.end(answer.body);
        },
      );
    });
    server.once('error', reject);
    server.listen(port, BENCH_BIND_ADDRESS, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('the bench server has no TCP address'));
        return;
      }
      bound = address.port;
      resolve({ server, port: bound });
    });
  });
}
