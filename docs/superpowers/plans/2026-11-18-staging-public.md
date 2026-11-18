# Staging Public (D31 superseded) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** staging.run.synthetos.com and staging.accounts.synthetos.com stop sitting behind Cloudflare Access, so an anonymous visitor to staging meets the same run sign-in dialog as on production; the deploy gates refuse while an Access application still covers staging and prove afterwards that staging answers like production.

**Architecture:** the Worker applies production's serial rule to staging (serial=(self) only with a validated run.connect session, plus the open /update/ HTML page); the dead Access-JWT identity path goes. The smoke checks invert: the Cloudflare API must show NO self-hosted Access application covering the staging host (a clean pre-deploy refusal while the owner has not deleted it yet), and post-deploy staging gets production's HTTP checks plus "no Access redirect". A failed staging smoke now rolls back like production instead of deleting the Worker (the deletion existed only because older code could not restore a removed Access application).

**Tech Stack:** TypeScript Worker, dependency-free gate scripts, vitest, Playwright, GitHub Actions; accounts repo: plain node ESM + node:test.

**Spec:** owner decision OD-40 (this plan's Task 5 writes it into docs/ops/owner-decisions.md). Owner's words, 2026-11-17/18: "production says sign in works soon but staging shows this they should show the same sign in with dimming modal on the staging not this generic cloudflare login" and "remove access". Supersedes D31 (docs/ops/access.md).

## Global Constraints

- No Claude or AI attribution in commits. Plain imperative messages.
- Modular code: ≤400 lines/file, ≤80/function, complexity ≤15, ≤4 params; `tools/gates/modularity-baseline.json` only shrinks.
- Agents never run full gates; targeted vitest/tsc/eslint only. Lead gates run once at the end with `LEAD_GATES=1`.
- Safety-path files (workers/run/src/headers.ts, docs/safety) change only as this plan says; CSP and Trusted Types untouched.
- The deploy token keeps "Access: Apps and Policies Read": the API check needs it.
- Fail closed: "unreachable" never passes a post-deploy check; the pre-deploy API check must pass before an unreachable host is tolerated.

## Review Focus

1. A hosted staging document for an anonymous visitor must carry `serial=()`; only a validated run.connect session (or the exact /update/ HTML page) gets `serial=(self)`.
2. With the Access application still present, `--pre-deploy` must refuse (exit 1) and nothing may be deployed or deleted.
3. A staging smoke failure after a successful deploy rolls back to the previous version; a failed deploy step must NOT roll back (it would revert the healthy previous version).
4. `checkNoAccessApplications` must treat an unreadable application list as a finding, never as "no application".
5. The accounts check must accept any non-Access answer below 500 on `/` and `/login`, and fail an Access redirect or a 5xx.

---

### Task 1: The Worker applies production's serial rule to staging; the Access identity path goes

**Files:**
- Modify: `workers/run/src/headers.ts` (grantsSerial, comments), `workers/run/src/routes.ts` (identity(), Env), `workers/run/wrangler.jsonc` (comment)
- Delete: `workers/run/src/accessIdentity.ts`
- Modify: `tools/gates/src/source/workerUpstreams.ts` (drop the two accessIdentity entries)
- Modify: `packages/contracts/src/index.ts` (IdentityProvider = 'run-session'; reason drops 'not-configured')
- Modify: `apps/web/src/live/authGate.ts` (remove accessProvider and the 'access' kind; signInAvailable keeps bench)
- Test: `workers/run/test/headers.test.ts`, `workers/run/test/identity.test.ts`, `apps/web/test/account.test.ts`, `apps/web/test/liveEntry.test.ts`, `tools/gates/test/worker-upstreams*.test.ts` if one lists the entries

**Interfaces:**
- Produces: `grantsSerial(runEnv, url, connectAllowed=false, htmlDocument=false)` unchanged signature; staging now returns true only when `connectAllowed || (htmlDocument && pathname === '/update/')`.
- Produces: `IdentityBody.identity.provider` is always `'run-session'`.

- [ ] Step 1: headers.test.ts: change the staging expectations: `grantsSerial('staging', staging '/')` → false; with `connectAllowed=true` → true; `/update/` HTML → true; `/update/` non-HTML → false. Run `cd workers/run && pnpm exec vitest run test/headers.test.ts`. Expected: FAIL on the flipped assertions.
- [ ] Step 2: implement in headers.ts: `own = (staging&&host) || (production&&host)`; `return own && (connectAllowed || (htmlDocument && url.pathname === '/update/'))`. Update the doc comments (no "behind Access"). Run the test. Expected: PASS.
- [ ] Step 3: identity.test.ts: remove the Access JWT describe blocks; add a test that on staging without a run session `/api/identity` answers `{identity:null, reason:'not-signed-in', signIn}` (signIn false without auth config). Run → FAIL (route still imports accessIdentity / returns not-configured). Then remove the branch and the import from routes.ts, drop `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` from Env, delete accessIdentity.ts, remove the `fetchCerts` parameter from `route()` if it only served Access (check callers in index.ts/tests). Run → PASS.
- [ ] Step 4: contracts: `IdentityProvider = 'run-session'`, reason union without `'not-configured'`. apps/web: delete `accessProvider`, the `'access'` provider kind and its composition for staging; fix the tests that used it (account.test.ts, liveEntry.test.ts) by deleting the Access cases, not by faking them. `cd apps/web && pnpm exec vitest run test/account.test.ts test/liveEntry.test.ts` → PASS; `pnpm exec tsc --noEmit -p apps/web` and `-p workers/run` → clean.
- [ ] Step 5: workerUpstreams.ts: remove the two accessIdentity entries; adjust the staging accounts `why` text ("Staging accounts: the browser is redirected..."). Run the upstream test file (`tools/gates/test` grep workerUpstreams) → PASS.
- [ ] Step 6: `pnpm exec eslint workers/run/src apps/web/src/live packages/contracts/src tools/gates/src/source`; commit "Apply production's serial rule to staging and drop the Access identity".

### Task 2: Smoke checks invert: no Access application, staging answers like production

**Files:**
- Modify: `tools/gates/src/smoke/checks.ts`, `tools/gates/src/smoke/cli.ts`
- Test: `tools/gates/test/smoke.test.ts`

**Interfaces:**
- Produces: `expectedHeadersFor(url, signedIn=false)`: own hosts (production or staging) → signedIn ? SERIAL_GRANTED : SECURITY_HEADERS; others SECURITY_HEADERS.
- Produces: `checkNoAccessApplications(host, apps: unknown): SmokeFinding[]` (check 'access'): non-array → finding "could not be read"; any `self_hosted` app whose domains cover host → one finding per app naming its `name`/`id`: "... still covers <host>: delete the Access application in Zero Trust → Access → Applications (OD-40)".
- Produces: `checkPublicGate(url, outcome, allowUnreachable): SmokeFinding[]` (check 'access'): unreachable → allowUnreachable ? [] : finding; redirect whose location hostname endsWith `.cloudflareaccess.com` → finding "still behind Cloudflare Access"; status ≥ 500 → finding; else [].
- Removes: `checkAccessGate`, `checkAccessApplications`, `AccessPolicy`.

- [ ] Step 1: smoke.test.ts: replace the two D31 describes with tests for the new functions (coverage: whole-host, `/*`, wildcard, self_hosted_domains, destinations; path-only app and other type and other host pass; null list fails; redirect to Access fails; 200 passes; 302 elsewhere passes; 503 fails; unreachable per flag). Flip the `expectedHeadersFor` staging expectation to SECURITY_HEADERS (and SERIAL_GRANTED with signedIn). Run `cd tools/gates && pnpm exec vitest run test/smoke.test.ts` → FAIL (imports missing).
- [ ] Step 2: implement in checks.ts; delete the old functions. Run → PASS.
- [ ] Step 3: cli.ts: `accessApi(host)` lists apps (no policies fetch) and returns `checkNoAccessApplications`. Pre-deploy: `[...api, ...checkPublicGate(url, probe, api.length === 0)]`. Post-deploy staging: `httpChecks(https://host, 'staging')` then `checkPublicGate` on `/` with allowUnreachable=false, then the API check; keep settle(). Update the header comment. `pnpm exec tsc --noEmit -p tools/gates`; the smoke CLI local-mode test in smoke.test.ts still passes.
- [ ] Step 4: eslint tools/gates/src/smoke; commit "Smoke: staging must be public and answer like production".

### Task 3: A failed staging smoke rolls back instead of deleting the Worker

**Files:**
- Modify: `tools/gates/src/deploy/rollback.ts`, `tools/gates/src/deploy/rollbackStatus.ts` (wording), `tools/gates/src/workflow/policy.ts` (ROLLBACK_IF.staging, comment lines 53-58), `.github/workflows/ci.yml` (staging undo `if:` and both undo step names)
- Test: `tools/gates/test/rollback.test.ts`, `tools/gates/test/deploy-workflow.test.ts` (if it pins ROLLBACK_IF), `tools/gates/test/workflow-policy*.test.ts`

**Interfaces:**
- Produces: `rollbackPlan('staging')` = `[['rollback','--config',WRANGLER_CONFIG,'--env','staging','--yes','--message','post-deploy smoke test failed']]`.
- Produces: ci.yml staging undo step `if: failure() && steps.deploy.outcome == 'success' && steps.site_smoke.outcome == 'failure'`; policy `ROLLBACK_IF.staging` equals that.

- [ ] Step 1: rollback.test.ts: expect the new staging plan; the CLI test log line changes; `rollbackFailure('staging','absent')` wording "absent". Run → FAIL. Implement. Run → PASS.
- [ ] Step 2: policy.ts: ROLLBACK_IF.staging = production's condition; update the rule comment; run the policy tests (`pnpm exec vitest run test/deploy-workflow.test.ts` and any `policy` test) → they fail on ci.yml until Step 3.
- [ ] Step 3: ci.yml: staging undo `if:` and both step names ("Undo the deployment when the smoke test failed (rolled back to the previous version)"). Policy tests → PASS. `node tools/gates/src/workflow/policy-cli.ts` if such a CLI exists → clean.
- [ ] Step 4: commit "Roll staging back like production when its smoke test fails".

### Task 4: CI step names, policy message, staging e2e headers

**Files:**
- Modify: `.github/workflows/ci.yml` (pre-deploy step name → "Staging must be public: no Cloudflare Access application (OD-40)"), `tools/gates/src/workflow/policy.ts` (smoke-credentials message), `tools/gates/test/deploy-workflow.test.ts` (preDeploy string), `tools/e2e/specs/headers.staging.ts`, `tools/e2e/src/served.ts` (comment), `tools/gates/src/deploy/wranglerConfig.ts` (comments)
- Test: deploy-workflow.test.ts; `tools/e2e/specs/headers.staging.ts` run via `pnpm build && cd tools/e2e && pnpm exec playwright test --config playwright.staging.config.ts`

- [ ] Step 1: headers.staging.ts: mirror headers.e2e.ts for staging: anonymous responses carry SECURITY_HEADERS exactly once; `/api/health` env 'staging'; featurePolicy serial false; the serial probe refuses in page and worker. Run the staging suite → FAIL before Task 1? (Task 1 is done, so it should PASS; if it passes immediately, the test was written after the change: acceptable here because the Worker change was itself TDD'd in Task 1; record as a Ruling.)
- [ ] Step 2: ci.yml step name + policy message + test string; `pnpm exec vitest run test/deploy-workflow.test.ts` → PASS.
- [ ] Step 3: commit "Name the staging public check and test staging headers like production".

### Task 5: Docs and the decision record

**Files:**
- Modify: `docs/ops/owner-decisions.md` (append OD-40), `docs/ops/access.md` (rewrite: "Staging is public (OD-40)"; §1 the one-time removal clicks; §2 what the gates check now; §3 manual check), `docs/ops/worker.md` (§Permissions-Policy per environment, deploy step 3, rollback), `docs/ops/account.md` (row 41, lines 98-100), `docs/ops/go-live-staging.md` (lines 12, 17, 48, §2.3, 86-87, 127, 132, 155, 165, 187, 215), `docs/ops/branch-protection.md:192`, `docs/ops/ci.md` (deploy-rollback and smoke-credentials rows), `README.md` (33-34, 129-130), `docs/design/ACCOUNTS_API_MCP.md:54`, `RELEASES.md` (an "Unreleased" note: staging public, D31 superseded)
- Test: `tools/gates/test/owner-decisions-drift.test.ts` (reads docs/ops/access.md; must still pass), `pnpm exec vitest run tools/gates/test/owner-decisions-drift.test.ts`

- [ ] Step 1: write OD-40 with the owner's words, the decision (staging public; gating by the run sign-in dialog and the accounts allowlist; serial rule as production; rollback like production; owner deletes `run-staging` and `accounts-staging` in Zero Trust), and "does not authorize a deployment".
- [ ] Step 2: the doc edits; grep `D31\|behind Cloudflare Access\|behind Access` over docs/ops, README, docs/design to confirm only history (PHASE0_TRACEABILITY, owner-decisions history, RELEASES history) remains.
- [ ] Step 3: commit "Record OD-40: staging is public, D31 superseded".

### Task 6: accounts repo — the staging public check

**Files (worktree /Volumes/External/projects/accounts-access):**
- Rename: `tools/access-check.mjs` → `tools/staging-public-check.mjs`
- Modify: `.github/workflows/ci.yml` (two steps: names "Staging must be public: no Cloudflare Access application (OD-40)" / "Post-deploy: staging answers without Cloudflare Access (OD-40)", run `node tools/staging-public-check.mjs --pre-deploy|--post-deploy`; undo step name "Undo: delete staging when the site deploy or the public check failed"), `tools/test/release-config.test.mjs`, `tools/test/database-backups.test.mjs:38`, `README.md` 251-259
- Test: `node --test tools/test/release-config.test.mjs tools/test/database-backups.test.mjs`

**Interfaces:**
- Produces: `checkNoAccessApplications(host, apps): string[]`, `checkPublicGate(url, outcome, allowUnreachable): string[]`, `accessApps(env, fetchFn)`, `publicFindings(mode, env, fetchFn)`, `onlyUnreachable`, `postDeployFindings(env, fetchFn, opts)`, `STAGING_HOST`.
- Post-deploy paths `/` and `/login`: pass when status < 500 and not an Access redirect.

- [ ] Step 1: rewrite the S2 tests (same shapes as before, inverted; stub Cloudflare: empty app list passes, a covering app fails with /still covers/, a 302 to cloudflareaccess fails with /still behind/, 200 and 302-elsewhere pass, 503 fails, unreachable rules as before). Run → FAIL (module missing).
- [ ] Step 2: write staging-public-check.mjs (git mv then edit); ci.yml; tests → PASS; `pnpm typecheck && pnpm lint` (targeted enough; not `pnpm check`).
- [ ] Step 3: README; commit "Require staging accounts to be public instead of behind Cloudflare Access".
