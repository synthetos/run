import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkWorkflow } from '../src/workflow/policy.ts';
import { REPO_ROOT } from './scratch.ts';
it('manual restore is independently byte-pinned, with no scheduled restore', () => {
  const source = readFileSync(join(REPO_ROOT, '.github/workflows/database-restore.yml'), 'utf8');
  expect(checkWorkflow('database-restore.yml', source)).toEqual([]);
  for (const [before, after] of [['workflow_dispatch', 'schedule'], ['refs/heads/main', 'refs/heads/topic'], ['"environment": "production"', '"environment": "staging"'], ['node tools/backups/restore-cli.mjs', 'echo unsafe']]) expect(checkWorkflow('database-restore.yml', source.replace(before!, after!))).not.toEqual([]);
});

it('does not admit a secret-bearing scheduled backup workflow', () => {
  const restore = readFileSync(join(REPO_ROOT, '.github/workflows/database-restore.yml'), 'utf8');
  expect(checkWorkflow('database-backups.yml', restore.replace('workflow_dispatch', 'schedule'))).not.toEqual([]);
});
