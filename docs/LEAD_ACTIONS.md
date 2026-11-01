# Lead actions: finishing Phase 0 (P0-15)

Everything in Phase 0 that can be done inside this repository is done and
passes from a clean install (see "State at hand-over" at the end), with one
exception: your decisions D39 and D40 are not yet carried into the gates and
ops pages (Step 0). What is left otherwise needs the owner's accounts:
GitHub, Cloudflare, the registrar. Nobody else can do these steps, and no
code can do them for you.

Do the steps **in this order**. Each one is a precondition of the next one,
and doing them out of order either fails a gate (which is fine) or leaves a
window where something is exposed (which is not). The detailed reasoning for
each control lives in the linked `docs/ops/` page; this page is the
checklist.

Placeholders used below: `<ACCOUNT_ID>` is the dedicated run Cloudflare
account id (32 hex characters), `<SUBDOMAIN>` its workers.dev subdomain,
`<SHA>` the `main` commit that production ends up serving.

---

## Step 0. Two decisions: made, not yet carried into this repository

These came out of the final Phase 0 review, as open owner decisions OD-1 and
OD-2 (`docs/ops/owner-decisions.md`). You have since decided both in
`DECISIONS.md` (synthetos.com, 2026-11-01):

- **D39 (OD-2), supersedes D34:** `run.synthetos.com` (and
  `accounts.synthetos.com`) stay in the **current** Cloudflare account,
  locked down: CI-only deploys with a token scoped to the run and accounts
  Workers only, minimal account members, a hardware-key owner login,
  audit-log alerts on any change CI did not make, and no local
  `wrangler login` used to deploy run or accounts. The reason: Workers custom
  domains need the hostname's zone in the same account as the Worker.
- **D40 (OD-1):** you are the only maintainer for now. Required reviews are
  set to zero, because GitHub never lets authors approve their own PRs.
  Protection comes from the required CI checks, signed and attested
  artifacts, the protected deploy environment and CODEOWNERS, with an
  independent AI review recorded for safety-path changes. The two-approval
  rule for safety paths comes back when a second maintainer joins.

**The repository still implements the old rules.** No fix pass changes a
gate to follow an owner decision without a reviewed change of its own
(`docs/ops/owner-decisions.md`), so, as committed today:

- the `safety-review` check (`tools/gates/src/review/safetyReview.ts`,
  `.github/workflows/safety-review.yml`) still requires **two** approvals
  from reviewers with write access on every safety-path PR. Under D40 that
  check can never pass for you alone. If it stays a required status check
  (Step 6), no safety-path PR merges until it is changed to the D40 rule
  (for example: the recorded independent review, with the two-approval rule
  kept for when a second maintainer joins);
- the Step 6 ruleset below still says `required_approving_review_count: 1`;
  D40 sets it to 0;
- `workers/run/wrangler.jsonc`, `tools/gates/src/deploy/wranglerConfig.ts`,
  `docs/ops/account.md` and `docs/ops/branch-protection.md` still describe a
  dedicated D34 account (the placeholder is named
  `D34_RUN_ACCOUNT_ID_PLACEHOLDER`). Under D39 the id that replaces it in
  Step 2 is the **current** account's id; the checks themselves do not care
  which account it is.

Carry D39 and D40 into those files in one reviewed change, and update
`docs/ops/owner-decisions.md`, before Step 6. Steps 1 to 5 below do not
depend on it, apart from the account named in Step 1.

---

## Step 1. The Cloudflare account (D39, which supersedes D34; D11)

> **D39 replaces this step's first item.** D34 is superseded: do not create a
> new account. Use the current account, locked down as D39 says, and read
> "the account" below as that one: items 2 to 6 (Workers Paid, the account
> id, the workers.dev subdomain, the hardware-key login, no
> `wrangler login` for run) still apply, and item 5's "add no other member"
> becomes "keep members to the minimum". The custom-domain question (OD-2)
> is moot, since the zone is in the same account; Step 11 still confirms that
> attaching the domain works with the token as scoped.

Dashboard only. Details: `docs/ops/account.md` §2 steps 1, 2 and 4.

