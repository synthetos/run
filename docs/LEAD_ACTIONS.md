# Lead actions: finishing Phase 0 (P0-15)

Everything in Phase 0 that can be done inside this repository is done and
passes from a clean install (see "State at hand-over" at the end). Your
decisions D39 and D40 are carried into the gates and ops pages (Step 0).
What is left needs the owner's accounts:
GitHub, Cloudflare, the registrar. Nobody else can do these steps, and no
code can do them for you.

Do the steps **in this order**. Each one is a precondition of the next one,
and doing them out of order either fails a gate (which is fine) or leaves a
window where something is exposed (which is not). The detailed reasoning for
each control lives in the linked `docs/ops/` page; this page is the
checklist.

Placeholders used below: `<ACCOUNT_ID>` is the id of the **current**
Cloudflare account, the one that holds the `synthetos.com` zone (D39;
32 hex characters), `<SUBDOMAIN>` its workers.dev subdomain,
`<SHA>` the `main` commit that production ends up serving.

---

## Step 0. Your decisions D39 and D40, as carried into this repository

These came out of the final Phase 0 review as open owner decisions OD-1 and
OD-2 (`docs/ops/owner-decisions.md`), and you decided both in `DECISIONS.md`
(synthetos.com, 2026-11-01). The repository now implements them:

- **D40 (OD-1), single maintainer.** The `safety-review` check requires
  **zero** approvals (`REQUIRED_SAFETY_APPROVALS` in
  `tools/gates/src/review/reviewPolicy.ts`) and, on every safety-path PR, a
  **recorded independent review** committed as
  `docs/safety/reviews/pr-<N>.md` and bound to the head commit
  (`docs/safety/reviews/README.md`). The checklist is still required. The
  ruleset in Step 6 takes `required_approving_review_count: 0`, with Code
  Owner review and last-push approval off, because GitHub never lets authors
  approve their own PRs, so either would block you exactly like a required
  approval (`docs/ops/branch-protection.md` §1, "Code Owners with one
  maintainer"). Native branch protection, not the check, is the real
  control: the required status checks, the protected `production`
  environment and the attested artifact. **When a second maintainer
  joins**: change that one line to `2`, and turn the three ruleset settings
  back on (`docs/ops/branch-protection.md` §1, "When a second maintainer
  joins").
- **D39 (OD-2), supersedes D34.** No dedicated account: `run` (and later
  `accounts`) live in the **current** Cloudflare account, locked down
  (`docs/ops/account.md`): CI-only deploys with a token scoped to the run and
  accounts Workers, minimal members, a hardware-key login, audit-log alerts
  on any change CI did not make, and no local deploys of run or accounts.
  The placeholder in `workers/run/wrangler.jsonc` is now
  `RUN_ACCOUNT_ID_PLACEHOLDER`; Step 2 replaces it with the current
  account's id. Because the site, forumbot and accounts share that account,
  service bindings between them work: `pnpm ci-policy` refuses any wrangler
  configuration in this repository other than run's that binds `accounts`
  (`tools/gates/src/bindings/check.ts`).

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
  alerts cover it), and they lose DNS:Edit (Step 9).

Record in those repositories' own lead-actions lists that this is done.

---

## Step 1. The Cloudflare account (D39, which supersedes D34; D11)

Dashboard only. Details: `docs/ops/account.md` §2. **Do not create a new
account** (D39).

1. Use the current account, the one that holds the `synthetos.com` zone.
   Make sure it is on **Workers Paid** (D11, $5/month).
2. Copy the **account id** (Workers & Pages → Overview, right-hand side).
   This is `<ACCOUNT_ID>`.
3. Note the account's **workers.dev subdomain** (Workers & Pages →
   Overview). This is `<SUBDOMAIN>`. Do not enable workers.dev for any
   run or accounts Worker.
4. Make sure your Cloudflare login uses a **hardware security key**, and
   remove TOTP and SMS fallbacks.
5. Keep **members to the minimum**: remove anyone who does not need access,
   give anyone who stays the narrowest role, and record them in
   `docs/ops/account.md`.
6. Never deploy run or accounts from a laptop: no `wrangler login` or local
   token used for them. Record any existing local wrangler login and what it
   is used for (`docs/ops/account.md` §2 step 5).

## Step 2. Put the account id into the repository

Do this locally, before the first push, so it needs no PR.

