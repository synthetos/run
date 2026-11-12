/**
 * The Worker script in the attested artifact (ROADMAP P0-04; closes the
 * P0-03 hand-off "the deploy job deploys only attested bytes").
 *
 * - The builder erases types and rewrites local imports, and refuses
 *   anything it cannot build faithfully (npm, parent or dynamic imports).
 * - The built modules behave like the source (same handler, same headers).
 * - Two builds are byte-identical.
 * - wrangler, given the built entry with --no-bundle and the repository
 *   config, attaches every module (a dry run, no account needed).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildModule, buildWorker, WorkerBuildError } from '../src/build/worker.ts';
import { renderHeadersFile, SECURITY_HEADERS } from '../../../workers/run/src/headers.ts';
import { REPO_ROOT } from './scratch.ts';

const base = mkdtempSync(join(tmpdir(), 'run-worker-build-'));
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function buildCli(out: string): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, [join(REPO_ROOT, 'tools/gates/src/build/worker-cli.ts'), join(REPO_ROOT, 'workers/run/src'), out], { encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

describe('buildModule', () => {
  const names = new Set(['index.ts', 'headers.ts']);

  it('erases types and rewrites ./x.ts to ./x.mjs', () => {
    const out = buildModule(
      { name: 'index.ts', source: "import { a, type B } from './headers.ts';\nexport const f = (x: B): number => a(x);\n" },
      names,
    );
    expect(out.name).toBe('index.mjs');
    expect(out.code).toContain("from './headers.mjs'");
    expect(out.code).not.toMatch(/: B|: number|type B/);
  });

  it.each([
    ["import { x } from 'valibot';", /not a local/],
    ["import { x } from '../../packages/contracts/src/index.ts';", /not a local/],
    ["import './side-effect.js';", /not a local/],
    ["import { x } from './missing.ts';", /does not exist/],
    ["const m = await import('./headers.ts');", /dynamic import/],
    ["const m = require('./headers.ts');", /require/],
  ])('refuses %s', (source, message) => {
    expect(() => buildModule({ name: 'index.ts', source }, names)).toThrow(message);
  });

  it('refuses syntax that type stripping cannot erase (an enum)', () => {
    expect(() => buildModule({ name: 'index.ts', source: 'enum E { A }\n' }, names)).toThrow(WorkerBuildError);
  });

  it('refuses a build without index.ts', () => {
    expect(() => buildWorker([{ name: 'headers.ts', source: 'export const a = 1;\n' }])).toThrow(/entry/);
  });
});

describe('the real Worker build', () => {
  const outA = join(base, 'a');
  const outB = join(base, 'b');

  it('builds every source module, deterministically', () => {
    expect(buildCli(outA).status).toBe(0);
    expect(buildCli(outB).status).toBe(0);
    const files = readdirSync(outA).filter(n => n.endsWith('.mjs')).sort();
    expect(files).toEqual(readdirSync(join(REPO_ROOT, 'workers/run/src')).map((n) => n.replace(/\.ts$/, '.mjs')).sort());
    for (const f of files) expect(readFileSync(join(outA, f))).toEqual(readFileSync(join(outB, f)));
  });

  it('refuses to write into an existing directory', () => {
    const r = buildCli(outA);
    expect(r.status).toBe(2);
    expect(r.output).toContain('already exists');
  });

  it('behaves like the source: health, 404s and headers on every response', async () => {
    const mod = (await import(pathToFileURL(join(outA, 'index.mjs')).href)) as {
      default: { fetch(r: Request, e: unknown): Promise<Response> };
    };
    const env = { RUN_ENV: 'staging', ASSETS: { fetch: () => Promise.resolve(new Response('asset')) } };
    const health = await mod.default.fetch(new Request('https://run.synthetos.com/api/health'), env);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', service: 'run', env: 'staging' });
    const catalog = await mod.default.fetch(new Request('https://run.synthetos.com/api/catalog/tools'), env);
    expect(catalog.status).toBe(200);
    expect((await catalog.json() as { tools: unknown[] }).tools).toHaveLength(30);
    expect(catalog.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
    const missing = await mod.default.fetch(new Request('https://run.synthetos.com/auth/login'), env);
    expect(missing.status).toBe(404);
    for (const res of [health, missing]) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
    }
  });

  it('wrangler deploy --no-bundle --dry-run attaches every built module (staging and production)', { timeout: 60_000 }, () => {
    const site = join(base, 'site');
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, 'index.html'), '<!doctype html><div id="app"></div>');
    writeFileSync(join(site, '_headers'), renderHeadersFile());
    const wrangler = join(REPO_ROOT, 'workers/run/node_modules/wrangler/bin/wrangler.js');
    expect(existsSync(wrangler)).toBe(true);
    for (const envArgs of [['--env', 'staging'], []]) {
      const outdir = join(base, `dry-${envArgs.length}`);
      const r = spawnSync(
        process.execPath,
        [wrangler, 'deploy', join(outA, 'index.mjs'), '--no-bundle', '--config', join(REPO_ROOT, 'workers/run/wrangler.jsonc'), ...envArgs, '--assets', site, '--dry-run', '--outdir', outdir],
        { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, cwd: base },
      );
      const output = `${r.stdout}${r.stderr}`;
      expect(r.status, output).toBe(0);
      expect(readdirSync(outdir).filter((f) => f.endsWith('.mjs')).sort()).toEqual(readdirSync(outA).filter(n => n.endsWith('.mjs')).sort());
      expect(output).toContain(envArgs.length > 0 ? 'env.RUN_ENV ("staging")' : 'env.RUN_ENV ("production")');
    }
  });
});

it('the data Worker artifact includes every schema dependency beside its entry, reproducibly', () => {
  const a = join(base, 'data-check-a'); const b = join(base, 'data-check-b');
  expect(buildCli(a).status).toBe(0); expect(buildCli(b).status).toBe(0);
  const files = readdirSync(join(a,'data')).sort();
  expect(files).toContain('index.mjs'); expect(files).toContain('packages_library_src_validate.mjs'); expect(files).toContain('packages_schema_src_jsonSchema.mjs');
  for (const file of files) expect(readFileSync(join(a,'data',file),'utf8')).toBe(readFileSync(join(b,'data',file),'utf8'));
  for (const file of files) {
    const code = readFileSync(join(a,'data',file),'utf8');
    for (const match of code.matchAll(/from ['"]\.\/([^'"]+)['"]/g)) expect(files).toContain(match[1]);
  }
});