1. Create a new account under your existing Cloudflare login (not a new
   login). Name it, for example, `synthetos-run`.
2. Subscribe it to **Workers Paid** (D11, $5/month).
3. Copy the **account id** (Workers & Pages → Overview, right-hand side).
   This is `<ACCOUNT_ID>`.
4. Note the account's **workers.dev subdomain** (Workers & Pages →
   Overview). This is `<SUBDOMAIN>`. Do not enable workers.dev for any
   Worker.
5. Make sure your Cloudflare login uses a **hardware security key**, and
   remove TOTP and SMS fallbacks. Add no other member.
6. Never run `wrangler login` against this account.

## Step 2. Put the account id into the repository

Do this locally, before the first push, so it needs no PR.

```sh
cd /Volumes/External/projects/run
ACCOUNT_ID=<ACCOUNT_ID>
printf '%s' "$ACCOUNT_ID" | grep -Eq '^[0-9a-f]{32}$' && echo ok   # must print ok
sed -i '' "s/\"account_id\": \"D34_RUN_ACCOUNT_ID_PLACEHOLDER\"/\"account_id\": \"$ACCOUNT_ID\"/" workers/run/wrangler.jsonc
git diff --stat                                   # exactly one line in workers/run/wrangler.jsonc
corepack pnpm install --frozen-lockfile
corepack pnpm check                               # must pass; the config tests accept a real id
git commit -am "D39: run Cloudflare account id"
```

If carrying D39 in (Step 0) changed how the domain is attached, make that
change in the same way now, and run `corepack pnpm check` again.

## Step 3. Create the GitHub repository (D3), without pushing yet

```sh
gh auth status                                    # logged in as ril3y, with admin on the synthetos org
gh repo create synthetos/run --public \
  --description "run.synthetos.com: browser workspace for Synthetos CNC controllers" \
  --disable-wiki
```

Do not let GitHub add a README, licence or `.gitignore`: the repository
already has them (Apache-2.0, `LICENSE` and `NOTICE`).

## Step 4. Repository settings that must be on before the first workflow run

Details: `docs/ops/branch-protection.md` §4 and §5. The commands below use
the GitHub REST API; each has a dashboard equivalent under Settings.

```sh
R=synthetos/run

# Actions: only GitHub-authored actions, and every action pinned to a full SHA.
gh api -X PUT repos/$R/actions/permissions \
  -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
gh api -X PUT repos/$R/actions/permissions/selected-actions \
  -F github_owned_allowed=true -F verified_allowed=false

# Workflow token: read-only, and it may not create or approve pull requests.
gh api -X PUT repos/$R/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

# Security: private vulnerability reporting (SECURITY.md points to it), Dependabot alerts.
gh api -X PUT repos/$R/private-vulnerability-reporting
gh api -X PUT repos/$R/vulnerability-alerts
```

In the dashboard, also set:
- Settings → Actions → General → **Fork pull request workflows**: require
  approval for all outside collaborators.
- Settings → Actions → General → **Artifact and log retention**: at least
  30 days.
- Then open Settings → Actions → General and confirm that "Require actions
  to be pinned to a full-length commit SHA" shows as on (the API field is
  recent; if it did not take, tick it there).

## Step 5. First push and first CI run

```sh
cd /Volumes/External/projects/run
git remote add origin git@github.com:synthetos/run.git
git push -u origin main
gh run watch --repo synthetos/run --exit-status   # the ci.yml push run
```

Expected: `verify`, `build`, `e2e`, `e2e-fake-serial` and `attest` pass;
`deploy-staging` and `deploy-production` are **skipped**, because
`RUN_DEPLOY_ENABLED` is not set. Save the run URL: it is evidence for
P0-03/P0-06 (traceability item O2).

If anything fails here, it is a real finding: fix it in a commit, push
again (the ruleset is not on yet), and do not continue until the run is
green.

## Step 6. Branch ruleset and environments

Details: `docs/ops/branch-protection.md` §1 and §2. Step 0 must be carried
into the repository first: under D40 the ruleset below takes
`required_approving_review_count: 0`, and `safety-review` stays in its
required checks only once it implements the D40 rule.

**Environments** (deployments only from `main`; production needs your
approval):

