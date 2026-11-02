import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { BENCH_USAGE, VERSION, usage } from '../src/index.ts';

describe('@synthetos/cli', () => {
  it('exports VERSION equal to the package.json version', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('prints its version and the bench command', () => {
    expect(usage()).toBe(`run-cli ${pkg.version}\n\nCommands:\n  ${BENCH_USAGE}`);
    expect(BENCH_USAGE).toMatch(/^run-cli bench --port/);
  });
});
