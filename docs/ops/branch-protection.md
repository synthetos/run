# Repository settings the owner must enable

ROADMAP P0-03: "Document the branch protection the owner must enable:
required checks, one review, two for safety paths." Nothing here can be
set from the repository. These are GitHub settings on `synthetos/run`, and
the CODEOWNERS file binds only when they are enabled.

## 1. Branch ruleset for `main`

Settings → Rules → Rulesets → New branch ruleset. Target: the default branch.
Enforcement: **Active**.

- **Restrict deletions**: on.
- **Block force pushes**: on.
- **Require linear history**: on.
- **Require a pull request before merging**: on.
  - Required approvals: **1**.
  - Dismiss stale pull request approvals when new commits are pushed: **on**.
  - Require review from Code Owners: **on**. This makes the owner a required
    reviewer for the SAFETY §8 paths in `.github/CODEOWNERS`.
  - Require approval of the most recent reviewable push: **on**.
  - Require conversation resolution before merging: on.
- **Require status checks to pass**: on. Require branches to be up to date
  before merging: **on**. Required checks:
  - `verify`
  - `build`
  - `e2e`
  - `e2e-fake-serial` (P0-14)
  - `safety-review`
- **Bypass list**: empty. If an emergency bypass is ever needed, the owner
  alone may bypass, and every use is recorded in the PR with its reason.

### What actually enforces review: native branch protection first

The **primary** review control is GitHub's own branch protection above:
required approvals (GitHub counts only approvals from people with write
access to the repository), "Require review from Code Owners" (the owner
must approve every CODEOWNERS path, which includes `.github/`,
`tools/gates/`, `workers/run/wrangler.jsonc` and the SAFETY §8 paths),
stale-approval dismissal and approval of the most recent push. GitHub
enforces these outside anything a pull request can change.

The `safety-review` check is a **secondary** control. Its workflow runs on
`pull_request`, and GitHub takes the definition of a `pull_request` workflow
from the PR itself. The gate code is checked out from the base commit, but a
PR could rewrite `safety-review.yml` (and `tools/gates/src/workflow/policy.ts`,
which checks that file). Such a PR touches `.github/` and `tools/gates/`, so
it cannot merge without the owner's Code Owner approval: that, not the
check, is what stops it. Do not rely on the check alone.

### Two reviews for safety paths

GitHub cannot require a different number of approvals for different paths.
The required `safety-review` check adds the second review
(`.github/workflows/safety-review.yml`). When a PR touches a path in
`tools/gates/src/shared/safetyPaths.ts`, it fails until both of these hold:
- the SAFETY §8 checklist from `.github/pull_request_template.md` is in the
  PR description, with all 40 items ticked;
- **two** reviewers other than the author have approved the PR's head
  commit, each holding **write, maintain or admin permission on this
  repository at the time the check runs**. The workflow asks GitHub for each
  reviewer's current permission
  (`GET /repos/{owner}/{repo}/collaborators/{username}/permission`) and the
  gate counts only `write` or `admin` answers (maintain is reported as
  write) from non-bot accounts. `author_association` is not used: it
  describes a relationship, and an organisation MEMBER can have read,
  triage or no access to this repository. A reviewer whose permission is
  read, triage or none, whose permission was revoked after approving, or
  whose permission could not be fetched does not count. Approvals from
  outside contributors do not count: the repository is public.
  A later "changes requested" or a dismissal cancels an approval.

It re-runs when the PR is edited or reviewed. A permission revoked after the
last run is only seen on the next run, which is one more reason the native
rules above come first.

**Solo maintainer:** this is an open OWNER DECISION, recorded in
`docs/ops/owner-decisions.md` (OD-1). Nothing in this repository decides it.

## 2. Environments

Settings → Environments.

| Environment | Deployment branches | Required reviewers | Secrets | Variables |
|---|---|---|---|---|
| `staging` | **Selected branches: `main` only** | none (optional: owner) | `CLOUDFLARE_API_TOKEN` | none |
| `production` | **Selected branches: `main` only** | **owner** (`@ril3y`). "Prevent self-review" stays off until a second maintainer exists | `CLOUDFLARE_API_TOKEN` | none |

- Store `CLOUDFLARE_API_TOKEN` **only as an environment secret**, never as a
  repository or organisation secret. Then no job without the environment can
  read it, even if the workflow policy were bypassed.
- The token is the single CI token of the dedicated run Cloudflare account
  (D34). Its permissions are **Workers Scripts:Edit** and **Access: Apps and
  Policies:Read** (the staging pre-deploy Access check), on the dedicated
  account only. Cloudflare API tokens cannot be limited to single scripts, so
  the account holding only `run` and `run-staging` (and later `accounts`) is
  what bounds it. Create it after the account exists. See
  `docs/ops/account.md`.

## 3. Repository variables

Settings → Secrets and variables → Actions → Variables:

| Variable | Value | When |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | the dedicated run account's id (placeholder until D34) | when the account exists |
| `RUN_WORKERS_DEV_SUBDOMAIN` | the dedicated account's workers.dev subdomain | when the account exists. The smoke test probes `https://run.<it>.workers.dev/` and fails if anything answers (SAFETY H45) |
| `RUN_DEPLOY_ENABLED` | `true` | only after D34 (account), D11 (Workers Paid), P0-04 (Worker configuration) and D31 (Access on staging) are all done. While it is unset, the deploy jobs are skipped |

## 4. Actions settings

Settings → Actions → General.

- **Actions permissions**:
  - allow only actions created by GitHub (`actions/*`);
  - enable "Require actions to be pinned to a full-length commit SHA".
- **Fork pull request workflows**: require approval for all outside
  collaborators.
- **Workflow permissions**: Read repository contents only. Leave "Allow
  GitHub Actions to create and approve pull requests" **off**.
- **Artifact and log retention**: at least 30 days, so that the logs proving
  "deploy jobs skipped on a PR" outlive the review.

## 5. Security

- Enable private vulnerability reporting (`SECURITY.md` points to it).
- Enable Dependabot alerts. Version-update PRs are optional, and they still
  wait out `minimumReleaseAge`.
