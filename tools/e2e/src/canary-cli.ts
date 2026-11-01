/**
 * Runs the third-party canary (see canary.ts):
 *
 *   RUN_E2E_SITE=<site> RUN_E2E_WORKER=<worker> node tools/e2e/src/canary-cli.ts
 *
 * Copies the artifact's site tree to a fresh temporary directory (the
 * artifact itself is never modified), plants the INJECTIONS, runs the whole
 * Playwright suite against the copy with the artifact's Worker, and judges
 * the result. Exit status: 0 the suite failed and the origin guard named
 * every planted URL; 1 it did not (the job must fail); 2 the canary could
 * not run.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INJECTIONS, inject, judgeCanary, type JsonReport } from './canary.ts';
import { REPO_ROOT, SITE_ENV, WORKER_ENV, servedMode } from './served.ts';

function main(): number {
  const mode = servedMode(process.env, process.cwd());
  if (mode.kind !== 'artifact') {
    process.stderr.write(`canary: needs artifact mode (${SITE_ENV} and ${WORKER_ENV}); run pnpm e2e:artifact or the CI e2e job\n`);
    return 2;
  }
  const scratch = mkdtempSync(join(process.env['RUNNER_TEMP'] ?? tmpdir(), 'run-canary-'));
  const site = join(scratch, 'site');
  cpSync(mode.siteDir, site, { recursive: true, verbatimSymlinks: true });
  for (const injection of INJECTIONS) {
    const file = join(site, injection.page);
    writeFileSync(file, inject(readFileSync(file, 'utf8'), injection));
    process.stdout.write(`canary: planted ${injection.marker} in ${injection.page}\n`);
  }

  const report = join(scratch, 'report.json');
  const cli = createRequire(join(REPO_ROOT, 'tools/e2e/package.json')).resolve('@playwright/test/cli');
  const run = spawnSync(process.execPath, [cli, 'test'], {
    cwd: join(REPO_ROOT, 'tools/e2e'),
    stdio: 'inherit',
    env: { ...process.env, [SITE_ENV]: site, [WORKER_ENV]: mode.workerDir, RUN_E2E_REPORT: report },
  });
  if (run.error !== undefined) throw run.error;
  if (!existsSync(report)) {
    process.stderr.write(`canary: Playwright wrote no report (exit ${String(run.status)}); the canary did not run\n`);
    return 1;
  }
  const verdict = judgeCanary(run.status, JSON.parse(readFileSync(report, 'utf8')) as JsonReport, INJECTIONS.map((i) => i.marker));
  if (!verdict.ok) {
    process.stderr.write('canary: FAILED. A third-party URL in a built page must fail the e2e suite through the origin guard:\n');
    for (const problem of verdict.problems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write(`canary: the planted site and the report are kept in ${scratch}\n`);
    return 1;
  }
  rmSync(scratch, { recursive: true, force: true });
  process.stdout.write(`canary: ok. The suite failed as it must, and the origin guard reported all ${INJECTIONS.length} planted URLs.\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`canary: could not run: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
