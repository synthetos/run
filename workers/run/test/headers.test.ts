/**
 * RUN_PLAN §6.4 headers (ROADMAP P0-04, T-S25). The expected values are
 * written out here as literal text copied from RUN_PLAN §6.4, independently
 * of how headers.ts assembles them, so a change to either side fails.
 */
import { describe, expect, it } from 'vitest';
import { HEADERS_FILE_MAX_LINE, renderHeadersFile, SECURITY_HEADERS, TRUSTED_TYPES_POLICIES, withSecurityHeaders } from '../src/headers.ts';

const RUN_PLAN_6_4: Record<string, string> = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
    "font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; " +
    "base-uri 'none'; form-action 'none'; object-src 'none'; " +
    "require-trusted-types-for 'script'; trusted-types rs-worker rs-svg-export",
  'permissions-policy':
    'serial=(self), screen-wake-lock=(self), usb=(), hid=(), bluetooth=(), camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
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

  it('grants the serial port to this origin only and switches off every other device API', () => {
    const pp = SECURITY_HEADERS['permissions-policy'] ?? '';
    expect(pp).toContain('serial=(self)');
    for (const off of ['usb', 'hid', 'bluetooth', 'camera', 'microphone', 'geolocation', 'payment']) expect(pp).toContain(`${off}=()`);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SECURITY_HEADERS)).toBe(true);
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

  it('applies every security header to every asset path', () => {
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
