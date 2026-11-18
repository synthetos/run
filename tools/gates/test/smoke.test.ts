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
  checkCaa,
  checkDnssec,
  checkHealth,
  checkIssuer,
  checkNoAccessApplications,
  checkPublicGate,
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
    headers: new Headers({ ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', ...over.headers }),
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
    expect(expectedHeadersFor('https://run.synthetos.com/')).toBe(SECURITY_HEADERS);
    expect(expectedHeadersFor('https://run.synthetos.com/', true)).toBe(SERIAL_GRANTED_SECURITY_HEADERS);
    expect(checkSecurityHeaders(observed({ headers: { 'permissions-policy': SERIAL_GRANTED_SECURITY_HEADERS['permissions-policy'] ?? '' } }), true)).toEqual([]);
    // OD-40: staging is public and follows the same rule; anonymous probes expect the fail-closed set there too.
    expect(expectedHeadersFor('https://staging.run.synthetos.com/api/health')).toBe(SECURITY_HEADERS);
    expect(expectedHeadersFor('https://staging.run.synthetos.com/', true)).toBe(SERIAL_GRANTED_SECURITY_HEADERS);
    for (const other of ['http://127.0.0.1:8787/', 'https://run.synthetos.com:8443/', 'https://run.example.workers.dev/', 'not a url']) expect(expectedHeadersFor(other)).toBe(SECURITY_HEADERS);
    const denied = observed({ headers: { 'permissions-policy': SERIAL_GRANTED_SECURITY_HEADERS['permissions-policy'] as string } });
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

describe('checkNoAccessApplications: staging is public (OD-40 supersedes D31)', () => {
  const host = 'staging.run.synthetos.com';
  const app = (over: Record<string, unknown> = {}) => ({ id: 'a1', name: 'run-staging', type: 'self_hosted', domain: host, ...over });

  it('passes when no application covers the host: none at all, a path-only app, another type, or a different host', () => {
    for (const apps of [[], [app({ domain: `${host}/admin` })], [app({ type: 'saas' })], [app({ domain: 'run.synthetos.com' })], [app({ domain: '*.synthetos.com.evil' })]]) {
      expect(checkNoAccessApplications(host, apps), JSON.stringify(apps)).toEqual([]);
    }
  });

  it('fails, naming the application, while one still covers the whole host in any of the API shapes', () => {
    for (const apps of [
      [app()],
      [app({ domain: `${host}/*` })],
      [app({ domain: '*.run.synthetos.com' })],
      [app({ domain: 'other.example', self_hosted_domains: [host] })],
      [app({ domain: undefined, destinations: [{ type: 'public', uri: host }] })],
    ]) {
      const findings = checkNoAccessApplications(host, apps);
      expect(findings, JSON.stringify(apps)).toHaveLength(1);
      expect(findings[0]?.check).toBe('access');
      expect(findings[0]?.message).toContain("'run-staging'");
      expect(findings[0]?.message).toContain('still covers');
      expect(findings[0]?.message).toContain('Zero Trust');
    }
    expect(checkNoAccessApplications(host, [app(), app({ id: 'a2', name: 'other' })])).toHaveLength(2);
    expect(checkNoAccessApplications(host, [app({ name: undefined })])[0]?.message).toContain("'a1'");
  });

  it('treats an unreadable list as a finding, never as "no application"', () => {
    expect(checkNoAccessApplications(host, null)).toEqual([{ check: 'access', message: 'the Cloudflare Access application list could not be read' }]);
    expect(checkNoAccessApplications(host, undefined)).toHaveLength(1);
    expect(checkNoAccessApplications(host, 'nope')).toHaveLength(1);
  });
});

describe('checkPublicGate (OD-40): an anonymous request reaches the Worker, not Cloudflare Access', () => {
  const url = 'https://staging.run.synthetos.com/';
  it('passes an answer from the Worker: content, a redirect elsewhere, a 404', () => {
    expect(checkPublicGate(url, { status: 200, location: null }, false)).toEqual([]);
    expect(checkPublicGate(url, { status: 302, location: '/update/' }, false)).toEqual([]);
    expect(checkPublicGate(url, { status: 302, location: 'https://evil.example/cloudflareaccess.com' }, false)).toEqual([]);
    expect(checkPublicGate(url, { status: 404, location: null }, false)).toEqual([]);
  });
  it('fails a redirect to the Access login, however the location is written', () => {
    for (const location of ['https://synthetos.cloudflareaccess.com/cdn-cgi/access/login/staging.run.synthetos.com', 'https://battlewithbytes.cloudflareaccess.com/x', 'HTTPS://Team.CloudflareAccess.com/']) {
      const findings = checkPublicGate(url, { status: 302, location }, false);
      expect(findings, location).toHaveLength(1);
      expect(findings[0]?.message).toContain('still behind Cloudflare Access');
    }
    expect(checkPublicGate(url, { status: 302, location: 'https://cloudflareaccess.com.evil.example/' }, false)).toEqual([]);
  });
  it('fails a server error', () => {
    expect(checkPublicGate(url, { status: 503, location: null }, false)).toHaveLength(1);
    expect(checkPublicGate(url, { status: 500, location: null }, false)[0]?.message).toContain('500');
  });
  it('accepts an unreachable host only before the first deploy, after the API check passed', () => {
    expect(checkPublicGate(url, 'unreachable', true)).toEqual([]);
    expect(checkPublicGate(url, 'unreachable', false)).toHaveLength(1);
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

function smoke(base: string, enabled = 'true'): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, 'tools/gates/src/smoke/cli.ts'), '--base-url', base], { env: { ...process.env, RUN_STORAGE_ENABLED: enabled } });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    child.on('close', (status) => resolve({ status, output }));
  });
}

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
  async function serve(breakOn?: { path: string; header: string; value: string | null }, storageStatus = 401): Promise<string> {
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
      } else if (path === '/api/records/tool') {
        status = storageStatus;
        headers['content-type'] = 'application/json; charset=utf-8';
        headers['cache-control'] = 'no-store';
        body = JSON.stringify({ error: 'not_signed_in' });
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

  it.each([['true', 503, 1], ['false', 401, 1], ['false', 503, 0], ['', 503, 1]] as const)('CLI checks storage expectation %s against %s', async (enabled, status, exit) => {
    const r = await smoke(await serve(undefined, status), enabled);
    expect(r.status, r.output).toBe(exit);
  });

  it('fails when the server is unreachable', async () => {
    const r = await smoke('http://127.0.0.1:9');
    expect(r.status).toBe(1);
    expect(r.output).toContain('could not complete');
  });
});
