import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import * as mod from '../src/index.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

describe('@synthetos/gcode-view', () => {
  it('exports VERSION equal to the package.json version', () => {
    expect(mod.VERSION).toBe(pkg.version);
    expect(mod.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has no dependencies of any kind: it is publishable on its own', () => {
    const fields = pkg as Record<string, unknown>;
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']) {
      expect(Object.keys((fields[field] ?? {}) as object), field).toEqual([]);
    }
    expect(pkg.sideEffects).toBe(false);
    expect(readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')).toContain('SegmentList');
  });

  it('imports nothing but its own modules (never machine, safety, protocol or gcode)', () => {
    for (const file of readdirSync(SRC)) {
      const text = readFileSync(SRC + file, 'utf8');
      for (const m of text.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'/g)) {
        const spec = m[1] ?? m[2] ?? '';
        expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/[a-zA-Z]+\.ts$/);
      }
    }
  });

  it('T-S41: offers no play, simulate or animate API', () => {
    for (const name of Object.keys(mod)) expect(name).not.toMatch(/play|simulat|animat/i);
    const renderer = mod.createRenderer.toString() + readFileSync(SRC + 'renderer.ts', 'utf8');
    expect(renderer).not.toMatch(/\b(play|simulate|animate)\w*\s*\(/i);
  });
});
