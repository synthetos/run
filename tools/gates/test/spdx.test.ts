import { describe, expect, it } from 'vitest';
import { isSatisfiedBy, licenceIds } from '../src/licence/spdx.ts';

const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause']);

describe('SPDX expression evaluation', () => {
  it('accepts a single allowed identifier and rejects others', () => {
    expect(isSatisfiedBy('MIT', ALLOWED)).toBe(true);
    expect(isSatisfiedBy('GPL-3.0-only', ALLOWED)).toBe(false);
  });

  it('needs one allowed operand of OR and every operand of AND', () => {
    expect(isSatisfiedBy('MIT OR GPL-3.0-only', ALLOWED)).toBe(true);
    expect(isSatisfiedBy('(GPL-2.0-only OR Apache-2.0)', ALLOWED)).toBe(true);
    expect(isSatisfiedBy('MIT AND BSD-3-Clause', ALLOWED)).toBe(true);
    expect(isSatisfiedBy('MIT AND GPL-2.0-only', ALLOWED)).toBe(false);
  });

  it('binds AND tighter than OR and honours parentheses', () => {
    // GPL OR (MIT AND Apache): satisfiable through the right-hand side.
    expect(isSatisfiedBy('GPL-2.0-only OR MIT AND Apache-2.0', ALLOWED)).toBe(true);
    // (GPL OR MIT) AND LGPL: never satisfiable.
    expect(isSatisfiedBy('(GPL-2.0-only OR MIT) AND LGPL-3.0-only', ALLOWED)).toBe(false);
  });

  it('treats "X WITH exception" as its own identifier', () => {
    expect(isSatisfiedBy('Apache-2.0 WITH LLVM-exception', ALLOWED)).toBe(false);
    expect(isSatisfiedBy('Apache-2.0 WITH LLVM-exception', new Set(['Apache-2.0 WITH LLVM-exception']))).toBe(true);
    expect(licenceIds('Apache-2.0 WITH LLVM-exception OR MIT')).toEqual(['Apache-2.0 WITH LLVM-exception', 'MIT']);
  });

  it('fails closed on empty, malformed or non-SPDX text', () => {
    for (const bad of ['', '   ', 'Unknown MIT', '(MIT', 'MIT)', 'MIT OR', 'AND MIT', 'SEE LICENSE IN LICENSE.md', 'MIT/X11', 'MIT WITH']) {
      expect(isSatisfiedBy(bad, ALLOWED), bad).toBe(false);
    }
    expect(licenceIds('(MIT')).toBeUndefined();
    expect(licenceIds('')).toBeUndefined();
  });
});
