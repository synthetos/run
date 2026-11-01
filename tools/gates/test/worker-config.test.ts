/**
 * workers/run/wrangler.jsonc and the deploy preflight (ROADMAP P0-04,
 * RUN_PLAN §5.2, §6.3, SAFETY H45, D34).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNT_ID_PLACEHOLDER, checkWorkerConfig, parseJsonc, stripJsonc } from '../src/deploy/wranglerConfig.ts';
import { REPO_ROOT } from './scratch.ts';

const CONFIG_PATH = join(REPO_ROOT, 'workers/run/wrangler.jsonc');
const TEXT = readFileSync(CONFIG_PATH, 'utf8');
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

describe('the committed wrangler.jsonc', () => {
  it('passes every check (the account id may still be the D34 placeholder in the repository)', () => {
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
      run_worker_first: ['/api/*', '/auth/*'],
    });
    expect(c['routes']).toEqual([{ pattern: 'run.synthetos.com', custom_domain: true }]);
    expect(c.env.staging['routes']).toEqual([{ pattern: 'staging.run.synthetos.com', custom_domain: true }]);
    expect(c.env.staging['workers_dev']).toBe(false);
    expect(c.env.staging['preview_urls']).toBe(false);
  });

  it('is refused for deploy while the account id is the placeholder', () => {
    expect(load()['account_id']).toBe(ACCOUNT_ID_PLACEHOLDER);
    expect(checkWorkerConfig(load(), { requireRealAccount: true }).map((f) => f.where)).toEqual(['account_id']);
  });
});

describe('checkWorkerConfig refuses each H45/D34 weakening', () => {
  const cases: [string, (c: Config) => void, string][] = [
    ['workers_dev true', (c) => (c['workers_dev'] = true), '.'],
    ['workers_dev omitted', (c) => delete c['workers_dev'], '.'],
    ['preview_urls true', (c) => (c['preview_urls'] = true), '.'],
    ['staging workers_dev true', (c) => (c.env.staging['workers_dev'] = true), 'env.staging'],
    ['staging preview_urls omitted', (c) => delete c.env.staging['preview_urls'], 'env.staging'],
    ['run_worker_first for everything', (c) => ((c['assets'] as Record<string, unknown>)['run_worker_first'] = true), 'assets'],
    ['an SPA fallback instead of the 404 page', (c) => ((c['assets'] as Record<string, unknown>)['not_found_handling'] = 'single-page-application'), 'assets'],
    ['a second production route', (c) => (c['routes'] = [{ pattern: 'run.synthetos.com', custom_domain: true }, { pattern: 'x.synthetos.com/*', zone_name: 'synthetos.com' }]), '.'],
    ['a non-custom-domain route', (c) => (c['routes'] = [{ pattern: 'run.synthetos.com/*', zone_name: 'synthetos.com' }]), '.'],
    ['staging on the production host', (c) => (c.env.staging['routes'] = [{ pattern: 'run.synthetos.com', custom_domain: true }]), 'env.staging'],
    ['staging overriding the account', (c) => (c.env.staging['account_id'] = REAL_ACCOUNT), 'env.staging.account_id'],
    ['staging overriding the assets', (c) => (c.env.staging['assets'] = c['assets']), 'env.staging.assets'],
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
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    delete childEnv['CLOUDFLARE_ACCOUNT_ID'];
    if (accountEnv !== undefined) childEnv['CLOUDFLARE_ACCOUNT_ID'] = accountEnv;
    const r = spawnSync(process.execPath, [join(REPO_ROOT, 'tools/gates/src/deploy/preflight.ts'), file, env], { encoding: 'utf8', env: childEnv });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }
  const withAccount = TEXT.replace(ACCOUNT_ID_PLACEHOLDER, REAL_ACCOUNT);

  it('refuses the committed config: the D34 account does not exist yet', () => {
    const r = preflight(TEXT, 'production', REAL_ACCOUNT);
    expect(r.status).toBe(1);
    expect(r.output).toContain('placeholder');
  });

  it('accepts a real account id that matches CLOUDFLARE_ACCOUNT_ID, for both environments', () => {
    expect(preflight(withAccount, 'production', REAL_ACCOUNT).status).toBe(0);
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
