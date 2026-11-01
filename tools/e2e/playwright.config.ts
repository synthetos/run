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
 * The fake-serial test build has its own suite and configuration
 * (playwright.fake-serial.config.ts); this one refuses to run against it.
 */
import { suiteConfig } from './src/suite.ts';

export default suiteConfig({ name: 'main', port: 8790, testMatch: '**/*.e2e.ts', modes: ['source', 'artifact'] });
