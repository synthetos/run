/**
 * Writes packages/testkit/STATUS.md from the behaviour register
 * (RUN_PLAN §8.1). Run with `pnpm --filter @synthetos/testkit gen:status`;
 * test/honesty.test.ts fails when the committed file is out of date.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BEHAVIOURS, MODEL_LIMITS } from '../src/honesty/behaviours.ts';
import { renderStatus, validateBehaviours } from '../src/honesty/status.ts';

const problems = validateBehaviours(BEHAVIOURS);
if (problems.length > 0) {
  process.stderr.write(`behaviour register has problems:\n${problems.join('\n')}\n`);
  process.exit(1);
}
const target = join(import.meta.dirname, '..', 'STATUS.md');
writeFileSync(target, renderStatus(BEHAVIOURS, MODEL_LIMITS));
process.stdout.write(`wrote ${target}\n`);
