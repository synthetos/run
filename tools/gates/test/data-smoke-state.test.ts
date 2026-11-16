import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { deployConfig, parseJsonc } from '../src/deploy/wranglerConfig.ts';
import { checkStorage } from '../src/smoke/storage.ts';
import { checkWorkflow } from '../src/workflow/policy.ts';
import { SECURITY_HEADERS } from '../../../workers/run/src/headers.ts';
import { REPO_ROOT } from './scratch.ts';

const id = '11111111-2222-4333-8444-555555555555';
const source = readFileSync(join(REPO_ROOT, 'workers/run/wrangler.jsonc'), 'utf8');
const response = (status: number) => ({ url: 'https://run.synthetos.com/api/records/tool', status, body: '{}', headers: new Headers({ ...SECURITY_HEADERS, 'cache-control': 'no-store' }) });

it.each([
  ['true', 401, true], ['true', 503, false], ['false', 503, true], ['false', 401, false],
] as const)('storage expectation %s requires exact response %s (passes=%s)', (enabled, status, passes) => {
  expect(checkStorage(response(status), enabled).length === 0).toBe(passes);
});
it.each([undefined, '', 'yes'])('refuses a missing or malformed smoke expectation %s', enabled => {
  expect(checkStorage(response(503), enabled)).toContainEqual(expect.objectContaining({ message: expect.stringContaining('RUN_STORAGE_ENABLED') }));
});
it('rejects ready production with only the ACCOUNTS service', () => {
  const config = parseJsonc(source.replace('RUN_AUTH_DATABASE_ID_PLACEHOLDER', id)) as Record<string, unknown>;
  config['services'] = [{ binding: 'ACCOUNTS', service: 'accounts', entrypoint: 'RunEntrypoint' }];
  expect(() => deployConfig(config, { requireRealAccount: true, authReady: true, dataReady: true })).toThrow('RUN_DATA');
});

it.each([
  [true, true, true, true], [true, true, false, false],
  [false, true, true, false], [true, false, true, false],
] as const)('preflight effective storage: realAuth=%s authReady=%s dataReady=%s yields %s', (realAuth, authReady, dataReady, enabled) => {
  const base = join(REPO_ROOT, 'node_modules/.cache'); mkdirSync(base, { recursive: true });
  const cwd = mkdtempSync(join(base, 'storage-smoke-'));
  const config = parseJsonc(realAuth ? source.replace('RUN_AUTH_DATABASE_ID_PLACEHOLDER', id) : source) as Record<string, unknown>;
  try {
    writeFileSync(join(cwd, 'source.json'), JSON.stringify(config));
    const run = spawnSync(process.execPath, [join(REPO_ROOT, 'tools/gates/src/deploy/preflight.ts'), 'source.json', 'production', '--write', 'deploy.json'], {
      cwd, encoding: 'utf8', env: { PATH: process.env['PATH'], CLOUDFLARE_ACCOUNT_ID: String(config['account_id']), RUN_AUTH_MIGRATIONS_READY: String(authReady), RUN_DATA_READY: String(dataReady), GITHUB_OUTPUT: join(cwd, 'output') },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(join(cwd, 'output'), 'utf8')).toContain(`run_data=${enabled}\n`);
    const prepared = JSON.parse(readFileSync(join(cwd, 'deploy.json'), 'utf8')) as { services?: { binding: string }[] };
    expect(prepared.services?.some(s => s.binding === 'RUN_DATA') ?? false).toBe(enabled);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
it.each(['', '          RUN_STORAGE_ENABLED: true\n', '          RUN_STORAGE_ENABLED: ${{ steps.data_config.outputs.ready }}\n'])('policy rejects production smoke disconnected from effective bindings: %s', replacement => {
  const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
  const changed = ci.replace('          RUN_STORAGE_ENABLED: ${{ steps.config.outputs.run_data }}\n', replacement);
  expect(checkWorkflow('ci.yml', changed)).toContainEqual(expect.objectContaining({ rule: 'smoke-credentials' }));
});
