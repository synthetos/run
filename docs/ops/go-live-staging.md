# Go live on staging: accounts sign-in (owner runbook)

ROADMAP A1-06, A1-07; OD-26 (owner, 2026-11-09: "yes staging first, just my github account for now"); DECISIONS D1, D31, D37, D39.

This page is for the owner. Every step here is a deploy, a DNS or Cloudflare change, a GitHub setting or a secret, so nobody else does it. Do the steps in order. Each step says how to check it.

**Rules for the whole page.**
- Never paste a secret into a chat, an issue, a commit or a terminal that echoes it. The commands below copy each secret straight to the clipboard (`pbcopy`). Paste it into the one field it belongs in, then copy something else.
- Never use `wrangler login` on a laptop for run or accounts (D39). Cloudflare changes are made in the dashboard, signed in with the hardware key.
- Staging only. Production comes later (§7) and needs its own go-ahead.

**What you end up with.** `staging.accounts.synthetos.com` and `staging.run.synthetos.com`, both behind Cloudflare Access. The staging run app has a Sign in link. Signing in with GitHub as `ril3y` gives "Signed in as @ril3y", and Connect then passes the sign-in gate with the run session. Any other GitHub account is refused by accounts with "Sign-in opens with the public beta."

## 0. Before you start (checks only)

1. The D39 lockdown in docs/ops/account.md §2 is done (hardware key, minimal members, the CI token, audit alerts). `workers/run/wrangler.jsonc` already carries the account id.
2. The run repository deploys to staging today, or is ready to (docs/ops/worker.md, docs/ops/access.md).
3. You have the `accounts` repository locally at `/Volumes/External/projects/accounts` with the A1-07 commit on `main`.

## 1. GitHub

### 1.1 Publish the accounts repository

1. On github.com, create the repository `synthetos/accounts`. Public, no README, no licence (the repository already has its Apache-2.0 licence, D3).
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

### 1.2 Register the staging GitHub App

The production app `Synthetos` (id 5562809) already exists. Staging needs its own app (accounts README).

github.com → Settings → Developer settings → GitHub Apps → New GitHub App:

| Field | Value |
|---|---|
| GitHub App name | `Synthetos Staging` |
| Homepage URL | `https://staging.run.synthetos.com` |
| Callback URL | `https://staging.accounts.synthetos.com/auth/github/callback` |
| Expire user authorization tokens | as the production app |
| Request user authorization (OAuth) during installation | off |
| Enable Device Flow | off |
| Webhook | **Active: off** (staging is behind Access, so GitHub could not reach it) |
| Permissions | none (all "No access") |
| Where can this GitHub App be installed? | Only on this account |

Then:
1. Note the **App ID** and the **Client ID**. These two are not secret.
2. Generate a client secret. Put it in your password manager as "Synthetos Staging client secret". It goes into one place only, step 4.2.
3. Do not generate a private key: accounts does not use it.

**Check.** The app page shows the callback above, no webhook and no permissions.

## 2. Cloudflare (dashboard, hardware key)

### 2.1 The CI token needs D1

The deploy jobs now apply D1 migrations and register run's client with `wrangler d1`. Edit the existing CI token (My Profile → API Tokens):
- add **Account → D1 → Edit**, on this account only;
- keep Workers Scripts → Edit and Access: Apps and Policies → Read;
- if the token is narrowed to named scripts, add `accounts` and `accounts-staging`.

Record the change in docs/ops/account.md §2 step 4 ("what it can actually reach").

**Check.** The token's summary lists exactly those three permissions on this account.

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

**Check.** In a private window, `https://staging.accounts.synthetos.com/` redirects to the Access login. (Before step 4 it may not resolve at all: that is fine.)

### 2.4 DNS

There are **no DNS records to add by hand**. Both hostnames are Workers custom domains: the deploy creates their records (docs/ops/account.md §2 step 6).

Check that nothing else already holds the two names:
- DNS → Records: there is no A, AAAA or CNAME record for `staging.accounts` or `staging.run` (a custom domain refuses an existing record).
- The CAA records on `synthetos.com` stay as they are: they already cover these names.
- Add `staging.accounts.synthetos.com` to your Certificate Transparency monitoring if it is not there yet (docs/ops/account.md §2 step 7).

## 3. Put in the non-secret values (one PR per repository)

Send the four values to the agent working on accounts, or edit them yourself:

| Value | File | Field |
|---|---|---|
| staging App ID | accounts `workers/accounts/wrangler.json` | `env.staging.vars.GITHUB_APP_ID` (replaces `STAGING_GITHUB_APP_ID_PLACEHOLDER`) |
| staging Client ID | same file | `env.staging.vars.GITHUB_CLIENT_ID` (replaces `STAGING_GITHUB_CLIENT_ID_PLACEHOLDER`) |
| `identity-staging` id | same file | `env.staging.d1_databases[0].database_id` (replaces `IDENTITY_STAGING_DATABASE_ID_PLACEHOLDER`) |
| `run-auth-staging` id | run `workers/run/wrangler.jsonc` | `env.staging.d1_databases[0].database_id` (replaces `RUN_AUTH_STAGING_DATABASE_ID_PLACEHOLDER`) |

The allowlist is already in the accounts file: `GITHUB_ALLOWED_IDS` is `["231731"]`, your numeric GitHub id (`ril3y`). Admission is by numeric id, never by login.

