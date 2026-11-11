/**
 * RUN_PLAN §6.4 headers (ROADMAP P0-04, T-S25). The expected values are
 * written out here as literal text copied from RUN_PLAN §6.4, independently
 * of how headers.ts assembles them, so a change to either side fails.
 */
import { describe, expect, it } from 'vitest';
import {
  grantsSerial,
  PRODUCTION_HOST,
  HEADERS_FILE_MAX_LINE,
  renderHeadersFile,
  securityHeadersFor,
  SECURITY_HEADERS,
  SERIAL_GRANTED_SECURITY_HEADERS,
  STAGING_HOST,
  TRUSTED_TYPES_POLICIES,
  withSecurityHeaders,
} from '../src/headers.ts';

const RUN_PLAN_6_4: Record<string, string> = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
    "font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; " +
    "base-uri 'none'; form-action 'none'; object-src 'none'; " +
    "require-trusted-types-for 'script'; trusted-types rs-worker rs-svg-export",
  // PRODUCTION stays at serial=() until Phase 6 (P0 review, P0-13; P1-00,
  // P1-09: production gets the Phase 0 shell only). Staging and the bench
  // build get serial=(self): SERIAL_GRANTED below.
  'permissions-policy':
    'serial=(), screen-wake-lock=(self), usb=(), hid=(), bluetooth=(), camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
};

/** RUN_PLAN §6.4's Phase 1 bench value, literally: the production set with serial=(self), nothing else changed. */
const SERIAL_GRANTED: Record<string, string> = {
  ...RUN_PLAN_6_4,
  'permissions-policy':
    'serial=(self), screen-wake-lock=(self), usb=(), hid=(), bluetooth=(), camera=(), microphone=(), geolocation=(), payment=()',
};

describe('SECURITY_HEADERS', () => {
  it('is exactly the RUN_PLAN §6.4 set, value for value', () => {
    expect({ ...SECURITY_HEADERS }).toEqual(RUN_PLAN_6_4);
  });

  it('allows only the two named Trusted Types policies, and never a default policy, duplicates or wildcards', () => {
    expect(TRUSTED_TYPES_POLICIES).toEqual(['rs-worker', 'rs-svg-export']);
    const csp = SECURITY_HEADERS['content-security-policy'] ?? '';
    expect(csp).not.toMatch(/'allow-duplicates'|trusted-types[^;]*\bdefault\b|'unsafe-|\*/);
  });

  it('production: denies the serial port to every origin, this one included, and switches off every other device API', () => {
    const pp = SECURITY_HEADERS['permissions-policy'] ?? '';
    const serial = pp.split(',').map((f) => f.trim()).filter((f) => f.startsWith('serial='));
    expect(serial).toEqual(['serial=()']);
    expect(pp).not.toMatch(/serial=\((?!\))/);
    for (const off of ['usb', 'hid', 'bluetooth', 'camera', 'microphone', 'geolocation', 'payment']) expect(pp).toContain(`${off}=()`);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SECURITY_HEADERS)).toBe(true);
  });
});

