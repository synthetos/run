/**
 * The deployment configuration the secret-bearing deploy job hands to
 * wrangler (P0-04 HIGH: custom builds under --no-bundle).
 *
 * wrangler runs a configured `build.command` even with `--no-bundle`, in the
 * job that holds CLOUDFLARE_API_TOKEN, before it uploads the attested Worker.
 * So:
 * - checkWorkerConfig refuses `build` in every scope, and every key outside a
 *   reviewed allowlist (a positive list, so the next wrangler key that runs
 *   or loads code is refused before anyone has heard of it);
 * - the deploy preflight writes the configuration wrangler is given
 *   (`--write`), rebuilt from the allowlisted keys of the checked file, and
 *   the deploy and undo steps use only that file;
 * - with the pinned wrangler, the checkout configuration with a build command
 *   does run it under --no-bundle (the defect), and the written deployment
 *   configuration never can (the preflight refuses to write one).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ACCOUNT_ID_PLACEHOLDER,
  checkWorkerConfig,
  DEPLOY_CONFIG_PATH,
  deployConfig,
  parseJsonc,
  RUN_AUTH_DATABASES,
  STAGING_KEYS,
  TOP_LEVEL_KEYS,
} from '../src/deploy/wranglerConfig.ts';
import { rollbackPlan } from '../src/deploy/rollback.ts';
import { REPO_ROOT } from './scratch.ts';

const COMMITTED = readFileSync(join(REPO_ROOT, 'workers/run/wrangler.jsonc'), 'utf8');
const REAL_ACCOUNT = '0123456789abcdef0123456789abcdef';
// The RUN_AUTH database ids are real here (A1-07: the preflight refuses the placeholder of the environment it deploys;
// worker-config.test.ts covers that refusal), so these tests keep testing the deployment configuration itself.
const TEXT = COMMITTED.replace(/"account_id": "[^"]*"/, `"account_id": "${ACCOUNT_ID_PLACEHOLDER}"`)
  .replace(RUN_AUTH_DATABASES.production.placeholder, '11111111-2222-4333-8444-555555555555')
  .replace(RUN_AUTH_DATABASES.staging.placeholder, '66666666-7777-4888-9999-aaaaaaaaaaaa');
type Config = Record<string, unknown> & { env: { staging: Record<string, unknown> } };
const load = (): Config => parseJsonc(TEXT) as Config;
const OPTIONS = { requireRealAccount: false };

const base = mkdtempSync(join(tmpdir(), 'run-deploy-config-'));
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});
let counter = 0;
const freshDir = (): string => {
  counter += 1;
  const dir = join(base, `d${counter}`);
  mkdirSync(dir);
  return dir;
};

describe('checkWorkerConfig refuses a custom build in every scope', () => {
  // The reviewer's reproduction: build.command at the root and in env.staging both returned [].
  it.each([
    ['the top level', (c: Config) => (c['build'] = { command: 'node harmless-review-marker.cjs' }), 'build'],
    ['env.staging', (c: Config) => (c.env.staging['build'] = { command: 'node harmless-review-marker.cjs' }), 'env.staging.build'],
    ['the top level, empty', (c: Config) => (c['build'] = {}), 'build'],
    ['env.staging, null', (c: Config) => (c.env.staging['build'] = null), 'env.staging.build'],
  ])('%s', (_label, mutate, where) => {
    const c = load();
    mutate(c);
    const findings = checkWorkerConfig(c, OPTIONS);
    expect(findings.map((f) => f.where)).toContain(where);
    expect(findings.find((f) => f.where === where)?.message).toMatch(/build/);
  });
});

describe('checkWorkerConfig accepts only the reviewed keys', () => {
  it('the committed file uses only allowlisted keys and passes', () => {
    const c = load();
    expect(Object.keys(c).filter((k) => !TOP_LEVEL_KEYS.includes(k))).toEqual([]);
    expect(Object.keys(c.env.staging).filter((k) => !STAGING_KEYS.includes(k))).toEqual([]);
    expect(checkWorkerConfig(c, OPTIONS)).toEqual([]);
  });

  it.each(['alias', 'define', 'tsconfig', 'node_compat', 'wasm_modules', 'text_blobs', 'data_blobs', 'upload_source_maps', 'no_bundle', 'minify', 'base_dir', 'unknown_future_key'])(
    "refuses '%s' at the top level and in env.staging",
    (key) => {
      const top = load();
      top[key] = {};
      expect(checkWorkerConfig(top, OPTIONS).map((f) => f.where)).toContain(key);
      const staging = load();
      staging.env.staging[key] = {};
      expect(checkWorkerConfig(staging, OPTIONS).map((f) => f.where)).toContain(`env.staging.${key}`);
    },
  );

  it.each([
    ['main', (c: Config) => (c['main'] = 'evil.mjs')],
    ['compatibility_date', (c: Config) => (c['compatibility_date'] = 'today')],
    ['find_additional_modules', (c: Config) => (c['find_additional_modules'] = false)],
    ['rules', (c: Config) => (c['rules'] = [{ type: 'ESModule', globs: ['**/*.js'] }])],
    ['vars', (c: Config) => (c['vars'] = { RUN_ENV: 'production', EXTRA: 'x' })],
  ])('pins the value of %s', (where, mutate) => {
    const c = load();
    mutate(c);
    expect(checkWorkerConfig(c, OPTIONS).map((f) => f.where)).toContain(where);
  });

  it('refuses keys in staging that only the top level may hold', () => {
    const c = load();
    c.env.staging['compatibility_date'] = '2026-10-01';
    expect(checkWorkerConfig(c, OPTIONS).map((f) => f.where)).toContain('env.staging.compatibility_date');
  });
});

