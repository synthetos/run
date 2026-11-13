import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkWranglerFile } from '../src/bindings/check.ts';
import { checkWorkflow } from '../src/workflow/policy.ts';
import { REPO_ROOT } from './scratch.ts';
it('allows exact private backup bindings and refuses every extra binding or public endpoint', () => {
  for (const environment of ['staging', 'production']) {
    const file = `workers/backup/wrangler.${environment}.json`;
    const config = JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf8')) as Record<string, unknown>;
    expect(checkWranglerFile(file, JSON.stringify(config))).toEqual([]);
    for (const patch of [{ workers_dev: true }, { preview_urls: true }, { routes: [{ pattern: 'backup.test', custom_domain: true }] }, { route: 'backup.test' }, { services: [] }, { kv_namespaces: [] }, { build: { command: 'false' } }, { d1_databases: [] }, { r2_buckets: [{ binding: 'BACKUPS', bucket_name: 'other' }] }, { vars: { BACKUP_ENV: environment === 'staging' ? 'production' : 'staging' } }]) expect(checkWranglerFile(file, JSON.stringify({ ...config, ...patch }))).not.toEqual([]);
    expect(checkWranglerFile('workers/other/wrangler.json', JSON.stringify(config))).not.toEqual([]);
  }
});
it('only the exact backup provision/deploy steps get existing credentials in protected jobs', () => {
  const source = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
  expect(checkWorkflow('ci.yml', source)).toEqual([]);
  for (const [before, after] of [['node tools/backups/provision-worker.mjs staging', 'echo secret'], ['worker/backup/index.mjs --no-bundle', 'worker/backup/other.mjs --no-bundle'], ['--config workers/backup/wrangler.deploy.json', '--config workers/backup/wrangler.staging.json']]) expect(checkWorkflow('ci.yml', source.replace(before!, after!))).not.toEqual([]);
});
