import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import * as mod from '../src/index.ts';

describe('@synthetos/machine', () => {
  it('exports VERSION equal to the package.json version', () => {
    expect(mod.VERSION).toBe(pkg.version);
    expect(mod.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is side-effect free and exposes its entry through the exports map', () => {
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.exports['.']).toBe('./src/index.ts');
  });

  it('declares no runtime npm dependencies (including optional, peer and bundled)', () => {
    const fields = pkg as Record<string, unknown>;
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']) {
      const value = fields[field] ?? {};
      expect(Object.keys(value as object), field).toEqual([]);
    }
  });
});
