import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import * as mod from '../src/index.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

describe('@synthetos/library', () => {
  it('exports VERSION equal to the package.json version', () => {
    expect(mod.VERSION).toBe(pkg.version);
    expect(mod.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is side-effect free and exposes its entry through the exports map', () => {
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.exports['.']).toBe('./src/index.ts');
  });

  it('declares no runtime npm dependencies: its only dependency is the schema package, as a workspace link', () => {
    const fields = pkg as Record<string, unknown>;
    for (const field of ['optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']) {
      expect(Object.keys((fields[field] ?? {}) as object), field).toEqual([]);
    }
    expect(fields['dependencies']).toEqual({ '@synthetos/schema': 'workspace:*' });
  });

  it('imports only its own modules and the JSON Schema validator (MACHINING_ASSISTANT §9: no network, no machine import)', () => {
    for (const file of readdirSync(SRC)) {
      const text = readFileSync(SRC + file, 'utf8');
      for (const m of text.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'/g)) {
        const spec = m[1] ?? m[2] ?? '';
        expect(spec, `${file} imports ${spec}`).toMatch(/^(\.\/[a-zA-Z]+\.ts|@synthetos\/schema\/json-schema)$/);
      }
    }
  });
});
