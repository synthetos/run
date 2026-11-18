/**
 * What a deploy job does when the post-deploy smoke test fails (P0 review;
 * SAFETY H45; OD-40). A failed smoke test must not leave the deployment live:
 * `wrangler rollback` to the previous version, in both environments (the
 * header or content regression the smoke test found came with this deploy).
 *
 * Until OD-40 staging was deleted instead, because older code could not
 * restore a removed Cloudflare Access application (D31). Staging is public
 * now and gated by the same code as production, so the same undo applies,
 * and the Worker's secrets survive a failed deploy.
 *
 * The deploy job runs `rollback-cli.ts <env>` only after a successful deploy
 * step whose smoke check failed (rule `deploy-rollback` in ci-policy): a
 * rollback after a failed deploy would revert the healthy previous version.
 * Dependency-free.
 */
import { DEPLOY_CONFIG_PATH, type DeployEnvironment } from './wranglerConfig.ts';

/** The deployment configuration the preflight wrote (never the checkout's wrangler.jsonc, P0-04 review). */
export const WRANGLER_CONFIG = DEPLOY_CONFIG_PATH;

/** The wrangler argument vectors to run, in order; the first that succeeds ends the plan. */
export function rollbackPlan(env: DeployEnvironment): readonly (readonly string[])[] {
  const scope = env === 'staging' ? ['--env', 'staging'] : [];
  return [['rollback', '--config', WRANGLER_CONFIG, ...scope, '--yes', '--message', 'post-deploy smoke test failed']];
}
