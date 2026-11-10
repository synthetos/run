/**
 * The post-deploy smoke test (ROADMAP P0-04 acceptance: "The smoke script
 * passes in the deploy job and fails it on a header regression").
 *
 * The checks are unit-tested on good and broken observations, and the CLI is
 * run in local mode against a server that serves the real headers, then one
 * deliberately broken header at a time. The same CLI runs in the deploy job.
 */
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkAccessApplications,
  checkAccessGate,
  checkCaa,
  checkDnssec,
  checkHealth,
  checkIssuer,
  checkSecurityHeaders,
  expectedHeadersFor,
  checkShell,
  checkSubdomainSetting,
  checkWorkersDevProbe,
  type Observed,
} from '../src/smoke/checks.ts';
import { SECURITY_HEADERS, SERIAL_GRANTED_SECURITY_HEADERS } from '../../../workers/run/src/headers.ts';
import { REPO_ROOT } from './scratch.ts';

const SHELL = '<!doctype html><script type="module" crossorigin src="/assets/workspace-AAAAAAAA.js"></script><div id="app"></div>';

function observed(over: Partial<{ status: number; headers: Record<string, string>; body: string }> = {}): Observed {
  return {
    url: 'https://run.synthetos.com/',
    status: over.status ?? 200,
    // OD-29: run.synthetos.com's own documents carry the serial-granted set (the Worker grants it there).
    headers: new Headers({ ...SERIAL_GRANTED_SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', ...over.headers }),
    body: over.body ?? SHELL,
  };
}

describe('checkSecurityHeaders', () => {
  it('passes the exact set', () => {
    expect(checkSecurityHeaders(observed())).toEqual([]);
  });

  it.each(Object.keys(SECURITY_HEADERS))('fails when %s is missing', (name) => {
    const res = observed();
    res.headers.delete(name);
    expect(checkSecurityHeaders(res).map((f) => f.message)).toEqual([expect.stringContaining(`${name} is missing`)]);
  });

  it('OD-29: run.synthetos.com must grant serial to itself; any other host must carry the fail-closed set', () => {
    expect(expectedHeadersFor('https://run.synthetos.com/')).toBe(SERIAL_GRANTED_SECURITY_HEADERS);
    expect(expectedHeadersFor('https://staging.run.synthetos.com/api/health')).toBe(SERIAL_GRANTED_SECURITY_HEADERS);
    for (const other of ['http://127.0.0.1:8787/', 'https://run.synthetos.com:8443/', 'https://run.example.workers.dev/', 'not a url']) expect(expectedHeadersFor(other)).toBe(SECURITY_HEADERS);
    const denied = observed({ headers: { 'permissions-policy': SECURITY_HEADERS['permissions-policy'] as string } });
    expect(checkSecurityHeaders(denied).map((f) => f.message)).toEqual([expect.stringContaining('permissions-policy')]);
  });

  it('fails on a weakened or duplicated value', () => {
    expect(checkSecurityHeaders(observed({ headers: { 'x-frame-options': 'SAMEORIGIN' } }))).toHaveLength(1);
    const dup = observed();
    dup.headers.append('content-security-policy', "script-src 'unsafe-inline'");
    expect(checkSecurityHeaders(dup)).toHaveLength(1);
  });
});

describe('checkShell and checkHealth', () => {
  it('passes the shell and fails without the workspace root or with a non-200', () => {
    expect(checkShell(observed())).toEqual([]);
    expect(checkShell(observed({ body: '<html>maintenance</html>' }))).toHaveLength(1);
    expect(checkShell(observed({ status: 302 }))).toHaveLength(1);
  });

  const health = (body: unknown, headers: Record<string, string> = {}): Observed =>
    observed({ body: JSON.stringify(body), headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

  it('passes ok health for the expected environment only', () => {
    expect(checkHealth(health({ status: 'ok', service: 'run', env: 'production', version: '0.0.0' }), 'production')).toEqual([]);
    expect(checkHealth(health({ status: 'ok', service: 'run', env: 'staging' }), 'production')).toHaveLength(1);
    expect(checkHealth(health({ status: 'misconfigured', service: 'run', env: null }), 'production')).toHaveLength(2);
  });

  it('fails a cacheable or non-JSON health response', () => {
    expect(checkHealth(health({ status: 'ok', service: 'run', env: 'production' }, { 'cache-control': 'max-age=60' }), 'production')).toHaveLength(1);
    expect(checkHealth(observed({ headers: { 'cache-control': 'no-store' } }), 'production').map((f) => f.message)).toEqual([
      expect.stringContaining('not application/json'),
      expect.stringContaining('not JSON'),
    ]);
  });
});

describe('preview URLs and workers.dev (H45)', () => {
  it('passes only when both are off', () => {
    expect(checkSubdomainSetting({ enabled: false, previews_enabled: false })).toEqual([]);
    expect(checkSubdomainSetting({ enabled: true, previews_enabled: false })).toHaveLength(1);
    expect(checkSubdomainSetting({ enabled: false, previews_enabled: true })).toHaveLength(1);
    expect(checkSubdomainSetting({ enabled: false })).toHaveLength(1);
    expect(checkSubdomainSetting(null)).toHaveLength(1);
  });

  it('passes a workers.dev probe that is unreachable or an error, fails one that serves', () => {
    expect(checkWorkersDevProbe('u', 'unreachable')).toEqual([]);
    expect(checkWorkersDevProbe('u', { status: 404 })).toEqual([]);
    expect(checkWorkersDevProbe('u', { status: 200 })).toHaveLength(1);
    expect(checkWorkersDevProbe('u', { status: 302 })).toHaveLength(1);
  });
});

describe('checkAccessApplications: the positive Access check (D31, P0 review)', () => {
  const host = 'staging.run.synthetos.com';
  const owner = { name: 'owner', decision: 'allow', include: [{ email: { email: 'owner@example.com' } }] };
  const app = (over: Record<string, unknown> = {}) => ({ id: 'a1', type: 'self_hosted', domain: host, policies: [owner], ...over });
  const embedded = (a: { policies?: unknown }) => a.policies;

  it('passes an application covering the whole host with only identity policies', () => {
    expect(checkAccessApplications(host, [app()], embedded)).toEqual([]);
    expect(checkAccessApplications(host, [app({ domain: `${host}/*` })], embedded)).toEqual([]);
    expect(checkAccessApplications(host, [app({ domain: '*.run.synthetos.com' })], embedded)).toEqual([]);
    expect(checkAccessApplications(host, [app({ domain: 'other.example', self_hosted_domains: [host] })], embedded)).toEqual([]);
    expect(checkAccessApplications(host, [app({ domain: undefined, destinations: [{ type: 'public', uri: host }] })], embedded)).toEqual([]);
    // A bench service token (non_identity) is allowed (docs/ops/access.md).
    expect(checkAccessApplications(host, [app({ policies: [owner, { name: 'bench', decision: 'non_identity', include: [{ service_token: { token_id: 't' } }] }] })], embedded)).toEqual([]);
  });

  it('fails when nothing covers the host: none at all, a path-only app, another type, or a different host', () => {
    for (const apps of [[], [app({ domain: `${host}/admin` })], [app({ type: 'saas' })], [app({ domain: 'run.synthetos.com' })], [app({ domain: '*.synthetos.com.evil' })]]) {
      expect(checkAccessApplications(host, apps, embedded), JSON.stringify(apps)).toEqual([expect.objectContaining({ check: 'access', message: expect.stringContaining('no Cloudflare Access application') })]);
    }
  });

  it('fails on a Bypass or an Everyone policy, and on unreadable data', () => {
    expect(checkAccessApplications(host, [app({ policies: [{ name: 'open', decision: 'bypass', include: [] }] })], embedded)).toHaveLength(1);
    expect(checkAccessApplications(host, [app({ policies: [{ name: 'all', decision: 'allow', include: [{ everyone: {} }] }] })], embedded)).toHaveLength(1);
    expect(checkAccessApplications(host, [app({ policies: undefined })], () => undefined)).toHaveLength(1);
    expect(checkAccessApplications(host, null, embedded)).toHaveLength(1);
  });

  it('reads separately listed policies when the app does not embed them', () => {
    const listed = new Map([['a1', [{ name: 'all', decision: 'allow', include: [{ everyone: {} }] }]]]);
    expect(checkAccessApplications(host, [app({ policies: undefined })], (a) => listed.get(a.id as string))).toHaveLength(1);
  });
});

describe('checkAccessGate (D31)', () => {
  const url = 'https://staging.run.synthetos.com/';
  it('passes a redirect to the Access login', () => {
    expect(checkAccessGate(url, { status: 302, location: 'https://synthetos.cloudflareaccess.com/cdn-cgi/access/login/staging.run.synthetos.com' }, false)).toEqual([]);
  });
  it('fails content served to an anonymous request, or a redirect elsewhere', () => {
    expect(checkAccessGate(url, { status: 200, location: null }, false)).toHaveLength(1);
    expect(checkAccessGate(url, { status: 302, location: 'https://evil.example/cloudflareaccess.com' }, false)).toHaveLength(1);
    expect(checkAccessGate(url, { status: 302, location: 'https://cloudflareaccess.com.evil.example/' }, false)).toHaveLength(1);
  });
  it('accepts an unreachable host only before the first deploy', () => {
    expect(checkAccessGate(url, 'unreachable', true)).toEqual([]);
    expect(checkAccessGate(url, 'unreachable', false)).toHaveLength(1);
  });
});

describe('DNSSEC, CAA and the certificate issuer (H46)', () => {
  it('needs a validated NOERROR answer', () => {
    expect(checkDnssec('r', { Status: 0, AD: true })).toEqual([]);
    expect(checkDnssec('r', { Status: 0, AD: false })).toHaveLength(1);
    expect(checkDnssec('r', { Status: 3, AD: true })).toHaveLength(1);
    expect(checkDnssec('r', null)).toHaveLength(1);
  });

  it('needs a CAA set that names only the allowed CAs', () => {
    expect(checkCaa('synthetos.com', [{ critical: 0, issue: 'pki.goog' }, { critical: 0, issue: 'letsencrypt.org; validationmethods=dns-01' }, { critical: 0, iodef: 'mailto:x' }])).toEqual([]);
    // The live synthetos.com set: the owner's three plus the two Cloudflare adds itself, with parameters.
    expect(checkCaa('synthetos.com', [{ critical: 0, issue: 'digicert.com; cansignhttpexchanges=yes' }, { critical: 0, issuewild: 'comodoca.com' }, { critical: 0, issue: 'pki.goog; cansignhttpexchanges=yes' }])).toEqual([]);
    expect(checkCaa('synthetos.com', [])).toHaveLength(1);
    expect(checkCaa('synthetos.com', [{ critical: 0, issue: 'pki.goog' }, { critical: 0, issuewild: 'cheap-ca.example' }])).toHaveLength(1);
    expect(checkCaa('synthetos.com', [{ critical: 0, iodef: 'mailto:x' }])).toHaveLength(1);
  });

  it('needs an expected issuer organisation', () => {
    expect(checkIssuer('h', 'Google Trust Services')).toEqual([]);
    expect(checkIssuer('h', "Let's Encrypt")).toEqual([]);
    expect(checkIssuer('h', 'Sectigo Limited')).toEqual([]);
    expect(checkIssuer('h', 'Some Other CA')).toHaveLength(1);
    expect(checkIssuer('h', undefined)).toHaveLength(1);
  });
});

describe('smoke CLI in local mode, against a live server', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server === undefined) resolve();
      else server.close(() => resolve());
    });
    server = undefined;
  });

  /** Serves the shell, an asset, a 404 and /api/health with the real headers; `breakOn` weakens one header on one path. */
  async function serve(breakOn?: { path: string; header: string; value: string | null }): Promise<string> {
    server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      const headers: Record<string, string> = { ...SECURITY_HEADERS };
      let status = 200;
      let body: string;
      if (path === '/') {
        headers['content-type'] = 'text/html; charset=utf-8';
        body = SHELL;
      } else if (path === '/assets/workspace-AAAAAAAA.js') {
        headers['content-type'] = 'text/javascript';
        body = 'export {};';
      } else if (path === '/api/health') {
        headers['content-type'] = 'application/json; charset=utf-8';
        headers['cache-control'] = 'no-store';
        body = JSON.stringify({ status: 'ok', service: 'run', env: 'production', version: '0.0.0' });
      } else {
        status = 404;
        headers['content-type'] = 'text/html; charset=utf-8';
        body = 'not found';
      }
      const target = breakOn !== undefined && (breakOn.path === path || (breakOn.path === '404' && status === 404)) ? breakOn : undefined;
      if (target !== undefined) {
        if (target.value === null) delete headers[target.header];
        else headers[target.header] = target.value;
      }
      res.writeHead(status, headers);
      res.end(body);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  function smoke(base: string): Promise<{ status: number | null; output: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [join(REPO_ROOT, 'tools/gates/src/smoke/cli.ts'), '--base-url', base]);
      let output = '';
      child.stdout.on('data', (d: Buffer) => (output += d.toString()));
      child.stderr.on('data', (d: Buffer) => (output += d.toString()));
      child.on('close', (status) => resolve({ status, output }));
    });
  }

  it('passes when every response carries the exact headers', async () => {
    const r = await smoke(await serve());
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain('all checks passed');
  });

  it.each([
    ['/', 'content-security-policy', "default-src 'self'"],
    ['/', 'permissions-policy', null],
    ['/assets/workspace-AAAAAAAA.js', 'x-content-type-options', null],
    ['/api/health', 'cross-origin-opener-policy', 'unsafe-none'],
    ['404', 'x-frame-options', null],
  ])('fails on a broken header: %s %s', async (path, header, value) => {
    const r = await smoke(await serve({ path, header, value }));
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain(header);
  });

  it('fails when the server is unreachable', async () => {
    const r = await smoke('http://127.0.0.1:9');
    expect(r.status).toBe(1);
    expect(r.output).toContain('could not complete');
  });
});
