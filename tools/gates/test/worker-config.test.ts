/**
 * workers/run/wrangler.jsonc and the deploy preflight (ROADMAP P0-04,
 * RUN_PLAN §5.2, §6.3, SAFETY H45, D39 (which supersedes D34)).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNT_ID_PLACEHOLDER, checkWorkerConfig, EXPECTED_SERVICES, parseJsonc, RUN_AUTH_DATABASES, stripJsonc } from '../src/deploy/wranglerConfig.ts';
import { REPO_ROOT } from './scratch.ts';

const CONFIG_PATH = join(REPO_ROOT, 'workers/run/wrangler.jsonc');
const COMMITTED = readFileSync(CONFIG_PATH, 'utf8');
// The committed file carries the placeholder until the owner fills in the
// current account's id (D39, docs/ops/account.md §2 step 9). The tests below run on the
// committed text with the account id put back to the placeholder, so they keep
// testing the same rules after that one-line change.
const ACCOUNT_LINE = /"account_id": "[^"]*"/;
const TEXT = COMMITTED.replace(ACCOUNT_LINE, `"account_id": "${ACCOUNT_ID_PLACEHOLDER}"`);
type Config = Record<string, unknown> & { env: { staging: Record<string, unknown> } };
const load = (): Config => parseJsonc(TEXT) as Config;
const REAL_ACCOUNT = '0123456789abcdef0123456789abcdef';

describe('stripJsonc', () => {
  it('removes line and block comments and trailing commas, but never inside strings', () => {
    const text = '{\n // c\n "a": "x // not a comment", /* b */ "u": "http://e/*x*/",\n "l": [1, 2,],\n}';
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: 'x // not a comment', u: 'http://e/*x*/', l: [1, 2] });
  });

  it('keeps escaped quotes inside strings', () => {
    expect(JSON.parse(stripJsonc('{"a": "q\\" // still string"}'))).toEqual({ a: 'q" // still string' });
  });

  it('throws on an unterminated comment or string', () => {
    expect(() => stripJsonc('{ /* x ')).toThrow(/unterminated/);
    expect(() => stripJsonc('{ "x ')).toThrow(/unterminated/);
  });
});

describe('A1-06: the sign-in bindings', () => {
  it('staging binds exactly accounts\' RunEntrypoint and its RUN_AUTH database; production binds nothing yet (sign-in off)', () => {
    const c = load();
    expect(c.env.staging['services']).toEqual(EXPECTED_SERVICES.staging);
    expect((c.env.staging['d1_databases'] as { database_name: string }[])[0]?.database_name).toBe('run-auth-staging');
    expect('services' in c).toBe(false);
    expect('d1_databases' in c).toBe(false);
  });

  it('with either key present, both must be exact: another service or entrypoint, one key alone, a second database or a bad id is refused', () => {
    const mutate = (fn: (c: Config) => void): string[] => {
      const c = load();
      fn(c);
      return checkWorkerConfig(c, { requireRealAccount: false }).map((f) => `${f.where}: ${f.message}`);
    };
    const prodDb = { binding: 'RUN_AUTH', database_name: 'run-auth', database_id: RUN_AUTH_DATABASES.production.placeholder, migrations_dir: 'migrations' };
    expect(mutate((c) => {
      c['services'] = EXPECTED_SERVICES.production;
      c['d1_databases'] = [prodDb];
    })).toEqual([]);
    expect(mutate((c) => (c['services'] = EXPECTED_SERVICES.production)).join()).toContain('RUN_AUTH');
    expect(mutate((c) => (c['d1_databases'] = [prodDb])).join()).toContain('services');
    expect(mutate((c) => (c.env.staging['services'] = [{ binding: 'ACCOUNTS', service: 'accounts-staging', entrypoint: 'Default' }])).join()).toContain('services');
    expect(mutate((c) => (c.env.staging['services'] = EXPECTED_SERVICES.production)).join()).toContain('env.staging');
    expect(mutate((c) => (c.env.staging['services'] = [...EXPECTED_SERVICES.staging, { binding: 'FORUM', service: 'forumbot' }])).join()).toContain('services');
    expect(mutate((c) => delete c.env.staging['d1_databases']).join()).toContain('RUN_AUTH');
    expect(mutate((c) => ((c.env.staging['d1_databases'] as Record<string, unknown>[])[0] = { binding: 'RUN_AUTH', database_name: 'run-auth-staging', database_id: 'nope', migrations_dir: 'migrations' })).join()).toContain('lower-case UUID');
    expect(mutate((c) => (c.env.staging['d1_databases'] = [...(c.env.staging['d1_databases'] as unknown[]), { binding: 'OTHER' }])).join()).toContain('exactly one');
    // Neither key in staging either: sign-in off there, accepted.
    expect(mutate((c) => {
      delete c.env.staging['services'];
      delete c.env.staging['d1_databases'];
    })).toEqual([]);
  });
});

