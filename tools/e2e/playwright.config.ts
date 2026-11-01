/**
 * Playwright against `wrangler dev` (ROADMAP P0-04, P0-06).
 *
 * - `pnpm e2e` (source mode): wrangler dev bundles workers/run/src and serves
 *   the freshly built apps/web/dist.
 * - `pnpm e2e:artifact` and the CI `e2e` job (artifact mode, RUN_E2E_SITE and
 *   RUN_E2E_WORKER set): wrangler dev serves the attested artifact, the
 *   Worker modules with --no-bundle and the site tree as built, through the
 *   same wrangler.jsonc as the deploy jobs. See src/served.ts.
 *
 * Both serve through the same asset layer (and the same `_headers` file) as
 * production. Every test runs under the origin guard (specs/fixtures.ts).
 * RUN_E2E_REPORT=<file> adds a JSON report (the canary reads it).
 */
import { defineConfig, type ReporterDescription } from '@playwright/test';
import { servedMode, shellQuote, wranglerArgs } from './src/served.ts';

const PORT = 8790;
const mode = servedMode(process.env, process.cwd());
const jsonReport = process.env['RUN_E2E_REPORT'];
const reporter: ReporterDescription[] = jsonReport === undefined ? [['list']] : [['list'], ['json', { outputFile: jsonReport }]];

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.e2e.ts',
  globalSetup: './global-setup.ts',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    // The default service-worker and bypass settings: the page's own CSP applies.
    bypassCSP: false,
  },
  webServer: {
    command: ['node', ...wranglerArgs(mode, PORT)].map(shellQuote).join(' '),
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { WRANGLER_SEND_METRICS: 'false', CI: '1' },
  },
});
