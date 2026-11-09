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
 * layer: the run session (accounts.synthetos.com, A1-06/A1-07) where sign-in
 * is on, and the verified Cloudflare Access identity on staging. Never
 * consulted by the machine path.
 */
export type IdentityProvider = 'access' | 'run-session';

export interface IdentityBody {
  /**
   * `subject` is the stable key (the accounts `sub` for a run session). `display` is for "Signed in as …" only
   * (the GitHub login for a run session; display-only, never used to decide anything).
   */
  readonly identity: { readonly provider: IdentityProvider; readonly subject: string; readonly display?: string } | null;
  /** Why there is no identity, for the refusal text (absent when there is one). */
  readonly reason?: 'not-signed-in' | 'not-available-here' | 'not-configured';
  /**
   * A1-07: true when this host offers sign-in with a Synthetos account (`/auth/login`). Who may sign in is decided
   * by accounts (D37), so true does not mean this visitor will be admitted.
   */
  readonly signIn?: boolean;
}

/**
 * `GET /api/session` (A1-06, A1-07): the page's account panel. Always 200, so a signed-out visitor's page load logs
 * no error. `account` is the run session's account or null; `display` is display-only ("@login"). `signIn` says
 * whether this host offers sign-in; accounts decides who is admitted (D37). Not the D1 gate: that asks
 * `/api/identity` at every gated request.
 */
export interface SessionBody {
  readonly account: { readonly subject: string; readonly display: string } | null;
  readonly signIn: boolean;
}
