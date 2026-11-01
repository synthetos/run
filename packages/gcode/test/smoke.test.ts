import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import * as mod from '../src/index.ts';

describe('@synthetos/gcode', () => {
  it('exports VERSION equal to the package.json version', () => {
    expect(mod.VERSION).toBe(pkg.version);
    expect(mod.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is side-effect free and exposes its entry through the exports map', () => {
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.exports['.']).toBe('./src/index.ts');
  });

  it('declares no runtime npm dependencies: its only dependencies are the workspace packages it may import', () => {
    const fields = pkg as Record<string, unknown>;
    for (const field of ['optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']) {
      const value = fields[field] ?? {};
      expect(Object.keys(value as object), field).toEqual([]);
    }
    // RUN_PLAN §5.3: gcode -> {safety, protocol}; every edge is a workspace link (the npm ban lives in .dependency-cruiser.cjs).
    const deps = (fields['dependencies'] ?? {}) as Record<string, string>;
    expect(Object.keys(deps).sort()).toEqual(['@synthetos/protocol', '@synthetos/safety']);
    for (const spec of Object.values(deps)) expect(spec).toBe('workspace:*');
  });
});
