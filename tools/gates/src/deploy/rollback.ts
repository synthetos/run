/**
 * What a deploy job does when the post-deploy smoke test fails (P0 review;
 * SAFETY H45, D31). A failed smoke test must not leave the deployment live:
 *
 * - staging: the Worker is DELETED (its custom domain goes with it). A
 *   staging host that fails the smoke test may be serving bench builds with
 *   `serial=(self)` without Access in front; rolling back the code would not
 *   restore a removed Access application, so the only fail-closed answer is
 *   to take the origin down. The next deploy recreates it once fixed.
 * - production: `wrangler rollback` to the previous version (the header or
 *   content regression the smoke test found came with this deploy).
 *
 * The deploy job runs `rollback-cli.ts <env>` only when the deploy step
 * succeeded and a later step failed (`artifact-digest`'s sibling rule
 * `deploy-rollback` in ci-policy). Dependency-free.
 */
import type { DeployEnvironment } from './wranglerConfig.ts';

export const WRANGLER_CONFIG = 'workers/run/wrangler.jsonc';

/** The wrangler argument vectors to run, in order; the first that succeeds ends the plan. */
export function rollbackPlan(env: DeployEnvironment): readonly (readonly string[])[] {
  if (env === 'staging') return [['delete', '--config', WRANGLER_CONFIG, '--env', 'staging']];
  return [['rollback', '--config', WRANGLER_CONFIG, '--yes', '--message', 'post-deploy smoke test failed']];
}
