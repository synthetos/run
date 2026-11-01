/**
 * Playwright against `wrangler dev` (ROADMAP P0-04 acceptance: "wrangler dev
 * serves the shell with the exact headers. A Playwright header test passes.
 * Adding an inline <script> to a built page produces a CSP violation in the
 * test.").
 *
 * wrangler dev runs the Worker from workers/run/src and serves the built
 * apps/web/dist through the same asset layer (and the same `_headers` file)
 * as production. P0-06 adds the CI job, against the attested artifact.
 */
import { defineConfig } from '@playwright/test';

const PORT = 8790;
const WRANGLER = '../../workers/run/node_modules/wrangler/bin/wrangler.js';

export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.e2e.ts',
  globalSetup: './global-setup.ts',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    // The default service-worker and bypass settings: the page's own CSP applies.
    bypassCSP: false,
  },
  webServer: {
    command: `node ${WRANGLER} dev --config ../../workers/run/wrangler.jsonc --port ${PORT} --ip 127.0.0.1 --show-interactive-dev-session=false`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { WRANGLER_SEND_METRICS: 'false', CI: '1' },
  },
});
