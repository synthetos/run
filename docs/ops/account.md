# The Cloudflare account for run (D39)

ROADMAP P0-04, RUN_PLAN §5.2, SAFETY H45, H46, DECISIONS D39 (which
supersedes D34), D11.

The Web Serial grant belongs to the **origin**. Anyone who can deploy the
`run` Worker, swap its assets or repoint `run.synthetos.com` in DNS receives
every user's serial grant, and every in-page mitigation is then defeated
(SAFETY H46, rated S4). The controls on this page are therefore safety
controls, not housekeeping. They are operational: no code can enforce them,
so each one is checked at every release (account, token and role audit) and,
where possible, by the post-deploy smoke test.

**D39 (owner, 2026-11-01).** There is **no dedicated account**. D34 planned
one, but Workers custom domains need the hostname's zone in the same
account as the Worker, and the `synthetos.com` zone stays where it is. So
`run` (and later `accounts`) live in the **current** Cloudflare account,
next to the site and forumbot, and that account is locked down:

- **CI-only deploys** with one API token scoped to the run and accounts
  Workers (as narrowly as Cloudflare allows; what it can actually reach is
  recorded below);
- **minimal account members**;
- a **hardware-key** owner login;
- **audit-log alerts** on any Workers change the CI token did not make;
- **no local `wrangler login`** used to deploy run or accounts, ever.

**Status (2026-11-01).** The repository carries the placeholder
`RUN_ACCOUNT_ID_PLACEHOLDER` in `workers/run/wrangler.jsonc` until the owner
puts in the current account's id (§2 step 9). The deploy
preflight (`tools/gates/src/deploy/preflight.ts`) refuses every deploy while
the placeholder (or the superseded D34 placeholder, or anything that is not
a 32-character hex id) is there, and deploys stay off until
`RUN_DEPLOY_ENABLED` is set.

## 1. What lives in the account

| Worker | Hostname | Notes |
|---|---|---|
| `run` | run.synthetos.com (custom domain) | this repository, `wrangler.jsonc` top level |
| `run-staging` | staging.run.synthetos.com (custom domain) | `--env staging`, behind Cloudflare Access (docs/ops/access.md) |
| `accounts`, `accounts-staging` | accounts.synthetos.com, staging.accounts.synthetos.com | the accounts repository, A1-07 |
| `synthetos` (the site), forumbot, others | their own hostnames | **not** deployed by run's CI token; they keep their own deploy paths |

Because these share one account, **service bindings between them work**.
Another Worker in the account could declare a binding to accounts'
`RunEntrypoint` and call it as run does. The platform does not prevent that;
review and CI do:

- in this repository, `pnpm ci-policy` refuses any wrangler configuration
  other than `workers/run/wrangler.jsonc` that binds `accounts` (service,
  entrypoint `RunEntrypoint`, Durable Object, Workflow or tail consumer), and
  refuses any `wrangler.toml` it cannot read
  (`tools/gates/src/bindings/check.ts`). run's own key allowlist does not
  allow any binding yet; Phase 1 adds exactly the accounts one;
- the accounts and site repositories must carry the matching rule (below);
- forumbot reaches accounts over OIDC over HTTPS, never through a binding.

**Matching requirement for the other repositories (D39).** The rule above
covers only this repository. Before `accounts` is deployed into the shared
account:

- **accounts repository**: its CI must refuse any change that lets a Worker
  other than `run` (and `run-staging`) call `RunEntrypoint`: no binding to
  itself from its own configurations, and its documentation must name run
  as the only allowed caller. Its deploy token is the same D39 token or one
  scoped the same way, used only by CI.
- **site repository (synthetos.com) and forumbot**: their CI must refuse any
  wrangler configuration that binds `accounts` or `accounts-staging` in any
  way (service, entrypoint `RunEntrypoint`, Durable Object, Workflow, tail
  consumer), and any configuration their check cannot read. forumbot talks
  to accounts over OIDC over HTTPS only. Their deploy tokens must not be
  able to deploy `run` or `accounts` (or, if Cloudflare cannot scope them
  that narrowly, that is recorded in `docs/ops/account.md` and the audit
  alerts cover it), and they lose DNS:Edit (§2 step 6).

Record in those repositories' own lead-actions lists that this is done.

## 2. Locking the account down (owner, once)

1. **Use the current account.** Do not create a new one. It must be on
   **Workers Paid** (D11). Record its account id.
2. **Hardware-key login.** Enable two-factor authentication with a hardware
   security key (WebAuthn) for the owner's Cloudflare login, and remove TOTP
   and SMS fallbacks.
3. **Minimal members.** List the account's members and remove everyone who
   does not need access. Anyone who stays gets the narrowest role that does
   their job (never Super Administrator), and is recorded in this file with
   the reason. No member other than the owner may hold a role that can
   deploy Workers or edit DNS.
