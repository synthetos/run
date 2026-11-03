/**
 * The fake-serial suite (ROADMAP P0-14, docs/testing/fake-serial.md):
 * `*.fake-serial.ts` specs against `wrangler dev` serving the TEST-ONLY
 * build apps/web/dist-fake-serial, whose `machine.worker` gets a mock port.
 * Runs only with RUN_E2E_FAKE_SERIAL=1 (`pnpm e2e:fake-serial` from the
 * root, or the CI `e2e-fake-serial` job). Same origin guard, same headers
 * and same asset layer as the main suite.
 */
import { suiteConfig } from './src/suite.ts';

// Parallel worktrees need separate servers; never reuse another checkout's artifact.
const port = Number(process.env['RUN_E2E_PORT'] ?? 8791);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('RUN_E2E_PORT must be an integer between 1024 and 65535');
export default suiteConfig({ name: 'fake-serial', port, testMatch: '**/*.fake-serial.ts', modes: ['fake-serial'] });
