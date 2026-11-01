/**
 * The origin guard's pure rules (ROADMAP P0-06). The browser side is
 * exercised by specs/origin-guard.e2e.ts and, end to end, by the canary.
 */
import { describe, expect, it } from 'vitest';
import { classifyUrl, domReferenceUrls, guardMessage, GUARD_PREFIX, originOf, refreshUrl, srcsetUrls } from '../src/origin.ts';

const ORIGIN = 'http://127.0.0.1:8790';

describe('classifyUrl', () => {
  it('accepts the origin under test only', () => {
    expect(classifyUrl(`${ORIGIN}/assets/x.js`, ORIGIN)).toBe('same-origin');
    expect(classifyUrl('http://127.0.0.1:8791/x', ORIGIN)).toBe('external');
    expect(classifyUrl('https://127.0.0.1:8790/x', ORIGIN)).toBe('external');
    expect(classifyUrl('http://localhost:8790/x', ORIGIN)).toBe('external');
    expect(classifyUrl('https://fonts.googleapis.com/css', ORIGIN)).toBe('external');
    expect(classifyUrl('wss://third-party.invalid/s', ORIGIN)).toBe('external');
  });

  it('treats data: and about: as local, and blob: by the origin that minted it', () => {
    expect(classifyUrl('data:image/png;base64,AA==', ORIGIN)).toBe('local');
    expect(classifyUrl('about:blank', ORIGIN)).toBe('local');
    expect(classifyUrl('about:srcdoc', ORIGIN)).toBe('local');
    expect(classifyUrl(`blob:${ORIGIN}/1b4f`, ORIGIN)).toBe('same-origin');
    expect(classifyUrl('blob:https://evil.example/1b4f', ORIGIN)).toBe('external');
  });

  it('fails closed on anything unparseable or opaque', () => {
    expect(classifyUrl('not a url', ORIGIN)).toBe('external');
    expect(classifyUrl('', ORIGIN)).toBe('external');
    expect(classifyUrl('chrome-extension://abc/x.js', ORIGIN)).toBe('external');
    expect(classifyUrl('javascript:alert(1)', ORIGIN)).toBe('external');
  });
});

describe('originOf', () => {
  it('returns the origin of the base URL and refuses missing or opaque ones', () => {
    expect(originOf(`${ORIGIN}/some/path`)).toBe(ORIGIN);
    expect(() => originOf(undefined)).toThrow(/no baseURL/);
    expect(() => originOf('data:text/plain,x')).toThrow(/opaque/);
  });
});

describe('srcsetUrls and refreshUrl', () => {
  it('splits srcset candidates on descriptor boundaries, keeping commas inside URLs', () => {
    expect(srcsetUrls('/a.png 1x, https://cdn.invalid/b.png 2x')).toEqual(['/a.png', 'https://cdn.invalid/b.png']);
    expect(srcsetUrls('https://cdn.invalid/c.png')).toEqual(['https://cdn.invalid/c.png']);
    expect(srcsetUrls('data:image/png;base64,AA== 1x, /d.png 480w')).toEqual(['data:image/png;base64,AA==', '/d.png']);
  });

  it('extracts the meta refresh target', () => {
    expect(refreshUrl('5; url=https://evil.invalid/')).toBe('https://evil.invalid/');
    expect(refreshUrl("0;URL='https://evil.invalid/x'")).toBe('https://evil.invalid/x');
    expect(refreshUrl('30')).toBeUndefined();
  });
});

describe('domReferenceUrls', () => {
  const base = `${ORIGIN}/safety/`;
  it('resolves relative values against the document base', () => {
    expect(domReferenceUrls({ tag: 'img', attr: 'src', value: '../icons/a.png', baseURI: base })).toEqual([`${ORIGIN}/icons/a.png`]);
    expect(domReferenceUrls({ tag: 'link', attr: 'href', value: '//cdn.invalid/x.css', baseURI: base })).toEqual(['http://cdn.invalid/x.css']);
  });

  it('reads every URL of srcset, ping and meta refresh', () => {
    expect(domReferenceUrls({ tag: 'img', attr: 'srcset', value: '/a.png 1x, https://cdn.invalid/b.png 2x', baseURI: base })).toEqual([`${ORIGIN}/a.png`, 'https://cdn.invalid/b.png']);
    expect(domReferenceUrls({ tag: 'a', attr: 'ping', value: 'https://t1.invalid/p  /local', baseURI: base })).toEqual(['https://t1.invalid/p', `${ORIGIN}/local`]);
    expect(domReferenceUrls({ tag: 'meta', attr: 'content', value: '1; url=https://evil.invalid/', baseURI: base })).toEqual(['https://evil.invalid/']);
    expect(domReferenceUrls({ tag: 'meta', attr: 'content', value: '1', baseURI: base })).toEqual([]);
  });
});

describe('guardMessage', () => {
  it('is undefined when clean and names every finding otherwise', () => {
    expect(guardMessage([])).toBeUndefined();
    const message = guardMessage([
      { kind: 'request', url: 'https://a.invalid/x', detail: 'image from /' },
      { kind: 'csp', url: 'inline', detail: 'script-src-elem in /' },
    ]);
    expect(message?.startsWith(GUARD_PREFIX)).toBe(true);
    expect(message).toContain('request https://a.invalid/x (image from /)');
    expect(message).toContain('csp inline (script-src-elem in /)');
  });
});