describe('the committed wrangler.jsonc', () => {
  it('passes every check (the account id may still be the placeholder in the repository)', () => {
    expect(checkWorkerConfig(load(), { requireRealAccount: false })).toEqual([]);
  });

  it('has the ROADMAP P0-04 settings, literally', () => {
    const c = load();
    expect(c['name']).toBe('run');
    expect(c['workers_dev']).toBe(false);
    expect(c['preview_urls']).toBe(false);
    expect(c['assets']).toEqual({
      directory: '../../apps/web/dist',
      binding: 'ASSETS',
      html_handling: 'auto-trailing-slash',
      not_found_handling: '404-page',
      // OD-29: the Worker runs first for every path in production too (it grants serial on run.synthetos.com).
      run_worker_first: true,
    });
    expect(c['routes']).toEqual([{ pattern: 'run.synthetos.com', custom_domain: true }]);
    expect(c.env.staging['routes']).toEqual([{ pattern: 'staging.run.synthetos.com', custom_domain: true }]);
    expect(c.env.staging['workers_dev']).toBe(false);
    expect(c.env.staging['preview_urls']).toBe(false);
  });

  it('P1-00, OD-29: staging (and production) run the Worker first for every path (it grants serial=(self) on its own host)', () => {
    expect(load().env.staging['assets']).toEqual({
      directory: '../../apps/web/dist',
      binding: 'ASSETS',
      html_handling: 'auto-trailing-slash',
      not_found_handling: '404-page',
      run_worker_first: true,
    });
  });

  it('is refused for deploy while the account id is the placeholder', () => {
    expect(load()['account_id']).toBe(ACCOUNT_ID_PLACEHOLDER);
    expect(checkWorkerConfig(load(), { requireRealAccount: true }).map((f) => f.where)).toEqual(['account_id']);
  });

  it('commits exactly one top-level account_id: the placeholder or a Cloudflare account id', () => {
    expect(COMMITTED.match(new RegExp(ACCOUNT_LINE.source, 'g'))).toHaveLength(1);
    const committed = (parseJsonc(COMMITTED) as Config)['account_id'];
    expect(committed === ACCOUNT_ID_PLACEHOLDER || /^[0-9a-f]{32}$/.test(String(committed))).toBe(true);
    // Apart from that one value, the committed file is the text tested above.
    expect(COMMITTED.replace(ACCOUNT_LINE, '')).toBe(TEXT.replace(ACCOUNT_LINE, ''));
  });
});

describe('checkWorkerConfig refuses each H45/D39 weakening', () => {
  const cases: [string, (c: Config) => void, string][] = [
    ['workers_dev true', (c) => (c['workers_dev'] = true), '.'],
    ['workers_dev omitted', (c) => delete c['workers_dev'], '.'],
    ['preview_urls true', (c) => (c['preview_urls'] = true), '.'],
    ['staging workers_dev true', (c) => (c.env.staging['workers_dev'] = true), 'env.staging'],
    ['staging preview_urls omitted', (c) => delete c.env.staging['preview_urls'], 'env.staging'],
    ['run_worker_first back to /api and /auth only (the Worker would not set the documents\' headers)', (c) => ((c['assets'] as Record<string, unknown>)['run_worker_first'] = ['/api/*', '/auth/*']), 'assets'],
    ['an SPA fallback instead of the 404 page', (c) => ((c['assets'] as Record<string, unknown>)['not_found_handling'] = 'single-page-application'), 'assets'],
    ['a second production route', (c) => (c['routes'] = [{ pattern: 'run.synthetos.com', custom_domain: true }, { pattern: 'x.synthetos.com/*', zone_name: 'synthetos.com' }]), '.'],
    ['a non-custom-domain route', (c) => (c['routes'] = [{ pattern: 'run.synthetos.com/*', zone_name: 'synthetos.com' }]), '.'],
    ['staging on the production host', (c) => (c.env.staging['routes'] = [{ pattern: 'run.synthetos.com', custom_domain: true }]), 'env.staging'],
    ['staging overriding the account', (c) => (c.env.staging['account_id'] = REAL_ACCOUNT), 'env.staging.account_id'],
    ['staging with the Worker first for /api and /auth only (it would not grant serial on documents)', (c) => (c.env.staging['assets'] = { ...(c['assets'] as object), run_worker_first: ['/api/*', '/auth/*'] }), 'env.staging.assets'],
    ['staging without assets settings', (c) => delete c.env.staging['assets'], 'env.staging.assets'],
    ['staging assets on another directory', (c) => ((c.env.staging['assets'] as Record<string, unknown>)['directory'] = '../../apps/web/dist-bench'), 'env.staging.assets'],
    ['staging with an SPA fallback', (c) => ((c.env.staging['assets'] as Record<string, unknown>)['not_found_handling'] = 'single-page-application'), 'env.staging.assets'],
    ['an extra environment', (c) => ((c.env as Record<string, unknown>)['preview'] = {}), 'env.preview'],
    ['an unsafe block', (c) => (c['unsafe'] = {}), '.'],
    ['a wrong RUN_ENV', (c) => (c['vars'] = { RUN_ENV: 'staging' }), '.'],
    ['a malformed account id', (c) => (c['account_id'] = 'ABC'), 'account_id'],
    ['a renamed Worker', (c) => (c['name'] = 'run2'), 'name'],
  ];
  it.each(cases)('%s', (_label, mutate, where) => {
    const c = load();
    mutate(c);
    expect(checkWorkerConfig(c, { requireRealAccount: false }).map((f) => f.where)).toContain(where);
  });
});