```sh
R=synthetos/run
OWNER_ID=$(gh api users/ril3y --jq .id)

BRANCHES='"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}'

echo "{ $BRANCHES }" | gh api -X PUT repos/$R/environments/staging --input -
echo "{ $BRANCHES, \"reviewers\": [{\"type\": \"User\", \"id\": $OWNER_ID}], \"prevent_self_review\": false }" \
  | gh api -X PUT repos/$R/environments/production --input -

for E in staging production; do
  gh api -X POST repos/$R/environments/$E/deployment-branch-policies -f name=main -f type=branch
done
```

**Ruleset for `main`** (save as `ruleset.json` outside the repository, then
create it):

```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "verify" }, { "context": "build" }, { "context": "e2e" },
          { "context": "e2e-fake-serial" }, { "context": "safety-review" } ] } }
  ]
}
```

```sh
gh api -X POST repos/synthetos/run/rulesets --input ruleset.json
```

Leave `bypass_actors` empty: D40 removes the need for a bypass by setting
required reviews to zero, not by exempting you. Check the result under
Settings → Rules → Rulesets against `docs/ops/branch-protection.md` §1 (as
updated for D40).

**Prove the deploy jobs cannot run on a PR** (P0-03 acceptance): open any
small PR (for example a typo fix), and confirm the run summary lists
`attest`, `deploy-staging` and `deploy-production` as skipped. Save that run
URL too. Close or merge the PR.

## Step 7. The single CI token (D39)

Details: `docs/ops/account.md` §2 step 3. In the account (under D39, the
current one): My Profile → API Tokens → Create Token → Custom token:

- **Account → Workers Scripts → Edit**, on that account only (D39 asks for
  it to reach the run and accounts Workers only: narrow it as far as
  Cloudflare allows, and record what it allows);
- **Account → Access: Apps and Policies → Read** (the staging pre-deploy
  Access check);
- no zone permissions, no DNS, no account settings; TTL one year.

