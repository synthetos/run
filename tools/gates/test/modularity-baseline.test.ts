import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { auditModularity } from '../src/modularity/audit.ts';
import { checkBaselineHistory } from '../src/modularity/history.ts';
import { BASELINE_PATH, readBaseline } from '../src/modularity/types.ts';
const root = resolve(import.meta.dirname, '../../..');
it('the whole source/test tree matches the exact baseline, with no new/worse/stale item', async () => {
  const baseline = readBaseline(JSON.parse(readFileSync(resolve(root, BASELINE_PATH), 'utf8')));
  expect(await auditModularity(root, baseline)).toEqual([]);
}, 60_000);
it('baseline history only decreases, including the current working copy', () => {
  const baseline = readBaseline(JSON.parse(readFileSync(resolve(root, BASELINE_PATH), 'utf8')));
  expect(checkBaselineHistory(root, baseline)).toEqual([]);
});
it('CI provides full history and the baseline stays explicitly owner-reviewed', () => {
  const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
  const verify = ci.slice(ci.indexOf('\n  verify:'), ci.indexOf('\n  mutation:'));
  expect(verify).toMatch(/fetch-depth: 0/);
  expect(readFileSync(resolve(root, '.github/CODEOWNERS'), 'utf8')).toMatch(/^\/tools\/gates\/modularity-baseline\.json\s+@ril3y$/m);
});
