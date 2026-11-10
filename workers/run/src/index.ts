/**
 * The run Worker (ROADMAP P0-04, RUN_PLAN §5.2, §6.3, §6.4).
 *
 * The Worker runs first for every path, in production (OD-29) as on staging
 * (P1-00), so that it can grant Web Serial to the documents of its own host:
 * `serial=(self)` only when `grantsSerial` holds (RUN_ENV and host match:
 * staging on staging.run.synthetos.com, production on run.synthetos.com),
 * the fail-closed set in every other case. Every response the Worker returns
 * goes through `withSecurityHeaders`, including errors and any asset request
 * that reaches it.
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
import { grantsSerial, securityHeadersFor, withSecurityHeaders } from './headers.ts';
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
    // Decided from the configuration and the request alone, after routing, so an error response gets the same set.
    let serialGranted = false;
    try {
      serialGranted = grantsSerial(env.RUN_ENV, new URL(request.url));
    } catch {
      serialGranted = false;
    }
    return withSecurityHeaders(response, securityHeadersFor(serialGranted));
  },
};
