/**
 * `pnpm e2e:artifact`: the CI `e2e` job, locally (ROADMAP P0-06).
 *
 * After `pnpm build` (the root script runs it first), this assembles an
 * artifact the way the `build` job does, in a fresh temporary directory:
 * the site tree (a copy of apps/web/dist) and the Worker modules (built by
 * tools/gates/src/build/worker-cli.ts), each with a sha256 manifest that is
 * then verified, exactly as the e2e job verifies the downloaded artifact.
 * Then it runs the suite in artifact mode, which must pass, and the
 * third-party canary, which must see the suite fail.
 *
 * The only difference from CI is the transport: CI moves the trees as tar
 * files between jobs; here they are copied.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT, SITE_ENV, WORKER_ENV } from './served.ts';

function step(label: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env, cwd = REPO_ROOT): void {
  process.stdout.write(`\ne2e:artifact: ${label}\n`);
  const run = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0) throw new Error(`${label} failed (exit ${String(run.status)})`);
}

function main(): void {
  const scratch = mkdtempSync(join(tmpdir(), 'run-e2e-artifact-'));
  const site = join(scratch, 'site');
  const worker = join(scratch, 'worker');
  const repro = join(REPO_ROOT, 'tools/gates/src/repro/cli.ts');

  step('build the Worker modules', [join(REPO_ROOT, 'tools/gates/src/build/worker-cli.ts'), join(REPO_ROOT, 'workers/run/src'), worker]);
  cpSync(join(REPO_ROOT, 'apps/web/dist'), site, { recursive: true, verbatimSymlinks: true });
  step('manifest the site tree', [repro, 'manifest', join(REPO_ROOT, 'apps/web/dist'), join(scratch, 'run-web.sha256')]);
  step('verify the copied site tree against its manifest', [repro, 'verify', site, join(scratch, 'run-web.sha256')]);
  step('manifest the Worker', [repro, 'manifest', worker, join(scratch, 'run-worker.sha256')]);
  step('verify the Worker against its manifest', [repro, 'verify', worker, join(scratch, 'run-worker.sha256')]);

  const env = { ...process.env, [SITE_ENV]: site, [WORKER_ENV]: worker };
  const cli = createRequire(join(REPO_ROOT, 'tools/e2e/package.json')).resolve('@playwright/test/cli');
  step('Playwright against wrangler dev serving the artifact (must pass)', [cli, 'test'], env, join(REPO_ROOT, 'tools/e2e'));
  step('staging headers suite against the same artifact (must pass, P1-00)', [cli, 'test', '-c', 'playwright.staging.config.ts'], env, join(REPO_ROOT, 'tools/e2e'));
  step('third-party canary (the suite must fail through the origin guard)', [join(REPO_ROOT, 'tools/e2e/src/canary-cli.ts')], env);
  process.stdout.write(`\ne2e:artifact: ok (artifact in ${scratch})\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`e2e:artifact: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