describe('SERIAL_GRANTED_SECURITY_HEADERS (P1-00: staging and the bench build)', () => {
  it('is the production set with serial=(self), value for value', () => {
    expect({ ...SERIAL_GRANTED_SECURITY_HEADERS }).toEqual(SERIAL_GRANTED);
  });

  it('differs from production in the permissions-policy only, and there in the serial feature only', () => {
    const differs = Object.keys(SECURITY_HEADERS).filter((k) => SECURITY_HEADERS[k] !== SERIAL_GRANTED_SECURITY_HEADERS[k]);
    expect(differs).toEqual(['permissions-policy']);
    const prod = (SECURITY_HEADERS['permissions-policy'] ?? '').split(', ');
    const granted = (SERIAL_GRANTED_SECURITY_HEADERS['permissions-policy'] ?? '').split(', ');
    expect(granted.filter((f, i) => f !== prod[i])).toEqual(['serial=(self)']);
  });

  it('never grants serial to another origin or to frames', () => {
    const pp = SERIAL_GRANTED_SECURITY_HEADERS['permissions-policy'] ?? '';
    expect(pp).not.toMatch(/serial=\*|serial=\(self [^)]|serial=\([^)]*"/);
    expect(Object.isFrozen(SERIAL_GRANTED_SECURITY_HEADERS)).toBe(true);
  });
});

describe('grantsSerial and securityHeadersFor (P1-00, OD-29)', () => {
  const url = (u: string): URL => new URL(u);

  it('grants serial only to each deployed Worker on its own host: staging (P1-00) and, since OD-29, production', () => {
    expect(STAGING_HOST).toBe('staging.run.synthetos.com');
    expect(PRODUCTION_HOST).toBe('run.synthetos.com');
    expect(grantsSerial('staging', url('https://staging.run.synthetos.com/'))).toBe(true);
    expect(grantsSerial('staging', url('https://staging.run.synthetos.com/safety/?x=1'))).toBe(true);
    expect(grantsSerial('production', url('https://run.synthetos.com/'))).toBe(false);
    expect(grantsSerial('production', url('https://run.synthetos.com/'), true)).toBe(true);
    expect(grantsSerial('production', url('https://run.synthetos.com/library'), true)).toBe(true);
  });

  it.each([
    ['the production Worker on a workers.dev name', 'production', 'https://run.example.workers.dev/'],
    ['the production Worker on a look-alike host', 'production', 'https://run.synthetos.com.evil.example/'],
    ['the production Worker on another port', 'production', 'https://run.synthetos.com:8443/'],
    ['the production Worker over plain http', 'production', 'http://run.synthetos.com/'],
    ['the production Worker on the staging host', 'production', 'https://staging.run.synthetos.com/'],
    ['the staging Worker on the production host', 'staging', 'https://run.synthetos.com/'],
    ['the staging Worker on a workers.dev name', 'staging', 'https://run-staging.example.workers.dev/'],
    ['the staging Worker on a look-alike host', 'staging', 'https://staging.run.synthetos.com.evil.example/'],
    ['the staging Worker on a sub-host', 'staging', 'https://x.staging.run.synthetos.com/'],
    ['the staging Worker over plain http', 'staging', 'http://staging.run.synthetos.com/'],
    ['the staging Worker on another port', 'staging', 'https://staging.run.synthetos.com:8443/'],
    ['wrangler dev (development)', 'development', 'http://127.0.0.1:8790/'],
    ['a missing RUN_ENV', undefined, 'https://staging.run.synthetos.com/'],
    ['RUN_ENV with other case', 'Staging', 'https://staging.run.synthetos.com/'],
    ['RUN_ENV not a string', ['staging'], 'https://staging.run.synthetos.com/'],
  ])('refuses %s', (_name, runEnv, u) => {
    expect(grantsSerial(runEnv, url(u))).toBe(false);
  });

  it('securityHeadersFor picks the set', () => {
    expect(securityHeadersFor(false)).toBe(SECURITY_HEADERS);
    expect(securityHeadersFor(true)).toBe(SERIAL_GRANTED_SECURITY_HEADERS);
  });
});

describe('withSecurityHeaders', () => {
  it('adds every header to a response that has none', () => {
    const res = withSecurityHeaders(new Response('x'));
    for (const [name, value] of Object.entries(RUN_PLAN_6_4)) expect(res.headers.get(name)).toBe(value);
  });

  it('replaces weaker values set upstream instead of merging with them', () => {
    const upstream = new Response('x', {
      headers: {
        'content-security-policy': "script-src * 'unsafe-inline'",
        'permissions-policy': 'usb=*',
        'x-frame-options': 'ALLOWALL',
      },
    });
    const res = withSecurityHeaders(upstream);
    expect(res.headers.get('content-security-policy')).toBe(RUN_PLAN_6_4['content-security-policy']);
    expect(res.headers.get('permissions-policy')).toBe(RUN_PLAN_6_4['permissions-policy']);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('keeps the status, the body and unrelated headers', async () => {
    const res = withSecurityHeaders(new Response('body text', { status: 418, headers: { 'content-type': 'text/plain', etag: '"1"' } }));
    expect(res.status).toBe(418);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(res.headers.get('etag')).toBe('"1"');
    expect(await res.text()).toBe('body text');
  });

  it('applies the serial-granted set when given, replacing an upstream serial=()', () => {
    const res = withSecurityHeaders(new Response('x', { headers: { 'permissions-policy': 'serial=()' } }), SERIAL_GRANTED_SECURITY_HEADERS);
    for (const [name, value] of Object.entries(SERIAL_GRANTED)) expect(res.headers.get(name)).toBe(value);
  });

  it('works on a response with immutable headers (as Response.redirect and fetch return them)', () => {
    const upstream = Response.redirect('https://run.synthetos.com/', 307);
    expect(() => upstream.headers.set('x-test', 'y')).toThrow();
    const res = withSecurityHeaders(upstream);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://run.synthetos.com/');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('renderHeadersFile', () => {
  const text = renderHeadersFile();

  it('applies every PRODUCTION security header (serial=()) to every asset path, in every environment', () => {
    const lines = text.split('\n');
    const all = lines.indexOf('/*');
    const assets = lines.indexOf('/assets/*');
    expect(all).toBeGreaterThanOrEqual(0);
    expect(assets).toBeGreaterThan(all);
    const parsed = Object.fromEntries(
      lines.slice(all + 1, assets).map((l) => {
        const i = l.indexOf(':');
        return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()];
      }),
    );
    expect(parsed).toEqual(RUN_PLAN_6_4);
  });

  it('marks hashed assets immutable', () => {
    expect(text).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');
  });

  it("keeps every line within Cloudflare's limit", () => {
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(HEADERS_FILE_MAX_LINE);
  });
});
