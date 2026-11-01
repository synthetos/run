# Owner decisions from the Phase 0 reviews

These questions came out of the Phase 0 reviews. Only the owner can decide
them, because each one is a trade-off between safety controls and the
owner's accounts, not a coding question. Nothing in this repository decides
them, and no fix pass may change the decisions they lead to (D39, D40, the review
rules in `docs/ops/branch-protection.md`) without the owner.

Record each decision in `DECISIONS.md` (synthetos.com) when it is made, then
update this page and the pages it names in one reviewed PR.

| ID | Question | Status | Blocks |
|---|---|---|---|
| OD-1 | How does a solo maintainer meet the review rules? | **DECIDED as D40 (owner, 2026-11-01); carried into this repository** | — |
| OD-2 | How does `run.synthetos.com` reach a Worker in the dedicated D34 account, when the `synthetos.com` zone is in another account? | **DECIDED as D39 (owner, 2026-11-01), superseding D34; carried into this repository** | — |

Both decisions are recorded in `DECISIONS.md`, and the gates and ops pages
now implement them (`docs/LEAD_ACTIONS.md` Step 0 summarises what changed
and what the accounts and site repositories must match).

---

## OD-1. The solo-maintainer review rule

**Decision (D40, owner, 2026-11-01).** The owner is the only maintainer for
now. Required reviews are set to zero, because GitHub never lets authors
approve their own PRs. Protection comes from the required CI status checks,
signed and attested artifacts, the protected deploy environment and
CODEOWNERS, with an independent AI review recorded for safety-path changes.
The two-approval rule for safety paths is restored when a second maintainer
joins.

**As implemented here.** `safety-review` requires zero approvals
(`REQUIRED_SAFETY_APPROVALS` in `tools/gates/src/review/reviewPolicy.ts`)
and, on every safety-path PR, the SAFETY §8 checklist and a recorded
independent review committed as `docs/safety/reviews/pr-<N>.md`, bound to
the head commit (`docs/safety/reviews/README.md`). The ruleset
(`docs/LEAD_ACTIONS.md` Step 6, `docs/ops/branch-protection.md` §1) requires
zero approvals and has Code Owner review and last-push approval off, since
GitHub never lets authors approve their own PRs. The `safety-review-job`
CI-policy rule against a PR weakening its own enforcement workflow stays,
and native branch protection stays the primary control. Restoring the
two-approval rule is a one-line change to that constant plus three ruleset
settings.

The analysis that led to it:

**The problem.** The `main` ruleset requires one approving review and Code
Owner review, and the `safety-review` check requires **two** approvals from
reviewers other than the author, each with write access to the repository,
on any PR that touches a safety path (`tools/gates/src/shared/safetyPaths.ts`,
which includes `.github/`, `tools/gates/`, `workers/run/wrangler.jsonc`,
`SAFETY.md` and `pnpm-lock.yaml`). GitHub never lets authors approve their own
PR. With one maintainer:
- a PR by the owner cannot get any approval, so no PR merges without a
  bypass;
- a PR by anyone else touching a safety path can get at most one qualifying
  approval (the owner's), so it cannot pass `safety-review` either.

The rules are deliberately not weakened in code to make this work: the second
reviewer is what SAFETY §8 asks for ("A second reviewer signs the 'Safety
review' approval"), and the trust fix for `safety-review` (reviewers' actual
repository permission, native branch protection as the primary control)
makes it stricter, not looser.

**Options for the owner** (from `docs/LEAD_ACTIONS.md` Step 0b):
1. Add a second maintainer with write access. This is the intended fix and
   needs no change to any rule.
2. Put the owner on the ruleset's bypass list "for pull requests only", and
   record every use, with its reason, in the PR. Safety-path PRs then merge
   on one person's judgement, which SAFETY §8 does not intend; say so in the
   decision record if this is chosen, with an end date.
3. Something else the owner chooses (for example a time-limited exception
   until a named second reviewer starts).

The options above are kept as the record of what was considered.

## OD-2. The D34 custom domain and the zone's account

**Decision (D39, owner, 2026-11-01), superseding D34.** Keep
`run.synthetos.com` (and `accounts.synthetos.com`) in the current Cloudflare
account, locked down: CI-only deploys with a token scoped to the run and
accounts Workers only, minimal account members, a hardware-key owner login,
audit-log alerts on any change not made by CI, and no local `wrangler login`
used to deploy run or accounts. Workers custom domains must be on a zone in
the same account.

**As implemented here.** `workers/run/wrangler.jsonc`,
`tools/gates/src/deploy/wranglerConfig.ts`, `docs/ops/account.md`,
`docs/ops/branch-protection.md` and `docs/LEAD_ACTIONS.md` describe the
current account with the D39 lockdown; the account id placeholder is
`RUN_ACCOUNT_ID_PLACEHOLDER` (still refused by every deploy). `pnpm
ci-policy` refuses any wrangler configuration other than run's that binds
`accounts` (`tools/gates/src/bindings/check.ts`), and `docs/LEAD_ACTIONS.md`
Step 0 records the matching requirement for the accounts and site
repositories.

The analysis that led to it:

**The problem.** D34 puts the `run` Worker in a new, dedicated Cloudflare
account; the `synthetos.com` zone stays in the existing account.
`workers/run/wrangler.jsonc` attaches `run.synthetos.com` and
`staging.run.synthetos.com` as Workers **custom domains**
(`custom_domain: true`), and `tools/gates/src/deploy/wranglerConfig.ts`
requires exactly that. As far as is known, Workers custom domains and
routes need the hostname's zone in the same account as the Worker, and
attaching one may need a zone permission the CI token deliberately does not
have (it holds Workers Scripts:Edit and Access: Apps and Policies:Read on the
dedicated account only). `docs/ops/account.md` §2 step 5 assumed a
cross-account custom-domain flow that may not exist. This is unverified.

**First step (owner, in the dashboard):** once the dedicated account exists,
try to add `staging.run.synthetos.com` as a custom domain of a throwaway
Worker in it. If that works with no zone permission on the CI token, there is
nothing to decide.

**Options if it does not work** (from `docs/LEAD_ACTIONS.md` Step 0a):
1. **Subdomain zone.** A zone `run.synthetos.com` in the dedicated account,
   delegated with NS records (and a DS record for DNSSEC) from
   `synthetos.com`. Keeps D34's isolation. Plan limits on subdomain zones
   apply.
2. **Cloudflare for SaaS.** The dedicated account holds a zone with custom
   hostnames for both names, which `synthetos.com` CNAMEs to. Works across
   accounts, but Access, DNSSEC, CAA and the smoke test's checks must be
   re-checked against it.
3. **Move the zone** into the dedicated account. This undoes the reason for
   D34 (the site and forumbot would share the account again) and is not
   recommended.

**What changes with the choice:** `routes` in `workers/run/wrangler.jsonc`,
the checks in `tools/gates/src/deploy/wranglerConfig.ts` (which pin those
routes), the CI token's scope in `docs/ops/branch-protection.md` §2, and the
smoke test's DNSSEC, CAA and certificate checks, all in one reviewed PR.

The options above are moot under D39 and kept as the record. Deploys stay off
(`RUN_DEPLOY_ENABLED` unset) until the Step 1 to 10 owner actions are done,
and the preflight refuses while `account_id` is the placeholder.
