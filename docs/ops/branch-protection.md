# Repository settings the owner must enable

ROADMAP P0-03: "Document the branch protection the owner must enable:
required checks, one review, two for safety paths." DECISIONS D40 (owner,
2026-11-01) changes the review part while the owner is the only maintainer;
this page describes the D40 settings and the change back when a second
maintainer joins. Nothing here can be set from the repository. These are
GitHub settings on `synthetos/run`.

## 1. Branch ruleset for `main`

Settings → Rules → Rulesets → New branch ruleset. Target: the default branch.
Enforcement: **Active**.

- **Restrict deletions**: on.
- **Block force pushes**: on.
- **Require linear history**: on.
- **Require a pull request before merging**: on.
  - Required approvals: **0** (D40). GitHub never lets authors approve their
    own pull requests, so with one maintainer any other number blocks every
    PR the owner opens.
  - Dismiss stale pull request approvals when new commits are pushed: **on**.
  - Require review from Code Owners: **off while D40's single maintainer is
    the only one** (see "Code Owners with one maintainer" below), on again
    with a second maintainer.
  - Require approval of the most recent reviewable push: **off** while
    required approvals are 0 (it would require an approval nobody can give);
    on again with a second maintainer.
  - Require conversation resolution before merging: on.
- **Require status checks to pass**: on. Require branches to be up to date
  before merging: **on**. Required checks:
  - `verify` (every gate: lint, boundaries, licences, CI policy, CODEOWNERS
    coverage, the PR template, the accounts-binding rule, the safety
    traceability and bench-record tests, every unit suite)
  - `build`
  - `e2e`
  - `e2e-fake-serial` (P0-14)
  - `safety-review`
- **Bypass list**: empty. D40 removes the need for a bypass by setting
  required approvals to zero, not by exempting the owner. If an emergency
  bypass is ever needed, the owner alone may bypass, and every use is
  recorded in the PR with its reason.

### What actually enforces review: native branch protection first

The **primary** controls are GitHub's own settings on this page: the
required status checks above (with "up to date" on), the protected
`production` environment with the owner as required reviewer (§2), and,
from the moment there is a second maintainer, required approvals (GitHub
counts only approvals from people with write access), Code Owner review,
stale-approval dismissal and approval of the most recent push. GitHub
enforces these outside anything a pull request can change. The deploy jobs
deploy only the signed, attested artifact of a `main` push (`docs/ops/ci.md`).

The `safety-review` check is a **secondary** control. Its workflow runs on
`pull_request`, and GitHub takes the definition of a `pull_request` workflow
from the PR itself. The gate code is checked out from the base commit, but a
PR could rewrite `safety-review.yml` (and `tools/gates/src/workflow/policy.ts`,
which checks that file). `pnpm ci-policy` keeps a rule against exactly that
(`safety-review-job`: replacing the gate step with `run: true`, checking out
the head, or dropping the permissions or the review record all fail it), and
such a PR touches safety paths, so it needs its own recorded independent
review. But both run from the same PR: do not rely on the check alone. With
a second maintainer, Code Owner review of `.github/` and `tools/gates/` is
what stops it.

### Safety-path PRs under D40: the recorded independent review

GitHub cannot require a different number of approvals for different paths,
and with one maintainer it cannot require any. The required `safety-review`
check (`.github/workflows/safety-review.yml`) adds the safety-path rules.
When a PR touches a path in `tools/gates/src/shared/safetyPaths.ts`, it fails
until all of these hold:

- the SAFETY §8 checklist from `.github/pull_request_template.md` is in the
  PR description, with all 40 items ticked;
- the PR commits its **recorded independent review** as
  `docs/safety/reviews/pr-<N>.md` (format: `docs/safety/reviews/README.md`,
  checked by `tools/gates/src/review/reviewRecord.ts`). The record names the
  reviewed commit and a reviewer other than the author, has the verdict
  `approve` and no open findings, and lists every safety path the PR touches.
  The check reads it at the head commit and asks GitHub to compare the
  reviewed commit with the head: the head must be strictly ahead of it, and
  the only file changed after it must be the record. Any later push, or a
  merge of `main` into the branch, needs a new review of the new commit;
