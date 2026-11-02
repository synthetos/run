# Phase 0 safety traceability

Safety conformance audit of Phase 0 ("Foundations, no serial"), 2026-11-01.

Every requirement in `SAFETY.md` and ROADMAP Phase 0 that applies to Phase 0
code is traced to the code that implements it, the test that proves it, and
the result of running that test. A requirement without a passing test is a
**FAIL**. Small gaps were fixed during the audit (marked **FIXED**, see
"Findings"); the rest are listed under "Open items".

## Scope and sources

| Source | Version used |
|---|---|
| `SAFETY.md` (in-repo copy) | synthetos.com `docs/run/SAFETY.md` at `f2760cd2` (D1 wording) plus the "Amended in P0 review" text; see `docs/safety/README.md` |
| ROADMAP Phase 0, RUN_PLAN, PROTOCOL_NOTES, DECISIONS | synthetos.com `docs/run/` at `53ff9998` |
| OLD-S (cited by SAFETY.md §8 and §10) | `docs/safety/OLD-S.md` |
| Edge-next firmware (EN) | `ead639978c77601b150be7ef12774f47eed4c824` (fb 450.01), `vendor/firmware-pins.json`. The local `edge-next` tip has since moved to `222a45c0`; nothing was re-pinned in this audit. (Note 2026-11-02: re-pinned after this audit to `97321391`, the E195 merge, fb still 450.01.) |
| Stock 440.21 (TG) | `d04183905470714254c24d299f6aad75f6bcbb7a` |
| Repository state audited | `eeaadb0` plus the audit commit that adds this file |

Owner decisions applied (2026-11-01): every DECISIONS.md recommendation
accepted; D1 decided as "sign-in required to connect and start", with the
condition that nothing in the machine path ever consults the session.

Status values: **PASS** (a test that would fail without the behaviour ran and
passed), **FIXED** (was a gap, fixed and passing in the audit commit),
**FAIL** (no passing test; reason and owner given), **N/A** (not Phase 0 code;
the phase that owns it is named).

## How the suite was run

All on macOS, Node 22.22.0, pnpm 10.34.6 (Corepack), in the working tree of
the audit commit.

| Step | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | pass |
| Gates | `pnpm gates` (ESLint, dependency-cruiser, licence, CI policy) | pass |
| Unit and integration tests, with coverage thresholds | `pnpm test` | 2,044 passed, 2 skipped (see next row), 0 failed (1,933 before the audit; the audit adds 111) |
| Env-gated tests | `RUN_FIRMWARE_REPO=<TinyG clone>` testkit `citations.test.ts`; `RUN_SITE_REPO=<synthetos.com clone>` gates `tokens.test.ts` | pass (the 2 tests skipped in the plain run: every firmware citation quote found at the pinned commits; no token drift against the site at the pinned ref) |
| Production build and bundle scan | `pnpm build && pnpm scan` | pass (26 files clean) |
| Fake-serial build and artifact diff | `pnpm build:fake-serial && pnpm fake-serial:diff` | pass (differs only in the transport seam chunk) |
| Playwright against the assembled artifact, then the third-party canary | `pnpm e2e:artifact` | 43 passed; canary: the suite failed and the origin guard named every planted URL (expected) |
| Playwright on the fake-serial build | `pnpm e2e:fake-serial` | 2 passed |
| Mutation testing, safety package (90 % break threshold) | `pnpm --filter @synthetos/safety mutation` | **87.90 % before the audit (FAIL)**, 90.84 % after (pass) |
| Manual mutation probes outside `safety` | see "Mutation probes" | 9 of 9 killed |

## A. Automated safety tests (SAFETY.md §10) that Phase 0 must provide

