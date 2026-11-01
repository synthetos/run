# Independent review findings: status

Status of every finding in the independent Phase 0 review record
(`synthetos/.agent-bridge/findings/phase0-codex.md` in the site workspace, batches 1-15, the
fix verification at 89e2b5f, the fix-pass verifications at 2583725 and
50496a2, and the round-1 verification at bf2e9f4), first tabled at `fb05e3c`
and brought up to date at `0a4eb06` (this round: the final gate below, and
the "Re-verified" column now carries the bf2e9f4 verification).

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
| 1 | 1 (P0-02 #1) | Layering enforced on direct edges only (safety -> wiring -> contracts; cloud -> helper -> machine) | High | CLOSED | 919a162 (package layers), 5f7108b (cloud reachability rule `cloud-never-reaches-machine-path`) | `tools/gates/test/review-gates-acceptance.test.ts` "P0-02 #1" (reviewer files, four-hop chain, workspace link, provenance exception passes); `tools/gates/test/acceptance.test.ts` | yes (safety subcase 89e2b5f; cloud subcase and longer/workspace-link chains bf2e9f4) |
| 2 | 1 (P0-02 #2) | `schema` missing from the no-network lint scope (machine -> schema -> fetch) | High | CLOSED | 5f7108b | `review-gates-acceptance.test.ts` "P0-02 #2" | yes (bf2e9f4) |
| 3 | 2 (P0-03) | safety-review counted any non-author approval (outsiders) | High | CLOSED | 2a6c5e3 (association), superseded by 689a935 (repository permission) | `tools/gates/test/safety-review.test.ts`, `tools/gates/test/review-permission.test.ts` | yes (NONE-outsider 89e2b5f; read-only MEMBER bypass bf2e9f4) |
| 4 | 2 (P0-03) | safety-review.yml runs as `pull_request`, so a PR can rewrite its own enforcement (`run: true` passed) | High | PARTIAL / OWNER | 689a935 (ci-policy rule `safety-review-job`; docs make native branch protection the primary control), a9811da (D40: zero required approvals in one line of `reviewPolicy.ts`, a recorded independent review bound to the head on every safety-path PR, `safety-review-job` extended to the record), 45157f1 (D39 account config); D40 verification follow-up: the gate step's run block is pinned line for line and must be the last of exactly six steps, and `if:`, `shell:`, NODE_OPTIONS, $GITHUB_ENV and $GITHUB_PATH are refused in the job (`|| true`, `exit 0` before the gate, `if: false` and an extra fabricating step had passed); a review record naming the author anywhere in `Reviewer:` is refused | `tools/gates/test/deploy-workflow.test.ts` "safety-review-job" (the `run: true` reproduction fails; dropping or redirecting the record fails; the ten neutralisation variants fail), `tools/gates/test/review-policy.test.ts` (sole maintainer passes with the record only; a self-approved PR without it fails; the one-line change back to 2 makes the CLI require two write-access approvals) | PARTIAL at bf2e9f4 (`run: true` now fails; PR-controlled trust boundary stays open). The D40 control (a9811da, 0a4eb06) is not yet verified |
|   |   | Remainder: a `pull_request` workflow is still PR-controlled by nature; the policy check runs from the same PR. The real control is native branch protection, which is owner configuration (`docs/ops/branch-protection.md` §1, `docs/LEAD_ACTIONS.md` Step 6). D40 is now carried in: with one maintainer, the recorded review is an auditable statement, not an identity check, and Code Owner review is off until a second maintainer joins (GitHub cannot let the only code owner approve their own PR). |   |   |   |   |   |
| 5 | 3 (P0-03) | Worker built and deployed from checkout in the secret-bearing job, outside the attested artifact | High | CLOSED | 59aeb86 (Worker built and attested in the build job, `--no-bundle`), 89e2b5f (artifact digests and attestations verified) | `tools/gates/test/workflow-policy.test.ts` (`artifact-digest`) | yes (89e2b5f) |
| 6 | 4 (P0-03) | `author_association` MEMBER/COLLABORATOR taken as proof of write permission | High | CLOSED | 689a935 | `review-permission.test.ts` "two read-only organisation MEMBERs no longer satisfy the check", revoked permission, bots, CLI with API shapes | yes (bf2e9f4) |
| 7 | 5 (P0-04) | `build`/`build.command` allowed at root and `env.staging`; wrangler runs it under `--no-bundle` with the deploy token | High | CLOSED | 689a935 (refuse `build` in every scope, positive key allowlist, deploy only the preflight-written `wrangler.deploy.json`), 3333622 (refuse `.env*` in the deploy directory, exact `--config`, no `--cwd`/`--env-file`) | `tools/gates/test/deploy-config.test.ts` "checkWorkerConfig refuses a custom build in every scope" and the pinned-wrangler dry run; `deploy-workflow.test.ts` "deploy-config" | yes (bf2e9f4, with pinned Wrangler dry-run and dotenv controls) |
| 8 | 5 (P0-04) | SVG export accepts `<style>@import url(...)` external CSS | Low | CLOSED | 689a935 (element/attribute allowlist; no style, `url()`, `@import`, escapes, references, comments, CDATA, PIs) | `apps/web/test/svg-export.test.ts` "the reviewer's reproductions", "external CSS and URL-bearing constructs" | yes (bf2e9f4) |
| 9 | 6 (P0-05) | W22 and the safety page say machine control is unaffected after sign-out | Medium | CLOSED | 1fce133 (`w22()` matches the amended SAFETY W22), 291e96a (the safety page's sign-out rule names every action W22 gates, starting a job, jogging, homing and changing settings, and quotes `w22()` in a `data-safety="W22"` element; the old "only prevents starting new ones" sentence is gone) | `packages/safety/test/strings.test.ts` (T-S32 byte match, `fixed('W22', ...)`); `apps/web/test/prerender.test.ts` "the sign-out rule matches the amended W22 in SAFETY.md" (reads W22 from the in-repo SAFETY.md and requires it, `w22()` and the page element to be identical) | not yet |
| 10 | 7 (P0-06) | e2e origin guard: Chromium redirect hops bypass `context.route`, so a request reaches a third party before the test fails | Medium | CLOSED | 8569986 (`tools/e2e/src/guard.ts`: every request is routed; same-origin requests are fetched by the guard with redirects disabled, same-origin hops are followed by the guard, the first external target is a `redirect` finding and the request is aborted before that hop is sent; the browser never sees a redirect, because Chromium also skips the routes for hops after a route fulfilled a redirect. `specs/csp.e2e.ts` falls back to the guard instead of `continue()`). Same defect class in the `request` fixture, which is sent from Node outside every browser route and followed redirects to any origin (`headers.e2e.ts` requests `/auth/login`): the fixture is now wrapped by `guardRequestContext`, which refuses an external URL and follows same-origin hops itself, throwing at the first external hop before it is sent) | `tools/e2e/specs/origin-guard.e2e.ts` redirect cases (302, 307, 308, protocol-relative, two- and three-hop chains, subresource, `fetch()`, loop, same-origin control; a loopback third party must see 0 requests); `tools/e2e/test/origin.test.ts` (`redirectTarget`, `redirectMethod`). Reproduction rerun after the fix: `externalLoopbackHits: 0`. `request` fixture: redirect chains, POST 307, HEAD, loop, absolute external URL, same-origin and `maxRedirects: 0` controls, and the suite fixture itself; a loopback third party must see 0 requests (it saw 2 before the wrapper) | not yet |
| 11 | 8 | Re-pin to edge-next ead63997 / 450.01, E164 unsigned footer, E050 fix | Info | CLOSED | b741bad, 92ead7d, 4c8a3ad | `packages/testkit/test/citations.test.ts` (with `RUN_FIRMWARE_REPO`); probe fixtures | yes (batch 11, batch 12) |
| 12 | 9 (P0-07 #1) | `decodeInbound` spreads a chunk's events into `push(...)`; a 200000-byte chunk throws RangeError | Low | CLOSED | f4dfa74 (events appended one at a time) | `packages/protocol/test/inbound.test.ts` "decodeInbound: large chunks" (the 200000-byte reproduction; 300000 bytes equal to the live decoder) | not yet |
| 13 | 9 (P0-07 #2) | `parseJson` accepts caller `maxDepth`/`maxChars` that defeat stack safety | Low | CLOSED | f4dfa74 (caller limits capped at `JSON_HARD_LIMITS`, 65536 chars and depth 64; a NaN or negative limit refuses every input) | `packages/protocol/test/json.test.ts` "caller limits are capped" (the reproduction returns `too-deep`; nesting to 100000 under unbounded limits never throws; caps; smaller limits still apply) | not yet |
| 14 | 10 (P0-08 #1) | Status-0 capability answer counts as present for any JSON value | Medium | CLOSED | 50496a2 | `packages/protocol/test/probe-contract.test.ts` "P0-08 #1" | yes (50496a2) |
| 15 | 10 (P0-08 #2) | Probe keeps only the footer revision; checksumless TG footer still classifies full | Medium | CLOSED | 23491b4 (helper only, PARTIAL), 50496a2 (end to end) | `probe-contract.test.ts` "P0-08 #2" (production path classifyLine -> buildProbeResult -> classify) | yes (50496a2) |
| 16 | 10 (P0-08 #3) | Invalid Date fails open in `verifyApprovedBuilds` | Low | CLOSED | 50496a2 | `probe-contract.test.ts` "P0-08 #3" | yes (50496a2) |
| 17 | 10 addendum (P0-08) | No controller-neutral coolant-pause (`coph`) capability; g2 `spph`/`coph` differ | Low | CLOSED | f4dfa74 (`DialectCaps.coolantPauseOnHold`: EN `probe` (coph reserved, stubbed 17), 440.21 and stock 449 `never` (no coph; hold code does not touch coolant), g2 `probe` (real coph, default true while spph defaults false, read from G2 1fb5940 `settings/settings_default.h:96-97, :145-146`, `config_app.cpp:974`, `cycle_feedhold.cpp:872, :925`, `coolant.cpp:100-105`); `COOLANT_PAUSE_TOKEN`) | `packages/protocol/test/dialect-contract.test.ts` "coolant pause on hold is its own fact" (every dialect); `packages/protocol/test/dialects.test.ts` (TG) | not yet |
| 18 | 11 | Doc drift: firmware-pins EN note, tinygEn header and signed bench note say D4 is not final; PROTOCOL_NOTES body stale | Low | PARTIAL / OWNER | fb05e3c | `tools/gates/test/doc-drift.test.ts` | PARTIAL confirmed at bf2e9f4 (signed bench note pending re-sign; PROTOCOL_NOTES amendments tracked separately) |
|   |   | Remainder: the bench note inside the signed manifest is unchanged, because changing it needs a new signature from the owner's key (recorded in `docs/ops/release-key.md` and `docs/LEAD_ACTIONS.md`; the test requires that record while the note is stale). The PROTOCOL_NOTES body lives in synthetos.com; the amendments are listed in `docs/protocol/notes-amendments.md` for the owner. |   |   |   |   |   |
| 19 | 12 (P0-09) | Schema travel bounds use JavaScript `lo < hi`; firmware skips soft limits when `fp_EQ(tn, tm)` in float32 | Medium | CLOSED | acaed21 (`packages/schema/src/travel.ts`: per-dialect travel semantics (TinyG EN and 440 only; any other dialect, g2 included, fails closed with `travelSemanticsUnknown`, no TinyG epsilon imposed); `validate` refuses a range whose float32 ends (nearest and two neighbours each side) are `fp_EQ` or not ordered (`travelFirmwareEqual`), one under 0.01 apart (`travelTooNarrow`, so read-back can prove it), and a minimum at or below DISABLE_SOFT_LIMIT (`travelEndDisabled`); `confirmSoftLimits` proves from the 3-decimal read-back that `sl` is 1 and each required axis has both ends tested before `softlimits.on` may be established; follow-up: the read-back is interpreted only when `unit` reads back 1 (G21), because linear travel rows are F_CONVERT and report in inches under G20, where a disabled -1000000 mm minimum reads -39370.079) | `packages/schema/test/travel.test.ts` (both reproductions on EN and 440, refused by `validate` and `screenWritePlan`, with the test-kit models showing the firmware really skips the limit; one-end drafts against board ends; float32 collapse near ±100000; every axis X..C; DISABLE_SOFT_LIMIT per end; normal ranges and a 0.01 span still pass, with the model enforcing them; read-back confirmation from model GETs; a G20 inch read-back is not confirmed) | not yet |
| 20 | 13 (P0-10 #1) | Near-coincident arc endpoint accepted as microscopic; firmware runs a full circle | High | CLOSED | 6f89b2a | `packages/safety/test/arc-fp.test.ts` "P0-10 #1"; `packages/safety/test/arc-models.test.ts` (cross-check on the corrected models) | yes (2583725) |
| 21 | 13 (P0-10 #2) | Absolute full circle with unknown start invents split coordinates around 0 | High | CLOSED | 6f89b2a | `arc-fp.test.ts` "P0-10 #2" | yes (2583725) |
| 22 | 13 (P0-10 #3) | Rotary radius mode: degrees treated as mm; overrun bound wrong | High | CLOSED | 5330284 (PARTIAL), 2583725 (physical-mm bound) | `packages/safety/test/rotary-bound.test.ts`; `packages/safety/test/overrun.test.ts` | yes (2583725) |
| 23 | 13 (P0-10 #4) | Same-block G20/G21 and F converted in the wrong order (25.4x feed) | Medium | CLOSED | 5330284 | `packages/safety/test/sanitize-model.test.ts` (2540 mm/min case, unknown prior units block) | yes (89e2b5f) |
| 24 | 14 (P0-11 #1) | Test-kit EN model lacks fp_EQ coincident-arc rule; TG borrowed the EN helper | High | CLOSED | bf3b2e5 | `packages/testkit/test/firmware-semantics.test.ts` (edge-next and 440.21 arc blocks; batch 14 reproductions as written) | yes (2583725) |
| 25 | 14 (P0-11 #2) | Test-kit models ignore live rotary radius settings | High | CLOSED | bf3b2e5 | `firmware-semantics.test.ts` "rotary axis modes and radius" | yes (2583725) |
| 26 | 14 (P0-11 #3) | Test-kit models repeat the same-block F/units order bug | Medium | CLOSED | bf3b2e5 | `firmware-semantics.test.ts` "F is set before G20/G21 in the same block" | yes (2583725) |
| 27 | 14 (P0-11 #4) | Test-kit soft limits use `min === max`, XYZ only, no DISABLE_SOFT_LIMIT sentinel | Medium | CLOSED | bf3b2e5 | `firmware-semantics.test.ts` "soft limits: fp_EQ skip, DISABLE_SOFT_LIMIT ends, every homed axis" | yes (2583725) |
| 28 | 15 (P0-13) | Computed/reflective Web Serial access passes lint, dependency-cruiser and the bundle scan | High | CLOSED | 5f7108b (`run/no-capability-lookup`, TypeScript-AST source check in `pnpm deps`, bundle-scan rule, Permissions-Policy `serial=()`) | `review-gates-acceptance.test.ts` "P0-13"; `tools/gates/test/source-scan.test.ts`; `tools/gates/test/bundle-scan.test.ts`; `tools/gates/test/bundle-acceptance.test.ts` (real Vite build); `workers/run/test/headers.test.ts` | yes (bf2e9f4; closes the demonstrated bypasses, not a proof that arbitrary JavaScript is harmless) |
| 29 | 15 (P0-14) | Unresolved `import(path)` evades the dependency graph | Medium | CLOSED | 5f7108b (`run/no-dynamic-import`, source check, bundle scan `dynamic-import`) | `review-gates-acceptance.test.ts` "P0-14"; `tools/gates/test/eslint-rules.test.ts`; `source-scan.test.ts` | yes (bf2e9f4) |
| 30 | 15 (P0-12) | GuardedTransport copies with polymorphic `line.slice()` (Buffer aliasing; subclass override) | Low | CLOSED | 5f7108b (intrinsic Uint8Array copy after a brand check) | `packages/machine/test/defensive-copy.test.ts` (reviewer reproduction, subclass, prototype spoof, Proxy, detached) | yes (bf2e9f4) |
| 31 | 89e2b5f verification | New regression: staging Access precheck step lacks `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, so every staging deploy stops | Medium | CLOSED | 689a935 (credentials passed; ci-policy `smoke-credentials`) | `deploy-workflow.test.ts` "smoke-credentials" and "the staging pre-deploy Access check without credentials (the regression, end to end)" | yes (bf2e9f4) |
| 32 | 2583725 verification | Housekeeping: commit message bodies name the reviewer as the finding source | Info | OWNER | none (history not rewritten) | n/a. The planned attribution cleanup before publication should use neutral finding IDs | n/a |
| 33 | 6f89b2a verification (arc uncertainty) | Arc ambiguity band assumed an exact start; `mpo`, offsets and stored positions are reported to 3 decimals (0.0005 mm, 50x EPSILON) and G91 moves accumulate float32 rounding. Parked at X0.0004 (reports 0), `G3 X0.0004 Y0 I0 J10 F600` was accepted unsplit with a 0.0004 mm bound; the firmware runs a 62.83 mm full circle | High | CLOSED | c2799da (per-axis machine/work position bounds in `analyze.ts`, `startUncertaintyMm` widens every coincidence, direction, branch-cut and R-chord decision for the arc and each sub-arc; test-kit targets float32) | `packages/safety/test/arc-fp.test.ts` "arc uncertainty" (parked 0.0004 on EN and TG, WCS, inch board, G92/G10 L20/G92.1, G28/G30, G90.1, R format, G91 chain); `packages/safety/test/arc-models.test.ts` (reported start state; parked 0.0004 X and Y, G92 offset 0.0004, 200-move G91 chain before a G90 arc on EN and TG, positioned controls) | finding confirmed at bf2e9f4; the fix (c2799da) not yet |
| 34 | c2799da verification (arc uncertainty, split lines) | The start bound counted a split line as one firmware sum. A split G91 move or arc is one float32 sum per sub-segment (`G0 X0 Y600`, `G91 G1 Y30 F1` (722 segments), `G90` drifts to Y630.010986; `G2 X0 Y630.010986328125 I10 J0` was accepted as a 0.011 mm arc, EN runs 62.83 mm; a 1453-sub-arc `G91 G2 X30 Y0 I15 J-200 F0.5` from X1500 drifts 0.068 mm), and an absolute split full circle writes an omitted plane axis's start rounded to 4 decimals (`G0 X0 Y0.00004`, `G2 I1 F0.5`, then `G3 X0 Y0 I1 J0` was accepted as 0.00004 mm, EN runs 6.28 mm) | High | CLOSED | 0b064d2 (`analyze.ts`: per-segment rounding for incremental splits, written-start rounding for omitted axes of absolute split arcs) | `packages/safety/test/arc-fp.test.ts` "arc uncertainty": split G91 move (float32 oracle from the written segments), split G91 arc, absolute split full circle, with positioned and unsplit controls | not yet |
| 35 | bf2e9f4 verification (inhibited axis) | The kinematics force an inhibited axis's (am=2) joint to 0 on every segment (EN kinematics.c:59, TG kinematics.c:63) and plan_exec moves each motor by the difference of absolute step targets, so an axis inhibited while its motor sits away from step 0 is driven back to 0 by the next move of ANY axis. A standard at 30 degrees, then `aam=2`, then `G1 X1 F600` was accepted with a 1 mm bound; the firmware turns A 30 degrees. Linear axis modes were not modelled at all (a disabled X/Y/Z ignores its word) | High | PARTIAL | 62a9d6e (test kit: motor space in `motion.ts`, behaviours EN/TG-INHIBITED-JOINT; sanitiser: `MotionModel.linear`, `inhibited-axis` blocks every motion line while an axis that is inhibited or of unknown mode reads away from 0 or is unknown; reading 0 adds its rounding to every bound (unknown for a rotary axis); `axis-mode` blocks words on disabled, radius-reading or unknown-mode linear axes and G28/G30 while any linear axis is not standard or inhibited) | `packages/safety/test/inhibited-axis.test.ts` (the reproduction on EN and 440.21 against the test-kit motor model, linear Y at 20, every motion kind, unknown mode and position, the 0.0004 residual, split segments, linear modes, configuration checks); `packages/testkit/test/firmware-semantics.test.ts` "inhibited axes"; `packages/testkit/test/parts.test.ts` (motor space) | finding source-confirmed at bf2e9f4 (EN kinematics.c:59, plan_exec.c:709-711); the fix (62a9d6e) not yet |
|   |   | Remainder: the mirror case is not visible in any read. An axis whose step target is 0 while its position is away from 0 (it was moved while inhibited, or a step resync such as a queue flush ran while it was inhibited away from 0) and that then leaves inhibited mode for any other mode, disabled included (only inhibited zeroes the joint), has its motor driven out to its position by the next move of any axis (testkit `firmware-semantics.test.ts` "leaving inhibited mode for DISABLED" and "un-inhibiting"). The board reports the mode and position, not the step target, so the sanitiser cannot see it. It needs the host to own every `am` change (Phase 0 has no settings write path) and to resync the position (G28.3 or homing) after leaving inhibited mode, or a bench-verified way to read the step position. |   |   |   |   |   |

## Still open

Checked at `0a4eb06`. Nothing in the table is OPEN. What is not done:

1. Row 35, High, remainder (OPEN in substance, latent): an axis switched
   out of inhibited mode while its position is away from 0 is driven out to
   that position by the next move of any axis, and no read shows it. It needs
   the host to own every `am` change and resync the position afterwards (or
   a bench-verified step-position read). Not reachable in Phase 0 or Phase 1:
   there is no settings write path and no motion. It must be closed before
   Phase 2 (bench motion) and Phase 4 (settings write).
2. Row 4, High, PARTIAL / OWNER: a `pull_request` workflow is controlled by
   the PR it checks. The real control is native branch protection with the
   D40 ruleset, which only the owner can configure. The D40 replacement
   control (a9811da, 0a4eb06) has not been independently verified.
3. Row 18, Low, PARTIAL / OWNER: the bench note inside the signed manifest
   still says D4 is not final until the owner re-signs it; the PROTOCOL_NOTES
   amendments are listed for the owner in `docs/protocol/notes-amendments.md`.
4. Row 32, OWNER: attribution cleanup in earlier commit message bodies
   (history not rewritten).
5. Not yet re-verified: rows 4 (D40 part), 9, 10, 12, 13, 17, 19, 33, 34
   and 35 are fixed with regression tests but the independent reviewer has
   not rerun its reproductions against those fixes. They are not accepted
   until it has.

### What blocks Phase 1 (bench read-only)

From these findings (the plan's own Phase 1 exit criteria, HIL-1.x and
the B-* bench items, are separate and all still ahead):

- **Re-verification of rows 33, 34 and 35** (High, safety). Phase 1 sends
  no motion, so these do not make Phase 1 unsafe by themselves, but they
  are the sanitiser's arc and axis-state reasoning and should be accepted
  before any Phase 1 code that later feeds them is built on.
- **Re-verification of rows 12, 13 and 17** (protocol). Phase 1's probe,
  inbound decoder and classifier run on live board output for the first
  time; these fixes are on that path.
- **Row 4 owner action**: native branch protection with the D40 ruleset
  must be on before safety-path code that talks to a real board merges.
- **Row 18 owner action**: the signed bench manifest note should be
  re-signed before Phase 1 probe classification relies on the approved
  builds manifest on the bench.
- **Permissions-Policy change**: DONE in P1-00, as its own change (commits
  "gates: Web Serial is allowed only in ...", "build, gates: the Web Serial
  transport gets its own chunk ...", "worker, headers: serial=(self) on
  staging only ...", "bench: a localhost bench build ..."). Production stays
  `serial=()` (the tests that pin it, `tools/e2e/specs/headers.e2e.ts` and
  `workers/run/test/headers.test.ts`, still pin the production set, and the
  e2e suite now also observes `SecurityError` in the page and in
  `machine.worker`); staging and the localhost bench build get
  `serial=(self)` (`SERIAL_GRANTED_SECURITY_HEADERS`, `grantsSerial`, the
  staging and bench Playwright suites). Row 28's gates now admit Web Serial
  in `packages/machine/src/webSerialTransport.ts` only (lint, source check,
  dependency-cruiser) and in its chunk `assets/serial/` only (bundle scan,
  staging and bench targets; production refuses it). The P1-01 transport
  itself still needs its own review. Needs independent review (D40).

Not blocking Phase 1: row 35's remainder (no `am` write, no motion), row 32
(housekeeping). Its Phase 1 consequence is implemented (P1-00): read-only
sessions surface the axis-mode facts that are unsafe for later motion,
including an axis seen leaving inhibited mode during the session
(`packages/safety/src/axisModeFacts.ts`, `axisModeFacts.test.ts`, with a
property cross-check against the sanitiser). P1-07 must render them.

## Final gate at 0a4eb06

Clean install: every `node_modules`, `apps/web/dist` and
`apps/web/dist-fake-serial` removed, then `pnpm install --frozen-lockfile`
(pnpm 10.34.6, Node 22.22.0). `pnpm check` exit 0: typecheck, lint (0
errors, 24 warnings), dependency-cruiser and the source capability check,
licence gate, ci-policy, every workspace test suite, build, bundle scan,
fake-serial build and artifact diff ("26 files; only the transport seam
chunk differs").

| Suite | Passed | Skipped |
|---|---|---|
| tools/gates | 818 | 2 (env-gated, below) |
| packages/safety (coverage) | 604 | 0 |
| packages/schema | 294 | 0 |
| packages/testkit | 275 | 1 (env-gated, below) |
| packages/protocol | 252 | 0 |
| apps/web | 153 | 0 |
| packages/machine | 121 | 0 |
| tools/e2e (unit) | 47 | 0 |
| workers/run | 39 | 0 |
| flasher, contracts, gcode, wiring, provenance, apps/cli | 22 | 0 |

Env-gated tests run separately and passing: `RUN_FIRMWARE_REPO`
(`packages/testkit/test/citations.test.ts`, 2 passed; `git show` at the
pinned commits only, the firmware working tree untouched) and
`RUN_SITE_REPO` (`tools/gates/test/tokens.test.ts`,
`tools/gates/test/doc-drift.test.ts`, 20 passed).

Playwright, locally (Chromium from the pinned Playwright, `wrangler dev`):
`pnpm e2e` 57 passed; `pnpm e2e:fake-serial` 2 passed (fake-serial diff
again only the seam chunk); `pnpm e2e:artifact` 57 passed against the
manifest-verified artifact, and the third-party canary failed the suite as
required, with the origin guard reporting all 4 planted URLs.

Not part of this gate: Stryker mutation runs, GitHub workflows, any deploy,
hardware.

## Playwright e2e at 291e96a

Run locally (Chromium from the pinned Playwright, `wrangler dev`):
`pnpm e2e` 53 passed (headers.e2e.ts included: the Permissions-Policy
denies serial, even to this origin); `pnpm e2e:fake-serial` 2 passed;
`pnpm e2e:artifact` 53 passed and the canary reported all 4 planted URLs.
The same suite at `4427c84` (before the redirect and W22 changes) passed
43 of 43, so no e2e failure was hidden by the earlier gate, which did not
run Playwright.

The CLOSED rows marked "not yet" are fixed and have regression tests, but the
independent reviewer has not yet rerun its original reproductions against
them. They count as accepted only after it has.
