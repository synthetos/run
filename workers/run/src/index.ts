/**
 * The run Worker. Empty in P0-01: every request gets 404. P0-04 adds the
 * wrangler configuration, static assets, /api/health and the security
 * headers of RUN_PLAN §6.4. This Worker holds no machine logic and may import
 * only `contracts` (and `auth-core` later) (RUN_PLAN §5.3).
 */

export const VERSION = '0.0.0';

export default {
  fetch(_request: Request): Response {
    return new Response('Not found\n', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  },
};