**Check.** Each repository's deploy preflight passes for staging:
- accounts: `node tools/deploy-preflight.mjs workers/accounts/wrangler.json staging` prints "configuration accepted";
- run: the `deploy-staging` job's preflight step passes (it refuses the staging database placeholder, and only that environment's).

The production placeholders stay until §7.

## 4. Deploy accounts-staging first

run's staging Worker binds `accounts-staging`, so accounts must exist first.

### 4.1 Deploy

1. In `synthetos/accounts`, set the repository variable `ACCOUNTS_DEPLOY_ENABLED` to `true`.
2. Merge the PR from step 3 to `main` (or push `main`).
3. The `deploy-staging` job runs, in this order:
   - verify the artifact's attestation;
   - preflight;
   - apply the migrations to `identity-staging`;
   - register run's client (`clients/staging.sql`);
   - deploy.
4. The `deploy-production` job then waits for your approval. **Do not approve it.** Reject it (its preflight would refuse the production placeholders anyway).

**Check.** The `deploy-staging` job is green, and `staging.accounts.synthetos.com` shows in Workers & Pages → `accounts-staging` → Domains. Until step 4.2 the Worker answers every request with a 503: without its secrets it fails closed.

### 4.2 Set the accounts-staging secrets

Workers & Pages → `accounts-staging` → Settings → Variables and Secrets → Add → type **Secret**, one at a time. Each command below puts the value on your clipboard only.

| Secret | Value |
|---|---|
| `GITHUB_CLIENT_SECRET` | the staging app's client secret from step 1.2 (from your password manager) |
| `OAUTH_STATE_KEY` | `openssl rand 32 \| base64 \| tr '+/' '-_' \| tr -d '=\n' \| pbcopy` |
| `FORM_KEY` | the same command again (a new value) |
| `RATE_KEY` | the same command again (a new value) |
| `GITHUB_WEBHOOK_SECRET` | the same command again (staging has no active webhook, but accounts requires the value) |
| `ID_TOKEN_PRIVATE_JWK` | `node -e 'const c=require("node:crypto");const k=c.generateKeyPairSync("ec",{namedCurve:"P-256"}).privateKey;process.stdout.write(JSON.stringify(k.export({format:"jwk"})))' \| pbcopy` |

Never reuse a production value on staging, or the reverse. You do not need to keep the generated keys anywhere else: a new one can always replace a lost one (all sessions then end).

Saving a secret makes a new Worker version outside CI, so the D39 audit-log alert fires. That is expected: note it in the release audit (docs/ops/account.md §3).

**Check.**
1. Signed in to Access in your normal browser, open `https://staging.accounts.synthetos.com/login`. It shows the sign-in form, not "not enabled".
2. Sign in with GitHub as `ril3y`. You land on the account page with your login.
3. If you have a second GitHub account: signing in with it shows "Sign-in opens with the public beta." and creates no account.

## 5. Deploy run-staging

### 5.1 Deploy

Merge the `accounts-live` branch (with the database id from step 3) to run's `main`. The `deploy-staging` job runs:
- preflight (it refuses the staging database placeholder);
- the Access pre-check;
- the `RUN_AUTH` migrations on `run-auth-staging`;
- the deploy (it binds `accounts-staging`'s `RunEntrypoint`);
- the smoke test.

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
2. **Sign in.** The address bar goes to staging.accounts, then GitHub (the staging app; approve it the first time), and back to run.
3. **Preferences → Account** says "Signed in as @ril3y", with **Sign out**.
4. DevTools → Application → Cookies → `https://staging.run.synthetos.com`: one `__Host-run_sid`, HttpOnly, Secure, SameSite Strict. No `__Host-run_oauth` remains.
5. DevTools → Network → `/api/identity` answers `{"identity":{"provider":"run-session",…,"display":"@ril3y"},"signIn":true}`.
6. **Connect** passes the sign-in step (C1 appears). With a machine connected, Preferences → Account shows Sign out disabled, with "Disconnect the machine first."
7. Disconnect, then **Sign out**. `/api/identity` now answers `identity: null`, and the cookie is gone. `__Host-acct_sid` on staging.accounts is untouched (sign-out of run only).
8. Optional: with a second GitHub account, Sign in ends at accounts with "Sign-in opens with the public beta."; run stays signed out.

If a check fails, nothing on the machine path depends on sign-in: Pause, Stop job and the stop controls never need it (D1). Roll back by removing the two run secrets (sign-in goes off at once), or with `wrangler rollback` from the dashboard as docs/ops/worker.md says.

## 6. Record it

- In run's `RELEASES.md` (the next entry) and in accounts' README: the staging go-live date, the two `deploy-staging` run URLs, and that §5.3 passed.
- docs/ops/account.md §3 audit: the token change (2.1) and the expected secret-change alerts (4.2, 5.2).

## 7. Production, later (not now)

Production needs its own go-ahead. When you give it, the same order applies:
1. Create the D1 databases `identity` and `run-auth`; put their ids in the two files (the `*_DATABASE_ID_PLACEHOLDER` values).
2. accounts production uses the existing app `Synthetos` (5562809) and its callback `https://accounts.synthetos.com/auth/github/callback`. Its webhook can stay active: production is not behind Access.
3. Approve accounts `deploy-production`, then set its six secrets with **new** values (the production app's client secret, and the production webhook secret).
4. Merge and approve run's `deploy-production`, then set its two secrets with new values.

The allowlist stays `["231731"]` until public beta (D37). Production run still serves `serial=()` until Phase 6 (P1-09), so production can sign in but cannot open a serial port yet. That is a separate decision.
