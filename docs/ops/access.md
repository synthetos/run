# Cloudflare Access on staging (D31)

ROADMAP P0-04, RUN_PLAN §5.2, SAFETY H45, DECISIONS D31.

Phases 1 to 3 run **only** on staging.run.synthetos.com, and only the owner
and the bench machines may reach it. The Web Serial grant belongs to the
origin, so an unprotected staging host would be a second origin serving
bench builds to anyone (SAFETY H45). Production stays the empty shell until
Phase 6.

**Status (2026-11-01): not configured.** It needs the account locked down
first (D39: the current account, docs/ops/account.md).

## 1. The Access application (owner)

In the current account (D39): Zero Trust → Access → Applications → Add an
application → **Self-hosted**.

| Field | Value |
|---|---|
| Application name | `run-staging` |
| Domain | `staging.run.synthetos.com`, path empty (the whole host, including `/api/*` and `/auth/*`) |
| Session duration | 24 hours or less |
| Identity providers | One-time PIN to the owner's address, or GitHub with the owner's account. No "allow all" provider |
| Cookie settings | `SameSite=Lax`, HTTP-only on, "Enable binding cookie" on |
| Instant auth | off |

Policies, in order:
1. **Allow: owner.** Include: Emails → the owner's address. Require:
   (optional) a hardware-key authentication method if the identity provider
   supports it.
2. **Allow: bench machines.** Include: the bench identities only. Prefer
   named emails per bench operator; a service token only for an unattended
   bench runner, named after the bench machine and rotated at each release.
3. No other policy. **No `Bypass` and no `Everyone` rule.**

Do the same for `staging.accounts.synthetos.com` when A1-07 deploys it.

## 2. Order of operations

1. Create the Access application **before** the first staging deploy, and
   give the deploy token (`CLOUDFLARE_API_TOKEN`, docs/ops/account.md) the
   extra scope **Access: Apps and Policies Read** on the run account. The
   `deploy-staging` job runs `smoke/cli.ts --env staging --pre-deploy`
   before it deploys. That check is **positive** (P0 review): it lists the
   Access applications through the Cloudflare API and refuses to deploy
   unless a `self_hosted` application covers the whole host
   (`staging.run.synthetos.com`, `…/*` or a `*.run.synthetos.com` wildcard)
   with no Bypass policy and no policy that includes Everyone. Only then may
   a host that does not resolve yet pass; when it already answers, an
   anonymous request must also redirect to the Access login. "Unreachable"
   alone never passes.
2. After every staging deploy, the smoke test repeats the API check and
   checks that anonymous requests to `/` and `/api/health` are redirected to
   `*.cloudflareaccess.com`.
3. **If any step after the deploy fails, the deploy job undoes it**
   (`deploy/rollback-cli.ts`): staging is **deleted** (`wrangler delete`,
   which removes the custom domain with it), because older code would not
   restore a removed Access application; production is rolled back
   (`wrangler rollback`). If the undo itself fails, the job log says the
   deployment is STILL LIVE: act at once (take the custom domain off in the
   dashboard). Production is never deployed after a failed staging job.

## 3. Manual check (ROADMAP P0-04 acceptance, recorded in the PR)

From a browser profile that is not signed in to Access:
- [ ] `https://staging.run.synthetos.com/` redirects to the Access login.
- [ ] `https://staging.run.synthetos.com/api/health` redirects to the Access login.
- [ ] After signing in as the owner, the shell loads, and DevTools shows the
      RUN_PLAN §6.4 headers on the document.
- [ ] `https://run-staging.<workers.dev subdomain>.workers.dev/` does not serve
      the app (workers.dev is off).

From a signed-in session, `https://run.synthetos.com/` serves the same shell
publicly (production is not behind Access) with the same headers.

## 4. Later: the Access identity in the Worker

Until A1-07 ships, the staging `AuthGate` is satisfied by the verified
Access identity: the run Worker checks the `Cf-Access-Jwt-Assertion` header
against the team's signing keys and the application's AUD tag (RUN_PLAN
§2.2). That check arrives with the AuthGate in Phase 1; P0-04 only puts the
Access application in front of staging. It never affects the machine path:
nothing in `machine`, `protocol` or `safety` consults a session (D1).
