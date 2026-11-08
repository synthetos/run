import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import * as mod from '../src/index.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Every source file, relative to src/, folders included. */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => `${e.parentPath.slice(SRC.length)}${e.parentPath.length > SRC.length ? '/' : ''}${e.name}`.replace(/^\//, ''));
}

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
    for (const file of sourceFiles()) {
      const text = readFileSync(SRC + file, 'utf8');
      for (const m of text.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'/g)) {
        const spec = m[1] ?? m[2] ?? '';
        // Its own modules: siblings, the carve/ folder, or (from carve/) the modules above it.
        expect(spec, `${file} imports ${spec}`).toMatch(/^(\.\/(carve\/)?|\.\.\/)[a-zA-Z]+\.ts$/);
      }
    }
  });

  it('T-S41: offers no play, simulate or animate API', () => {
    for (const name of Object.keys(mod)) expect(name).not.toMatch(/play|simulat|animat/i);
    const renderer = mod.createRenderer.toString() + readFileSync(SRC + 'renderer.ts', 'utf8');
    expect(renderer).not.toMatch(/\b(play|simulate|animate)\w*\s*\(/i);
    for (const file of sourceFiles().filter((f) => f.startsWith('carve/'))) expect(readFileSync(SRC + file, 'utf8'), file).not.toMatch(/\b(play|simulate|animate)\w*\s*\(/i);
  });
});
