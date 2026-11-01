# Independent review findings: status

Status of every finding in the independent Phase 0 review record
(`synthetos/.agent-bridge/findings/phase0-codex.md` in the site workspace, batches 1-15, the
fix verification at 89e2b5f and the fix-pass verifications at 2583725 and
50496a2), checked at `fb05e3c`.

How to read the table:

- **CLOSED**: fixed, with a regression test built from the original
  reproduction that fails without the fix. "Re-verified" says whether the
  independent reviewer has rerun its original reproduction against the fix.
  A fix that is not yet re-verified is not accepted until it is.
- **PARTIAL**: part of the finding is fixed; the remainder is stated.
- **OPEN**: not fixed. The original reproduction still shows the defect at
  `fb05e3c` (rerun for this table where noted).
- **OWNER**: the remainder needs an owner decision or an owner-held key or
  account, not a code change.

None of the open items is a current motion path: Phase 0 has no Web Serial
transport and the production Permissions-Policy is `serial=()`. They must be
closed before the code they affect drives a machine.

## Final gate at fb05e3c

Clean install (every `node_modules` and both `dist` directories removed,
`pnpm install --frozen-lockfile`, pnpm 10.34.6, Node 22.22.0), then
`pnpm check`: typecheck, lint (0 errors, 24 warnings), dependency-cruiser and
the source capability check, licence gate, ci-policy, every workspace test
suite, build, bundle scan, fake-serial build and artifact diff ("only the
transport seam chunk differs"). Exit 0.

| Suite | Passed | Skipped |
|---|---|---|
| tools/gates | 763 | 2 (env-gated, below) |
| packages/safety (coverage) | 544 | 0 |
| packages/schema | 270 | 0 |
| packages/testkit | 256 | 1 (env-gated, below) |
| packages/protocol | 241 | 0 |
| apps/web | 152 | 0 |
| packages/machine | 121 | 0 |
| tools/e2e (unit) | 43 | 0 |
| workers/run | 39 | 0 |
| flasher, contracts, gcode, wiring, provenance, apps/cli | 22 | 0 |

The three env-gated tests were run separately and pass:
`RUN_FIRMWARE_REPO` (`packages/testkit/test/citations.test.ts`, `git show`
only, firmware tree untouched) and `RUN_SITE_REPO`
(`tools/gates/test/tokens.test.ts`, `tools/gates/test/doc-drift.test.ts`).
Not part of this gate: Playwright e2e, Stryker mutation runs, GitHub
workflows, any deploy.

## Findings

| # | Batch | Finding | Severity | Status | Fixing commit(s) | Test that proves it | Re-verified |
|---|---|---|---|---|---|---|---|
| 1 | 1 (P0-02 #1) | Layering enforced on direct edges only (safety -> wiring -> contracts; cloud -> helper -> machine) | High | CLOSED | 919a162 (package layers), 5f7108b (cloud reachability rule `cloud-never-reaches-machine-path`) | `tools/gates/test/review-gates-acceptance.test.ts` "P0-02 #1" (reviewer files, four-hop chain, workspace link, provenance exception passes); `tools/gates/test/acceptance.test.ts` | safety subcase yes (89e2b5f); cloud subcase not yet |
| 2 | 1 (P0-02 #2) | `schema` missing from the no-network lint scope (machine -> schema -> fetch) | High | CLOSED | 5f7108b | `review-gates-acceptance.test.ts` "P0-02 #2" | not yet |
| 3 | 2 (P0-03) | safety-review counted any non-author approval (outsiders) | High | CLOSED | 2a6c5e3 (association), superseded by 689a935 (repository permission) | `tools/gates/test/safety-review.test.ts`, `tools/gates/test/review-permission.test.ts` | NONE-outsider case yes (89e2b5f) |
| 4 | 2 (P0-03) | safety-review.yml runs as `pull_request`, so a PR can rewrite its own enforcement (`run: true` passed) | High | PARTIAL / OWNER | 689a935 (ci-policy rule `safety-review-job`; docs make native branch protection the primary control) | `tools/gates/test/deploy-workflow.test.ts` "safety-review-job" (the `run: true` reproduction fails) | not yet |
|   |   | Remainder: a `pull_request` workflow is still PR-controlled by nature; the policy check runs from the same PR. The real control is native branch protection, which is owner configuration, and D40 (single maintainer, zero required reviews) is decided but not yet carried into this repository (`docs/ops/owner-decisions.md` OD-1). |   |   |   |   |   |
| 5 | 3 (P0-03) | Worker built and deployed from checkout in the secret-bearing job, outside the attested artifact | High | CLOSED | 59aeb86 (Worker built and attested in the build job, `--no-bundle`), 89e2b5f (artifact digests and attestations verified) | `tools/gates/test/workflow-policy.test.ts` (`artifact-digest`) | yes (89e2b5f) |
| 6 | 4 (P0-03) | `author_association` MEMBER/COLLABORATOR taken as proof of write permission | High | CLOSED | 689a935 | `review-permission.test.ts` "two read-only organisation MEMBERs no longer satisfy the check", revoked permission, bots, CLI with API shapes | not yet |
| 7 | 5 (P0-04) | `build`/`build.command` allowed at root and `env.staging`; wrangler runs it under `--no-bundle` with the deploy token | High | CLOSED | 689a935 (refuse `build` in every scope, positive key allowlist, deploy only the preflight-written `wrangler.deploy.json`), 3333622 (refuse `.env*` in the deploy directory, exact `--config`, no `--cwd`/`--env-file`) | `tools/gates/test/deploy-config.test.ts` "checkWorkerConfig refuses a custom build in every scope" and the pinned-wrangler dry run; `deploy-workflow.test.ts` "deploy-config" | not yet |
| 8 | 5 (P0-04) | SVG export accepts `<style>@import url(...)` external CSS | Low | CLOSED | 689a935 (element/attribute allowlist; no style, `url()`, `@import`, escapes, references, comments, CDATA, PIs) | `apps/web/test/svg-export.test.ts` "the reviewer's reproductions", "external CSS and URL-bearing constructs" | not yet |
| 9 | 6 (P0-05) | W22 and the safety page say machine control is unaffected after sign-out | Medium | PARTIAL | 1fce133 (`w22()` matches the amended SAFETY W22) | `packages/safety/test/strings.test.ts` (T-S32 byte match, `fixed('W22', ...)`) | not yet |
|   |   | Remainder: `apps/web/src/pages/safety/SafetyPage.ts:86` still says sign-out "only prevents starting new ones" (jobs). The amended W22 also refuses new jog, home and settings changes. The page text has not been updated and no test pins it. |   |   |   |   |   |
| 10 | 7 (P0-06) | e2e origin guard: Chromium redirect hops bypass `context.route`, so a request reaches a third party before the test fails | Medium | OPEN | none | none. Reproduction rerun at fb05e3c: `node /private/tmp/run-p006-redirect-repro.mjs` gives `externalLoopbackHits: 1` (the guard reports the finding, but the destination was hit) | n/a |
| 11 | 8 | Re-pin to edge-next ead63997 / 450.01, E164 unsigned footer, E050 fix | Info | CLOSED | b741bad, 92ead7d, 4c8a3ad | `packages/testkit/test/citations.test.ts` (with `RUN_FIRMWARE_REPO`); probe fixtures | yes (batch 11, batch 12) |
| 12 | 9 (P0-07 #1) | `decodeInbound` spreads a chunk's events into `push(...)`; a 200000-byte chunk throws RangeError | Low | OPEN | none | none. Rerun at fb05e3c: `decodeInbound([new Uint8Array(200000).fill(0x11)])` throws RangeError (`packages/protocol/src/inbound.ts:32`). The live `createInboundDecoder().push` path is unaffected | n/a |
| 13 | 9 (P0-07 #2) | `parseJson` accepts caller `maxDepth`/`maxChars` that defeat stack safety | Low | OPEN | none | none. Rerun at fb05e3c: `parseJson('['.repeat(4096), {maxChars: 4096, maxDepth: 10000})` throws RangeError despite the never-throws contract. The default limits (depth 16) are safe | n/a |
| 14 | 10 (P0-08 #1) | Status-0 capability answer counts as present for any JSON value | Medium | CLOSED | 50496a2 | `packages/protocol/test/probe-contract.test.ts` "P0-08 #1" | yes (50496a2) |
| 15 | 10 (P0-08 #2) | Probe keeps only the footer revision; checksumless TG footer still classifies full | Medium | CLOSED | 23491b4 (helper only, PARTIAL), 50496a2 (end to end) | `probe-contract.test.ts` "P0-08 #2" (production path classifyLine -> buildProbeResult -> classify) | yes (50496a2) |
| 16 | 10 (P0-08 #3) | Invalid Date fails open in `verifyApprovedBuilds` | Low | CLOSED | 50496a2 | `probe-contract.test.ts` "P0-08 #3" | yes (50496a2) |
| 17 | 10 addendum (P0-08) | No controller-neutral coolant-pause (`coph`) capability; g2 `spph`/`coph` differ | Low | OPEN | none | none. Only `spindlePauseOnHold` exists in `packages/protocol/src/dialects/types.ts`; `coph` appears only in the EN dialect comment and the schema tables | n/a |
| 18 | 11 | Doc drift: firmware-pins EN note, tinygEn header and signed bench note say D4 is not final; PROTOCOL_NOTES body stale | Low | PARTIAL / OWNER | fb05e3c | `tools/gates/test/doc-drift.test.ts` | not yet |
|   |   | Remainder: the bench note inside the signed manifest is unchanged, because changing it needs a new signature from the owner's key (recorded in `docs/ops/release-key.md` and `docs/LEAD_ACTIONS.md`; the test requires that record while the note is stale). The PROTOCOL_NOTES body lives in synthetos.com; the amendments are listed in `docs/protocol/notes-amendments.md` for the owner. |   |   |   |   |   |
| 19 | 12 (P0-09) | Schema travel bounds use JavaScript `lo < hi`; firmware skips soft limits when `fp_EQ(tn, tm)` in float32 | Medium | OPEN | none | none. Rerun at fb05e3c: `validate({xtn: 0, xtm: 0.000001}, EN)` and `validate({xtn: 1000, xtm: 1000.000001}, EN)` both return `[]` (`packages/schema/src/validate.ts`, `checkCrossKey`). The test-kit models now model the firmware skip correctly (row 26), so a schema regression can be written against them | n/a |
| 20 | 13 (P0-10 #1) | Near-coincident arc endpoint accepted as microscopic; firmware runs a full circle | High | CLOSED | 6f89b2a | `packages/safety/test/arc-fp.test.ts` "P0-10 #1"; `packages/safety/test/arc-models.test.ts` (cross-check on the corrected models) | yes (2583725) |
| 21 | 13 (P0-10 #2) | Absolute full circle with unknown start invents split coordinates around 0 | High | CLOSED | 6f89b2a | `arc-fp.test.ts` "P0-10 #2" | yes (2583725) |
| 22 | 13 (P0-10 #3) | Rotary radius mode: degrees treated as mm; overrun bound wrong | High | CLOSED | 5330284 (PARTIAL), 2583725 (physical-mm bound) | `packages/safety/test/rotary-bound.test.ts`; `packages/safety/test/overrun.test.ts` | yes (2583725) |
| 23 | 13 (P0-10 #4) | Same-block G20/G21 and F converted in the wrong order (25.4x feed) | Medium | CLOSED | 5330284 | `packages/safety/test/sanitize-model.test.ts` (2540 mm/min case, unknown prior units block) | yes (89e2b5f) |
| 24 | 14 (P0-11 #1) | Test-kit EN model lacks fp_EQ coincident-arc rule; TG borrowed the EN helper | High | CLOSED | bf3b2e5 | `packages/testkit/test/firmware-semantics.test.ts` (edge-next and 440.21 arc blocks; batch 14 reproductions as written) | yes (2583725) |
| 25 | 14 (P0-11 #2) | Test-kit models ignore live rotary radius settings | High | CLOSED | bf3b2e5 | `firmware-semantics.test.ts` "rotary axis modes and radius" | yes (2583725) |
| 26 | 14 (P0-11 #3) | Test-kit models repeat the same-block F/units order bug | Medium | CLOSED | bf3b2e5 | `firmware-semantics.test.ts` "F is set before G20/G21 in the same block" | yes (2583725) |
| 27 | 14 (P0-11 #4) | Test-kit soft limits use `min === max`, XYZ only, no DISABLE_SOFT_LIMIT sentinel | Medium | CLOSED | bf3b2e5 | `firmware-semantics.test.ts` "soft limits: fp_EQ skip, DISABLE_SOFT_LIMIT ends, every homed axis" | yes (2583725) |
| 28 | 15 (P0-13) | Computed/reflective Web Serial access passes lint, dependency-cruiser and the bundle scan | High | CLOSED | 5f7108b (`run/no-capability-lookup`, TypeScript-AST source check in `pnpm deps`, bundle-scan rule, Permissions-Policy `serial=()`) | `review-gates-acceptance.test.ts` "P0-13"; `tools/gates/test/source-scan.test.ts`; `tools/gates/test/bundle-scan.test.ts`; `tools/gates/test/bundle-acceptance.test.ts` (real Vite build); `workers/run/test/headers.test.ts` | not yet |
| 29 | 15 (P0-14) | Unresolved `import(path)` evades the dependency graph | Medium | CLOSED | 5f7108b (`run/no-dynamic-import`, source check, bundle scan `dynamic-import`) | `review-gates-acceptance.test.ts` "P0-14"; `tools/gates/test/eslint-rules.test.ts`; `source-scan.test.ts` | not yet |
| 30 | 15 (P0-12) | GuardedTransport copies with polymorphic `line.slice()` (Buffer aliasing; subclass override) | Low | CLOSED | 5f7108b (intrinsic Uint8Array copy after a brand check) | `packages/machine/test/defensive-copy.test.ts` (reviewer reproduction, subclass, prototype spoof, Proxy, detached) | not yet |
| 31 | 89e2b5f verification | New regression: staging Access precheck step lacks `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, so every staging deploy stops | Medium | CLOSED | 689a935 (credentials passed; ci-policy `smoke-credentials`) | `deploy-workflow.test.ts` "smoke-credentials" and "the staging pre-deploy Access check without credentials (the regression, end to end)" | not yet |
| 32 | 2583725 verification | Housekeeping: commit message bodies name the reviewer as the finding source | Info | OWNER | none (history not rewritten) | n/a. The planned attribution cleanup before publication should use neutral finding IDs | n/a |
| 33 | 6f89b2a verification (arc uncertainty) | Arc ambiguity band assumed an exact start; `mpo`, offsets and stored positions are reported to 3 decimals (0.0005 mm, 50x EPSILON) and G91 moves accumulate float32 rounding. Parked at X0.0004 (reports 0), `G3 X0.0004 Y0 I0 J10 F600` was accepted unsplit with a 0.0004 mm bound; the firmware runs a 62.83 mm full circle | High | CLOSED | c2799da (per-axis machine/work position bounds in `analyze.ts`, `startUncertaintyMm` widens every coincidence, direction, branch-cut and R-chord decision for the arc and each sub-arc; test-kit targets float32) | `packages/safety/test/arc-fp.test.ts` "arc uncertainty" (parked 0.0004 on EN and TG, WCS, inch board, G92/G10 L20/G92.1, G28/G30, G90.1, R format, G91 chain); `packages/safety/test/arc-models.test.ts` (reported start state; parked 0.0004 X and Y, G92 offset 0.0004, 200-move G91 chain before a G90 arc on EN and TG, positioned controls) | not yet |

## Still open

These need fixes before the code they affect controls a machine. Each one
still reproduces at `fb05e3c`:

1. Row 19, Medium, safety: schema travel-bound validation does not follow the
   firmware's float32 `fp_EQ` soft-limit skip. A settings write could disable
   an axis's soft limits while validation reports nothing. This is the most
   important open item. It is latent (no settings write path in Phase 0).
2. Row 10, Medium, test containment: the e2e origin guard reports a redirect
   to another origin but does not stop it.
3. Row 9, Medium, wording: safety page line 86 contradicts the amended W22.
4. Row 17, Low: no coolant-pause capability fact.
5. Rows 12 and 13, Low: `decodeInbound` argument spreading, and caller JSON
   limits that are not capped.

Owner items: row 4 (native branch protection and carrying D40 into the
gates), row 18 (re-sign the bench manifest note, apply the PROTOCOL_NOTES
amendments), row 32 (attribution cleanup).

The CLOSED rows marked "not yet" are fixed and have regression tests, but the
independent reviewer has not yet rerun its original reproductions against
them. They count as accepted only after it has.
