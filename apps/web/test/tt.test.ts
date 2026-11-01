/**
 * The two Trusted Types policies (ROADMAP P0-04, RUN_PLAN §6.4, T-S25).
 * The browser-level behaviour (only these two names can exist, sinks refuse
 * plain strings) is asserted by the Playwright suite in tools/e2e; this file
 * tests the rules each policy applies.
 */
import { describe, expect, it } from 'vitest';
import {
  brandSvgExport,
  checkSvgExport,
  checkWorkerScriptUrl,
  createRunPolicies,
  type PolicyFactoryLike,
  type PolicyRules,
  RS_SVG_EXPORT,
  RS_WORKER,
  TrustedTypesError,
} from '../src/security/tt.ts';

const ORIGIN = 'https://run.synthetos.com';

describe('rs-worker: checkWorkerScriptUrl', () => {
  it.each([
    ['/assets/machine.worker-AbCd1234.js', `${ORIGIN}/assets/machine.worker-AbCd1234.js`],
    ['assets/gcode.worker-x.js', `${ORIGIN}/assets/gcode.worker-x.js`],
    [`${ORIGIN}/assets/cloud/sync.worker-y.js`, `${ORIGIN}/assets/cloud/sync.worker-y.js`],
  ])('accepts %s', (input, href) => {
    expect(checkWorkerScriptUrl(input, ORIGIN)).toBe(href);
  });

  it.each([
    ['another origin', 'https://evil.example/assets/x.js'],
    ['a sibling origin', 'https://staging.run.synthetos.com/assets/x.js'],
    ['a protocol-relative URL', '//evil.example/assets/x.js'],
    ['a data: URL', 'data:text/javascript,alert(1)'],
    ['a blob: URL', `blob:${ORIGIN}/0b7c`],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a path outside /assets/', '/x.js'],
    ['a dot segment escaping /assets/', '/assets/../x.js'],
    ['an encoded dot segment', '/assets/%2e%2e/x.js'],
    ['a backslash', '/assets\\..\\x.js'],
    ['a query', '/assets/x.js?v=1'],
    ['a fragment', '/assets/x.js#a'],
    ['credentials', 'https://u:p@run.synthetos.com/assets/x.js'],
    ['a non-script file', '/assets/x.css'],
    ['an empty segment', '/assets//x.js'],
    ['whitespace', ' /assets/x.js'],
  ])('refuses %s', (_label, input) => {
    expect(() => checkWorkerScriptUrl(input, ORIGIN)).toThrow(TrustedTypesError);
  });
});

describe('rs-svg-export: brandSvgExport and checkSvgExport', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/><text>X+ &amp; Y-</text></svg>';

  it('accepts a branded export exactly once', () => {
    const branded = brandSvgExport(svg);
    expect(checkSvgExport(branded)).toBe(svg);
    expect(() => checkSvgExport(branded)).toThrow(/did not produce/);
  });

  it('refuses a string the export renderer did not produce', () => {
    expect(() => checkSvgExport(svg)).toThrow(TrustedTypesError);
    expect(() => checkSvgExport('<img src=x onerror=alert(1)>')).toThrow(TrustedTypesError);
  });

  it.each([
    ['not SVG', '<div>x</div>'],
    ['no SVG namespace', '<svg viewBox="0 0 1 1"></svg>'],
    ['truncated', '<svg xmlns="http://www.w3.org/2000/svg">'],
    ['a script element', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['an event handler', '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)"/></svg>'],
    ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>'],
    ['a link', '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://x"><rect/></a></svg>'],
    ['an external image', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x/i.png"/></svg>'],
    ['a use reference', '<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/></svg>'],
    ['a javascript: URL', '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="javascript:x"/></svg>'],
    ['an entity declaration', '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"></svg>'],
  ])('brandSvgExport refuses %s', (_label, input) => {
    expect(() => brandSvgExport(input)).toThrow(TrustedTypesError);
  });
});

/** A factory that behaves like the browser under `trusted-types rs-worker rs-svg-export` (no allow-duplicates). */
function browserLikeFactory(): PolicyFactoryLike & { created: string[] } {
  const created: string[] = [];
  return {
    created,
    createPolicy(name: string, rules: PolicyRules) {
      if (name !== RS_WORKER && name !== RS_SVG_EXPORT) throw new TypeError(`policy '${name}' disallowed by CSP`);
      if (created.includes(name)) throw new TypeError(`policy '${name}' already exists`);
      created.push(name);
      const wrap = (fn: ((s: string) => string) | undefined) => (s: string) => {
        if (fn === undefined) throw new TypeError('not supported');
        const value = fn(s);
        return { toString: () => value };
      };
      return { createHTML: wrap(rules.createHTML), createScriptURL: wrap(rules.createScriptURL) };
    },
  };
}

describe('createRunPolicies', () => {
  it('creates exactly the two named policies', () => {
    const factory = browserLikeFactory();
    createRunPolicies(factory, ORIGIN);
    expect(factory.created).toEqual([RS_WORKER, RS_SVG_EXPORT]);
  });

  it('cannot run twice on one page: the second creation is refused, as in the browser', () => {
    const factory = browserLikeFactory();
    createRunPolicies(factory, ORIGIN);
    expect(() => createRunPolicies(factory, ORIGIN)).toThrow(/already exists/);
  });

  it('workerScriptUrl applies the rs-worker rule', () => {
    const tt = createRunPolicies(browserLikeFactory(), ORIGIN);
    expect(tt.workerScriptUrl('/assets/machine.worker-a.js').toString()).toBe(`${ORIGIN}/assets/machine.worker-a.js`);
    expect(() => tt.workerScriptUrl('https://evil.example/assets/x.js')).toThrow(TrustedTypesError);
  });

  it('svgExportBlob makes an SVG blob from a branded export only', async () => {
    const tt = createRunPolicies(browserLikeFactory(), ORIGIN);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const blob = tt.svgExportBlob(brandSvgExport(svg));
    expect(blob.type).toBe('image/svg+xml');
    expect(await blob.text()).toBe(svg);
    expect(() => tt.svgExportBlob(svg as Parameters<typeof tt.svgExportBlob>[0])).toThrow(TrustedTypesError);
  });

  it('each policy refuses the other sink', () => {
    const factory = browserLikeFactory();
    const rules: Record<string, PolicyRules> = {};
    const spy: PolicyFactoryLike = {
      createPolicy(name, r) {
        rules[name] = r;
        return factory.createPolicy(name, r);
      },
    };
    createRunPolicies(spy, ORIGIN);
    expect(() => rules[RS_WORKER]?.createHTML?.('<b>x</b>')).toThrow(TrustedTypesError);
    expect(() => rules[RS_SVG_EXPORT]?.createScriptURL?.('/assets/x.js')).toThrow(TrustedTypesError);
  });
});