Store it only as an **environment** secret, never a repository secret, and
never on disk:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo synthetos/run --env staging      # paste when prompted
gh secret set CLOUDFLARE_API_TOKEN --repo synthetos/run --env production   # same token
```

## Step 8. Cloudflare Access in front of staging (D31)

Details and exact field values: `docs/ops/access.md` §1. In the new
account: Zero Trust → Access → Applications → Add → Self-hosted, domain
`staging.run.synthetos.com` with an empty path, policies "Allow: owner"
(your address) and "Allow: bench machines" only. **No Bypass and no
Everyone rule.** This must exist before the first staging deploy: the
deploy job refuses to deploy staging unless the Access API shows it.

## Step 9. DNS and zone hardening for run.synthetos.com

Details: `docs/ops/account.md` §2 steps 5 to 7. The post-deploy smoke test
checks DNSSEC, CAA and the certificate issuer on **every** deploy, and a
failed smoke test undoes the deploy, so these must be in place first.

1. Set up the hostnames as Workers custom domains (D39: the zone and the
   Worker are in the same account). Do not create DNS records for
   `run.synthetos.com` or `staging.run.synthetos.com` by hand: with custom
   domains the deploy creates them.
2. Remove **DNS:Edit** from every day-to-day token on the `synthetos.com`
   zone (the site's deploy token, forumbot's, your local wrangler token).
3. Turn on **DNSSEC** for `synthetos.com` (DNS → Settings) and add the DS
   record at the registrar. Confirm:
   ```sh
   dig +dnssec synthetos.com SOA @1.1.1.1 | grep -E 'flags:.* ad'
   ```
4. Add **CAA** records on `synthetos.com`: `0 issue "pki.goog"`,
   `0 issue "letsencrypt.org"`, `0 issue "ssl.com"`, the same three as
   `issuewild`, and `0 iodef "mailto:<your address>"`. Compare with
   Cloudflare's current CA list and with `ALLOWED_CAA_ISSUERS` and
   `ALLOWED_ISSUER_ORGS` in `tools/gates/src/smoke/checks.ts`; if they
   differ, change both together in a PR. Confirm:
   ```sh
   dig +short CAA synthetos.com
   ```
5. **Registrar lock** (and registry lock if offered), with the registrar
   login on a hardware key.
6. **Certificate Transparency monitoring** for `run.`, `staging.run.`,
   `accounts.` and `staging.accounts.synthetos.com`, alerting you.
7. **Audit-log alerts** in the new account for Worker uploads, versions,
   deployments, routes, custom domains and secrets made by anyone other than
   the CI token.

## Step 10. Repository variables, then switch deploys on

Details: `docs/ops/branch-protection.md` §3. The preflight refuses a deploy
when `CLOUDFLARE_ACCOUNT_ID` differs from the id committed in Step 2.

```sh
R=synthetos/run
gh variable set CLOUDFLARE_ACCOUNT_ID     --repo $R --body "<ACCOUNT_ID>"
gh variable set RUN_WORKERS_DEV_SUBDOMAIN --repo $R --body "<SUBDOMAIN>"
# Only when Steps 1, 7, 8 and 9 are all done:
gh variable set RUN_DEPLOY_ENABLED        --repo $R --body "true"
```

## Step 11. First deploy

Deploys run only from a push to `main`. Start one by re-running the most
recent `main` push run (variables are read when the jobs run):

```sh
R=synthetos/run
RUN_ID=$(gh run list --repo $R --workflow ci.yml --branch main --event push --limit 1 --json databaseId --jq '.[0].databaseId')
gh run rerun "$RUN_ID" --repo $R
gh run watch "$RUN_ID" --repo $R
```

If the deploy jobs are still skipped on the re-run, the next commit merged
to `main` deploys instead (for example the `RELEASES.md` PR of Step 13, done
before the tag).

What happens, in order (`docs/ops/worker.md`, "A deploy, step by step"):
1. `deploy-staging` verifies the attestation, runs the preflight and the
   positive Access check, deploys, and runs the smoke test. A first deploy
   warns that there is no previous state; that is expected.
2. `deploy-production` waits for your approval. Approve it in the run page
   (Review deployments → production → Approve) only after staging is green.
3. The production smoke test checks the shell, the 404, `/api/health`, the
   exact headers, workers.dev and preview URLs off, DNSSEC, CAA and the
   certificate issuer.

If a step after the deploy fails, the job undoes the deploy (staging is
deleted, production rolled back). If the log says the deployment is STILL
LIVE, take the custom domain off in the dashboard at once.

Two things to confirm on this first deploy, because they could only be
reasoned about locally:
- the smoke test's workers.dev settings read works with the token's scope
  (`docs/ops/account.md` §2 step 3; if it needs a broader scope, do not
  broaden the token, report it);
- attaching the custom domain works with the token as scoped (D39).

## Step 12. Manual checks to record

Record each in the release PR of Step 13.

1. **Access** (`docs/ops/access.md` §3): from a browser profile not signed
   in to Access, `https://staging.run.synthetos.com/` and `/api/health`
   redirect to the Access login; signed in, the shell loads with the §6.4
   headers; `https://run-staging.<SUBDOMAIN>.workers.dev/` does not serve
   the app. `https://run.synthetos.com/` serves the shell publicly.
2. **Smoke output**: copy the output of both "Post-deploy smoke test" steps.
3. **Install check** (`docs/ops/install-check.md`, traceability O3) on
   desktop Chrome and Edge against staging, and fill in its table.
