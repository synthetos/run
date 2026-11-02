/**
 * External link sanitising (MACHINING_ASSISTANT §8): http(s) only, no other
 * scheme, no credentials, a length limit, and a normalised href rendered
 * with rel="noopener noreferrer nofollow" in a new tab.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EXTERNAL_LINK_REL, URL_MAX_LENGTH, checkExternalUrl, safeExternalLink } from '../src/index.ts';

describe('checkExternalUrl accepts absolute http(s) links', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['http://example.com/', 'http://example.com/'],
    ['HTTPS://Shop.Example.COM/Path/To?q=A#Frag', 'https://shop.example.com/Path/To?q=A#Frag'],
    ['https://example.com?x=1', 'https://example.com/?x=1'],
    ['https://example.com#top', 'https://example.com/#top'],
    ['https://example.com:8443/a', 'https://example.com:8443/a'],
    ['https://example.com:65535', 'https://example.com:65535/'],
    ['https://sub-1.example.co.uk/a%20b', 'https://sub-1.example.co.uk/a%20b'],
    ['https://xn--bcher-kva.example/', 'https://xn--bcher-kva.example/'],
    ['http://192.168.1.10/datasheet.pdf', 'http://192.168.1.10/datasheet.pdf'],
    ['http://0.0.0.0/', 'http://0.0.0.0/'],
    ['https://example.com/a@b', 'https://example.com/a@b'],
    ['https://example.com/?next=https://other.example/', 'https://example.com/?next=https://other.example/'],
  ])('%s -> %s', (input, href) => {
    expect(checkExternalUrl(input)).toEqual({ ok: true, href });
  });
});

describe('checkExternalUrl refuses everything else, and says why', () => {
  it.each([
    [42, 'type'],
    [null, 'type'],
    [undefined, 'type'],
    ['', 'empty'],
    ['javascript:alert(1)', 'scheme'],
    ['JaVaScRiPt:alert(1)', 'scheme'],
    ['data:text/html,<b>x</b>', 'characters'],
    ['data:text/plain,hello', 'scheme'],
    ['vbscript:msgbox', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['ftp://example.com/', 'scheme'],
    ['mailto:a@example.com', 'scheme'],
    ['blob:https://example.com/uuid', 'scheme'],
    ['//example.com/', 'scheme'],
    ['/relative/path', 'scheme'],
    ['example.com', 'scheme'],
    ['https:example.com', 'syntax'],
    ['https:/example.com', 'syntax'],
    [' https://example.com', 'characters'],
    ['https://example.com ', 'characters'],
    ['java\nscript:alert(1)', 'characters'],
    ['java\tscript:alert(1)', 'characters'],
    ['https://exa\u0000mple.com', 'characters'],
    ['https://example.com/\u007f', 'characters'],
    ['https:\\\\example.com', 'characters'],
    ['https://example.com\\@evil.example', 'characters'],
    ['https://ex\u00e4mple.com/', 'characters'],
    ['https://example.com/\u202e', 'characters'],
    ['https://example.com/<script>', 'characters'],
    ['https://example.com/"', 'characters'],
    ['https://example.com/%zz', 'characters'],
    ['https://example.com/%4', 'characters'],
    ['https://user:pass@example.com/', 'credentials'],
    ['https://user@example.com/', 'credentials'],
    ['https://@example.com/', 'credentials'],
    ['https://trusted.example@evil.example/', 'credentials'],
    ['https://[::1]/', 'host'],
    ['https:///example.com', 'host'],
    ['https://', 'host'],
    ['https://localhost/', 'host'],
    ['https://example..com/', 'host'],
    ['https://example.com./', 'host'],
    ['https://-example.com/', 'host'],
    ['https://example-.com/', 'host'],
    ['https://exa_mple.com/', 'host'],
    [`https://${'a'.repeat(64)}.com/`, 'host'],
    [`https://${Array.from({ length: 60 }, () => 'abcd').join('.')}.com/`, 'host'],
    ['http://0x7f.1/', 'host'],
    ['http://127.1/', 'host'],
    ['http://2130706433/', 'host'],
    ['http://1.2.3.256/', 'host'],
    ['http://01.2.3.4/', 'host'],
    ['http://1.2.3.4.5/', 'host'],
    ['http://example.0x/', 'host'],
    ['https://example.com:/', 'port'],
    ['https://example.com:0/', 'port'],
    ['https://example.com:080/', 'port'],
    ['https://example.com:65536/', 'port'],
    ['https://example.com:http/', 'port'],
    ['https://example.com:1:2/', 'port'],
  ])('%j is refused (%s)', (input, problem) => {
    const r = checkExternalUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe(problem);
      expect(r.message).toMatch(/^[A-Z].*\.$/);
    }
  });

  it('enforces the length limit', () => {
    const base = 'https://example.com/';
    const atLimit = base + 'a'.repeat(URL_MAX_LENGTH - base.length);
    expect(checkExternalUrl(atLimit).ok).toBe(true);
    expect(checkExternalUrl(`${atLimit}a`)).toMatchObject({ ok: false, problem: 'too-long' });
  });

  it('is total and fail-safe for any string (fast-check)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300, unit: 'binary' }), (s) => {
        const r = checkExternalUrl(s);
        if (r.ok) {
          expect(r.href).toMatch(/^https?:\/\/[a-z0-9.-]+(:[0-9]+)?[/?#]/);
          expect(r.href.split(/[/?#]/)[2]).not.toContain('@');
          expect(r.href.length).toBeLessThanOrEqual(URL_MAX_LENGTH + 1);
        }
      }),
    );
  });

  it('refuses any scheme other than http and https (fast-check)', () => {
    const scheme = fc
      .stringMatching(/^[A-Za-z][A-Za-z0-9+.-]{0,10}$/)
      .filter((s) => !['http', 'https'].includes(s.toLowerCase()));
    fc.assert(
      fc.property(scheme, fc.webUrl(), (s, url) => {
        expect(checkExternalUrl(`${s}:${url.replace(/^https?:/, '')}`).ok).toBe(false);
      }),
    );
  });

  it('accepts generated web URLs without user info, and keeps them http(s) (fast-check)', () => {
    fc.assert(
      fc.property(fc.webUrl({ withQueryParameters: true, withFragments: true }), (url) => {
        const r = checkExternalUrl(url);
        if (r.ok) expect(r.href.startsWith('http://') || r.href.startsWith('https://')).toBe(true);
      }),
    );
  });
});

describe('safeExternalLink', () => {
  it('returns the anchor attributes for an accepted link', () => {
    const link = safeExternalLink('HTTPS://Example.com/x');
    expect(link).toEqual({ href: 'https://example.com/x', rel: 'noopener noreferrer nofollow', target: '_blank' });
    expect(EXTERNAL_LINK_REL).toBe('noopener noreferrer nofollow');
    expect(Object.isFrozen(link)).toBe(true);
  });

  it('returns null for a refused link', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/plain,x', 'https://u:p@example.com', 'https://example.com/' + 'a'.repeat(URL_MAX_LENGTH), 7]) {
      expect(safeExternalLink(bad)).toBeNull();
    }
  });
});
