/**
 * The localhost bench build suite (P1-00): `*.bench.ts` specs against the
 * loopback bench server (tools/gates/src/bench) serving apps/web/dist-bench.
 * LOCAL ONLY: `pnpm e2e:bench` from the repository root builds both
 * artifacts, checks the bench one, then runs this. CI never builds or serves
 * the bench build (ci-policy `bench-never-in-ci`); its CI evidence is
 * tools/gates/test/bench-acceptance.test.ts and bench-server.test.ts.
 * Same origin guard as every suite.
 */
import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { REPO_ROOT, shellQuote } from './src/served.ts';

const PORT = 8794;

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.bench.ts',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, browserName: 'chromium', bypassCSP: false },
  webServer: {
    command: ['node', join(REPO_ROOT, 'tools/gates/src/bench/cli.ts'), '--port', String(PORT), join(REPO_ROOT, 'apps/web/dist-bench')].map(shellQuote).join(' '),
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