describe('preflight CLI', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function preflight(configText: string, env: string, accountEnv: string | undefined): { status: number | null; output: string } {
    const dir = mkdtempSync(join(tmpdir(), 'run-preflight-'));
    dirs.push(dir);
    const file = join(dir, 'wrangler.jsonc');
    writeFileSync(file, configText);
    const childEnv: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: join(dir, 'outputs') };
    delete childEnv['CLOUDFLARE_ACCOUNT_ID'];
    if (accountEnv !== undefined) childEnv['CLOUDFLARE_ACCOUNT_ID'] = accountEnv;
    // The deploy jobs always pass --write (deploy-config.test.ts covers what it writes).
    const r = spawnSync(process.execPath, [join(REPO_ROOT, 'tools/gates/src/deploy/preflight.ts'), file, env, '--write', join(dir, 'wrangler.deploy.json')], { encoding: 'utf8', env: childEnv });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }
  const PROD_DB = '11111111-2222-4333-8444-555555555555';
  const STAGING_DB = '66666666-7777-4888-9999-aaaaaaaaaaaa';
  const accountOnly = TEXT.replace(ACCOUNT_ID_PLACEHOLDER, REAL_ACCOUNT);
  const withAccount = accountOnly.replace(RUN_AUTH_DATABASES.production.placeholder, PROD_DB).replace(RUN_AUTH_DATABASES.staging.placeholder, STAGING_DB);

  it('A1-07 (review M1): production stays blocked pending data provisioning; staging deploys sign-in off with a placeholder', () => {
    expect(preflight(accountOnly, 'production', REAL_ACCOUNT).status).toBe(1);
    const staging = preflight(accountOnly, 'staging', REAL_ACCOUNT);
    expect(staging.status).toBe(0);
    expect(preflight(accountOnly.replace(RUN_AUTH_DATABASES.staging.placeholder, STAGING_DB), 'staging', REAL_ACCOUNT).status).toBe(0);
  });

  it('A1-07: once production carries the bindings, its deploy needs the real database id', () => {
    const bound = accountOnly.replace(
      '"routes": [{ "pattern": "run.synthetos.com", "custom_domain": true }],',
      `"routes": [{ "pattern": "run.synthetos.com", "custom_domain": true }], "services": ${JSON.stringify(EXPECTED_SERVICES.production)}, "d1_databases": [{ "binding": "RUN_AUTH", "database_name": "run-auth", "database_id": "${RUN_AUTH_DATABASES.production.placeholder}", "migrations_dir": "migrations" }],`,
    );
    expect(bound).not.toBe(accountOnly);
    const refused = preflight(bound, 'production', REAL_ACCOUNT);
    expect(refused.status).toBe(1);
    expect(preflight(bound.replace(RUN_AUTH_DATABASES.production.placeholder, PROD_DB), 'production', REAL_ACCOUNT).status).toBe(1);
  });

  it('refuses the config while it carries the placeholder', () => {
    const r = preflight(TEXT, 'production', REAL_ACCOUNT);
    expect(r.status).toBe(1);
    expect(r.output).toContain('placeholder');
    expect(r.output).toContain('D39');
  });

  it('refuses the superseded D34 placeholder too (it is not an account id)', () => {
    const r = preflight(TEXT.replace(ACCOUNT_ID_PLACEHOLDER, 'D34_RUN_ACCOUNT_ID_PLACEHOLDER'), 'production', REAL_ACCOUNT);
    expect(r.status).toBe(1);
    expect(r.output).toContain('account_id');
  });

  it('accepts a real account id that matches CLOUDFLARE_ACCOUNT_ID, for both environments', () => {
    expect(preflight(withAccount, 'production', REAL_ACCOUNT).status).toBe(1);
    expect(preflight(withAccount, 'staging', REAL_ACCOUNT).status).toBe(0);
  });

  it('refuses when the job names a different account, or none', () => {
    expect(preflight(withAccount, 'production', 'ffffffffffffffffffffffffffffffff').output).toContain('differs');
    expect(preflight(withAccount, 'production', undefined).status).toBe(1);
  });

  it('refuses a config that enables preview URLs, even with the right account', () => {
    const r = preflight(withAccount.replace(/"preview_urls": false/, '"preview_urls": true'), 'production', REAL_ACCOUNT);
    expect(r.status).toBe(1);
    expect(r.output).toContain('preview_urls');
  });

  it('exits 2 on bad usage', () => {
    expect(preflight(withAccount, 'preview', REAL_ACCOUNT).status).toBe(2);
  });
});
