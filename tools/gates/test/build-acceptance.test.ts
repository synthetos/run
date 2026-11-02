/**
 * ROADMAP P0-03 acceptance on the real build: each case copies the working
 * tree, changes one thing, builds the web app with the repository's Vite
 * config and runs the real gate CLI.
 *
 * - "Two clean builds produce identical hashes (the check fails on an
 *   injected timestamp)."
 * - "The bundle scan fails on an origin literal or network identifier
 *   outside apps/web/src/cloud."
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScratchRepo } from './scratch.ts';

const TIMEOUT = 180_000;
const scratches: ScratchRepo[] = [];

function fresh(): ScratchRepo {
  const repo = ScratchRepo.create();
  scratches.push(repo);
  return repo;
}

afterEach(() => {
  for (const s of scratches.splice(0)) s.dispose();
});

function built(repo: ScratchRepo): void {
  const result = repo.buildWeb();
  expect(result.status, result.output).toBe(0);
}

const CLOUD_CLIENT = "export async function health(): Promise<number> {\n  const r = await fetch('/api/health');\n  return r.status;\n}\n";
const USE_CLOUD = "\nimport { health } from '../cloud/client.ts';\nvoid health().then((s) => { root.dataset['api'] = String(s); });\n";

describe('reproducible build', () => {
  it('two clean builds in different directories are byte-identical', { timeout: TIMEOUT }, () => {
    const a = fresh();
    const b = fresh();
    built(a);
    built(b);
    const result = a.gate('tools/gates/src/repro/cli.ts', ['compare', join(a.root, 'apps/web/dist'), join(b.root, 'apps/web/dist')]);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/files identical, tree sha256 [0-9a-f]{64}/);
  });

  it('fails when the build injects a timestamp', { timeout: TIMEOUT }, () => {
    const a = fresh();
    const b = fresh();
    for (const repo of [a, b]) {
      // A build-time value that differs between runs, the classic way a
      // timestamp leaks into a bundle.
      const config = repo.read('apps/web/vite.config.ts');
      const patched = config.replace(
        'define: { __RUN_BUILD__: JSON.stringify(build) },',
        'define: { __RUN_BUILD__: JSON.stringify(build), __BUILD_TIME__: JSON.stringify(new Date().toISOString() + process.hrtime.bigint().toString()) },',
      );
      expect(patched).not.toBe(config);
      repo.write('apps/web/vite.config.ts', patched);
      repo.append('apps/web/src/entries/workspace.ts', 'declare const __BUILD_TIME__: string;\nroot.dataset["built"] = __BUILD_TIME__;\n');
    }
    built(a);
    built(b);
    const result = a.gate('tools/gates/src/repro/cli.ts', ['compare', join(a.root, 'apps/web/dist'), join(b.root, 'apps/web/dist')]);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('the two builds differ');
  });

  it('verify accepts an intact tree and refuses a changed, missing or added file', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    built(repo);
    const dist = join(repo.root, 'apps/web/dist');
    const manifest = join(repo.base, 'run-web.sha256');
    expect(repo.gate('tools/gates/src/repro/cli.ts', ['manifest', dist, manifest]).status).toBe(0);
    expect(repo.gate('tools/gates/src/repro/cli.ts', ['verify', dist, manifest]).status).toBe(0);

    repo.append('apps/web/dist/index.html', '<!-- tampered -->');
    const changed = repo.gate('tools/gates/src/repro/cli.ts', ['verify', dist, manifest]);
    expect(changed.status).toBe(1);
    expect(changed.output).toContain('changed     index.html');

    repo.write('apps/web/dist/extra.js', 'x');
    expect(repo.gate('tools/gates/src/repro/cli.ts', ['verify', dist, manifest]).output).toContain('unexpected  extra.js');
  });
});

describe('production build only', () => {
  it('refuses to build under a non-production NODE_ENV (a development bundle embeds file paths)', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    const result = repo.buildWeb('test');
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('refusing to build with NODE_ENV=test');
  });

  it('builds with NODE_ENV=production', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    const result = repo.buildWeb('production');
    expect(result.status, result.output).toBe(0);
  });
});

describe('bundle scan on the real build', () => {
  it('passes the clean build', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    built(repo);
    const result = repo.scan();
    expect(result.status, result.output).toBe(0);
  });

  it('a network identifier outside apps/web/src/cloud fails the scan', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('apps/web/src/workspace/AppShell.ts', "\nexport const ping = (): Promise<Response> => fetch('/api/health');\n");
    repo.append('apps/web/src/entries/workspace.ts', "\nimport { ping } from '../workspace/AppShell.ts';\nvoid ping();\n");
    built(repo);
    const result = repo.scan();
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('network-identifier');
  });

  it('an origin literal outside apps/web/src/cloud fails the scan', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.append('apps/web/src/entries/workspace.ts', "\nroot.dataset['help'] = 'https://forum.example.com/help';\n");
    built(repo);
    const result = repo.scan();
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('origin-literal');
  });

  it('cloud-client code lands under assets/cloud/ and its fetch passes', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/cloud/client.ts', CLOUD_CLIENT);
    repo.append('apps/web/src/entries/workspace.ts', USE_CLOUD);
    built(repo);
    const cloudDir = join(repo.root, 'apps/web/dist/assets/cloud');
    expect(existsSync(cloudDir)).toBe(true);
    expect(readdirSync(cloudDir).some((f) => f.endsWith('.js'))).toBe(true);
    const result = repo.scan();
    expect(result.status, result.output).toBe(0);
  });

  it('a non-cloud module named cloud is not filed as cloud, so its fetch fails', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/shell/cloud.ts', "export const sneak = (): Promise<Response> => fetch('/x');\n");
    repo.append('apps/web/src/entries/workspace.ts', "\nvoid import('../shell/cloud.ts');\n");
    built(repo);
    const result = repo.scan();
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/network-identifier\s+assets\/cloud-[^/]+\.js/);
  });

  it('a third-party origin inside the cloud client still fails', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    repo.write('apps/web/src/cloud/client.ts', `${CLOUD_CLIENT}export const elsewhere = 'https://api.example.com';\n`);
    repo.append('apps/web/src/entries/workspace.ts', `${USE_CLOUD}import { elsewhere } from '../cloud/client.ts';\nroot.dataset['e'] = elsewhere;\n`);
    built(repo);
    const result = repo.scan();
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/origin-literal\s+assets\/cloud\//);
  });
});

describe('verify fails on a failing test', () => {
  it('the unit-test command exits non-zero when one test fails', { timeout: TIMEOUT }, () => {
    const repo = fresh();
    const vitest = 'node_modules/vitest/vitest.mjs';
    const clean = repo.gate(vitest, ['run', '--root', 'packages/safety']);
    expect(clean.status, clean.output).toBe(0);
    repo.write(
      'packages/safety/test/regression.test.ts',
      "import { expect, it } from 'vitest';\nit('a safety regression', () => { expect(1 + 1).toBe(3); });\n",
    );
    const failing = repo.gate(vitest, ['run', '--root', 'packages/safety']);
    expect(failing.status, failing.output).toBe(1);
    expect(failing.output).toContain('a safety regression');
  });
});
