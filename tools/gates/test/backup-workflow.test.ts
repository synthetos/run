import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkWorkflow } from '../src/workflow/policy.ts';
import { REPO_ROOT } from './scratch.ts';
it('admits only the byte-pinned nightly/dispatch, protected main-branch backup workflow', () => {
  const source = readFileSync(join(REPO_ROOT, '.github/workflows/database-backups.yml'), 'utf8');
  expect(checkWorkflow('database-backups.yml', source)).toEqual([]);
  for (const [before, after] of [['refs/heads/main', 'refs/heads/topic'], ['"environment": "production"', '"environment": "staging"'], ['"schedule"', '"pull_request_target"'], ['"workflow_dispatch"', '"push"'], ['node tools/backups/cli.mjs', 'echo unsafe'], ['CLOUDFLARE_D1_API_TOKEN', 'OTHER_SECRET'], ['"persist-credentials": false', '"persist-credentials": true'], ['"contents": "read"', '"contents": "write"']]) {
    expect(source).toContain(before);
    expect(checkWorkflow('database-backups.yml', source.replace(before!, after!))).not.toEqual([]);
  }
  expect(checkWorkflow('database-backups.yml', source + '\n')).not.toEqual([]);
});

it('manual restore is independently byte-pinned, with no scheduled restore', () => {
  const source = readFileSync(join(REPO_ROOT, '.github/workflows/database-restore.yml'), 'utf8');
  expect(checkWorkflow('database-restore.yml', source)).toEqual([]);
  for (const [before, after] of [['workflow_dispatch', 'schedule'], ['refs/heads/main', 'refs/heads/topic'], ['"environment": "production"', '"environment": "staging"'], ['node tools/backups/restore-cli.mjs', 'echo unsafe']]) expect(checkWorkflow('database-restore.yml', source.replace(before!, after!))).not.toEqual([]);
});