4. **Header-regression drill** (P0-04, `docs/ops/worker.md`, "Acceptance
   items that need the owner"): choose option A or B and record the failing
   run URL.
5. **Release audit** (`docs/ops/account.md` §3): tick the checklist.

## Step 13. RELEASES.md and the tag `run-v0.1.0`

1. In a PR, fill in the three pending lines of the `run-v0.1.0` entry in
   `RELEASES.md` (the deployed commit `<SHA>`, the production deploy run URL,
   the smoke output), change "(pending)" to the date, and attach the Step 12
   records to the PR description. Merge it (this merge deploys again; that
   is fine, it is the same code plus a text file).
2. Tag the commit that production served when you ran the Step 12 checks
   (`<SHA>`, the one named in `RELEASES.md`), not the `RELEASES.md` merge
   commit:

   ```sh
   cd /Volumes/External/projects/run
   git fetch origin
   git tag -a run-v0.1.0 <SHA> -m "run-v0.1.0: Phase 0 foundations (shell and safety page; no serial, no accounts)"
   git push origin run-v0.1.0
   ```

   Use `git tag -s` instead of `-a` if you sign tags.
3. Mark P0-15 and traceability items O1, O2 and O4 as done in
   `docs/safety/PHASE0_TRACEABILITY.md`.

P0-15 is then complete: the production deploy from `main` succeeded with its
smoke output recorded, `run.synthetos.com` and `/safety/` are live, and
staging is behind Access.

---

## Not needed for P0-15, but before Phase 1

From `docs/safety/PHASE0_TRACEABILITY.md` "Open items":

- **Release key** (`docs/ops/release-key.md`): the only key is a
  staging-only placeholder whose private half must be treated as disclosed.
  Create the real key offline, compile it in, re-sign
  `firmware/approved-builds.json`. Bench sessions on staging depend on it.
  When you re-sign, also replace the bench entry's note: the signed bench
  note predates D4 and still calls the build number undecided. It was left
  as signed because changing it needs a new signature
  (`docs/ops/release-key.md`, "The signed bench note predates D4").
- **D4 is done** (edge-next reports `fb` 450.01 at `ead63997`, which is the
  commit `vendor/firmware-pins.json` and the dialect citations are pinned
  to). Still open, and separate from the build number: the `fbs` and `cap`
  tokens D4 recommends (the build reports neither), D5 image approval (no
  image has passed it, so the `release` channel stays empty) and the D6
  published release. If the published release commit differs from
  `ead63997`, re-pin and regenerate the HIL tables (PIN-1, D32). The app
  detects the build by capability probe, never by number alone.
- **O5**: raise mutation score of `packages/safety/src/sanitize/` above 90 %
  and add a mutation or coverage gate to `protocol`, `machine` and `schema`.
- **O6**: copy the in-repo SAFETY.md amendments back into the authoritative
  copy in synthetos.com so the two are identical again.
- **D1 (sign-in required)**: Phase 1 adds the sign-in gate at Connect and
  Start, with a test that revoking the session mid-job changes nothing in
  the machine path. Nothing in Phase 0 consults a session.

---

## State at hand-over (2026-11-01)

From a clean install (`node_modules` and build outputs removed,
`pnpm install --frozen-lockfile`), on Node 22.22.0 and pnpm 10.34.6:

| Check | Command | Result |
|---|---|---|
| Typecheck, lint, boundaries, licences, CI policy, unit tests, build, bundle scan, fake-serial build and diff | `pnpm check` | pass |
| Firmware citations at the pinned commits | `RUN_FIRMWARE_REPO=<TinyG clone> pnpm --filter @synthetos/testkit exec vitest run test/citations.test.ts` | pass |
| Design tokens match synthetos.com | `RUN_SITE_REPO=<synthetos.com clone> pnpm --filter @synthetos/gates exec vitest run test/tokens.test.ts` | pass |
| End-to-end against `wrangler dev` | `pnpm e2e` | 43 passed |
| End-to-end against the CI-shaped artifact, with the canary | `pnpm e2e:artifact` | pass |
| Fake serial in machine.worker | `pnpm e2e:fake-serial` | 2 passed |

Greps: no `TODO`, `FIXME`, `XXX`, `HACK` or stubs in the tracked sources;
`navigator.serial` appears only in comments, documentation, the lint rule
and bundle scan that ban it, and the gate tests; `protocol`, `schema` and
`flasher` have no dependencies, and `safety` and `machine` depend only on
workspace packages (`protocol`, `flasher`).

### Re-run after the P0 review fix pass (2026-11-01)

The independent Phase 0 review's findings were fixed in local commits on
`main` after this hand-over, each with regressions written first. On the
docs fix commit, `pnpm check`, the firmware citation test (against the
pinned commits), `pnpm e2e` (43 passed) and `pnpm e2e:fake-serial`
(2 passed) all pass again. `pnpm e2e:artifact` and the clean-install run
were not repeated. The fix pass changed no owner step above except as Step 0
and the release-key notes say.
