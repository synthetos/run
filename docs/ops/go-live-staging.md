# Go live on staging: accounts sign-in (owner runbook)

ROADMAP A1-06, A1-07; OD-26 (owner, 2026-11-09: "yes staging first, just my github account for now"); DECISIONS D1, D31, D37, D39.

This page is for the owner. Every step here is a deploy, a DNS or Cloudflare change, a GitHub setting or a secret, so nobody else does it. Do the steps in order. Each step says how to check it.

**Rules for the whole page.**
- Never paste a secret into a chat, an issue, a commit or a terminal that echoes it. The commands below copy each secret straight to the clipboard (`pbcopy`). Paste it into the one field it belongs in, then clear the clipboard at once: `pbcopy < /dev/null`. If you use a clipboard manager that keeps history, pause it for these steps or delete those entries afterwards.
- Never use `wrangler login` on a laptop for run or accounts (D39). Cloudflare changes are made in the dashboard, signed in with the hardware key.
- Staging only. Production comes later (§7) and needs its own go-ahead.

**What you end up with.** `staging.accounts.synthetos.com` and `staging.run.synthetos.com`, both behind Cloudflare Access. The staging run app has a Sign in link. Signing in with GitHub as `ril3y` gives "Signed in as @ril3y", and Connect then passes the sign-in gate with the run session. Any other GitHub account is refused by accounts with "Sign-in opens with the public beta."

## 0. Before you start (checks only)

1. The D39 lockdown in docs/ops/account.md §2 is done (hardware key, minimal members, the CI token, audit alerts). `workers/run/wrangler.jsonc` already carries the account id.
2. The run repository deploys to staging today, or is ready to (docs/ops/worker.md, docs/ops/access.md).
3. You have the `accounts` repository locally at `/Volumes/External/projects/accounts` with the A1-07 commit on `main`.

## 1. GitHub

### 1.1 Publish the accounts repository

1. On github.com, create the repository `synthetos/accounts`. Private, no README, no licence (the repository already has its Apache-2.0 licence, D3).
2. From your own terminal:
   ```sh
   cd /Volumes/External/projects/accounts
   git remote add origin git@github.com:synthetos/accounts.git
   git push -u origin main
   ```
3. Repository settings, as the accounts README says under "CI and release controls":
   - branch protection on `main`, with the required checks verify, build, e2e and browser;
   - environments `staging` and `production`, with `production` requiring your approval.
4. Repository variable `CLOUDFLARE_ACCOUNT_ID`: the same account id as in run (`79866c4d48cb424b8cb3ac3b9955d46b`).
5. In both environments, the secret `CLOUDFLARE_API_TOKEN`: the D39 CI token (the one run uses; docs/ops/account.md §2 step 4). Paste it from your password manager.
6. Do **not** set `ACCOUNTS_DEPLOY_ENABLED` yet (step 4.1 does).

**Check.** The first push runs the `accounts-ci` workflow: verify, build, e2e, browser and attest pass. The deploy jobs are skipped (no `ACCOUNTS_DEPLOY_ENABLED`).

### 1.2 Add staging to the existing GitHub App (OD-37)

Use **Synthetos**, App ID `5562809`, Client ID `Iv23liIlkNxE7f3oEyX4`. Do not create another app.

GitHub → Settings → Developer settings → GitHub Apps → Synthetos → Callback URLs: add `https://staging.accounts.synthetos.com/auth/github/callback`. Keep the production callback `https://accounts.synthetos.com/auth/github/callback` and the production webhook unchanged. Keep the app's zero permissions.

Use this same app's client ID and client secret for staging accounts. Read the secret from the password manager; never put it in a repository. No new private key is needed.

**Check.** Both callback URLs appear on Synthetos. The production webhook is still active at its existing URL. Staging remains behind Access; this does not add a second webhook destination.

## 2. Cloudflare (dashboard, hardware key)

### 2.1 Separate deploy and database credentials

Keep `CLOUDFLARE_API_TOKEN` for Workers Scripts → Edit and Access: Apps and Policies → Read only. Remove D1 Edit from it. Record the actual scope in docs/ops/account.md §2 step 4.

Create a second token with only Account → D1 → Edit on this account. Store it as `CLOUDFLARE_D1_API_TOKEN` in the `staging` and `production` GitHub environments of both repositories. Only the reviewed migration and client-registration steps receive it; deploy and Access checks use the deploy token. Merge the accounts companion workflow change before enabling its deploy jobs.

D1 Edit may reach every database in the account. The separate credential limits exposure to the database steps; it does not make database access harmless or guarantee that individual writes appear in Cloudflare audit logs (SAFETY H46).