| ID | Requirement (abridged) | Code | Test | Status |
|---|---|---|---|---|
| T-S1 | Sanitiser output never contains `!~%` or control bytes, never shortens a kept line, monotonic N, rejects `$?Hh{` first characters, TinyG comment rule, idempotent; EN M201.3 and L∉{2,20}; TG G18 arcs, G28/G30 under G20/G91, G28.4, E words, >3 queued commands; inserted C14 lines are barriers | `packages/safety/src/sanitize/` | `packages/safety/test/sanitize-property.test.ts` (fast-check, every dialect), `sanitize-rules.test.ts`, `sanitize-text.test.ts`, `sanitize-model.test.ts` | PASS. The OLD-S clause "preview geometry equals `interpret(sanitize(x))`" is N/A until the interpreter exists (TB-02) |
| T-S2 | CAM corpus of at least 14 files with the listed cases | `test-fixtures/cam/` (20 files), sanitiser | `packages/safety/test/sanitize-corpus.test.ts` | PASS |
| T-S3 | Allow-matrix generated over state × overlay × intent; no unclassified cell; Start only from ARMED | `packages/safety/src/allowMatrix.ts` | `allowMatrix.test.ts` (T-S3 block), `allowMatrix-oracle.test.ts` | PASS; oracle hardened (FIXED, finding F3) |
| T-S4 | Three TinyG tables: EN 12 shutdown, 13 panic, 203 limit, 207 job kill; TG 11 shutdown, 204 limit; stat 3 programStop | `packages/protocol/src/dialects/tinygEn.ts`, `tinyg440.ts`, `tinyg449Stock.ts` | `packages/protocol/test/dialects.test.ts` (T-S4 block), `packages/schema/test/hilTables.test.ts` (table agreement) | PASS |
| T-S16 | 1200 baud open throws without the token; 2341:003D refused before open | `packages/machine/src/openPolicy.ts`, `guardedTransport.ts`, `packages/flasher/src/bootloaderCapability.ts` | `packages/machine/test/t-s16.test.ts`, `packages/flasher/test/bootloader-capability.test.ts` | PASS (probe P3) |
| T-S24a precursor | No 0x04 for `tinyg-440`, `tinyg-449-stock` or unclassified boards | dialect `realtime` data, `lookup.ts`, `machine/src/writeShape.ts` | `dialects.test.ts` ("T-S24a/b precursors"), `dialect-contract.test.ts` (realtime contract) | PASS |
| T-S24b precursor | No 0x05 for TG; ENQ only to a classified `tinyg-en` | dialect data; `allowMatrix.ts` `enq` row | `dialects.test.ts`, `allowMatrix.test.ts` ("ENQ only to a classified board…") | PASS |
| T-S25 | Production CSP present; no external origins in built output; only the two named Trusted Types policies | `workers/run/src/headers.ts`, `apps/web/public/_headers` (generated), `apps/web/src/security/tt.ts` | `workers/run/test/headers.test.ts`, `tools/gates/test/headers-file.test.ts`, `tools/e2e/specs/headers.e2e.ts`, `csp.e2e.ts`, `trusted-types.e2e.ts`, `origin-guard.e2e.ts`, canary (`tools/e2e/src/canary.ts`) | PASS |
| T-S32 | Every W/C string comes from `strings.ts` and byte-matches SAFETY §5–§6 | `packages/safety/src/strings.ts`; lint rule `tools/gates/src/eslint/rules/noSignalWordLiteral.ts` | `packages/safety/test/strings.test.ts`, `strings-params.test.ts`, `strings-errors.test.ts`; `tools/gates/test/acceptance.test.ts` (signal-word lint) | **FIXED** (finding F1: W22 was stale against the D1 safety case) |
| T-S38 (Phase 0 part) | Read allowlists over all dialects; `adc3 md me alarm panic shutd er clear clr boot jog*` never emitted as GETs; probe reads only allowed tokens | `packages/schema/src/allowlists/`, `packages/protocol/src/probe.ts` | `packages/schema/test/allowlists.test.ts` (incl. fuzz), `packages/protocol/test/probe.test.ts` | PASS (probe P4). Status polling, "read all", console and settings-editor read paths are Phase 1+ |
| T-S40 | Production bundle has no test-kit marker and no `transport=` handling | `packages/testkit/src/marker.ts`, `tools/gates/src/bundle/scan.ts` | `tools/gates/test/bundle-scan.test.ts`, `bundle-acceptance.test.ts`, `packages/testkit/test/marker.test.ts`; `pnpm scan` on the real build | PASS |
| T-S55 | Classifier fixtures: EN → `tinyg-en`; same fb without tokens → `tinyg-449-stock` READ_ONLY; 440.21 rev-1 → `tinyg-440`; conflicts → READ_ONLY; unapproved EN fb → READ_ONLY | `packages/protocol/src/dialects/classify.ts`, `probe.ts` | `packages/protocol/test/capability.test.ts`, `probe.test.ts` | PASS (probe P5) |
| T-S57 | No network identifiers in `protocol safety machine flasher provenance schema` (lint; schema added in the P0 review, P0-02 #2); `workers/run` imports no safety-path package | `tools/gates/src/eslint/rules/noNetworkApi.ts`, `.dependency-cruiser.cjs` (`worker-imports-only-contracts`) | `tools/gates/test/acceptance.test.ts` ("a network identifier in each machine-path package fails lint", "the run Worker importing safety fails dependency-cruiser"), `eslint-rules.test.ts` | PASS |
| T-S58 | Sign-out, account switch, armed-file delete, profile switch denied in every LIVE state | `allowMatrix.ts` cloud rows | `allowMatrix.test.ts` (T-S58), `allowMatrix-oracle.test.ts` (state by state) | PASS |
| T-S59 (matrix part) | Sync pauses while RUNNING/HELD/BARRIER_DRAINING/STOPPING_JOB | `allowMatrix.ts` `cloudSync` row | `allowMatrix-oracle.test.ts` ("cloud sync pauses in exactly…") | **FIXED** (finding F3: PREAMBLE, HOLD_REQUESTED, BARRIER_DRAINING and END_HOLDBACK were untested). The E-layer part ("no fetch from the sync worker") is A2-06 |
| T-S62 | Stop class allowed in every overlay × base-state cell with the port open; Home denied under FAULT, STALE, ORPHANED_MOTION | `allowMatrix.ts` (normative rule) | `allowMatrix.test.ts` (T-S62), `allowMatrix-oracle.test.ts` | **FIXED** (finding F3: the generated test took STOP_CLASS and PORT_OPEN_STATES from the code under test) |
| T-S64 | Long-move splitting within the ceiling, on the original path (lines, arcs, G90/G91, mm/inch) | `packages/safety/src/sanitize/geometry.ts`, `sanitize.ts` | `packages/safety/test/split.test.ts`, `geometry.test.ts` | PASS |
| T-S69 (U part) | Host-gate loosening not used without C19; envelope only from `tn`/`tm` | `packages/safety/src/hostGates.ts` | `packages/safety/test/hostGates.test.ts` | **FIXED** (finding F2: plasma, partial dual-motor drop, jog-cap edges and infinite values were untested) |
| T-S75 (U part) | Production origin rejects bench entries by signature and `env` | `packages/protocol/src/approvedBuilds.ts`, `releaseKeys.ts`, `firmware/approved-builds.json` | `packages/protocol/test/approvedBuilds.test.ts`, `tools/gates/test/approved-builds.test.ts` | PASS. Advisory and revocation parts are Phase 1/6 |
| T-S76 | A file ending with spindle or coolant on is blocked until C22 | sanitiser end-state rule | `sanitize-property.test.ts`, `sanitize-rules.test.ts` | PASS |
| T-S86 (Phase 0 part) | First line written is `{"sr":null}`; ORPHANED_MOTION unclassified allows only `!` and Reset controller | `packages/protocol/src/probe.ts`; `allowMatrix.ts` | `probe.test.ts` ("writes {"sr":null} first"); `allowMatrix.test.ts` (T-S86) | PASS (probe P1). Connect paths and the spliced-fragment model test are Phase 1 (P1-03) |

Not Phase 0 (no code exists for them yet; each names its owning task):
T-S5 to T-S15, T-S17 to T-S23, T-S26 to T-S31, T-S33 to T-S37 (Phases 1–5),
T-S39 (MachineSession, P1-02), T-S41 to T-S54, T-S56, T-S60, T-S61, T-S63,
T-S65 to T-S68, T-S70 to T-S74, T-S77 to T-S85, T-S87, T-S88 (Phases 1–6 and
Track A). Where Phase 0 already carries their data (for example the stop
sequences of T-S23 and the ENQ rule of T-S87), the data is covered by the
rows above and by `dialect-contract.test.ts`.

## B. Safety review checklist (SAFETY.md §8) items that apply to Phase 0 code

| Item | Requirement (abridged) | Enforcement | Test | Status |
|---|---|---|---|---|
| OLD-S 2 | No mid-line abort; one complete line per awaited write; no newline after a failure | `machine/src/guardedTransport.ts`, `writeShape.ts`; lint `noWriterAbort.ts` | `guarded-transport.test.ts` (H2b latch, ordering), `write-shape.test.ts`, `acceptance.test.ts` ("a writer abort in machine fails lint") | PASS (probe P2) |
| OLD-S 3 / 33 | Every intent through `allowed`; no unclassified cell; stop class allowed in every connected overlay | `allowMatrix.ts` | T-S3, T-S62 rows above | PASS (FIXED oracle) |
| OLD-S 7 | Bytes to the board exclude `! ~ %` and control bytes in data, no `$ ? H h {` start, line limits | sanitiser; `writeShape.ts` | T-S1 row; `write-shape.test.ts` | PASS |
| OLD-S 8 | Dialect differences as data, with citations and table snapshots | `protocol/src/dialects/*`, `schema/src/generated/*` | `dialect-contract.test.ts`, `tools/gates/test/schema-tables.test.ts`, `hilTables.test.ts` | PASS |
| OLD-S 9 | Every firmware claim cites file:line or is UNVERIFIED with a bench task; the test kit carries the same status | `@cite` tags; `testkit/src/honesty/` | `testkit/test/honesty.test.ts`, `citations.test.ts` (env-gated, run in this audit), `dialect-contract.test.ts` ("every unverified fact names a bench task") | PASS |
| OLD-S 13 | §5–§6 strings unchanged unless SAFETY.md changes in the same PR | `strings.ts` | T-S32 | FIXED (F1) |
| OLD-S 14 / RUN_PLAN §5.3 | No runtime npm dependency in `protocol safety machine` (and `flasher provenance schema`) | `.dependency-cruiser.cjs` `safety-path-no-npm`, `safety-path-no-node-core`; package smoke tests | `tools/gates/test/acceptance.test.ts` ("an npm import in safety…", "npm reached transitively…"), each package's `smoke.test.ts` | PASS |
| OLD-S 15 | CSP and Trusted Types not loosened; no inline script; no third-party origin | headers, `tt.ts`, bundle scan | T-S25 row; `csp.e2e.ts` (inline script blocked) | PASS |
| OLD-S 17 | Stryker ≥ 90 % on touched safety-path packages; `safety` branch coverage 100 % | `packages/safety/stryker.config.json` (break 90), `vitest.config.ts` thresholds | `pnpm --filter @synthetos/safety mutation`, `pnpm test` | **FIXED** (finding F4: 87.90 % → 90.84 %). Coverage 100 % PASS. See open item O5 for the other packages |
| OLD-S 20 | No code path emits 0x18 except `resetController` | dialect stop data | `dialect-contract.test.ts` ("no stop sequence ever writes ^X") | PASS for Phase 0 data; the generated T-S26 is Phase 2 |
| 22 | No network identifier in `protocol safety machine flasher provenance schema`; none imports `contracts` or `cloud`; no import chain from `cloud` reaches the machine path (P0 review, P0-02 #1) | lint and dependency-cruiser | T-S57 row; `acceptance.test.ts` (contracts, cloud client rules), `review-gates-acceptance.test.ts` (multi-hop cloud chains, machine -> schema -> fetch) | PASS |
| 27 | All reads through the per-dialect allowlist | `schema/src/allowlists/` | T-S38 row | PASS |
| 28 | Dialect selection uses the probe and manifest, not `fb` alone | `classify.ts` | T-S55 row; `capability.test.ts` property "edge-next full requires every capability token" | PASS |
| 29 | ^D and ENQ only on `tinyg-en` and only by the named intents | dialect data, `allowMatrix.ts` | T-S24a/b rows; `dialect-contract.test.ts` | PASS (data level) |
| 30 | Program stops are host barriers on every TinyG dialect; final M2/M30 holdback intact | dialect `gcode` data; sanitiser marking | `dialects.test.ts` (G-code rules), `sanitize-corpus.test.ts` (C14 barrier, final M30 held back) | PASS |
| 31 | Test kit not reachable from any production entry | dependency-cruiser `entries-never-reach-testkit`, `production-source-never-imports-testkit`; bundle scan | T-S40 row; `acceptance.test.ts` | PASS |
| 34 | No string calls a hold "STOPPED"; the pause control carries W2 | `strings.ts`; `apps/web/src/shell/SafetyBar.ts` | T-S32 (W2 label); `apps/web/test/shell.test.ts` (stop button labelled W2), `safety-bar.e2e.ts` | PASS for Phase 0 (no hold UI yet; T-S63 is Phase 2) |
| 36 | Every profile field classified; host-gate loosening through C19 | `hostGates.ts` | T-S69 row | FIXED (F2) |
| 38 | No sanitised line queues more than the ceiling | sanitiser step 6a | T-S64 row | PASS |
| 39 | Connect writes `{"sr":null}` first; no ENQ before a rev-2/3 footer | `probe.ts`; `enq` row | T-S86 row; T-S24b row | PASS (probe P1) |
| CODEOWNERS | The §8 path list is owned by the owner | `.github/CODEOWNERS` | `tools/gates/test/codeowners.test.ts` (reads §8 from the in-repo SAFETY.md) | PASS |

Items 1, 4, 5, 6, 10, 11, 12, 16, 18, 19, 21, 23–26, 32, 35, 37 and 40 cover
code that Phase 0 does not have (MachineSession, UI state, timers, settings
write, jog, flasher, preview, cloud API, console): N/A until their phase.

## C. ROADMAP Phase 0 acceptance criteria

| Task | Acceptance criterion | Test or evidence | Status |
|---|---|---|---|
| P0-01 | Frozen-lockfile install with `--ignore-scripts`, typecheck, test and web build succeed on a clean clone; lockfile committed | A fresh `git clone` of the audit commit: `pnpm install --frozen-lockfile --ignore-scripts`, then typecheck, gates, `pnpm test` (2,044 passed, 2 env-gated skips), build and bundle scan all pass; `pnpm-lock.yaml` tracked | PASS |
| P0-02 | Each of the six named violations fails CI; clean `main` passes | `tools/gates/test/acceptance.test.ts` ("the six ROADMAP P0-02 acceptance violations", "the remaining P0-02 rules") | PASS |
| P0-03 | `verify` fails on a failing test | `build-acceptance.test.ts` ("the unit-test command exits non-zero when one test fails"), `workflow-policy.test.ts` ("fails when verify stops running the tests") | PASS |
| P0-03 | Deploy jobs cannot run on a PR | `workflow-policy.test.ts` ("deploy jobs evaluate to false for every pull_request context…") | PASS (static proof; the "in the logs" proof needs the GitHub repo, O2) |
| P0-03 | Only deploy jobs reference the Cloudflare secret | `workflow-policy.test.ts` ("grep: only the deploy jobs mention the Cloudflare secret") | PASS |
| P0-03 | A missing §8 CODEOWNERS path fails CI | `codeowners.test.ts` | PASS |
| P0-03, D40 | Safety-path PRs need the checklist and a recorded independent review bound to the head; zero approvals with one maintainer, two restored by a one-line change; a PR cannot replace its own enforcement step | `tools/gates/src/review/reviewPolicy.ts`, `reviewRecord.ts`, `safetyReview.ts`, `.github/workflows/safety-review.yml`, ci-policy `safety-review-job` | `review-policy.test.ts`, `safety-review.test.ts`, `review-permission.test.ts`, `deploy-workflow.test.ts` ("safety-review-job") | PASS (static and local; the native ruleset is O2) |
| P0-03 | Two clean builds are identical; an injected timestamp fails | `build-acceptance.test.ts` (reproducible build) | PASS |
| P0-03 | Bundle scan fails on an origin literal or network identifier outside `cloud` | `build-acceptance.test.ts`, `bundle-scan.test.ts` | PASS |
| P0-04 | `wrangler dev` serves the shell with the exact headers (Playwright) | `tools/e2e/specs/headers.e2e.ts` | PASS |
| P0-04 | An inline `<script>` in a built page is a CSP violation | `tools/e2e/specs/csp.e2e.ts` (with a no-CSP control) | PASS |
| P0-04 | `workers_dev: false`, `preview_urls: false`, custom domains, `run_worker_first` | `tools/gates/test/worker-config.test.ts` | PASS |
| P0-04 | Smoke script fails on a header regression | `tools/gates/test/smoke.test.ts` ("fails on a broken header", local server) | PASS (local); deploy-job run is O1 |
| P0-04 | Production serves the shell; staging reachable only through Access (manual) | needs the D39 account lockdown and D31 Access application | **FAIL: blocked on owner (O1)** |
| P0-05 | T-S32 | see section A | FIXED (F1) |
| P0-05 | Contrast ≥ 4.5:1 text, ≥ 3:1 non-text, both themes | `tools/gates/test/tokens.test.ts` ("contrast table"), `docs/design/contrast.md` | PASS |
| P0-05 | Installable (manifest fields, icons, no installability errors); installed window shows the same safety bar | `tools/e2e/specs/install.e2e.ts` | PASS (automated part); the manual Install-prompt check on desktop Chrome and Edge is O3 |
| P0-05 | Screenshots light/dark at 320 and 1280 px | `docs/design/screenshots/p0-05/` (12 files) | PASS (evidence, reviewed by eye) |
| P0-05 | Safety bar visible at 320 px and desktop; axe-core passes; no request leaves the origin | `tools/e2e/specs/safety-bar.e2e.ts` | PASS |
| P0-05 | Token drift against the site at a pinned ref | `tokens.test.ts` (env-gated, run in this audit) | PASS |
| P0-06 | T-S25 in CI; a third-party URL in a built page fails the job | `pnpm e2e:artifact` (suite then canary), `tools/e2e/test/canary.test.ts` | PASS locally; first CI run is O2 |
| P0-07 | Fixtures: every PN JSON example, 29 forum topics with URLs, EN-HIL banner shapes and footer revisions, relaxed `{er:…}` | `packages/protocol/test/fixtures.test.ts` | PASS |
| P0-07 | fast-check: re-chunking invariance, arbitrary bytes never throw, XON/XOFF never inside lines | `frame.test.ts`, `inbound.test.ts`, `json.test.ts` | PASS |
| P0-07 | 100 % branch coverage on `frame.ts` and `classify.ts` | `packages/protocol/vitest.config.ts` thresholds (all protocol sources at 100 %) | PASS |
| P0-08 | T-S4, T-S75, T-S55, T-S24a/b precursors | section A | PASS |
| P0-08 | Probe steps are GETs, single line, single key | `probe.test.ts` ("every step is a GET…") | PASS |
| P0-08 | `tinyg-449-stock` always readOnly; g2core real data, not a stub; shared contract tests over every dialect | `dialects.test.ts` ("modes and lookups"), `dialect-contract.test.ts` | PASS |
| P0-08 | Board schema and selection with TinyG v8 and Due+gShield fixtures; unknown → safe common subset | `packages/schema/test/boards.test.ts`, `jsonSchema.test.ts` | PASS |
| P0-09 | Every vendored token allowed or denied; every allowlisted token in its table | `allowlists.test.ts` (RUN_PLAN §8.2 block) | PASS |
| P0-09 | Snapshot fails if regeneration changes the output | `tools/gates/test/schema-tables.test.ts`, `hilTables.test.ts` ("the generated module is exactly its vendored table") | PASS |
| P0-09 | `adc3`, `md`, `me` denied in every dialect | `allowlists.test.ts` | PASS (probe P4) |
| P0-09 | Forbidden keys never in a write plan (fast-check) | `packages/schema/test/writePlan.test.ts`, `forbiddenWrites.test.ts` | PASS |
| P0-09 / D32 | `den.json` generated from the edge-next pin, recording its source commit | `vendor/tinyg-hil-tables/SOURCES.json`; `hilTables.test.ts` ("den.json is generated from the edge-next pin") | PASS |
| P0-10 | T-S1, T-S2, T-S3, T-S58 | section A | PASS |
| P0-10 | 100 % branch coverage on `safety`; Stryker 90 % gating | `packages/safety/vitest.config.ts`; `stryker.config.json` | **FIXED** (F4) |
| P0-10 | Phase 0 release denies every motion and write intent ("Not available in this release.") | `allowMatrix.test.ts` ("Phase 0 release gate") | PASS |
| P0-11 | Each cited EN and TG behaviour listed in the task has a test | `packages/testkit/test/en-model.test.ts`, `tg-model.test.ts`; `honesty.test.ts` ("every behaviour has a test whose title carries its id") | PASS |
| P0-11 | Same seed → byte-identical transcripts | `determinism.test.ts` | PASS |
| P0-11 | Test kit is dev-only with `TESTKIT_MARKER` | `marker.test.ts`, bundle scan | PASS |
| P0-12 | T-S16; line validation; Transport has `writeLine` semantics and no `abort()`; lint rule in force | `t-s16.test.ts`, `write-shape.test.ts`, `guarded-transport.test.ts`, `transport-contract.test.ts` ("has exactly the reviewed members"), `acceptance.test.ts` ("the P0-02 Web Serial rule is still in force") | PASS |
| P0-13 | T-S40; importing the test kit into an entry fails both dependency-cruiser and the scan | `bundle-acceptance.test.ts` | PASS |
| P0-14 | Written result; a passing example that opens the mock port from `machine.worker` in the built app | `docs/testing/fake-serial.md`; `tools/e2e/specs/open-mock-port.fake-serial.ts`; `fake-serial-acceptance.test.ts`, `artifact-diff.test.ts` | PASS |
| Phase 0 rule | Nothing opens a serial port; no `navigator.serial` outside test fakes | lint `noWebSerial.ts`; bundle scan Web Serial rule; `machine-worker.e2e.ts` ("has no transport in Phase 0") | PASS |
| P0-15 | Tag `run-v0.1.0`, `RELEASES.md`, production deploy with smoke output, live site, staging behind Access | `RELEASES.md` entry written (pending); deploy and tag need a GitHub remote, the D39 account lockdown and D31 Access, in the order of `docs/LEAD_ACTIONS.md` | **FAIL: not done, blocked on owner (O1, O2, O4)** |

## D. Owner decisions with a Phase 0 safety condition

| Decision | Condition | Code | Test | Status |
|---|---|---|---|---|
| D1 | Sign-in required to connect and start; nothing in the machine path consults the session; stop and recovery never need sign-in | `MatrixSnapshot` has no account field (`allowMatrix.ts`); machine-path packages cannot import `contracts` or `cloud` (`.dependency-cruiser.cjs`); W22 and §4.9 wording (`strings.ts`, `SAFETY.md`) | `allowMatrix-oracle.test.ts` (D1 block: type-level key check, decisions unchanged by any attached account state), `acceptance.test.ts` (contracts and cloud rules), T-S62, T-S32 | **FIXED** (F1, F5). The sign-in gate itself is UI work in Phase 1 and lives outside the machine path |
| D3 | Public Apache-2.0 repo | `LICENSE`, `NOTICE`, licence gate | `licence-policy.test.ts`, `spdx.test.ts` | PASS |
| D4 | Detect by capability probe, never by build number alone | `classify.ts` | T-S55; `capability.test.ts` property tests | PASS |
| D31, D39 (supersedes D34) | Staging behind Access; the current account, locked down; placeholder until the owner sets its id; only run may bind accounts | `workers/run/wrangler.jsonc` (placeholder account id), `tools/gates/src/deploy/preflight.ts`, `tools/gates/src/bindings/check.ts`, `docs/ops/account.md`, `docs/ops/access.md` | `worker-config.test.ts` ("is refused for deploy while the account id is the placeholder"), `accounts-binding.test.ts`, `owner-decisions-drift.test.ts`, `smoke.test.ts` (Access checks) | PASS for code; activation is O1 |
| D32 | `den.json` generated from the edge-next candidate | `vendor/tinyg-hil-tables/` | `hilTables.test.ts` | PASS |

## Findings and fixes made in this audit

- **F1. W22 contradicted the D1 safety case (T-S32 false pass).** The owner's
  D1 decision changed SAFETY.md upstream (synthetos.com `f2760cd2`): W22 now
  says that starting a job, jogging, homing or changing settings needs sign-in
  again. The in-repo SAFETY.md was still the earlier copy, and `strings.ts`
  still said "Your job and machine control are not affected", which under D1
  is untrue. T-S32 passed only because both sides were stale. Fixed: the
  upstream change is applied to `SAFETY.md` (W22, H27, H42, the §4.9 identity
  rows), `w22()` matches it, the message snapshot is updated, and
  `docs/safety/README.md` records the new source commit. T-S32 fails on the
  old wording (checked).
- **F2. Host-gate loosening edges untested (T-S69).** Mutation testing showed
  that these could be weakened with every test still passing: spindle kind
  away from **plasma** (only laser was tested); dropping **one of two**
  dual-motor axes; a jog-cap change that keeps one cap and lowers the other;
  an infinite hold timeout or jog cap. Tests added to `hostGates.test.ts`.
- **F3. Self-referential oracle in the generated allow-matrix test (T-S3,
  T-S62, T-S59).** `allowMatrix.test.ts` takes `STOP_CLASS` and
  `PORT_OPEN_STATES` from the module under test. Emptying `STOP_CLASS` made
  the T-S62 loop vacuous, and counting NOT_CONNECTED as "port open" moved the
  expected values with the code; both mutants survived. Four job states in
  the Load job and Cloud sync rows, and most intent kinds, were also
  unpinned. Fixed with `allowMatrix-oracle.test.ts`, which writes every list
  out from SAFETY §3 and §4.1. Both mutants are now killed (checked).
- **F4. Mutation score below the P0-10 gate.** `pnpm --filter @synthetos/safety
  mutation` scored 87.90 % against a 90 % break threshold (CI would have
  failed). 85 of the 483 survivors were in `strings.ts`: the parameter name in
  each refusal message, and one whole check, could be lost unnoticed. With
  `strings-errors.test.ts` (every parameter of every string function is
  refused by name) and F2/F3, the score is 90.84 %.
- **F5. No test held the D1 condition at the decision function.** The
  dependency rules kept `contracts` and `cloud` out of the machine path, but
  nothing stopped `allowed()` from reading an account field a caller attached
  to the snapshot. `allowMatrix-oracle.test.ts` now fails the typecheck if
  `MatrixSnapshot` gains a field, and fails at run time if any decision
  changes with attached account state (checked with a mutant that denies when
  `signedIn === false`).

### Mutation probes

Behaviours outside `safety` have no mutation gate in Phase 0, so the main
ones were checked by hand: each mutant was applied, the package's tests run,
and the source restored.

| Probe | Mutant | Result |
|---|---|---|
| P1 | `{"sr":null}` moved after the identity GETs (`protocol/src/probe.ts`) | killed (2 tests) |
| P2 | realtime group length cap removed (`machine/src/writeShape.ts`) | killed |
| P3 | direct 2341:003D refusal removed (`machine/src/openPolicy.ts`) | killed |
| P4 | `adc3` removed from the deny list (`schema/src/allowlists/tinygCommon.ts`) | killed (5 tests) |
| P5 | edge-next accepted without the capability tokens and stubbed `spph` (`protocol/src/dialects/classify.ts`) | killed (6 tests) |
| S1 | `STOP_CLASS` emptied | killed (was surviving) |
| S2 | NOT_CONNECTED counted as port-open | killed (was surviving) |
| S3 | `allowed()` denies when `signedIn === false` | killed |
| S4 | W22 reverted to the pre-D1 wording | killed |

## Open items

- **O1. Deployment acceptance (P0-04, P0-15): FAIL, blocked on the owner.**
  The D39 lockdown of the current Cloudflare account, its scoped CI token, the D31 Access application
  on `staging.run.synthetos.com` and DNS do not exist yet. Until they do,
  "production serves the shell", "staging only through Access", "the smoke
  script passes in the deploy job and fails it on a header regression" and
  the post-deploy DNSSEC/CAA/issuer checks cannot be run. Owner actions:
  `docs/ops/account.md`, `docs/ops/access.md`, `docs/ops/worker.md`.
- **O2. First CI run (P0-03, P0-06): FAIL, blocked on the owner.** There is no
  GitHub remote. "Deploy jobs cannot run on a PR (proved in the logs)" and
  "T-S25 passes in CI" are proved statically and locally here; the CI logs
  need `synthetos/run` created and the branch protection of
  `docs/ops/branch-protection.md` enabled.
- **O3. Manual install check (P0-05): FAIL until recorded.** The Install
  prompt on desktop Chrome and Edge must be checked by a person and recorded
  (`docs/ops/install-check.md`). The automated installability test passes.
- **O4. P0-15 not done.** `RELEASES.md` has the `run-v0.1.0` entry, marked
  pending; the production deploy, smoke output and tag depend on O1 and O2.
  The owner's steps, in order and with commands, are in `docs/LEAD_ACTIONS.md`,
  which also covers the two decisions found in the final gate. The owner has
  since decided both (D39: run stays in the current Cloudflare account,
  superseding D34; D40: single-maintainer review), and both are now carried
  into the gates and ops pages (`docs/LEAD_ACTIONS.md` Step 0).
- **O5. Mutation margin and coverage of the other safety-path packages.**
  The `safety` package now passes at 90.84 %, but `sanitize/` alone is at
  88.4 % (`analyze.ts` 88.6 %, `geometry.ts` 80.7 %, 333 survivors), so the
  package-level margin is thin. OLD-S §8 item 17 asks for ≥ 90 % "on touched
  safety-path packages"; only `safety` is mutation-tested. `protocol` is held
  at 100 % coverage, `machine` and `schema` have no coverage or mutation gate.
  Recommended before Phase 1: raise `sanitize/` above 90 % and add Stryker
  (or at least 100 % coverage thresholds) to `protocol`, `machine` and
  `schema`.
- **O6. SAFETY.md copies differ.** The in-repo SAFETY.md carries the "Amended
  in P0 review" text (§4.3, §4.4 steps 1 and 3, §4.7 step 6a), which the
  synthetos.com copy does not have. The authoritative copy should receive
  these amendments so the two are identical again (`docs/safety/README.md`).
- **O7. Firmware pin note: fixed in the P0 review fix pass, except the signed
  bench note.** DECISIONS D4 records edge-next as 450.01 at `ead63997`, the
  commit pinned here. `vendor/firmware-pins.json`, the `tinyg-en` dialect
  header, the classifier header and `docs/ops/release-key.md` now say D4 is
  done, and keep the `fbs`/`cap` tokens, D5 image approval and the D6 release
  open and separate. The bench entry note inside the signed manifest still
  predates D4; it changes only with a new signature, so it waits for the
  owner's re-sign (`docs/ops/release-key.md`, "The signed bench note predates
  D4"). `tools/gates/test/doc-drift.test.ts` keeps all of this from drifting
  back. The local `edge-next` tip has moved to `222a45c0`; re-pinning (PIN-1)
  is a separate reviewed change, and classification relies on the capability
  probe, never on `fb` alone.