```sh
cd /Volumes/External/projects/run
ACCOUNT_ID=<ACCOUNT_ID>
printf '%s' "$ACCOUNT_ID" | grep -Eq '^[0-9a-f]{32}$' && echo ok   # must print ok
sed -i '' "s/\"account_id\": \"RUN_ACCOUNT_ID_PLACEHOLDER\"/\"account_id\": \"$ACCOUNT_ID\"/" workers/run/wrangler.jsonc
git diff --stat                                   # exactly one line in workers/run/wrangler.jsonc
corepack pnpm install --frozen-lockfile
corepack pnpm check                               # must pass; the config tests accept a real id
git commit -am "D39: run Cloudflare account id"
```

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

Details: `docs/ops/branch-protection.md` §1 and §2. The ruleset below is the
D40 one: zero required approvals, Code Owner review and last-push approval
off (GitHub never lets authors approve their own PRs), and `safety-review`
a required check, which now requires the recorded independent review on
safety-path PRs instead of approvals.

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
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
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
Settings → Rules → Rulesets against `docs/ops/branch-protection.md` §1.
When a second maintainer joins, set `required_approving_review_count` to 1
and `require_code_owner_review` and `require_last_push_approval` to true, in
the same week as the one-line change in
`tools/gates/src/review/reviewPolicy.ts`.

**Prove the deploy jobs cannot run on a PR** (P0-03 acceptance): open any
small PR (for example a typo fix), and confirm the run summary lists
`attest`, `deploy-staging` and `deploy-production` as skipped. Save that run
URL too. Close or merge the PR.

## Step 7. The single CI token (D39)

Details: `docs/ops/account.md` §2 step 4. In the current account (D39):
My Profile → API Tokens → Create Token → Custom token:

- **Account → Workers Scripts → Edit**, on that account only (D39 asks for
  it to reach the run and accounts Workers only: narrow it as far as
  Cloudflare allows, and record in `docs/ops/account.md` what it can reach);
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

Details and exact field values: `docs/ops/access.md` §1. In the current
account (D39): Zero Trust → Access → Applications → Add → Self-hosted, domain
`staging.run.synthetos.com` with an empty path, policies "Allow: owner"
(your address) and "Allow: bench machines" only. **No Bypass and no
Everyone rule.** This must exist before the first staging deploy: the
deploy job refuses to deploy staging unless the Access API shows it.

## Step 9. DNS and zone hardening for run.synthetos.com

Details: `docs/ops/account.md` §2 steps 6 to 8. The post-deploy smoke test
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
7. **Audit-log alerts** in the account for uploads, versions, deployments,
   routes, custom domains and secrets of the run and accounts Workers made
   by anyone other than the run CI token, and for any change to members,
   API tokens or the zone's DNS records.

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
- **D4 is done** (edge-next reported `fb` 450.01 at `ead63997` and still
  does at `6ec70652`). **Re-pinned 2026-11-02, twice:** `vendor/firmware-pins.json`,
  the dialect citations, the HIL tables and the board tables first followed
  edge-next `97321391` (the merge of the E195 stale-line fix; it also carries
  the stricter input errors E168-E177, E191 and E193 from `d254eb0b`) and now
  follow `6ec70652` (the merge of the spindle and coolant readouts `spe`,
  `spc`, `spd`, `sps`, `cof`, `com`, which also carries the `rt` heartbeat
  family, phase A: `hb`, `qt`, `up`). All of them are read-only in run; the
  bench manifest is re-signed for `6ec70652`. Still
  open, and separate from the build number: the `fbs` and `cap` tokens D4
  recommends (the build reports neither), D5 image approval (no image has
  passed it, so the `release` channel stays empty) and the D6 published
  release. If the published release commit differs from `6ec70652`, re-pin
  and regenerate the HIL tables again (PIN-1, D32). The app detects the build
  by capability probe, never by number alone.
- **O5**: raise mutation score of `packages/safety/src/sanitize/` above 90 %
  and add a mutation or coverage gate to `protocol`, `machine` and `schema`.
- **O6**: copy the in-repo SAFETY.md amendments back into the authoritative
  copy in synthetos.com so the two are identical again.
- **D1 (sign-in required)**: Phase 1 adds the sign-in gate at Connect and
  Start (P1-05, pluggable per D41, accepted 2026-11-02), with a test that revoking the
  session mid-job changes nothing in the machine path. Nothing in Phase 0
  consults a session.