- `REQUIRED_SAFETY_APPROVALS` approvals of the head commit from reviewers
  other than the author with write, maintain or admin permission **at the
  time the check runs** (`GET /repos/{owner}/{repo}/collaborators/{username}/permission`;
  `author_association` is never used). Under D40 this is **0**
  (`tools/gates/src/review/reviewPolicy.ts`).

The record is an auditable statement, not an identity check: with one
maintainer nothing on GitHub can prove who wrote it. That is the trade-off
D40 accepts; the independent reviewer re-runs its own reproductions, and
the record keeps what was reviewed and when.

### Code Owners with one maintainer

`.github/CODEOWNERS` stays as it is, and `pnpm ci-policy` keeps every
SAFETY §8 path owned by the owner, so GitHub still requests the owner's
review on those paths. But "Require review from Code Owners" asks for an
approval from a code owner **other than the author**; with the owner as the
only code owner, every PR the owner opens on a CODEOWNERS path would be
blocked, exactly like required approvals. So it is off under D40 and comes
back on with a second maintainer. Until then, the owner being the only
person with write access (and the only environment reviewer) is what
CODEOWNERS describes.

### When a second maintainer joins

1. In the repository, change one line in
   `tools/gates/src/review/reviewPolicy.ts`:
   `export const REQUIRED_SAFETY_APPROVALS: number = 2;`
   (`tools/gates/test/review-policy.test.ts` proves that this one line brings
   back the two-approval rule). Merge it as a normal safety-path PR.
2. In the ruleset: required approvals **1**, Require review from Code Owners
   **on**, Require approval of the most recent reviewable push **on**.
3. In the `production` environment: turn "Prevent self-review" on.
4. Add the new maintainer to `.github/CODEOWNERS` only if they are to own
   paths; the owner stays a required reviewer of the SAFETY §8 paths.

## 2. Environments

Settings → Environments.

| Environment | Deployment branches | Required reviewers | Secrets | Variables |
|---|---|---|---|---|
| `staging` | **Selected branches: `main` only** | none (optional: owner) | `CLOUDFLARE_API_TOKEN` | none |
| `production` | **Selected branches: `main` only** | **owner** (`@ril3y`). "Prevent self-review" stays off until a second maintainer exists | `CLOUDFLARE_API_TOKEN` | none |

- Store `CLOUDFLARE_API_TOKEN` **only as an environment secret**, never as a
  repository or organisation secret. Then no job without the environment can
  read it, even if the workflow policy were bypassed.
- The token is the single CI deploy token for run (D39). It lives in the
  **current** Cloudflare account, which also holds the `synthetos.com` zone,
  the site and forumbot (D39 supersedes D34's dedicated account). Its
  permissions are **Workers Scripts:Edit** and **Access: Apps and
  Policies:Read** (the staging pre-deploy Access check), on that account,
  narrowed to the run and accounts Workers as far as Cloudflare allows; it has
  no zone or DNS permission. What Cloudflare actually lets it reach is
  recorded in `docs/ops/account.md` §2. Nobody deploys run from a laptop.

## 3. Repository variables

Settings → Secrets and variables → Actions → Variables:

| Variable | Value | When |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | the current account's id (D39), the same id that replaces `RUN_ACCOUNT_ID_PLACEHOLDER` in `workers/run/wrangler.jsonc` | when the D39 lockdown (`docs/ops/account.md` §2) is in place |
| `RUN_WORKERS_DEV_SUBDOMAIN` | the account's workers.dev subdomain | with the account id. The smoke test probes `https://run.<it>.workers.dev/` and fails if anything answers (SAFETY H45) |
| `RUN_DEPLOY_ENABLED` | `true` | only after D39 (the account locked down), D11 (Workers Paid), P0-04 (Worker configuration) and D31 (Access on staging) are all done. While it is unset, the deploy jobs are skipped |

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
