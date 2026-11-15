import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { verifySafetyAdvisory } from '../../../packages/protocol/src/safetyAdvisory.ts';
it('ships unsigned advisories for both deployed environments', async () => {
  const file = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../apps/web/public/safety-advisory.json'), 'utf8'));
  for (const environment of ['staging', 'production'] as const) {
    expect((await verifySafetyAdvisory(file, { environment, now: new Date('2026-11-15T00:00:00Z') })).ok).toBe(true);
  }
  expect(JSON.stringify(file)).not.toContain('"sig"');
  expect(JSON.stringify(file)).not.toContain('"kid"');
});
