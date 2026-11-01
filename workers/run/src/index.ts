/**
 * The run Worker (ROADMAP P0-04, RUN_PLAN §5.2, §6.3, §6.4).
 *
 * Cloudflare serves the static shell directly from the asset layer, and the
 * Worker runs first only for `/api/*` and `/auth/*` (wrangler.jsonc). Every
 * response the Worker returns goes through `withSecurityHeaders`, including
 * errors and any asset request that reaches it.
 *
 * Routes live in routes.ts. This module exports only the handler: the
 * Workers runtime treats every named export of the main module as an
 * entrypoint.
 *
 * This Worker holds no machine logic and is never trusted for safety. It may
 * import only `contracts` (and `auth-core` later) (RUN_PLAN §5.3,
 * dependency-cruiser `worker-imports-only-contracts`). The network is never
 * in the motion or stop path (SAFETY §4.10).
 */
import { withSecurityHeaders } from './headers.ts';
import { type Env, json, route } from './routes.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch {
      // An unexpected error still gets the security headers and no detail.
      response = json(500, { error: 'internal_error' });
    }
    return withSecurityHeaders(response);
  },
};
