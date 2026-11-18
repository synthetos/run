# Staging is public (OD-40; D31 superseded)

ROADMAP P0-04, RUN_PLAN §5.2, SAFETY H45, DECISIONS D31 (superseded), OD-40
(docs/ops/owner-decisions.md).

Until 2026-11-18 `staging.run.synthetos.com` and `staging.accounts.synthetos.com`
sat behind a Cloudflare Access application (D31): staging served bench builds
with a serial grant and no sign-in in front of them, so only the owner and the
bench machines could reach it. Both are gone now, by the owner's decision
OD-40. What gates staging is what gates production: the run sign-in dialog
(signed-out visitors see the dimmed workspace under it), the accounts
allowlist (D37), and a Web Serial grant that the Worker gives only to a
document with a validated `run.connect` session (`grantsSerial`,
workers/run/src/headers.ts). Staging and production deploy the same attested
artifact; staging simply gets it hours earlier, after the owner's approval.

## 1. The one-time removal (owner)

In the current account (D39): Zero Trust → Access → Applications. Delete
`run-staging` (staging.run.synthetos.com) and `accounts-staging`
(staging.accounts.synthetos.com). Nothing else changes: the deploy token
keeps **Access: Apps and Policies Read**, because the deploy gates still read
the application list to prove the two are gone.

Do this after the gate changes of OD-40 are on `main` in both repositories and
before approving the next staging deploy. While an application still exists,
the staging deploy is refused before anything is deployed (below), with the
application's name in the log.

## 2. What the gates check now

1. **Before every staging deploy** (`smoke/cli.ts --env staging --pre-deploy`
   in run; `tools/staging-public-check.mjs --pre-deploy` in accounts): the
   Cloudflare API must list **no** `self_hosted` Access application covering
   the whole staging host (`staging.run.synthetos.com`, `…/*` or a wildcard
   over it). One that does is named in the log and the job stops, before the
   deploy step, so nothing is deployed or deleted. When the host already
   answers, an anonymous request must reach the Worker rather than a
   `*.cloudflareaccess.com` login. A host that does not resolve yet passes the
   probe only after the API check passed; "unreachable" alone never passes.
2. **After every staging deploy**, the smoke test runs production's HTTP
   checks against staging (the shell, its entry script, the 404 page and
   `/api/health` with the exact fail-closed headers: an anonymous document
   carries `serial=()`), then the same two Access checks, then the shared
   infrastructure checks (workers.dev off, DNSSEC, CAA, certificate issuer).
3. **A smoke failure after a successful deploy rolls staging back** to the
   previous version (`deploy/rollback-cli.ts`, `wrangler rollback --env
   staging`), exactly as production. Staging used to be deleted instead,
   because older code could not restore a removed Access application; with
   Access gone the deletion went too, and a failed staging deploy no longer
   drops the Worker's secrets. A failed deploy step is not rolled back: the
   previous version is still the live one. Production is never deployed after
   a failed staging job.

## 3. Manual check (owner, after the first deploy under OD-40)

From a private window (no cookies):
- [ ] `https://staging.run.synthetos.com/` shows the dimmed workspace under the
      run sign-in dialog, with no Cloudflare login page first.
- [ ] DevTools → Network → the document: `Permissions-Policy` starts with
      `serial=()`; every other RUN_PLAN §6.4 header matches docs/ops/worker.md.
- [ ] **Continue with GitHub** signs in through staging accounts and lands
      back on staging run with no dialog; the document now carries
      `serial=(self)`, `Cache-Control: no-store` and `Vary: Cookie`.
- [ ] `https://run-staging.<workers.dev subdomain>.workers.dev/` does not serve
      the app (workers.dev is off).