---

## Phase 1, from P1-00 (gate change)

P1-00 lifted the Phase 0 Web Serial ban for `packages/machine/src/webSerialTransport.ts`
only, granted `serial=(self)` on staging and in the localhost bench build,
and kept production at `serial=()`. What only you can do:

- **D41: done (owner, 2026-11-02).** Accepted as proposed
  (`docs/ops/owner-decisions.md` OD-3) and recorded in `DECISIONS.md`
  (synthetos.com). The port chooser gate change was approved the same day
  and is implemented; OD-4 was decided (keep: no Disconnect under
  ORPHANED_MOTION).
- **Production deploys from P1-01 on (now in effect: the P1-01 commit
  wires the transport into the release build).** The production deploy job now scans
  as `--target production`, which refuses any artifact that carries the Web
  Serial transport. From the first P1-01 commit on, `deploy-production`
  fails at that scan on every main push (before anything is deployed), so
  production keeps the Phase 0 shell (P1-09). Either accept the red job
  until Phase 6, or decide on a workflow change that deploys production
  only on demand (a reviewed change of its own; D41 "What the owner should
  weigh").
- **After the first staging deploy behind Access**, open
  https://staging.run.synthetos.com/ signed in through Access and check in
  DevTools (Network, the document response) that `Permissions-Policy`
  starts with `serial=(self)` and every other header matches
  `docs/ops/worker.md`. The post-deploy smoke test cannot see staging
  headers behind Access. Record it in RELEASES.md.
- **Branch protection (row 4)** must be on before the P1-01 transport
  merges (`docs/safety/CODEX_FINDINGS_STATUS.md`).
- The localhost bench build and its bench checks are in
  `docs/bench/README.md`.
- **Sign the safety advisory (P1-05).** `apps/web/public/safety-advisory.json`
  is committed with no entries, so LIVE is refused everywhere (fail closed).
  Review `apps/web/advisory/safety-advisory.unsigned.json` (staging entry,
  nothing revoked) and run `pnpm sign:advisory --key <pem outside the repo>
  --kid <kid>` with a key authorised for staging (docs/ops/release-key.md).
  The bench build on localhost reads the staging entry.
- **Access identity for the D1 gate on staging (P1-05).** Set the staging
  Worker vars `ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) and
  `ACCESS_AUD` (the Access application's AUD tag). Until both are set,
  `GET /api/identity` answers `not-configured` and Connect is refused on
  staging.

## Phase 1: your actions to finish it (P1-09)

In order. Everything before step 5 is a decision or a setting; nothing
here needs code from you.

1. **D41**: done 2026-11-02 (accepted, recorded in `DECISIONS.md`).
2. **The port chooser gate change**: approved and implemented 2026-11-02
   (02fea94, c75f8c1). It still needs its recorded independent review (D40)
   with step 3.
3. **Branch protection (row 4)** on, then the independent D40 review of
   P1-00 to P1-08 (each task's commits; traced in
   `docs/safety/PHASE1_TRACEABILITY.md`) and the re-verification of rows 4,
   9, 10, 12, 13, 17, 19, 33, 34, 35 (`docs/safety/CODEX_FINDINGS_STATUS.md`).
4. **Re-sign the bench manifest note (row 18)**, sign the safety advisory
   (above), and set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` on staging.
5. **Bench rig (D10)**: E-stop, J6 LED and relay, Saleae, USB power switch;
   set the `SerialAllowUsbDevicesForUrls` policy (`docs/bench/policy.md`,
   B-POL-1).
6. **Run the bench checklist** on the staging artifact (`docs/bench/GUIDE.md`
   §8, `docs/bench/README.md` BENCH-P100 to P109): HIL-1.1 to HIL-1.12 and
   B-ID-1, B-SIG-1, T2.1, B-PROBE-1, B-MD-1, B-EXCL-1, B-SPLICE-1. Commit the
   probe fixtures with the board id replaced by the placeholder.
7. **Record the release** in `RELEASES.md`: HIL record id, artifact hash, the
   bench board's EN commit and `fb`. Production stays the Phase 0 shell.

Built on 2026-11-02 (were "still to build before step 6"): the window's
port chooser and Connect (OD-3), the axis-mode facts (BENCH-P100-5),
**Save transcript**, and T-S19 with the 1M-segment preview loaded.

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
