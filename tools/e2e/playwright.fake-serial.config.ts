/**
 * The fake-serial suite (ROADMAP P0-14, docs/testing/fake-serial.md):
 * `*.fake-serial.ts` specs against `wrangler dev` serving the TEST-ONLY
 * build apps/web/dist-fake-serial, whose `machine.worker` gets a mock port.
 * Runs only with RUN_E2E_FAKE_SERIAL=1 (`pnpm e2e:fake-serial` from the
 * root, or the CI `e2e-fake-serial` job). Same origin guard, same headers
 * and same asset layer as the main suite.
 */
import { suiteConfig } from './src/suite.ts';

export default suiteConfig({ name: 'fake-serial', port: 8791, testMatch: '**/*.fake-serial.ts', modes: ['fake-serial'] });
