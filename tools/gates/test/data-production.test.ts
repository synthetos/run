import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { dataDeployConfig, productionDataConfig, DATA_DATABASE_PLACEHOLDER, DATA_BUCKET_PLACEHOLDER } from '../src/deploy/dataConfig.ts';
import { deployConfig, parseJsonc } from '../src/deploy/wranglerConfig.ts';
import { checkWorkflow } from '../src/workflow/policy.ts';
import { checkStorage } from '../src/smoke/storage.ts';
import { SECURITY_HEADERS } from '../../../workers/run/src/headers.ts';
import { REPO_ROOT } from './scratch.ts';
const account = 'a'.repeat(32), id = '11111111-2222-4333-8444-555555555555';
const reviewed = () => ({ ...dataDeployConfig(account, id, 'production'), main: 'src/index.ts' });
it('accepts only exact private production bindings, and never produces a deploy config with placeholders', () => {
  expect(productionDataConfig(reviewed(), account)).toEqual(dataDeployConfig(account, id, 'production'));
  const source = readFileSync(join(REPO_ROOT, 'workers/run-data/wrangler.jsonc'), 'utf8');
  for (const [db, bucket] of [[DATA_DATABASE_PLACEHOLDER, DATA_BUCKET_PLACEHOLDER], [id, DATA_BUCKET_PLACEHOLDER], [DATA_DATABASE_PLACEHOLDER, 'run-files']]) {
    const c = parseJsonc(source.replace(/"account_id": "[^"]*"/, `"account_id": "${account}"`).replace(DATA_DATABASE_PLACEHOLDER, db!).replace(DATA_BUCKET_PLACEHOLDER, bucket!));
    expect(productionDataConfig(c, account)).toBeNull();
  }
});
it.each([{ build: { command: 'false' } }, { workers_dev: true }, { preview_urls: true }, { routes: ['public'] }, { account_id: 'b'.repeat(32) }, { r2_buckets: [{ binding: 'RUN_FILES', bucket_name: 'run-files-staging' }] }, { d1_databases: [{ database_id: 'bad' }] }])('refuses altered production data configuration %j', patch => {
  expect(() => productionDataConfig({ ...reviewed(), ...patch }, account)).toThrow();
});
it('strips production RUN_DATA until ready, retaining sign-in and staging bindings', () => {
  const c = parseJsonc(readFileSync(join(REPO_ROOT, 'workers/run/wrangler.jsonc'), 'utf8').replace('RUN_AUTH_DATABASE_ID_PLACEHOLDER', id));
  const off = deployConfig(c, { requireRealAccount: true, authReady: true });
  expect(off['services']).toEqual([{ binding: 'ACCOUNTS', service: 'accounts', entrypoint: 'RunEntrypoint' }]);
  expect((off['env'] as { staging: { services: unknown[] } }).staging.services).toContainEqual({ binding: 'RUN_DATA', service: 'run-data-staging', entrypoint: 'AppEntrypoint' });
  expect(deployConfig(c, { requireRealAccount: true, authReady: true, dataReady: true })['services']).toContainEqual({ binding: 'RUN_DATA', service: 'run-data', entrypoint: 'AppEntrypoint' });
});
it('production data preflight writes only real ids with migration readiness and refuses overwrite', () => {
  const base = join(REPO_ROOT, 'node_modules/.cache'); mkdirSync(base, { recursive: true });
  const cwd = mkdtempSync(join(base, 'data-preflight-')); mkdirSync(join(cwd, 'workers/run-data'), { recursive: true });
  const file = join(cwd, 'workers/run-data/wrangler.jsonc'), out = join(cwd, 'workers/run-data/wrangler.deploy.json');
  const run = (ready: boolean) => spawnSync(process.execPath, [join(REPO_ROOT, 'tools/gates/src/deploy/data-preflight-cli.ts')], { cwd, encoding: 'utf8', env: { PATH: process.env['PATH'], CLOUDFLARE_ACCOUNT_ID: account, RUN_DATA_MIGRATIONS_READY: String(ready), GITHUB_OUTPUT: join(cwd, 'output') } });
  try {
    writeFileSync(file, JSON.stringify(reviewed()).replace(id, DATA_DATABASE_PLACEHOLDER));
    expect(run(false).status).toBe(0); expect(existsSync(out)).toBe(false);
    expect(readFileSync(join(cwd, 'output'), 'utf8')).toBe('ready=false\n');
    writeFileSync(file, JSON.stringify(reviewed())); expect(run(false).status).toBe(1); expect(existsSync(out)).toBe(false);
    expect(run(true).status).toBe(0); expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(dataDeployConfig(account, id, 'production'));
    expect(run(true).status).toBe(1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
it('confines production data credentials and orders migrations/deploy before Run', () => {
  const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
  expect(checkWorkflow('ci.yml', ci)).toEqual([]);
  for (const mutation of [ci.replaceAll("if: steps.data_config.outputs.ready == 'true'", 'if: always()'), ci.replace('data-preflight-cli.ts', 'other-cli.ts'), ci.replace('Apply production data migrations', 'Skip migrations')]) {
    expect(checkWorkflow('ci.yml', mutation)).not.toEqual([]);
  }
  const migration = ci.indexOf('- name: Apply production data migrations'), deploy = ci.indexOf('- name: Deploy attested production data Worker'), site = ci.indexOf('- name: Deploy the attested artifact to production');
  expect(migration).toBeLessThan(deploy); expect(deploy).toBeLessThan(site);
  const dataStep = ci.slice(deploy - 6, site - 6);
  expect(checkWorkflow('ci.yml', ci.replace(dataStep, '') + dataStep)).not.toEqual([]);
});
it.each([401, 503])('production anonymous storage accepts %s only with security headers and no-store', status => {
  const res = { url: 'https://run.synthetos.com/api/records/tool', status, body: '{}', headers: new Headers({ ...SECURITY_HEADERS, 'cache-control': 'no-store' }) };
  expect(checkStorage(res, status === 401 ? 'true' : 'false')).toEqual([]);
  expect(checkStorage({ ...res, status: 200 }, status === 401 ? 'true' : 'false')).not.toEqual([]);
  expect(checkStorage({ ...res, headers: new Headers() }, status === 401 ? 'true' : 'false')).not.toEqual([]);
});
