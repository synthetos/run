import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import * as mod from '../src/index.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

describe('@synthetos/advisor', () => {
  it('exports VERSION equal to the package.json version', () => {
    expect(mod.VERSION).toBe(pkg.version);
    expect(mod.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is side-effect free and exposes its entry through the exports map', () => {
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.exports['.']).toBe('./src/index.ts');
  });

  it('declares no runtime npm dependencies: only library and the schema validator, as workspace links', () => {
    const fields = pkg as Record<string, unknown>;
    for (const field of ['optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']) {
      expect(Object.keys((fields[field] ?? {}) as object), field).toEqual([]);
    }
    expect(fields['dependencies']).toEqual({ '@synthetos/library': 'workspace:*', '@synthetos/schema': 'workspace:*' });
  });

  it('imports only its own modules, library and the JSON Schema validator (no network, no machine, no clock)', () => {
    // Top-level modules, the analysis/ folder (only its own modules) and planner/ (its own and the tape's types).
    const files = [...readdirSync(SRC).filter((f) => f.endsWith('.ts')), ...['analysis', 'planner'].flatMap((d) => readdirSync(`${SRC}${d}`).map((f) => `${d}/${f}`))];
    for (const file of files) {
      const text = readFileSync(SRC + file, 'utf8');
      for (const m of text.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'/g)) {
        const spec = m[1] ?? m[2] ?? '';
        const allowed = file.startsWith('analysis/') ? /^\.\/[a-zA-Z]+\.ts$/ : file.startsWith('planner/') ? /^(\.\/[a-zA-Z]+\.ts|\.\.\/analysis\/types\.ts)$/ : /^(\.\/[a-zA-Z]+\.ts|\.\/(analysis|planner)\/index\.ts|@synthetos\/library|@synthetos\/schema\/json-schema)$/;
        expect(spec, `${file} imports ${spec}`).toMatch(allowed);
      }
      expect(text, file).not.toMatch(/\bDate\.now\b|\bMath\.random\b|\bperformance\.now\b|\bsetTimeout\b|\bsetInterval\b/);
    }
  });
});
