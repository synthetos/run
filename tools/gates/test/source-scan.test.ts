/**
 * The source capability check that `pnpm deps` runs after dependency-cruiser
 * (P0 review fix pass, P0-13 and P0-14). It is a separate implementation from
 * the ESLint rules, so it gets the same fixtures. The real-gate runs are in
 * review-gates-acceptance.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanSource } from '../src/source/scan.ts';
import { REPO_ROOT } from './scratch.ts';

const rules = (code: string, path = 'packages/machine/src/x.ts'): string[] => scanSource(path, code).map((f) => f.rule);

describe('pnpm deps runs the source check', () => {
  it('after dependency-cruiser, in the package.json script CI calls', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['deps']).toBe('depcruise packages apps workers tools --config .dependency-cruiser.cjs && node tools/gates/src/source/cli.ts');
  });
});

describe('capability-lookup', () => {
  it('fails on the reviewer probe, verbatim', () => {
    const found = scanSource('apps/web/src/reviewProbe.ts', "const s = Reflect.get(navigator, ['ser', 'ial'].join(''));\nvoid Reflect.apply(Reflect.get(s, ['get', 'Ports'].join('')), s, []);\n");
    expect(found.map((f) => f.rule)).toEqual(['capability-lookup', 'capability-lookup', 'capability-lookup', 'capability-lookup']);
    expect(found.map((f) => f.line)).toEqual([1, 1, 2, 2]);
  });

  it.each([
    ["navigator['ser' + 'ial']"],
    ['navigator[key]'],
    ['navigator?.[key]'],
    ['navigator.serialize'],
    ['const n = navigator;'],
    ['use(navigator);'],
    ['const o = { navigator };'],
    ['Object.keys(navigator)'],
    ["'serial' in navigator"],
    ['globalThis.navigator'],
    ["globalThis['navigator'][k]"],
    ["(globalThis as any)['navi' + 'gator']"],
    ['window[name]'],
    ['self?.[name]'],
    ['const g = globalThis;'],
    ['const { location } = window;'],
    ['top[k]'],
    ['parent.frames[k]'],
    ['document.defaultView'],
    ['frame.contentWindow[k]'],
    ["Reflect.get(globalThis, 'navigator')"],
    ["const n = 'navigator';"],
    ['const n = `navigator`;'],
    ['const { navigator: n } = globalThis;'],
    ['clientInformation[k]'],
    ['declare const navigator: any; const v = navigator[k];'],
    ['declare const top: any; const v = top[k];'],
    ['const R = Reflect;'],
    ['const s = (navigator as unknown as Record<string, unknown>)[k];'],
  ])('fails: %s', (code) => {
    expect(rules(code), code).toContain('capability-lookup');
  });

  it.each([
    ['navigator.language'],
    ['globalThis.navigator.userAgent'],
    ['self.navigator.onLine'],
    ["typeof navigator !== 'undefined'"],
    ['globalThis.location.origin'],
    ["(globalThis as { trustedTypes?: unknown })['trustedTypes']"],
    ['globalThis[`trustedTypes`]'],
    ["'trustedTypes' in globalThis"],
    ["globalThis.addEventListener('message', () => {});"],
    ["(globalThis as unknown as WorkerScope).addEventListener('message', () => {});"],
    ["typeof window === 'undefined'"],
    ['function f(top: number, parent: number) { return [top, parent][0]; }'],
    ['const { a } = obj; const b = rect.top; const c = o.parent;'],
    ['type W = typeof window; interface N { navigator: Navigator }'],
    ['let x: Window["navigator"];'],
    ["const label = 'the host window.'; const n = 'navigation';"],
    ["import { x } from './navigator-free.ts';"],
  ])('passes: %s', (code) => {
    expect(rules(code), code).toEqual([]);
  });

  it('is not applied to the dev-only test kit when the caller says so', () => {
    expect(scanSource('packages/testkit/src/x.ts', 'Object.defineProperty(globalThis, k, {});', { capabilities: false })).toEqual([]);
    expect(scanSource('packages/testkit/src/x.ts', 'Object.defineProperty(globalThis, k, {});').map((f) => f.rule)).toEqual(['capability-lookup']);
  });
});

describe('dynamic-import', () => {
  it('fails on the reviewer loader, verbatim', () => {
    const found = scanSource('packages/machine/src/reviewImport.ts', 'export async function loadModule(path: string): Promise<unknown> {\n  return import(/* @vite-ignore */ path);\n}\n');
    expect(found.map((f) => [f.rule, f.line])).toEqual([['dynamic-import', 2]]);
  });

  it.each([['import(`./${n}.ts`)'], ["import('./' + n)"], ['import()']])('fails: %s', (code) => {
    expect(rules(code)).toEqual(['dynamic-import']);
  });

  it('applies to the test kit too', () => {
    expect(scanSource('packages/testkit/src/x.ts', 'import(p);', { capabilities: false }).map((f) => f.rule)).toEqual(['dynamic-import']);
  });

  it('passes literal specifiers, import attributes, type-only imports and import.meta', () => {
    expect(rules("import('./a.ts'); import(`./b.ts`); import('./c.json', { with: { type: 'json' } }); type T = typeof import('./d.ts'); const u = import.meta.url;")).toEqual([]);
  });
});
