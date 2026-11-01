# The dedicated Cloudflare account (D34)

ROADMAP P0-04, RUN_PLAN §5.2, SAFETY H45, H46, DECISIONS D34, D11.

The Web Serial grant belongs to the **origin**. Anyone who can deploy the
`run` Worker, swap its assets or repoint `run.synthetos.com` in DNS receives
every user's serial grant, and every in-page mitigation is then defeated
(SAFETY H46, rated S4). The controls on this page are therefore safety
controls, not housekeeping. They are operational: no code can enforce them,
so each one is checked at every release (account, token and role audit) and,
where possible, by the post-deploy smoke test.

**Status (2026-11-01): the account does not exist yet.** The repository
carries the placeholder `D34_RUN_ACCOUNT_ID_PLACEHOLDER` in
`workers/run/wrangler.jsonc`. The deploy preflight
(`tools/gates/src/deploy/preflight.ts`) refuses every deploy while it is
there, and deploys stay off until `RUN_DEPLOY_ENABLED` is set.

## 1. What lives in the account

| Worker | Hostname | Notes |
|---|---|---|
| `run` | run.synthetos.com (custom domain) | this repository, `wrangler.jsonc` top level |
| `run-staging` | staging.run.synthetos.com (custom domain) | `--env staging`, behind Cloudflare Access (docs/ops/access.md) |
| `accounts`, `accounts-staging` | accounts.synthetos.com, staging.accounts.synthetos.com | the accounts repository, A1-07 |

Nothing else. The site (`synthetos`), forumbot and every other project stay
in the existing account, which keeps its own Workers Paid plan (D11).

## 2. Setting it up (owner, once)

1. **Create the account** in the Cloudflare dashboard (a new account under
   the owner's login, not a new login). Subscribe it to **Workers Paid**
   (D11). Record the account id.
2. **Hardware-key login.** Enable two-factor authentication with a hardware
   security key (WebAuthn) for the owner's Cloudflare login, and remove TOTP
   and SMS fallbacks. No other member is added to this account. If a second
   person is ever added, give them the narrowest role (never Super
   Administrator) and record it in this file.
3. **The single CI token.** Create exactly one API token:
   - permission **Account → Workers Scripts → Edit**, on this account only;
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
4. **No local wrangler access.** Never run `wrangler login` against this
   account, and never create a second token for it "temporarily". A local
   `wrangler login` token is account-wide (H46 cause). Deploys happen only
   from the `deploy-*` jobs.
5. **The zone.** `synthetos.com` stays in the existing account. Custom
   domains of the new account's Workers attach to it through the zone's
   normal custom-domain flow (the owner approves it in the dashboard).
   Then, on the zone:
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
6. **Certificate Transparency monitoring** for `run.synthetos.com`,
   `staging.run.synthetos.com`, `accounts.synthetos.com` and
   `staging.accounts.synthetos.com`: subscribe to a CT monitor (for example
   Cloudflare's own Certificate Transparency Monitoring on the zone, or an
   external service such as crt.sh alerts) and send alerts to the owner. A
   certificate from an unexpected CA, or one that no deploy explains, is an
   incident (SAFETY H46).
7. **Audit-log alerts for non-CI deploys.** In the new account, create a
   Notification (or a Logpush job to an alerting endpoint) on audit-log
   events for the Workers above: script upload, version, deployment, route
   and custom-domain changes, and secret changes. Alert on every such event
   whose actor is **not** the CI token. Test it once by viewing (not
   changing) a setting and confirming that only real changes alert.
8. **Point the repository at it.** In a PR:
   - replace `D34_RUN_ACCOUNT_ID_PLACEHOLDER` in `workers/run/wrangler.jsonc`
     with the account id;
   - set the repository variable `CLOUDFLARE_ACCOUNT_ID` to the same id (the
     preflight refuses a mismatch);
   - set the repository variable `RUN_WORKERS_DEV_SUBDOMAIN` to the
     account's workers.dev subdomain (Workers & Pages → Overview), so the
     smoke test can probe that the workers.dev origin is dead.

## 3. Audit at every release

Record the answers in the release PR.

- [ ] The account has exactly one API token: Workers Scripts:Edit and Access: Apps and Policies:Read, nothing else.
- [ ] The token is only in the `staging` and `production` environment secrets.
- [ ] Members: the owner only (or the recorded exceptions), hardware key on.
- [ ] Audit log since the last release: every Workers change was made by the
      CI token, at a time matching a deploy job.
- [ ] No day-to-day token on the synthetos.com zone has DNS:Edit.
- [ ] DNSSEC, CAA and the registrar lock are on (the smoke test checks DNSSEC,
      CAA and the issuer on every deploy).
- [ ] CT monitoring is active; no unexplained certificate since the last release.
- [ ] `workers_dev` and `preview_urls` are off for `run` and `run-staging`
      (the smoke test checks both on every deploy).
