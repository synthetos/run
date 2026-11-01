/**
 * @synthetos/contracts
 *
 * API types and valibot schemas shared by the web app and the run Worker. Depends only on valibot.
 *
 * Runtime dependencies are limited to `valibot` (RUN_PLAN §5.3).
 */

/** Package version. Kept equal to package.json `version` by the smoke test. */
export const VERSION = '0.0.0';

/**
 * `GET /api/identity` (ROADMAP P1-05, RUN_PLAN §2.2). Who the run Worker
 * verified the caller to be, for the D1 sign-in gate in the web app's UI
 * layer. Until A1-07 the only provider is the verified Cloudflare Access
 * identity, on staging only; production answers `identity: null` until the
 * accounts session exists. Never consulted by the machine path.
 */
export type IdentityProvider = 'access' | 'run-session';

export interface IdentityBody {
  readonly identity: { readonly provider: IdentityProvider; readonly subject: string } | null;
  /** Why there is no identity, for the refusal text (absent when there is one). */
  readonly reason?: 'not-signed-in' | 'not-available-here' | 'not-configured';
}
