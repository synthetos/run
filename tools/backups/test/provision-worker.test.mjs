import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provisionWorker } from '../provision-worker.mjs';
import { workerConfig, checkBackupConfig } from '../worker-config.mjs';
import { REPO } from '../config.mjs';
import { LIFECYCLE } from '../bucket.mjs';
test('provisions only scratch, preserves source, and pins every private binding', async () => {
  const source = '11111111-2222-4333-8444-555555555555', scratch = '66666666-7777-4888-9999-aaaaaaaaaaaa';
  const calls = [];
  const r2 = async path => /^r2\/buckets\/run-files(?:-staging)?$/.test(path) ? null : ({ result: path.endsWith('/managed') ? { enabled: false } : path.endsWith('/custom') ? { domains: [] } : path.endsWith('/lifecycle') ? LIFECYCLE : {} });
  const d1 = async (path, method = 'GET', body) => {
    calls.push([path, method, body]);
    if (method === 'POST') { assert.equal(body.name, `restore-test-${REPO}`); return { result: { uuid: scratch } }; }
    return { result: [{ name: REPO === 'run' ? 'run-auth' : 'identity', uuid: source }] };
  };
  const config = await provisionWorker('production', 'a'.repeat(32), d1, r2);
  assert.ok(checkBackupConfig(config));
  assert.deepEqual(config.d1_databases.map(d => d.database_id), [source, scratch]);
  assert.equal(calls.filter(c => c[1] === 'POST').length, 1);
  assert.throws(() => workerConfig('production', source, source), /differ/);
  assert.equal(await provisionWorker('production', 'a'.repeat(32), async () => ({ result: [] }), r2), null);
});

test('environment-specific scratch bindings and cron offsets are exact', () => {
  for (const environment of ['staging', 'production']) {
    const suffix = environment === 'staging' ? '-staging' : '';
    const config = workerConfig(environment, 'SOURCE_DATABASE_ID', 'SCRATCH_DATABASE_ID');
    assert.equal(config.d1_databases[1].database_name, `restore-test-${REPO}${suffix}`);
    assert.deepEqual(config.triggers.crons, [`${(REPO === 'accounts' ? 45 : 50) - (environment === 'staging' ? 15 : 0)} 7 * * *`]);
    const wrong = structuredClone(config);
    wrong.d1_databases[1].database_name = `restore-test-${REPO}${suffix ? '' : '-staging'}`;
    assert.equal(checkBackupConfig(wrong), false);
    assert.equal(checkBackupConfig({ ...config, triggers: { crons: ['0 0 * * *'] } }), false);
  }
});