describe('deployConfig: the configuration wrangler is given', () => {
  it('holds only allowlisted keys, with the values of the checked file', () => {
    const c = load();
    c['account_id'] = REAL_ACCOUNT;
    const out = deployConfig(c, { requireRealAccount: true });
    expect(Object.keys(out).every((k) => TOP_LEVEL_KEYS.includes(k))).toBe(true);
    expect(out).not.toHaveProperty('build');
    expect(out).not.toHaveProperty('$schema');
    const staging = (out['env'] as { staging: Record<string, unknown> }).staging;
    expect(Object.keys(staging).every((k) => STAGING_KEYS.includes(k))).toBe(true);
    expect(checkWorkerConfig(out, { requireRealAccount: true })).toEqual([]);
    for (const key of ['name', 'main', 'compatibility_date', 'find_additional_modules', 'rules', 'account_id', 'workers_dev', 'preview_urls', 'assets', 'routes', 'vars']) {
      expect(out[key]).toEqual(c[key]);
    }
    expect(staging).toEqual(c.env.staging);
  });

  it('refuses to produce anything from a configuration with a build command', () => {
    const c = load();
    c.env.staging['build'] = { command: 'node marker.cjs' };
    expect(() => deployConfig(c, OPTIONS)).toThrow(/build/);
  });

  it('the deploy and undo steps use that file, never the checkout configuration', () => {
    expect(DEPLOY_CONFIG_PATH).toBe('workers/run/wrangler.deploy.json');
    for (const env of ['staging', 'production'] as const) {
      for (const args of rollbackPlan(env)) {
        expect(args[args.indexOf('--config') + 1]).toBe(DEPLOY_CONFIG_PATH);
      }
    }
  });

  it('is never committed (the preflight creates it in the deploy job, and refuses to overwrite one)', () => {
    const tracked = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--', DEPLOY_CONFIG_PATH], { encoding: 'utf8' });
    expect(tracked).toBe('');
  });
});

