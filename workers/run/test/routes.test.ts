/**
 * The run Worker's routes and handler (ROADMAP P0-04): `/api/*` is 404
 * except `/api/health`; `/auth/*` is 404 until A1; every response, including
 * errors and proxied assets, carries the security headers.
 */
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import worker from '../src/index.ts';
import { type Env, route, VERSION } from '../src/routes.ts';
import { HASHED_ASSET_CACHE_CONTROL, SECURITY_HEADERS, SERIAL_GRANTED_SECURITY_HEADERS } from '../src/headers.ts';

const ORIGIN = 'https://run.synthetos.com';

interface RecordingAssets {
  readonly seen: string[];
  fetch(request: Request): Promise<Response>;
}

/** An ASSETS binding that records what reached it. */
function assets(): RecordingAssets {
  const seen: string[] = [];
  return {
    seen,
    fetch(request: Request): Promise<Response> {
      seen.push(new URL(request.url).pathname);
      return Promise.resolve(new Response('<!doctype html><div id="app"></div>', { headers: { 'content-type': 'text/html' } }));
    },
  };
}

/** An environment; `null` leaves RUN_ENV unset. */
function env(runEnv: string | null = 'production'): Env & { ASSETS: RecordingAssets } {
  return runEnv === null ? { ASSETS: assets() } : { ASSETS: assets(), RUN_ENV: runEnv };
}

const req = (path: string, method = 'GET'): Request => new Request(`${ORIGIN}${path}`, { method });

function expectSecurityHeaders(res: Response): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name), name).toBe(value);
}

describe('VERSION', () => {
  it('equals the package.json version', () => {
    expect(VERSION).toBe(pkg.version);
  });
});

describe('GET /api/health', () => {
  it.each(['production', 'staging', 'development'])('reports ok for RUN_ENV=%s, as uncached JSON', async (runEnv) => {
    const res = await worker.fetch(req('/api/health'), env(runEnv));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok', service: 'run', env: runEnv, version: VERSION });
    expectSecurityHeaders(res);
  });

  it.each([null, '', 'prod', 'Production'])('reports misconfigured with 500 when RUN_ENV is %j', async (runEnv) => {
    const res = await worker.fetch(req('/api/health'), env(runEnv));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ status: 'misconfigured', env: null });
  });

  it('answers HEAD with headers and no body', async () => {
    const res = await worker.fetch(req('/api/health', 'HEAD'), env());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expectSecurityHeaders(res);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('refuses %s with 405', async (method) => {
    const res = await worker.fetch(req('/api/health', method), env());
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expectSecurityHeaders(res);
  });
});

describe('every other /api and /auth path is a 404 in Phase 0', () => {
  it.each(['/api', '/api/', '/api/healthz', '/api/health/', '/api/projects', '/auth', '/auth/login', '/auth/callback'])('%s', async (path) => {
    const e = env();
    const res = await worker.fetch(req(path), e);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'not_found' });
    expectSecurityHeaders(res);
    expect(e.ASSETS.seen).toEqual([]);
  });
});

describe('anything else goes to the asset layer, still with the headers', () => {
  it.each(['/', '/apis', '/api-docs', '/authors', '/safety/'])('%s', async (path) => {
    const e = env();
    const res = await worker.fetch(req(path), e);
    expect(e.ASSETS.seen).toEqual([path]);
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
  });
});

describe('errors', () => {
  it('a throwing route becomes a 500 with the headers and no detail', async () => {
    const broken: Env = {
      ASSETS: {
        fetch(): Promise<Response> {
          return Promise.reject(new Error('secret internal detail'));
        },
      },
      RUN_ENV: 'production',
    };
    const res = await worker.fetch(req('/'), broken);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(JSON.parse(text)).toEqual({ error: 'internal_error' });
    expectSecurityHeaders(res);
  });

  it('route() itself adds no headers: the handler is the single place that does', async () => {
    const res = await route(req('/api/health'), env());
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});

describe('P1-00: serial=(self) on staging only, decided per request', () => {
  const STAGING = 'https://staging.run.synthetos.com';
  const at = (origin: string, path: string, method = 'GET'): Request => new Request(`${origin}${path}`, { method });
  const pp = (res: Response): string | null => res.headers.get('permissions-policy');

  it.each(['/', '/safety/', '/no-such-page', '/assets/workspace-abc12345.js', '/api/health', '/api/nope', '/auth/login'])(
    'the staging Worker on the staging host grants serial=(self) on %s, with every other header unchanged',
    async (path) => {
      const res = await worker.fetch(at(STAGING, path), env('staging'));
      for (const [name, value] of Object.entries(SERIAL_GRANTED_SECURITY_HEADERS)) expect(res.headers.get(name), name).toBe(value);
    },
  );

  it.each([
    ['production Worker, production host', 'production', ORIGIN],
    ['production Worker, staging host', 'production', STAGING],
    ['staging Worker, production host', 'staging', ORIGIN],
    ['development Worker, staging host', 'development', STAGING],
    ['no RUN_ENV, staging host', null, STAGING],
  ])('%s: serial=()', async (_name, runEnv, origin) => {
    for (const path of ['/', '/api/health', '/assets/a-abc12345.js']) {
      const res = await worker.fetch(at(origin, path), env(runEnv));
      expect(pp(res), `${origin}${path}`).toBe(SECURITY_HEADERS['permissions-policy']);
      expectSecurityHeaders(res);
    }
  });

  it('an error inside the Worker on staging still gets the staging set and no detail', async () => {
    const broken: Env = { RUN_ENV: 'staging', ASSETS: { fetch: () => Promise.reject(new Error('boom')) } };
    const res = await worker.fetch(at(STAGING, '/'), broken);
    expect(res.status).toBe(500);
    expect(pp(res)).toBe(SERIAL_GRANTED_SECURITY_HEADERS['permissions-policy']);
  });

  it('a hashed asset the Worker serves gets the immutable cache policy; other paths and failures do not', async () => {
    const e = env('staging');
    expect((await worker.fetch(at(STAGING, '/assets/workspace-abc12345.js'), e)).headers.get('cache-control')).toBe(HASHED_ASSET_CACHE_CONTROL);
    expect((await worker.fetch(at(STAGING, '/'), e)).headers.get('cache-control')).toBeNull();
    const missing: Env = { RUN_ENV: 'staging', ASSETS: { fetch: () => Promise.resolve(new Response('nope', { status: 404 })) } };
    expect((await worker.fetch(at(STAGING, '/assets/gone-abc12345.js'), missing)).headers.get('cache-control')).toBeNull();
    expect((await worker.fetch(at(STAGING, '/assetsx/a.js'), e)).headers.get('cache-control')).toBeNull();
  });
});
