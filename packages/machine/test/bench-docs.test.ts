/**
 * The bench checklist (docs/bench/README.md) names the GETs the session
 * writes; an owner checks a real transcript against it, so it must match.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { READING_TOKENS } from '../src/index.ts';

const README = readFileSync(fileURLToPath(new URL('../../../docs/bench/README.md', import.meta.url)), 'utf8');

describe('docs/bench/README.md matches the session', () => {
  it('BENCH-P102-1 and BENCH-P103-1 list the READING GETs exactly', () => {
    const reading = `\`${READING_TOKENS.join(' ')}\``;
    for (const id of ['BENCH-P102-1', 'BENCH-P103-1']) {
      const row = README.split('\n').find((l) => l.startsWith(`| ${id}`));
      expect(row, id).toBeDefined();
      expect(row, id).toContain(reading);
    }
  });
});

/** The placeholder every committed probe fixture uses for the board's unique per-chip `id`. */
const ID_PLACEHOLDER = '0X0000-XXX';
const PROBE_FIXTURES = fileURLToPath(new URL('../../../test-fixtures/probe/', import.meta.url));

/** Every `id` value in a fixture's text that is not the placeholder. */
function unredactedIds(text: string): string[] {
  return [...text.matchAll(/"id"\s*:\s*"([^"]*)"/g)].map((m) => m[1] as string).filter((id) => id !== ID_PLACEHOLDER);
}

describe('board ids stay out of the public repository (B-PROBE-1)', () => {
  it('the check finds a real id and accepts the placeholder', () => {
    expect(unredactedIds('probe: {"fb":450.01,"id":"3X3566-YMB"} {"r":{"id":"3X3566-YMB"},"f":[3,0,10]}')).toEqual(['3X3566-YMB', '3X3566-YMB']);
    expect(unredactedIds(`probe: {"fb":450.01,"id":"${ID_PLACEHOLDER}"}`)).toEqual([]);
  });

  it('the bench docs tell the owner to replace the id before committing or posting', () => {
    expect(README).toContain(ID_PLACEHOLDER);
    const guide = readFileSync(fileURLToPath(new URL('../../../docs/bench/GUIDE.md', import.meta.url)), 'utf8');
    expect(guide.slice(guide.indexOf('## 9.'))).toContain(ID_PLACEHOLDER);
  });

  it('every committed probe fixture has only the placeholder id', () => {
    const files = existsSync(PROBE_FIXTURES) ? readdirSync(PROBE_FIXTURES).filter((f) => f.endsWith('.txt')) : [];
    for (const f of files) expect(unredactedIds(readFileSync(`${PROBE_FIXTURES}${f}`, 'utf8')), f).toEqual([]);
  });
});
