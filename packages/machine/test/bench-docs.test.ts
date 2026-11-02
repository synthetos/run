/**
 * The bench checklist (docs/bench/README.md) names the GETs the session
 * writes; an owner checks a real transcript against it, so it must match.
 */
import { readFileSync } from 'node:fs';
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
