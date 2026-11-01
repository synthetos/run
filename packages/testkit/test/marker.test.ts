/**
 * The test-kit marker must survive into any bundle that contains test-kit
 * code (ROADMAP P0-13, T-S40). tools/gates/test/bundle-acceptance.test.ts
 * proves it on a real production build; these tests pin the two properties
 * that make it work: every module imports marker.ts, and marker.ts names the
 * marker in a side effect a bundler cannot drop.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TESTKIT_MARKER } from '../src/marker.ts';
import { MockSerialPort } from '../src/mockSerialPort.ts';
import { TinyGEdgeNextModel } from '../src/firmware/edgeNext.ts';
import { createSim } from '../src/simHost.ts';

const SRC = resolve(import.meta.dirname, '../src');
const MARKER_FILE = join(SRC, 'marker.ts');
const modules = (): string[] =>
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(SRC, f))
    .filter((f) => f !== MARKER_FILE);

describe('the test-kit marker', () => {
  it('has the literal value the bundle scan searches for', () => {
    expect(TESTKIT_MARKER).toBe('__SYNTHETOS_TESTKIT_DEV_ONLY__');
  });

  it('is set on globalThis as a read-only, non-enumerable flag once the kit is loaded', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, TESTKIT_MARKER);
    expect(descriptor).toEqual({ value: true, enumerable: false, writable: false, configurable: false });
    expect(Object.keys(globalThis)).not.toContain(TESTKIT_MARKER);
  });

  it('names the marker in a module-level side effect, not only in an export a minifier may drop', () => {
    const code = readFileSync(MARKER_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toMatch(/^Object\.defineProperty\(globalThis, TESTKIT_MARKER,/m);
  });

  it('is loaded by every other module in src/', () => {
    const files = modules();
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      let spec = relative(dirname(file), MARKER_FILE);
      if (!spec.startsWith('.')) spec = `./${spec}`;
      // `import './marker.ts';`, or a re-export from it (index.ts), which
      // evaluates it just the same.
      const text = readFileSync(file, 'utf8');
      const imports = text.includes(`\nimport '${spec}';\n`) || text.includes(` from '${spec}';\n`);
      expect(imports, relative(SRC, file)).toBe(true);
    }
  });
});

describe('MockSerialPort', () => {
  it('reports [object MockSerialPort], a name string a minifier cannot rename', () => {
    const port = new MockSerialPort(createSim(new TinyGEdgeNextModel()).endpoint);
    expect(Object.prototype.toString.call(port)).toBe('[object MockSerialPort]');
  });
});

describe('re-evaluating marker.ts', () => {
  it('does not throw when the flag is already defined (a second module instance)', async () => {
    vi.resetModules();
    const again = await import('../src/marker.ts');
    expect(again.TESTKIT_MARKER).toBe(TESTKIT_MARKER);
    expect(Object.getOwnPropertyDescriptor(globalThis, TESTKIT_MARKER)?.value).toBe(true);
  });
});