4. **The CI token.** Create exactly one API token for run's CI:
   - permission **Account → Workers Scripts → Edit**, on this account only,
     narrowed to the run and accounts Workers as far as Cloudflare's token
     model allows. Record here what the created token can actually reach
     (if Cloudflare cannot limit it to those scripts, it can edit every
     Worker in the account, the site and forumbot included: say so here, and
     rely on the audit alerts in step 8 to catch any use against them);
   - plus **Account → Access: Apps and Policies → Read** (read only): the
     staging deploy confirms through the API that Access protects staging
     before it deploys (docs/ops/access.md §2, P0 review). No Access edit;
   - no zone permissions, no DNS, no account settings;
   - client IP filtering is not possible for GitHub-hosted runners; keep the
     TTL at one year and rotate it at each yearly audit;
   - store it **only** as the `CLOUDFLARE_API_TOKEN` environment secret of
     the GitHub environments `staging` and `production`
     (docs/ops/branch-protection.md §2), never as a repository secret and
     never on a laptop.

   The smoke test reads the Worker's workers.dev and preview settings with
   this same token (`GET /accounts/{id}/workers/scripts/{name}/subdomain`,
   a read inside Workers Scripts). Confirm on the first staging deploy that
   the read succeeds with this scope; if Cloudflare requires a broader scope
   for that read, do not broaden the token: report it, and the check moves
   to the account audit instead.
5. **No local deploys of run or accounts.** Never deploy run or accounts
   from a laptop, and never create a second token for them "temporarily".
   The site's and forumbot's existing local or CI tokens stay as they are
   for those projects, but must not be used against run or accounts, and
   lose DNS:Edit (step 6). A local `wrangler login` token is account-wide
   (H46 cause): if one exists on any machine, revoke it, or at the least
   never use it for run or accounts, and record which it is here.
6. **The zone.** `synthetos.com` is in the same account, so the Workers
   custom domains attach directly (the deploy creates their DNS records).
   Confirm on the first staging deploy that attaching the custom domain
   works with the CI token as scoped. Then,
   on the zone:
   - **Remove DNS:Edit from every day-to-day token** (the site's deploy
     token, forumbot's, the owner's local wrangler token). DNS changes are
     made in the dashboard with the hardware key, and only by the owner.
   - **DNSSEC on**: enable it in Cloudflare DNS and add the DS record at the
     registrar.
   - **CAA**: add CAA records on `synthetos.com` that allow only the CAs
     Cloudflare issues from, for example
     `0 issue "pki.goog"`, `0 issue "letsencrypt.org"`, `0 issue "ssl.com"`,
     the same three as `issuewild`, and `0 iodef "mailto:<owner address>"`.
     Then compare the list with Cloudflare's current CA list and with
     `ALLOWED_CAA_ISSUERS` and `ALLOWED_ISSUER_ORGS` in
     `tools/gates/src/smoke/checks.ts`; change both in the same PR if they
     differ.
   - **Registrar lock** (transfer lock and, if offered, registry lock) at
     the registrar, with the registrar login also on a hardware key.
7. **Certificate Transparency monitoring** for `run.synthetos.com`,
   `staging.run.synthetos.com`, `accounts.synthetos.com` and
   `staging.accounts.synthetos.com`: subscribe to a CT monitor (for example
   Cloudflare's own Certificate Transparency Monitoring on the zone, or an
   external service such as crt.sh alerts) and send alerts to the owner. A
   certificate from an unexpected CA, or one that no deploy explains, is an
   incident (SAFETY H46).
8. **Audit-log alerts for non-CI changes.** In the account, create a
   Notification (or a Logpush job to an alerting endpoint) on audit-log
   events for `run`, `run-staging`, `accounts` and `accounts-staging`: script
   upload, version, deployment, route and custom-domain changes, and secret
   changes. Alert on every such event whose actor is **not** the run CI
   token. Also alert on any change to account members, API tokens and the
   `synthetos.com` DNS records, whoever makes it. Test it once by viewing (not
   changing) a setting and confirming that only real changes alert.
9. **Point the repository at it**:
   - replace `RUN_ACCOUNT_ID_PLACEHOLDER` in `workers/run/wrangler.jsonc`
     with the current account's id;
   - set the repository variable `CLOUDFLARE_ACCOUNT_ID` to the same id (the
     preflight refuses a mismatch);
   - set the repository variable `RUN_WORKERS_DEV_SUBDOMAIN` to the
     account's workers.dev subdomain (Workers & Pages → Overview), so the
     smoke test can probe that the workers.dev origin is dead.

## 3. Audit at every release

Record the answers in the release PR.

- [ ] run has exactly one API token: Workers Scripts:Edit and Access: Apps and Policies:Read, scoped as recorded in §2 step 4, nothing else; no other token in the account can deploy run or accounts, or that is recorded with the reason.
- [ ] The token is only in the `staging` and `production` environment secrets.
- [ ] Members: the minimum (the owner, plus the recorded exceptions), hardware key on.
- [ ] No local wrangler login or laptop token was used to deploy run or accounts.
- [ ] Audit log since the last release: every change to the run and accounts
      Workers was made by the run CI token, at a time matching a deploy job;
      the audit-log alerts are still active.
- [ ] No day-to-day token on the synthetos.com zone has DNS:Edit.
- [ ] DNSSEC, CAA and the registrar lock are on (the smoke test checks DNSSEC,
      CAA and the issuer on every deploy).
- [ ] CT monitoring is active; no unexplained certificate since the last release.
- [ ] `workers_dev` and `preview_urls` are off for `run` and `run-staging`
      (the smoke test checks both on every deploy).
