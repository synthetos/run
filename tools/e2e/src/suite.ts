/**
 * The Playwright configuration the suites share (ROADMAP P0-04, P0-06,
 * P0-14, P1-00): the main suite (`*.e2e.ts`, playwright.config.ts), the
 * fake-serial suite (`*.fake-serial.ts`, playwright.fake-serial.config.ts)
 * and the staging headers suite (`*.staging.ts`,
 * playwright.staging.config.ts).
 *
 * Each suite runs only in its own served modes (src/served.ts): the main
 * suite never runs against the fake-serial test build, and the fake-serial
 * suite never runs against anything else. A mismatch is refused when the
 * configuration loads, before any server starts.
 */
import { defineConfig, type PlaywrightTestConfig, type ReporterDescription } from '@playwright/test';
import { servedMode, shellQuote, wranglerArgs, type ServedMode, type WorkerEnvironment } from './served.ts';

export interface SuiteOptions {
  readonly name: string;
  readonly port: number;
  readonly testMatch: string;
  readonly modes: readonly ServedMode['kind'][];
  /** The deployment wrangler dev stands in for (default production; the staging suite, P1-00). */
  readonly environment?: WorkerEnvironment;
}

export function suiteConfig(options: SuiteOptions, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): PlaywrightTestConfig {
  const mode = servedMode(env, cwd);
  if (!options.modes.includes(mode.kind)) {
    throw new Error(`e2e: the ${options.name} suite runs only in ${options.modes.join(' or ')} mode, not ${mode.kind} (src/served.ts)`);
  }
  const jsonReport = env['RUN_E2E_REPORT'];
  const reporter: ReporterDescription[] = jsonReport === undefined ? [['list']] : [['list'], ['json', { outputFile: jsonReport }]];
  return defineConfig({
    testDir: './specs',
    testMatch: options.testMatch,
    globalSetup: './global-setup.ts',
    forbidOnly: true,
    retries: 0,
    workers: 1,
    reporter,
    use: {
      baseURL: `http://127.0.0.1:${options.port}`,
      browserName: 'chromium',
      // The default service-worker and bypass settings: the page's own CSP applies.
      bypassCSP: false,
    },
    webServer: {
      command: ['node', ...wranglerArgs(mode, options.port, options.environment ?? 'production')].map(shellQuote).join(' '),
      url: `http://127.0.0.1:${options.port}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { WRANGLER_SEND_METRICS: 'false', CI: '1' },
    },
  });
}
