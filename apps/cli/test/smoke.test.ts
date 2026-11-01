import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { VERSION, usage } from '../src/index.ts';

describe('@synthetos/cli', () => {
  it('exports VERSION equal to the package.json version', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('prints its version and states that no commands exist yet', () => {
    expect(usage()).toBe(`run-cli ${pkg.version}\nNo commands yet. Bench tooling arrives in P1-08.\n`);
  });
});