function preflight(configText: string, env: string, extra: (dir: string) => string[], cwd?: (dir: string) => string, authReady = true): { status: number | null; output: string; dir: string } {
  const dir = freshDir();
  const file = join(dir, 'wrangler.jsonc');
  writeFileSync(file, configText);
  const childEnv: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: join(dir, 'outputs'), RUN_AUTH_MIGRATIONS_READY: authReady ? 'true' : 'false', CLOUDFLARE_ACCOUNT_ID: REAL_ACCOUNT };
  const r = spawnSync(process.execPath, [join(REPO_ROOT, 'tools/gates/src/deploy/preflight.ts'), file, env, ...extra(dir)], {
    encoding: 'utf8',
    env: childEnv,
    ...(cwd === undefined ? {} : { cwd: cwd(dir) }),
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}`, dir };
}

describe('preflight --write', () => {
  const withAccount = TEXT.replace(ACCOUNT_ID_PLACEHOLDER, REAL_ACCOUNT);
  const withBuild = withAccount.replace('"vars": { "RUN_ENV": "staging" }', '"vars": { "RUN_ENV": "staging" },\n      "build": { "command": "node marker.cjs" }');

  it('placeholder or missing migration credential deploys with both auth bindings removed, never a placeholder sent to wrangler', () => {
    // The committed staging id is real now (owner created run-auth-staging); the placeholder case is built here.
    const placeholder = withAccount.replace(/"database_id": "[0-9a-f-]{36}"/, '"database_id": "RUN_AUTH_STAGING_DATABASE_ID_PLACEHOLDER"');
    for (const [text, ready] of [[placeholder, true], [withAccount, false]] as const) {
      const r = preflight(text, 'staging', dir => ['--write', join(dir, 'wrangler.deploy.json')], undefined, ready);
      expect(r.status, r.output).toBe(0);
      const written = JSON.parse(readFileSync(join(r.dir, 'wrangler.deploy.json'), 'utf8')) as Config;
      expect(written.env.staging).not.toHaveProperty('services');
      expect(written.env.staging).not.toHaveProperty('d1_databases');
      expect(r.output).toContain('run sign-in: off');
      expect(readFileSync(join(r.dir, 'outputs'), 'utf8')).toBe('run_auth=false\n');
    }
    const r = preflight(withAccount, 'staging', dir => ['--write', join(dir, 'wrangler.deploy.json')]);
    expect(r.status).toBe(0);
    const written = JSON.parse(readFileSync(join(r.dir, 'wrangler.deploy.json'), 'utf8')) as Config;
    expect(written.env.staging['d1_databases']).toHaveLength(1);
    expect(r.output).toContain('migration required');
    expect(readFileSync(join(r.dir, 'outputs'), 'utf8')).toBe('run_auth=true\n');
  });

  it('writes the allowlisted deployment configuration when the checked file is accepted', () => {
    const r = preflight(withAccount, 'staging', (dir) => ['--write', join(dir, 'wrangler.deploy.json')]);
    expect(r.status, r.output).toBe(0);
    const written = JSON.parse(readFileSync(join(r.dir, 'wrangler.deploy.json'), 'utf8')) as Record<string, unknown>;
    expect(written).toEqual(deployConfig(parseJsonc(withAccount), { requireRealAccount: true }));
  });

  it('refuses a configuration with a build command and writes nothing', () => {
    expect(withBuild).not.toBe(withAccount);
    const r = preflight(withBuild, 'staging', (dir) => ['--write', join(dir, 'wrangler.deploy.json')]);
    expect(r.status).toBe(1);
    expect(r.output).toContain('env.staging.build');
    expect(existsSync(join(r.dir, 'wrangler.deploy.json'))).toBe(false);
  });

  it('refuses to overwrite an existing file (a committed or planted deployment configuration)', () => {
    const r = preflight(withAccount, 'staging', (dir) => {
      writeFileSync(join(dir, 'wrangler.deploy.json'), JSON.stringify({ build: { command: 'node marker.cjs' } }));
      return ['--write', join(dir, 'wrangler.deploy.json')];
    });
    expect(r.status).toBe(2);
    expect(readFileSync(join(r.dir, 'wrangler.deploy.json'), 'utf8')).toContain('marker');
  });

  // wrangler loads .env, .env.local, .env.<env> and .env.<env>.local from its working directory into
  // its own process environment, whatever --config says. A committed .env.staging holding
  // CLOUDFLARE_API_BASE_URL sends the deploy token to that host (reproduced with the pinned 4.149.0
  // against a local listener). The preflight runs in the same directory as the wrangler steps.
  for (const name of ['.env', '.env.local', '.env.staging', '.env.staging.local', '.env.production']) {
    it(`refuses to write a deployment configuration while ${name} exists in the working directory`, () => {
      const r = preflight(
        withAccount,
        'staging',
        (dir) => ['--write', join(dir, 'wrangler.deploy.json')],
        (dir) => {
          writeFileSync(join(dir, name), 'CLOUDFLARE_API_BASE_URL=https://example.invalid/client/v4\n');
          return dir;
        },
      );
      expect(r.status, r.output).toBe(1);
      expect(r.output).toContain(name);
      expect(existsSync(join(r.dir, 'wrangler.deploy.json'))).toBe(false);
    });
  }

  it('accepts the same configuration in a working directory without dotenv files', () => {
    const r = preflight(withAccount, 'staging', (dir) => ['--write', join(dir, 'wrangler.deploy.json')], (dir) => dir);
    expect(r.status, r.output).toBe(0);
  });

  it('requires --write: a preflight that produces no deployment configuration is a usage error', () => {
    expect(preflight(withAccount, 'staging', () => []).status).toBe(2);
  });
});

describe('the pinned wrangler (dry run, no account)', () => {
  const wrangler = join(REPO_ROOT, 'workers/run/node_modules/wrangler/bin/wrangler.js');

  function dryRun(dir: string, config: string): { status: number | null; output: string } {
    mkdirSync(join(dir, 'worker'), { recursive: true });
    mkdirSync(join(dir, 'site'), { recursive: true });
    writeFileSync(join(dir, 'worker/index.mjs'), 'export default { fetch() { return new Response("x"); } };\n');
    writeFileSync(join(dir, 'site/index.html'), '<!doctype html>');
    const r = spawnSync(
      process.execPath,
      [wrangler, 'deploy', 'worker/index.mjs', '--no-bundle', '--config', config, '--env', 'staging', '--assets', 'site', '--dry-run', '--outdir', join(dir, 'out')],
      { encoding: 'utf8', cwd: dir, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', CLOUDFLARE_API_TOKEN: '' } },
    );
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }

  const marker = (dir: string): string => join(dir, 'build-ran');
  // wrangler runs the command in the directory of the configuration file (here the test directory).
  const buildCommand = (): string => `node -e "require('node:fs').writeFileSync('build-ran', 'yes')"`;

  it('the defect: a build command in the checkout configuration runs despite --no-bundle', { timeout: 60_000 }, () => {
    const dir = freshDir();
    const c = load();
    c.env.staging['build'] = { command: buildCommand() };
    writeFileSync(join(dir, 'wrangler.json'), JSON.stringify(c));
    const r = dryRun(dir, 'wrangler.json');
    expect(r.status, r.output).toBe(0);
    expect(existsSync(marker(dir)), r.output).toBe(true);
  });

  it('the defect: wrangler loads .env.<env> from its working directory even with an explicit --config', { timeout: 60_000 }, () => {
    const dir = freshDir();
    const out = join(dir, 'dotenv-loaded.json');
    // WRANGLER_OUTPUT_FILE_PATH is harmless and observable without a network: wrangler writes its
    // session record there. CLOUDFLARE_API_BASE_URL would be read the same way.
    writeFileSync(join(dir, '.env.staging'), `WRANGLER_OUTPUT_FILE_PATH=${out}\n`);
    writeFileSync(join(dir, 'wrangler.json'), JSON.stringify({ ...load(), account_id: REAL_ACCOUNT }));
    const r = dryRun(dir, 'wrangler.json');
    expect(r.status, r.output).toBe(0);
    expect(existsSync(out), r.output).toBe(true);
  });

  it('the fix: the preflight writes no deployment configuration from it, and the written one runs no build', { timeout: 60_000 }, () => {
    const dir = freshDir();
    const c = load();
    c['account_id'] = REAL_ACCOUNT;
    c.env.staging['build'] = { command: buildCommand() };
    const refused = preflight(JSON.stringify(c), 'staging', () => ['--write', join(dir, 'wrangler.deploy.json')]);
    expect(refused.status).toBe(1);
    expect(existsSync(join(dir, 'wrangler.deploy.json'))).toBe(false);

    // The clean file: the written configuration deploys the attested entry and runs nothing.
    delete c.env.staging['build'];
    const ok = preflight(JSON.stringify(c), 'staging', () => ['--write', join(dir, 'wrangler.deploy.json')]);
    expect(ok.status, ok.output).toBe(0);
    const r = dryRun(dir, 'wrangler.deploy.json');
    expect(r.status, r.output).toBe(0);
    expect(r.output).not.toContain('[custom build]');
    expect(r.output).toContain('env.RUN_ENV ("staging")');
    expect(existsSync(marker(dir))).toBe(false);
  });
});