test('absent sources need no D1 credential or resources; present sources require the credential', async () => {
  const absent = async (path, method = 'GET') => { assert.match(path, /^d1\/database\?/); assert.equal(method, 'GET'); return { result: [] }; };
  assert.equal(await provisionWorker('production', 'a'.repeat(32), null, absent), null);
  const present = async () => ({ result: [{ name: REPO === 'run' ? 'run-auth' : 'identity', uuid: '11111111-2222-4333-8444-555555555555' }] });
  await assert.rejects(provisionWorker('production', 'a'.repeat(32), null, present), /Missing credential: CLOUDFLARE_D1_API_TOKEN: D1: Edit/);
  await assert.rejects(provisionWorker('production', 'a'.repeat(32), async () => { throw new Error('Credential requires CLOUDFLARE_D1_API_TOKEN: D1: Edit'); }, absent), /Credential requires/);
  await assert.rejects(provisionWorker('production', 'a'.repeat(32), present, async () => { throw new Error('bucket missing'); }), /bucket missing/);
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('not-yet command exits zero and publishes ready=false and a plain job summary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'backup-not-yet-'));
  try {
    const env = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'existing', GITHUB_OUTPUT: join(directory, 'output'), GITHUB_STEP_SUMMARY: join(directory, 'summary') };
    const code = `import { runProvision } from ${JSON.stringify(new URL('../provision-worker.mjs', import.meta.url).href)};
      await runProvision('production', ${JSON.stringify(env)}, async (url, options) => {
        if (!url.includes('/d1/database?') || options.method !== 'GET' || options.headers.authorization !== 'Bearer existing') throw new Error('Unexpected resource mutation');
        return new Response(JSON.stringify({ success: true, result: [] }));
      });`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { cwd: directory, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'ready=false\n');
    assert.match(child.stdout, /^Backups not deployed yet: .* does not exist in production\. They start after the database is created\.\n$/);
    assert.equal(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), child.stdout);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('existing resources publish ready=true and the unchanged exact config', () => {
  const directory = mkdtempSync(join(tmpdir(), 'backup-ready-'));
  try {
    mkdirSync(join(directory, 'workers/backup'), { recursive: true }); mkdirSync(join(directory, 'payload'));
    const env = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'existing', CLOUDFLARE_D1_API_TOKEN: 'd1', GITHUB_OUTPUT: join(directory, 'output'), GITHUB_STEP_SUMMARY: join(directory, 'summary') };
    const source = '11111111-2222-4333-8444-555555555555', scratch = '66666666-7777-4888-9999-aaaaaaaaaaaa';
    const list = [{ name: REPO === 'run' ? 'run-auth' : 'identity', uuid: source }, { name: `restore-test-${REPO}`, uuid: scratch }];
    const code = `import { runProvision } from ${JSON.stringify(new URL('../provision-worker.mjs', import.meta.url).href)};
      await runProvision('production', ${JSON.stringify(env)}, async (url, options) => {
        if (options.method !== 'GET') throw new Error('Unexpected mutation');
        if (url.endsWith('/r2/buckets/run-files')) return new Response('', { status: 404 });
        const result = url.includes('/d1/database?') ? ${JSON.stringify(list)} : url.endsWith('/managed') ? { enabled: false } : url.endsWith('/custom') ? { domains: [] } : url.endsWith('/lifecycle') ? ${JSON.stringify(LIFECYCLE)} : {};
        return new Response(JSON.stringify({ success: true, result }));
      });`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { cwd: directory, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'ready=true\n');
    const file = REPO === 'run' ? 'workers/backup/wrangler.deploy.json' : 'payload/backup-wrangler.json';
    assert.deepEqual(JSON.parse(readFileSync(join(directory, file), 'utf8')), workerConfig('production', source, scratch, env.CLOUDFLARE_ACCOUNT_ID));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('includes run-data in each environment when it exists, without creating source databases', async () => {
  if (REPO !== 'run') return;
  const auth = '11111111-2222-4333-8444-555555555555', data = '22222222-2222-4333-8444-555555555555', scratch = '66666666-7777-4888-9999-aaaaaaaaaaaa';
  for (const environment of ['production', 'staging']) {
    const suffix = environment === 'staging' ? '-staging' : '';
    const d1 = async (_path, method = 'GET') => { assert.equal(method, 'GET'); return { result: [{ name: `run-auth${suffix}`, uuid: auth }, { name: `run-data${suffix}`, uuid: data }, { name: `restore-test-run${suffix}`, uuid: scratch }] }; };
    const r2 = async path => /^r2\/buckets\/run-files(?:-staging)?$/.test(path) ? null : ({ result: path.endsWith('/managed') ? { enabled: false } : path.endsWith('/custom') ? { domains: [] } : {} });
    const config = await provisionWorker(environment, 'a'.repeat(32), d1, r2);
    assert.equal(checkBackupConfig(config, environment), true);
    assert.deepEqual(config.d1_databases.map(d => [d.binding, d.database_name, d.database_id]), [['SOURCE', `run-auth${suffix}`, auth], ['SOURCE_DATA', `run-data${suffix}`, data], ['SCRATCH', `restore-test-run${suffix}`, scratch]]);
    assert.throws(() => workerConfig(environment, { SOURCE: auth, SOURCE_DATA: data }, data), /differ/);
  }
});

test('files source is optional, read from the matching environment and never provisioned here', async () => {
  const auth = '11111111-2222-4333-8444-555555555555', scratch = '66666666-7777-4888-9999-aaaaaaaaaaaa';
  for (const environment of ['production', 'staging']) {
    const suffix = environment === 'staging' ? '-staging' : '';
    const d1 = async () => ({ result: [{ name: `run-auth${suffix}`, uuid: auth }, { name: `restore-test-run${suffix}`, uuid: scratch }] });
    const r2 = async (path, method = 'GET', _body, missing) => {
      assert.equal(method, 'GET');
      if (path === `r2/buckets/run-files${suffix}`) { assert.equal(missing, true); return { result: { name: `run-files${suffix}` } }; }
      return { result: path.endsWith('/managed') ? { enabled: false } : { domains: [] } };
    };
    const config = await provisionWorker(environment, 'a'.repeat(32), d1, r2);
    assert.deepEqual(config.r2_buckets, [{ binding: 'BACKUPS', bucket_name: 'synthetos-db-backups' }, { binding: 'SOURCE_FILES', bucket_name: `run-files${suffix}` }]);
    assert.ok(checkBackupConfig(config));
    const wrong = structuredClone(config); wrong.r2_buckets[1].bucket_name = `run-files${suffix ? '' : '-staging'}`;
    assert.equal(checkBackupConfig(wrong), false);
  }
});