**Check.** The deploy token has no D1 permission. The D1 token has no Worker, Access or DNS permission. Both repositories reference the D1 secret only in database steps. Keep both tokens out of repository secrets and local deploy tools.

### 2.2 Create the two staging D1 databases

Storage & Databases → D1 → Create, twice:
- `identity-staging` (accounts' users, sessions and the run client);
- `run-auth-staging` (run's pending sign-ins and device rows).

Note both database ids (each a UUID). They are not secret.

**Check.** Both databases exist, empty. Do not run anything in them: the deploy jobs apply the reviewed migrations.

### 2.3 Cloudflare Access on staging accounts

Zero Trust → Access → Applications → Add → Self-hosted, exactly as docs/ops/access.md §1, with these differences:
- Application name `accounts-staging`;
- Domain `staging.accounts.synthetos.com`, path empty (the whole host).

Same policies: allow the owner only, no Bypass, no Everyone. If `run-staging` (staging.run.synthetos.com) is not set up yet, do it now too (docs/ops/access.md).

**Check (stop if it fails).** In Zero Trust → Access → Applications, `accounts-staging` exists for the whole host with only your allow policy. Then, from your terminal:

```sh
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://staging.accounts.synthetos.com/
```

- Before step 4 the name may not resolve yet (`curl` reports a DNS error). That is fine; the deploy job checks Access again through the API before anything else and refuses if the application is missing.
- After step 4 it **must** print `302` and a `https://…cloudflareaccess.com/…` address. Anything else (a 200, a 503, another address) means staging accounts is public: stop, take the custom domain off the Worker in the dashboard, and fix Access before going on. The deploy job also checks this after the deploy and deletes the staging Worker if it fails.

### 2.4 DNS

There are **no DNS records to add by hand**. Both hostnames are Workers custom domains: the deploy creates their records (docs/ops/account.md §2 step 6).

Check that nothing else already holds the two names:
- DNS → Records: there is no A, AAAA or CNAME record for `staging.accounts` (a custom domain refuses an existing record). `staging.run` already has its record if run-staging has been deployed before: that one is expected, it belongs to the run-staging Worker.
- The CAA records on `synthetos.com` stay as they are: they already cover these names.
- Add `staging.accounts.synthetos.com` to your Certificate Transparency monitoring if it is not there yet (docs/ops/account.md §2 step 7).

## 3. Put in the non-secret values (one PR per repository)

Send the four values to the agent working on accounts, or edit them yourself:

| Value | File | Field |
|---|---|---|
| Synthetos App ID `5562809` | accounts `workers/accounts/wrangler.json` | `env.staging.vars.GITHUB_APP_ID` (replaces `STAGING_GITHUB_APP_ID_PLACEHOLDER`) |
| Synthetos Client ID `Iv23liIlkNxE7f3oEyX4` | same file | `env.staging.vars.GITHUB_CLIENT_ID` (replaces `STAGING_GITHUB_CLIENT_ID_PLACEHOLDER`) |
| `identity-staging` id | same file | `env.staging.d1_databases[0].database_id` (replaces `IDENTITY_STAGING_DATABASE_ID_PLACEHOLDER`) |
| `run-auth-staging` id | run `workers/run/wrangler.jsonc` | `env.staging.d1_databases[0].database_id` (replaces `RUN_AUTH_STAGING_DATABASE_ID_PLACEHOLDER`) |

The allowlist is already in the accounts file: `GITHUB_ALLOWED_IDS` is `["231731"]`, your numeric GitHub id (`ril3y`). Admission is by numeric id, never by login.

**Check.** Each repository's deploy preflight passes for staging:
- accounts: `node tools/deploy-preflight.mjs workers/accounts/wrangler.json staging` prints "configuration accepted";
- run: the `deploy-staging` job's preflight step passes (it deploys sign-in off while the database id is a placeholder or the D1 credential is absent).

The production placeholders stay until §7.

## 4. Deploy accounts-staging first

run's staging Worker binds `accounts-staging`, so accounts must exist first.

### 4.1 Deploy

1. In `synthetos/accounts`, set the repository variable `ACCOUNTS_DEPLOY_ENABLED` to `true`.
2. Merge the PR from step 3 to `main` (or push `main`).
3. The `deploy-staging` job runs, in this order:
   - verify the artifact's attestation;
   - the Cloudflare Access check (it refuses if no Access application covers staging accounts);
   - preflight;
   - apply the migrations to `identity-staging`;
   - register run's client (`clients/staging.sql`);
   - deploy;
   - the Access check again (an anonymous request must go to the Access login); if it fails, the job deletes the staging Worker.
4. The `deploy-production` job then waits for your approval. **Do not approve it.** Reject it (its preflight would refuse the production placeholders anyway).

**Check.** The `deploy-staging` job is green, and `staging.accounts.synthetos.com` shows in Workers & Pages → `accounts-staging` → Domains. Until step 4.2 the Worker answers every request with a 503: without its secrets it fails closed.

### 4.2 Set the accounts-staging secrets

Workers & Pages → `accounts-staging` → Settings → Variables and Secrets → Add → type **Secret**, one at a time. Each command below puts the value on your clipboard only.

| Secret | Value |
|---|---|
| `GITHUB_CLIENT_SECRET` | the existing Synthetos app's client secret from step 1.2 (from your password manager) |
| `OAUTH_STATE_KEY` | `openssl rand 32 \| base64 \| tr '+/' '-_' \| tr -d '=\n' \| pbcopy` |
| `FORM_KEY` | the same command again (a new value) |
| `RATE_KEY` | the same command again (a new value) |
| `GITHUB_WEBHOOK_SECRET` | the same command again (staging has no active webhook, but accounts requires the value) |
| `ID_TOKEN_PRIVATE_JWK` | `node -e 'const c=require("node:crypto");const k=c.generateKeyPairSync("ec",{namedCurve:"P-256"}).privateKey;process.stdout.write(JSON.stringify(k.export({format:"jwk"})))' \| pbcopy` |

Only the GitHub app client credentials are shared (OD-37). Generate separate session, signing, rate-limit and webhook keys for staging. You do not need to keep the generated keys anywhere else: a new one can always replace a lost one (all sessions then end).

Saving a secret makes a new Worker version outside CI, so the D39 audit-log alert fires. That is expected: note it in the release audit (docs/ops/account.md §3).

**Check.**
1. Signed in to Access in your normal browser, open `https://staging.accounts.synthetos.com/login`. It shows the sign-in form, not "not enabled".
2. Sign in with GitHub as `ril3y`. You land on the account page with your login.
3. If you have a second GitHub account: signing in with it shows "Sign-in opens with the public beta." and creates no account.

## 5. Deploy run-staging

### 5.1 Deploy

Merge the `accounts-live` branch (with the database id from step 3) to run's `main`. The `deploy-staging` job runs:
- preflight (it strips unconfigured sign-in bindings);
- the Access pre-check;
- the `RUN_AUTH` migrations on `run-auth-staging`;
- the deploy (it binds `accounts-staging`'s `RunEntrypoint`);
- the smoke test.

run's `deploy-production` is not affected: production carries no sign-in bindings yet (`workers/run/wrangler.jsonc`), so it deploys exactly as before, with sign-in off, until §7.

**Check.** The job is green. Sign-in is still off until step 5.2: `/auth/login` is a 404, and the app's Preferences → Account says signing in is not available.

### 5.2 Set the run-staging secrets

Workers & Pages → `run-staging` → Settings → Variables and Secrets → Add → type **Secret**:

| Secret | Value |
|---|---|
| `RUN_STATE_KEY` | `openssl rand 32 \| base64 \| tr '+/' '-_' \| tr -d '=\n' \| pbcopy` |
| `RUN_RATE_KEY` | the same command again (a new value) |

The same audit-log note applies as in 4.2.

### 5.3 Check the whole sign-in

Signed in to Access, at `https://staging.run.synthetos.com`:

1. **Preferences → Account** says "Not signed in" with a **Sign in** link.
2. **Sign in.** The address bar goes to staging.accounts, then GitHub (the existing Synthetos app; approve it if needed), and back to run.
3. **Preferences → Account** says "Signed in as @ril3y", with **Sign out**.
4. DevTools → Application → Cookies → `https://staging.run.synthetos.com`: one `__Host-run_sid`, HttpOnly, Secure, SameSite Lax. No `__Host-run_oauth` remains.
5. DevTools → Network → `/api/identity` answers `{"identity":{"provider":"run-session",…,"display":"@ril3y"},"signIn":true}`.
6. **Connect** passes the sign-in step (C1 appears). With a machine connected, Preferences → Account shows Sign out disabled, with "Disconnect the machine first."
7. Disconnect, then **Sign out**. `/api/identity` now answers `identity: null`, and the cookie is gone. `__Host-acct_sid` on staging.accounts is untouched (sign-out of run only).
8. Optional: with a second GitHub account, Sign in ends at accounts with "Sign-in opens with the public beta."; run stays signed out.

If a check fails, nothing on the machine path depends on sign-in: Pause, Stop job and the stop controls never need it (D1). Roll back by removing the two run secrets (sign-in goes off at once), or with `wrangler rollback` from the dashboard as docs/ops/worker.md says.

## 6. Record it

- In run's `RELEASES.md` (the next entry) and in accounts' README: the staging go-live date, the two `deploy-staging` run URLs, and that §5.3 passed.
- docs/ops/account.md §3 audit: the token change (2.1) and the expected secret-change alerts (4.2, 5.2).

## 7. Production: run active for the users we allow (OD-29)

The owner, 2026-11-09: "yes we want run to be active for certain users we allow asap the real site real storage real auth". Production grants Web Serial only on HTML requests with a valid run session, after accounts validates it. Sign-in must be fully configured first. Signed-out visitors get serial=(); their document cannot use Web Serial even through DevTools. HTML is no-store and varies by Cookie. The serial asset directory is session-gated and private/no-store. Accounts owns allowlist admission. Production stays read-only (Phase 1): motion, settings writes, jobs and the flasher are each a separate owner decision (T-S93).

### 7.1 Before production opens: three checks

All three must be done and recorded in `RELEASES.md` before the production deploy of §7.3 is approved.

**(a) The D39/H46 production deploy controls, verified** (docs/ops/account.md §2 and §3). Since OD-29 the production origin holds the serial grant for admitted users, so a deploy, DNS or account compromise is the S4 case of H46 there too.
- [ ] Deploys only from CI: no local `wrangler login` used for run or accounts; the release audit (account.md §3) shows every change to `run`, `accounts` and their staging copies made by the CI token.
- [ ] The CI token is scoped as recorded (Workers Scripts Edit, Workers R2 Storage Edit, D1 Edit, Access Read), and lives only in the `staging` and `production` environment secrets of both repositories. The D1 residual has its chosen option (§2.1).
- [ ] The audit-log alerts are active for `run`, `run-staging`, `accounts` and `accounts-staging` (and the D1 alert if you chose option A), and fire on a test.
- [ ] Your Cloudflare login, registrar login and GitHub login use a hardware key, with no TOTP or SMS fallback; account members are the minimum.
- [ ] DNSSEC, CAA, the registrar lock and CT monitoring are on (the smoke test checks the first three on each deploy).

**(b) The §9 HIL items for connect, stop and pause/resume, run on staging against a bench board.** TG-Firmware runs the benches (SAFETY §9.1: the bench rig with the hardwired E-stop, staging running the exact attested artifact that production will run). Ask them for exactly these, signed in `RELEASES.md` with the evidence §9 names:

| Area | HIL items (SAFETY §9) |
|---|---|
| Connect | HIL-1.1 (connect and identify edge-next), HIL-1.3 (C1 per session), HIL-1.5 (USB pull and board reset: UNKNOWN, FAULT), HIL-1.6 (connect while another tool runs a job: no writes), HIL-1.11 (port exclusivity across browsers and tools), HIL-1.12 (partial-line splice), HIL-1.13 (the status-report setup at connect) |
| Stop | HIL-1.7 (stop request from a second tab with the controlling tab frozen), HIL-1.10 (orphaned motion: only Stop job and Reset offered), HIL-2.6 (Stop job, ^D, in RUN, HOLD, a dwell and a spin-up), HIL-2.8 (Spindle off now), HIL-2.12 (hold timeout), HIL-2.13 (hardwired E-stop), HIL-2.14 (jog release and Stop job during a jog), HIL-3.4 (Stop job mid-job) |
| Pause and resume | HIL-1.9 (feedhold latency), HIL-2.7 (Pause during a dwell, then resume), HIL-3.2 (feedhold during streaming, under XOFF), HIL-3.3 (hold and resume mid-job) |
| Sign-in (new with OD-26) | HIL-3.8 (session expiry, sign-out in another tab and a network loss during a job change nothing on the machine path) |
| Production equals staging | HIL-6.4 (the production deployment is the staging artifact by code hash; production rejects bench manifest entries; headers verified) |

Production itself is read-only (Phase 1), so on production only connect, Pause and the stop class apply today; the motion and job items above are what the owner will need when motion or jobs are turned on for production.

**(c) The allowlist holds only `ril3y`.** In accounts' `workers/accounts/wrangler.json`, production `vars.GITHUB_ALLOWED_IDS` is exactly `["231731"]`. The deploy preflight refuses an empty or malformed list; check the value by eye too.

**Not needed for this opening:** the public-launch items stay for the public opening: the D25 legal review (E-stop wording, privacy text, product liability) and the published privacy text (RUN_PLAN §9.1). The allowlist keeps production closed to the public until then (D37).

### 7.2 Signed production data the page needs

Connect needs a signed `safety-advisory.json` for production and a production entry in the approved-builds manifest for the board's firmware (RUN_PLAN §5.2: per-environment signed data files; production rejects bench entries). These are signed with the **release key**, which only you hold (docs/ops/release-key.md); never with the bench key. Without them Connect is refused ("The safety advisory could not be verified") or the board is READ_ONLY.

### 7.3 Accounts production and run production, in order

The prerequisites in §7.1 (including the TG-Firmware HIL sign-off and allowlist) and §7.2 (owner-signed production data) are unchanged. Do not run wrangler locally or create resources in the dashboard. CI does the provisioning and deployment; the owner approves the protected `production` jobs. Every manual workflow below selects **main**. None is dispatched by this implementation.

**One owner credential step before the secrets job:** on the existing Synthetos GitHub App, create a new client secret and save it as **APP_CLIENT_SECRET** in the accounts repository's protected **production** environment. Do not copy the staging value. CI generates all other missing keys, including the webhook secret as staging does, and writes them straight to Worker secrets; no additional webhook-secret input is needed. Never paste any secret into a log, issue or review.

1. In **accounts**, choose **production-provision → Run workflow**, then approve its `production` job. CI lists D1 using `CLOUDFLARE_D1_API_TOKEN`, reuses `identity` if present, or creates it. Only its database id is printed; no deployment or migration runs.
2. Review and merge the PR replacing accounts' `IDENTITY_DATABASE_ID_PLACEHOLDER` with that printed id. The production allowlist stays exactly `["231731"]`.
3. Approve accounts' **deploy-production** for the reviewed commit. The existing preflight, IDENTITY migrations and run client registration must pass before the attested code deploys. Production uses the existing GitHub App **Synthetos (5562809)** and callback `https://accounts.synthetos.com/auth/github/callback`; no new app is created.
4. In **accounts**, choose **production-secrets**, Worker **accounts**, then approve. CI reads only APP_CLIENT_SECRET from the protected production environment, generates fresh missing random/signing keys on the runner, and keeps existing Worker secret values. No values are printed. This does not reuse staging keys or alter staging.
5. In **run**, choose **production-provision → Run workflow**, then approve. CI looks up or creates `run-auth` with the separate D1 credential and prints its public id for review. The account must match the reviewed Worker configuration.
6. Review and merge the PR replacing run's `RUN_AUTH_DATABASE_ID_PLACEHOLDER` with the printed id. The reviewed production bindings are exactly ACCOUNTS → accounts / RunEntrypoint and RUN_AUTH → run-auth. No production run-data binding is added.
7. Approve run's **deploy-production** for that reviewed commit. While the database id is a placeholder, preflight strips both sign-in bindings and production still deploys with sign-in off. Once real bindings are enabled, the conditional RUN_AUTH migration step must succeed before deploy; a missing migration credential still strips sign-in bindings, never deploys an unmigrated enabled binding.
8. In **accounts**, choose **production-secrets**, Worker **run**, then approve. CI installs its two production sign-in secrets without exposing their values. The same generation plan as staging creates fresh RUN_STATE_KEY and RUN_RATE_KEY directly on the runner; no GitHub environment key inputs are needed for run. Generated values are never printed or written anywhere except the selected Worker's secret store. Existing values are kept on reruns. The accounts job maps the owner's production APP_CLIENT_SECRET to GITHUB_CLIENT_SECRET.
9. Perform §7.4's checks. The first signed-out visit additionally shows the non-blocking sign-in card; **Continue without an account** hides it for this browser. The existing Connect notice remains, and the document's server-issued serial policy remains the gate.

The two provisioning workflows are idempotent and share each repo's production deploy concurrency group. A retry finds the same database by name. Resource ids enter configuration only through a reviewed PR. Apart from the single GitHub App client-secret step above, the owner only selects the workflow and approves; no generated key contents are handled by the owner.

### 7.4 Check production

1. In a private window (signed out), `https://run.synthetos.com`: Connect shows "Connecting needs a Synthetos account" with "Synthetos accounts are coming soon", and a small "Beta testers can sign in" link.
2. Signed out, DevTools → Network → the document: `Permissions-Policy` starts with `serial=()`. The page still loads fully, with the sign-in link. Sign in and navigate again: the document has `serial=(self)`, `Cache-Control: no-store` and `Vary: Cookie`. Every other header matches docs/ops/worker.md.
3. Sign in as `ril3y`: Preferences → Account says "Signed in as @ril3y". Connect goes on to C1 and the port chooser, and the board identifies, read-only.
4. With a second GitHub account: accounts says "Sign-in opens with the public beta.", and Connect stays refused.
