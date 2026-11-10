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
| OD-3 | D41: how is the D1 sign-in gate satisfied before accounts.synthetos.com and staging Access exist, and how is Web Serial granted for Phase 1? | **ACCEPTED as D41 (owner, 2026-11-02), as proposed; the window's port chooser gate change APPROVED the same day and implemented (commits 02fea94, c75f8c1)** | — |
| OD-4 | In Phase 1, a session under ORPHANED_MOTION cannot be disconnected from the app (the matrix allows only Stop job and Reset controller as exits, and Phase 1 has neither ^D nor ^X). Keep that, or allow Disconnect there in Phase 1? | **DECIDED (owner, 2026-11-02): keep it (option 1).** No Disconnect under ORPHANED_MOTION; the bench guide says unplug the USB or close the tab | — |

OD-1, OD-2 and OD-3 are recorded in `DECISIONS.md` (D40, D39, D41), and the gates and ops pages
now implement them (`docs/ops/account.md` §1 records what the accounts and
site repositories must match).

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
(`docs/ops/branch-protection.md` §1) requires
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

**Options for the owner** (from the owner's checklist, Step 0b):
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
and `docs/ops/branch-protection.md` describe the
current account with the D39 lockdown; the account id placeholder was
`RUN_ACCOUNT_ID_PLACEHOLDER` (refused by every deploy) until the owner set the account id on 2026-11-04. `pnpm
ci-policy` refuses any wrangler configuration other than run's that binds
`accounts` (`tools/gates/src/bindings/check.ts`), and `docs/ops/account.md`
§1 records the matching requirement for the accounts and site
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

**Options if it does not work** (from the owner's checklist, Step 0a):
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

## OD-3. D41 (accepted 2026-11-02): pluggable sign-in gate, the localhost bench build, and where serial is granted

**Status: ACCEPTED (owner, 2026-11-02), as proposed below, and recorded as
D41 in `DECISIONS.md` (synthetos.com). The window's port chooser change
described at the end of this section was APPROVED the same day and is
implemented (see "The window's port chooser: as implemented").**

**Context.** D1: signing in is required to Connect and Start, nothing in the
machine path ever consults the session, and Pause, stop and recovery are
never gated. For Phase 1 the owner wants to plug a real TinyG into this
computer and see it read-only. accounts.synthetos.com is not deployed yet
(Track A1) and staging Access (D31) is not configured, so neither identity
the plan names exists today. RUN_PLAN §6.4 grants `serial=(self)` "from the
Phase 1 bench app onward", but RUN_PLAN §5.2 runs one attested artifact on
both staging and production, so a static header file cannot differ between
them.

**Decision (as proposed, accepted 2026-11-02).**
1. The D1 gate (P1-05) is **pluggable** in the UI/auth layer, with exactly
   three identity providers: the run session (A1-07, later; production
   only ever accepts this one); the verified Cloudflare Access identity
   (staging, RUN_PLAN §2.2 until A1-07); and a **localhost-only bench
   identity** that exists only in an explicit bench build.
2. The **bench build** is `vite build --mode bench` (`pnpm build:bench`,
   `apps/web/dist-bench/`). It is the release build with one module
   swapped, the build-channel seam (`apps/web/src/channel/`), and
   `pnpm bench:check` proves that nothing else differs. It refuses to run on
   any host but `localhost`/`127.0.0.1` over plain HTTP, and only the
   loopback bench server (`pnpm bench:serve`, 127.0.0.1, Host-checked)
   serves it. It is **never deployed**: its marker fails every staging and
   production bundle scan (the build job, both deploy jobs), and ci-policy
   `bench-never-in-ci` refuses any workflow line that builds, scans or
   serves it. The bench identity of P1-05 lives in the bench channel
   module, so it cannot exist in a staging or production artifact.
3. **Web Serial is granted** (`serial=(self)`) on staging (by the Worker,
   only when `RUN_ENV` is `staging` and the host is
   staging.run.synthetos.com) and by the bench server. **Production stays
   at `serial=()`**, and the production deploy job's bundle scan
   (`--target production`) refuses any artifact that carries the Web Serial
   transport, so production keeps the Phase 0 shell until Phase 6.

**As implemented here (P1-00).** Items 2 and 3 are in place: the bench
build, server, scans and CI rule; the per-environment headers
(`workers/run/src/headers.ts`, `docs/ops/worker.md`). Item 1 is P1-05.
Nothing in the machine path imports the build channel
(dependency-cruiser `machine-path-never-reaches-build-channel`).

**What the owner should weigh.**
- The bench build is a second artifact. The diff check keeps it equal to
  the release code except one small module, but HIL records for a phase
  release must still name the staging artifact (SAFETY HIL-6.4), not the
  bench build. Proposed: the bench build is for looking and for bench
  tasks (B-*); a signed HIL record is always taken on staging.
- The bench identity means "whoever sits at this computer". That is the
  same trust as the bench itself, and it never reaches a deployed origin.
- From P1-01 on, every main push's production deploy stops at its scan
  (by design, before anything is deployed). If a red production job on
  every push is unwanted, the alternative is to keep `RUN_DEPLOY_ENABLED`
  for staging only, which needs a workflow change of its own.

- **The window's port chooser still needs one more gate change (not
  decided here; P1-01 did not make it).** P1-01 added the transport and
  the worker's side of the port choice (`findGrantedPort`); no window code
  calls `requestPort()` yet, so nothing can produce a selector for a real
  port. The task that adds the Connect gesture (P1-02's PORT_REQUEST, or
  P1-03) must make this change in its own reviewed commit. The narrowest
  form keeps the ROADMAP wording ("only in
  `machine/src/webSerialTransport.ts`"): export the chooser from that same
  module and admit exactly one main-thread importer in
  dependency-cruiser, with the page build filing that chunk under
  `assets/serial/` too. Original note: RUN_PLAN
  §5.4 has the window call `requestPort()` (it exists only on Window and
  needs a user gesture) and read the chosen port's `getInfo()` and its
  index in the window's own `getPorts()` to build the `PortSelector`
  (docs/testing/fake-serial.md, "Recommended for P1-01"). The P1-00 gates
  admit Web Serial in `packages/machine/src/webSerialTransport.ts` only,
  which only the machine worker's seam may import, and the bundle scan
  admits it only in `assets/serial/` (a worker chunk); so no main-thread
  file can make that call today. P1-01 must either name exactly one
  main-thread chooser module in every gate (lint, source check,
  dependency-cruiser, its own page chunk in the scan), in its own reviewed
  change, or the owner amends the ROADMAP wording "only in
  machine/src/webSerialTransport.ts".

**The window's port chooser: as implemented (approved 2026-11-02).** The
narrowest form, in its own reviewed commit (02fea94): the chooser is one
named sibling of the transport, `packages/machine/src/webSerialChooser.ts`
(`WEB_SERIAL_CHOOSER_MODULE`). It calls `requestPort()` synchronously,
reads `getInfo()` and the chosen port's index in the window's
`getPorts()`, and returns a `PortSelector`; it never opens a port and
imports types only. A sibling rather than an export of the transport
itself, so the page chunk holds no transport code and the fake-serial test
artifact (whose page imports it too) still holds no transport. Exactly one
main-thread module imports it, `apps/web/src/live/portChooser.ts`
(`WEB_SERIAL_CHOOSER_IMPORTER`), and every gate says so: lint and the
source check admit a static `navigator.serial` read in the chooser only;
dependency-cruiser `web-serial-chooser-importers` and
`web-serial-chooser-type-imports-only`; the page build files its chunk as
`assets/serial/web-serial-chooser-<hash>.js` (`apps/web/build/chunks.ts`),
which the staging and bench scans admit and the production scan refuses;
the fake-serial diff accepts that chunk only when byte-identical in both
artifacts. The Connect wiring followed in its own commit (c75f8c1): the C1
confirm click calls the chooser after the D1 gate (the bench identity in
the bench build), the advisory and C1, and hands the selector to the
machine worker. Pause, Escape and the stop requests are never gated.

**If the owner had rejected it.** Remove the bench build (`apps/web/build/bench.ts`,
`apps/web/src/channel/bench*.ts`, `tools/gates/src/bench/`, the bench scan
target and the policy rule) in one reviewed change; staging and production
headers are independent of it.

---

## OD-4. Disconnect under ORPHANED_MOTION in Phase 1 (raised in P1-02)

**What the design says.** SAFETY §3: "From ORPHANED_MOTION: only Stop job
(...) or Reset controller (C15, then a full re-handshake). Never `~`." The
allow-matrix (P0-10) therefore denies Disconnect under ORPHANED_MOTION, so
the user cannot walk away from a machine that is still running something a
previous session queued.

**What Phase 1 adds.** Phase 1 never writes ^D or ^X (ROADMAP Phase 1). So
under ORPHANED_MOTION the only thing the app can send is `!` with "Use your
E-stop", and there is no way to leave the overlay from the app: it ends when
the board resets (its banner; the probe then starts again) or when the USB
link goes (LOST, then Acknowledge). Closing the tab also releases the port.
The P1-02 implementation follows the matrix as written; the bench guide
(BENCH-P102-4) tells the user to unplug the board or close the tab.

**Options.**
1. Keep it (recommended for Phase 1): disconnecting does not stop the
   machine, the user is at the bench with the E-stop, and unplugging is the
   honest action. Nothing changes.
2. Allow Disconnect under ORPHANED_MOTION in the Phase 1 release only (an
   allow-matrix change, needs safety review): the app then releases the port
   while the board may still be moving, with W32 shown.

**Decision (owner, 2026-11-02): option 1, keep it.** No Disconnect under
ORPHANED_MOTION in Phase 1. The bench guide (section 5.7) tells the user to
unplug the USB or close the tab. Nothing changes in the allow-matrix.

The decision does not change any byte the app writes.

## OD-5. A public board illustration for the configurator (owner, 2026-11-02)

**Decision: approved.** The owner, who owns the hardware design, approves a
separately authored, publishable illustration of the TinyG board (v8 first)
for the visual configurator. It looks like the "Connecting TinyG" wiki images,
but is cleaner and interactive.

- **What may go into it:** connector positions, labels and orientation, taken
  as derived facts.
- **What may not:** no CAD file, netlist, layout export, screenshot or private
  path from the hardware repositories is published (D26 and RUN_PLAN rule 6
  still apply).
- **Provenance:** each illustration records which reviewed public facts it
  shows.

## OD-6. Short Pause and Stop labels (owner, 2026-11-02)

**Decision.** The Pause button reads "Pause". The words "not an E-stop" are
removed from the button. The permanent W1 warning at the top still says the
software is not an emergency stop. "Stop job" no longer says "spindle off".

**Consequences.**
- SAFETY.md W2 and the related C-strings change. The T-S32 test, which
  compares the strings byte for byte, follows the amended SAFETY.md.
- The spindle-stays-on fact moves to the state shown while paused:
  "Paused · spindle still on".
- Implemented with the workspace rebuild (Stage 1, branch workspace-stage1):
  SAFETY.md W2 and §4.4 carry the dated "Amended 2026-11-02 (OD-6)" notes,
  `strings.ts` `w2Label()` is "Pause", `STOP_TEXT` gains "Stop job",
  "Paused", "Paused · spindle still on" and "Paused: the machine was idle,
  nothing changed", and T-S32 checks them byte for byte.

## OD-7. run is public and licensed AGPL-3.0 (owner, 2026-11-02)

**Decision.**
- run is open source in the public repo `synthetos/run`, created by the owner on 2026-11-02.
- Its license changes from Apache-2.0 (D3) to **AGPL-3.0**.
- The owner's intent: run is open source and not commercial. Anyone who modifies it and distributes it or serves it over a network must publish their source under the same license.

**TinyG note.**
- TinyG is GPL-2.0-only, © Alden S. Hart, Jr.
- Some run files are generated from TinyG source: the settings tables, and the error codes with their text.
- The owner's position: the license obligation belongs to the firmware, not to run.
- Recorded here so the provenance stays clear: the generated tables keep their TinyG source citations.

**Consequences.**
- LICENSE, NOTICE, README, the package `license` fields, SPDX headers, the site footer and D3/PHASE0 traceability all move to AGPL-3.0.
- The dependency licence gate is unchanged: dependencies stay permissive-only.
- No push happens until the history audit is clean.
- Implemented (branch public-cleanup): LICENSE carries the full AGPL-3.0 text; every package `license` field is `AGPL-3.0-or-later`; NOTICE, README, the site footer and `packages/gcode-view/README.md` say so; the PHASE0 D3 row is marked superseded. No source file carries SPDX headers, so there were none to change.

## OD-8. Board photos may be published; schematics and Gerbers may not (owner, 2026-11-03)

**Decision.** Photographs and rendered images of Synthetos boards from the private hardware repositories may be used in run and on synthetos.com. Schematics, KiCad sources, layouts, netlists and Gerbers stay private: only derived facts (pin names, functions, connector positions, ratings) from them may be published, with a file:line citation, as before (OD-5, RUN_PLAN rule 6).

**Consequences.** Machine and board pages may show real board photos (for example `synthetos-hardware/docs/images/TinyGv8h.jpg`), copied into the public repo with a SOURCE note naming the origin commit. The OD-5 illustration stays the interactive drawing; photos are reference images beside it.

## OD-9. W1 stays visible; other explanations go behind help (owner, 2026-11-03)

**Decision.** The W1 warning line stays permanently visible, as SAFETY.md requires. Every other explanatory paragraph in the workspace (Connect, setup, W13, W7 and similar) moves behind compact (?) help reachable by hover, focus or tap, or is removed. Registered strings stay byte-exact wherever they are shown.

## OD-10. Firmware images come from GitHub Releases (owner, 2026-11-03)

**Decision.** Official firmware `.hex` files are published by CI to GitHub Releases. run's signed release list points at those release assets (repository, tag, asset name, size, SHA-256), and run never flashes a file whose hash differs from the list.

**How run fetches them.** The browser cannot fetch GitHub release assets directly (strict CSP `connect-src 'self'`, and network code lives only in the cloud chunk), so run's Worker proxies them: `GET /firmware/<repo>/<tag>/<asset>` fetches the asset from GitHub server-side, verifies its SHA-256 against the signed list, caches it, and serves it same-origin. On the bench, the user may also pick a local copy, which must match the listed hash. Signing the production list with the release key stays an owner step.

## OD-11. Three staging-only approvals from the firmware-update phase (owner, 2026-11-03)

**Decision.** Approved as built: (1) a signed release on the staging release list counts as an approved build for its hardware version, so a board updated to a listed release is not read-only when its settings restore must be written; (2) the simulated board's test images are listed under hardware version 99 and refused on any real port; (3) `positionVerify` is allowed under NEEDS_REVIEW, so the post-update restore can be written. All three are staging-only; production is unchanged.

## 2026-11-03: routine explanations on demand

The owner explicitly requested that routine explanatory paragraphs become `?` help instead of always-visible copy, citing the spindle readouts, Connect card, preview disclaimer W13, disconnected explanation W7, setup and machine-template copy. The implementation preserves the registered wording and makes help available by hover, keyboard focus and tap; CSS hover/focus works without JavaScript. W1 retains its existing visible presentation. This changes routine presentation, not active faults, confirmations, or Pause/Stop behavior. SAFETY §5 records the presentation amendment. The implementation is reviewed independently before it merges.

## OD-12. Disconnect is never refused for ORPHANED_MOTION (owner, 2026-11-03)

**Owner's words.** "disconnect button is not working. The machine has motion left from a previous session: it can only be stopped. Use Stop job or Reset controller. another bug" (bench 2, after a connect that read another program's unread output).

**Decision.** Disconnect is allowed under ORPHANED_MOTION. Closing the port writes nothing and changes nothing on the board, so the refusal protected nothing; it only kept the user in a session whose one remaining action was `!`. Disconnecting does not stop the machine: Stop job, Reset controller or the E-stop do, and the next connect lands in UNKNOWN as after every abnormal end (W6). Disconnect stays refused while a job, jog, homing, settings write or flash owns the machine. SAFETY H14 and the §4.1 matrix carry the amendment.

## 2026-11-03: output left unread by a previous program (H49 amendment)

Recorded from the bench 2 Console transcript the owner pasted: the first lines run read after opening the port were pushed status reports, a torn heartbeat fragment and only then the answer to run's own `{sr:null}`. The firmware maintainer's session confirmed the board never originates an `r` frame and that the tear happens in the FTDI and macOS buffers once nobody drains the port. Run now discards everything before the first answer on a link (counted in the session log) instead of taking a torn line for a damaged answer. Not an owner decision; recorded here because it changes connect behaviour the owner saw.

## OD-13. The machine pane: one warning, the machine's axes, no scrolling (owner, 2026-11-03)

**Owner's words.** "still so many words nothing works … no way to actually home it or set it homed. so many estop references its over the top already … ugly text, terrible scrolling on this window, spindle and coolant cut off, everything is greyed out, there is entirely too much text and too much scrolling for anyone to use this ever. i want this fixed visually; if it doesnt fit come up with a different solution, look at other cnc uis how they do it. also why cannot i jog right now, move it to a position then set work home or machine home with a button; not all machines have limit switches to home."

**Decisions.**
1. W1 is the only warning that stays on screen. W34 (not homed) is a small "Not homed" tag whose help carries the registered text, and it is still named in every jog confirmation; the "keep a hand on the E-stop" sentence appears once, in W1, and nowhere in panel copy.
2. The pane shows the machine's axes only (X, Y, Z, plus A when the machine has one), never B and C for a TinyG.
3. The pane fits a 1280 × 720 window without scrolling: Position, jog, zero and home on one screen at Simple; tabs only at Advanced; tab labels short enough to fit ("Spindle", not "Spindle and coolant").
4. Zero here, Go to zero, Home all and "Set machine zero here" (G28.3, for a machine without switches) are buttons on the pane; "Set machine zero here" is offered whenever the machine is connected and at rest, whether or not the homing settings were read.
5. A gate that greys the pane out says how to clear it where the user is: NEEDS_REVIEW (the board's settings differ from the reference) offers "Keep the board's settings" and "Review" in the same banner, on every view; nothing is greyed out without its way out beside it.
6. Safety behaviour is unchanged: the confirmations (C4, C16, C25, C26), the motion preconditions and the never-gated Pause, Stop job and Spindle off stay as SAFETY states them.

## OD-14. Run sets the settings it needs at connect (owner, 2026-11-04)

**Owner's words.** "if this is needed we need a way to do this in the UI to set the settings we need … there is a setting delay we need to write to the eeprom … but yes on connect we should set settings for sure."

**Context.** Bench 3 answered every GET with an empty reply (footer-only JSON verbosity, `jv` 1, left by a test harness); run never writes `jv` (SAFETY H24: the default plan normalises nothing), so it could not identify the board and parked in ORPHANED_MOTION with a message that named the wrong cause.

**Decision.** At connect, run sets the communication and reporting settings it requires (starting with `jv`) when they differ, shows what it changed in plain words (as W35 does for the status report list), and offers to restore the previous values on disconnect. Every persisted write follows the firmware's EEPROM rule (the reply, then the settle delay before the next line, N35). The list, target values and timing come from the firmware maintainer's answer and are cited in SAFETY when the amendment to H24 is written; until then this decision is recorded, not built.

**Amended (owner, 2026-11-08).** "we control the hardware so i think settings a sr is fine in settings." Run sets the reporting settings it needs at connect (the `sr` list, `sv`, `si`; H64) and leaves them set. There is no offer to restore the previous values on disconnect. Supersedes the restore offer above, and run decision D24 (synthetos.com docs/run/DECISIONS.md).

## OD-15. Configuration sent during a job is refused and reported (owner, 2026-11-04)

**Owner's words.** "refuse and report i think is the best."

**Context.** On edge-next 450.01 a persisted configuration SET sent while a cycle runs is applied in RAM and only its EEPROM save fails (status 106), so a stray SET from any sender changes machine behaviour mid-cut (firmware maintainer, 2026-11-04).

**Decision.** While a cycle or hold is active, a configuration SET is refused before it is applied (RAM and EEPROM unchanged), the reply carries a distinct status meaning "stop the job first", and the job continues: no alarm, no pause. Stop-class bytes, GETs and runtime `rt` leaves are exempt. Requested of the firmware for 450.02. On run's side a never-send list (`baud`, `$defa`, `jv` 0, `ee` 1, `js` 0, `ex` outside a chosen flow-control change, motor and axis settings during normalisation) is added to the write grammar, and run words the firmware's refusal plainly.

## OD-16. Confirmations are modals below the strip (owner, 2026-11-04)

**Owner's words.** "wth is this looks terrible cant see text lets do modals vs fullwidth screen messages inline this is terrible."

**Decision.** Every confirmation card (C4, C13, C16, C23, C24, C25, C26 and the rest, and "I've checked the machine") opens as a centred modal over the page below the machine strip: readable on any background, the same everywhere it is asked from. W1, the machine strip and Pause and Stop job are never covered and stay usable, so the SAFETY §4.1 rule ("never a modal over the stop controls") holds; Cancel still has the focus. The owner added: "modals not full width messages": the messages that ask for action (the fault and stale banners, "state unknown" with its ways out, the settings review, event notices, W29, a refused connect) are one modal below the strip too, hiding itself when it has nothing to say; the observer's Pause request and Stop job request stay a row, since they are controls.

## OD-17. No settings confirmations at connect (owner, 2026-11-04)

**Owner's words.** "no stop all of this shit, if the ui needs a setting set it then connect this is a requirement stop click hell and modals and revisions etc."

**Decision.** Connecting never stops on a settings difference. When the board's settings differ from this computer's last reference, the board's settings become the reference at once (the next revision, recorded), the difference stays visible in Board, and no NEEDS_REVIEW, banner or confirmation is raised. Settings run needs are set by run at connect (OD-14). Supersedes the NEEDS_REVIEW default resolution (C23) on the connect path; SAFETY H24/H59's drift rows are amended to "recorded and shown, not blocking".

## OD-18. W6 is not printed in the strip before connecting (owner, 2026-11-04)

**Owner's words.** "get rid of this message useless" (the W6 previous-session band in the machine strip), and later "WARNING — … still this is there stop this is dumb".

**Decision.** After a session that ended while connected, the strip before connecting shows the ordinary not-connected state (W7 behind its help) with `data-state="previous-session"`, not the W6 band. The previous session still counts: the next connect still lands in UNKNOWN, and the Position panel then says "Position not verified. The last session ended while connected." with its exits (I've checked the machine, Home, Set machine zero here), so the warning is given once, where the user can act on it. The `liveSession` marker, its lifecycle and the UNKNOWN overlay are unchanged. SAFETY §4.6 "On load", H13 mitigation and T-S17 are amended accordingly.


## OD-19. Job start matches the preview; the board is never left relative after an alarm (owner, 2026-11-08)

**Owner's words.** "option 1 for job start"

**Context.** The preview draws a file from `G21 G90 G17 G91.1` (the offline start state, apps/web gcode-worker `OFFLINE_START`), but the board may hold other modes when a job starts. An alarm, a lost link or a FAULT in the middle of a jog, or a probe ended by Pause, Stop job or an alarm, leaves the board in `G91` (and `G21`), and clearing the alarm does not reset its modes; a file that ends in `G91` without M2/M30 does the same, and an earlier file or another program can leave inches, another plane or absolute arc centres. Job preparation read those modes and checked the file under them, but nothing set them: a file that moves before it sets `G90` ran relative while the preview showed it absolute, with no warning. (Typed G-code is never sent in this release, so the Console was not a way in.)

**Decision (option 1 of three).** Before a job's first line, for each mode the preview assumes that the file relies on (a line that depends on it comes before the file sets it) and that the board, as read, does not hold, run writes it (`G90`, `G21`, `G17`, `G91.1`, one line in that order), takes every prep read again (an independent second review found that offsets and axis settings read before a `G21` were inches), confirms the modes, and checks the file again from those values, so the modes the file relies on are the preview's on the board and in the check. A file that sets its own modes before it moves gets nothing extra. The check says so in one plain line only when run writes something ("Run sets absolute mode and millimetres before the first line, as the preview shows."), and the job card shows the board's distance mode and units near Start, from read values ("Absolute, mm"). The work coordinate system and the motion mode are not written: the preview's G54 with zero offsets matches no board (Set zero and C31 match the work zero), and G0 and G1 move along the same line. With it, three related changes the lead asked for in the same branch: after an alarm that ended a jog, go to zero or probe of run's, a Clear alarm answered with status 0 is followed by `G90` (with `G20` when the board was in inches before that motion; a refused `G90` is said and tried again after the next successful clear); go to zero ends in `G90`, like a jog outside a tool change; and the probe's stop distance converts `zjh` with the units read with it. Known and accepted, in the safe direction: in an inch file whose `F` sits on the line that sets `G20`, that `F` relies on the start units (the firmware reads `F` first), so on a board in inches run writes `G21` first and that `F` is read as mm/min, 25.4 times slower than meant. SAFETY §4.4a Start, §4.5b (Go to zero, Clear alarm), §4.5c, §4.1 and the test rows are amended (2026-11-08).

**Addendum (owner, 2026-11-08).** The owner approved the two session-issued intents this decision added to the allow-matrix (`packages/safety/src/allowMatrix.ts`): `alarmRestore` (motion kind; ALARM and IDLE_*, no overlay) and `jobModes` (jobs kind; PREAMBLE only), as the owner review SAFETY §8 asks for a change to the matrix and the motion grammar.

## OD-20. Resume is one click after a pause the user made (owner, 2026-11-08)

**Owner's words.** "One click, fix the doc"

**Context.** SAFETY §4.1's Resume row asked for "a named confirmation" (C9, with a spindle-restart second step), but the built app never shows C9. As built: Resume is allowed from HELD or PROGRAM_PAUSED with no overlay, only for a job (or a jog's hold) of this session, and only while the controller owes no answer but job lines. After a pause, a breakpoint or a program stop it is one click (`~` when the board reports a hold); after a refused line it is C33; after a manual tool change it is C34, with C35 when the spindle must start again. The row's "fresh report" and "unchanged offsets" conditions are not checked by the code.

**Decision.** Keep one click; the documents follow the code. SAFETY §4.1's Resume row and §6 C9 are amended (2026-11-08): C9 is not shown, its strings stay defined, and C33, C34 and C35 stay where the code asks them.

## OD-21. Run's zero check skips C31 when the zero matches the plan (owner, 2026-11-08)

**Owner's words.** "Skip when they match"

**Context.** The Run step compares the board's work zero with the plan (`runZeroCheck`, apps/web workspace/zeroPlan.ts): the zero Place job planned, or the work zero saved for this file. C31 asked the user to accept the board's work zero whenever they differed.

**Decision.** C31 is not asked when the board's work zero is within 0.05 mm on each of X, Y and Z of Place job's planned zero and the machine position is established (homed or set, no UNKNOWN), as built; the same holds for a saved work zero. When the position is not established the two cannot be compared, and C31 is asked. SAFETY §6 C31 is amended (2026-11-08).

## OD-22. Connect: bench and staging as now, production locked until accounts ship (owner, 2026-11-08)

**Owner's words.** "Allow on bench/staging only"

**Context.** Connecting is identity-gated (D1, OD-3; apps/web live/authGate.ts): the bench build connects as "whoever sits at this computer" on loopback (`bench` provider), staging behind Cloudflare Access (`access` provider), and production accepts only the accounts.synthetos.com session (`run-session`), which has not shipped, so production cannot connect.

**Decision.** Bench and staging connect as now; production stays locked until accounts ship, with a plain message saying so. The message itself is being reworded separately (another change, not part of this record).

## OD-23. Go to zero lifts Z to the top of travel only after a homing this connection saw (owner, 2026-11-08)

**Owner's words.** "A: no lift unless homed"

**Context.** Go to zero (and its C25) raised Z first to `ztm − 1`, just under the top of Z travel, whenever the board reported homed. "Set machine zero here" (G28.3) also makes the board report homed, but then machine Z 0 is wherever the tool was when it was set, so `ztm − 1` can lie above the real top of travel: the Z move stalls and the position is lost. A position set before this connection cannot be told apart from one set by hand.

**Decision (option A of two).** The safe Z is `ztm − 1` only when this connection saw a homing cycle home Z (the session's per-axis note, since the review of 2026-11-08). In every other case it is the current machine Z, so Z is not lifted (the session never lowers it), and C25 adds: "The machine position was set by hand, so Run does not know the top of Z travel: raise Z first if the tool is near the work or a clamp." (owner-approved wording, in the safety strings as `c25HandSet`). Not chosen: asking for a clearance height in C25 (option B). SAFETY H53, §4.5b Go to zero and §6 C25 are amended (2026-11-08).

## OD-24. The travel check: block when homed, warn when not (owner, 2026-11-08)

**Owner's words.** "Block when homed, warn when not"

**Context.** SAFETY H3 claimed a preflight in machine coordinates against the work envelope, but the job check had no travel test at all: a file that moved past the machine's travel ran until the firmware's soft limits (off by default, `sl` 0, and skipped on unhomed axes) or the hard stops. It came up while building the Resume re-check after a Z re-zero at a tool change, which had nothing to reuse.

**Decision.** The job check now checks every modelled machine-coordinate end point and arc extent against each axis's soft limits (`tn`/`tm` from the axis groups read for the job), at load, again at Start, and on Resume after a Z re-zero at a tool change. When the machine position is known (this connection saw a homing cycle complete, as in OD-23), a move past travel blocks the job (and that Resume), naming the line, the axis, the machine coordinate and the limit. When it is not known (set by hand, before this connection, not homed), or a limit or position was not read, the same finding is a warning the user confirms before Start (C40). SAFETY H3 now states what is and is not modelled.

**Review fixes (2026-11-08).** An independent review of the first build found that the Resume re-check mixed values read at Start with values read at the change and could pass a re-check it could not run; it now replays from the Start values with only the re-zeroed Z offset replaced, and refuses whatever it cannot check. "Position known" is decided per axis (an axis homed by a cycle this connection saw), the same rule OD-23's Z lift now uses (Z homed this connection).

**C36 and C40 (owner, 2026-11-08).** "One box when both apply": when C40 is asked because a move leaves the travel of an axis whose position is not known and the board is not homed, the one box reads C40's sentence followed by C36's (both owner-approved, unchanged), so nothing C36 asserts is lost, and its tick confirms both. C36 stays alone when the job fits, and next to C40 when C40 is asked because a limit or a position was not read. How the owner's choice is read is the lead's call (2026-11-08), recorded here: (1) C40's text does not state everything C36 does (soft limits, where every axis is), so the one box shows both approved sentences, C40's then C36's, with no new wording, and one tick counts as both; (2) only the past-travel C40 merges with C36: C40 asked because a limit or position was not read still shows beside C36, and "never pass silently" stands.

**C40 wording (owner, 2026-11-08).** "Approve as written": "Run cannot check this job against the machine's travel: <why>. Start only if you have checked that every move fits the machine." 

**C41 wording (owner, 2026-11-09).** "yes use shorter words": the one box for C36 and C40 is now C41, one shorter text in place of the two approved sentences side by side: "<Axis> isn't homed, so Run can't check its travel and soft limits may not protect it. Line <n>: <Axis> would reach <value> mm, past its <limit> mm limit. I've checked where every axis is and that every move fits." For example: "X isn't homed, so Run can't check its travel and soft limits may not protect it. Line 2: X would reach 200 mm, past its 150 mm limit. I've checked where every axis is and that every move fits." When more moves leave the travel, it names the first and adds "and N more" (the lead's instruction, 2026-11-09). The start still carries C40's finding for that move, matched exactly. This replaces reading (1) of the C36 and C40 paragraph above; reading (2) stands. The owner also prefers shorter sentences in all UI and confirmation wording from now on.

## OD-25. Play preview, colour by tool, and fine carving detail (owner, 2026-11-09)

**Owner's words.** "play preview should just play the gcode and the movements"; carving detail "fine"; colour the toolpath by tool, with a legend generated from the tools the file uses.

**Context.** SAFETY H15 and T-S41 said there was no Play or Simulate button: the preview scrubbed and highlighted lines, and nothing moved but the live marker on reported positions. The 3D view drew every tool's path in one colour, and carved the stock on a 0.25 mm grid.

**Decision.**
- **Play preview.** Play moves a preview tool along the file's moves at the programmed speeds (F for feeds and arcs; rapids at the machine profile's rapid rate, else a stated 5,000 mm/min), at 1×, 2×, 5× or 10×, starting at 1×. Pause and the scrubber work any time. While a session is on, the drawing says "Preview at programmed speeds: not timed like the machine". The preview tool is its own marker in the highlight colour, never the live marker's; the live marker still moves only on reported positions. It is never offered while a job of this tab runs or the board is in motion (it stops at once if that changes), and under reduced motion it steps one move at a time ("Next move"). The NOT CONNECTED band and W7's rules stand. A timing provider is the seam for Analyze's predicted speeds later; not built. SAFETY H15 and T-S41 are amended; T-S141 to T-S143 added.
- **Colour by tool.** Each tool the file uses gets a colour in the order it first appears (never cycled; a ninth and later share the eighth), from a colour-blind-safe palette shaded for light and dark; a tool not known is neutral and named as such. Arcs are a lighter tint and rapids a fainter dashed one, so the move type still shows. The key lists the tools when there are two or more; clicking one makes its lines stand out.
- **Carving detail.** The carve's base cell is 0.125 mm, coarsened only past the cap (2 million cells, 4096 a side); no toggle. Advanced's key shows the size used.

## OD-30. C1 is shown once per browser, never again (owner, 2026-11-09)

**Owner's words.** "never show this to anyone after the first set of check boxes".

**Context.** C1 (the E-stop and work-area checklist) was asked at the start of every LIVE session: in full the first time, after a wording change and on each new calendar day, otherwise as a one-box short form ("My E-stop is within reach and I tested it today"). The owner found the repeated boxes a reason the Run page felt like "check boxes everywhere".

**Decision.** The full C1 list is shown at the first Connect in a browser. Once it has been accepted there, no form of C1 is shown again in that browser: not the short form, not after a text change, not on a later day. The acceptance stays device-local (`device-safety`, never synced, never cleared by sign-out); a browser whose record cannot be read shows the full list again. W1 (the E-stop banner) is unchanged and stays on every page. SAFETY §4.1 (Enter LIVE), §6 C1 and HIL-1.3 are amended; run apps/web/src/live/c1.ts and liveEntry.ts implement it.

## OD-31. Typed moves: design approved, long lines split, ask first on a low-Z G0 (owner, 2026-11-09)

**Owner's words.** The typed-moves design approved; then "split, ask first".

**Context.** The terminal lets a typed G0, G1, G2, G3 or G4 move the machine (SAFETY H91, docs/design/terminal-typed-moves.md). Each typed line goes through the same path as the button that does the same thing. As first built it refused any move the sanitiser would split under the §4.3 queued-motion ceiling (with k 0.5 that is about 21 mm at F500), and it sent a G0 as typed, with no safe-Z rule.

**Decision.** A long typed line is sent as the sanitiser's own split, each piece at most ceiling ÷ lookahead of modelled time (1.25 s at the defaults), fed like a hold jog while fewer than 4 pieces are in the planner: the queue stays within the ceiling, and three pieces wait behind the one running so the planner does not brake between them (bench 2 showed every piece slowing to 0 with one waiting; bench confirmation is on the HIL list). The travel check runs on the whole line, the user sees one line in flight, and Pause, Resume and Stop job work as for a job. A G0 that moves X or Y while machine Z is below go to zero's safe Z asks "Z is low. Raise Z first?" with Raise / Move as typed / Cancel; Raise sends go to zero's own lines (`G90 G21`, `G53 G0 Z<safe>`, the modes read before the move put back) and is offered only when Z was homed in this connection (OD-23), the move has no Z word and the modes were read; otherwise only Move as typed and Cancel, with the reason. G1, G2 and G3 are never asked. SAFETY H91 records it; run packages/machine/src/session/typedMove.ts, typedTravel.ts, typedLowZ.ts and typedPieces.ts implement it.

## OD-32. Short safety wording for the Run step (owner, 2026-11-09)

**Owner's words.** "approve with fire risk".

**Context.** The Run step was redesigned (one "Ready to start?" list, one start tick, the travel question at Start). A strings table proposed short versions of the safety strings on that step.

**Decision.** The table is approved, with W5 keeping the fire risk: "WARNING — If this tab closes or sleeps, the machine keeps moving (up to N mm, about T s) and the spindle stays on, a fire risk. Keep this tab open and stay at the machine." C30 is shorter (no line count). C31, C36 and C32 and the attestation are confirmed in one start tick ("I confirm: the board's work zero · axes checked · hands clear · I'll stay here, sleep off.", with what applies), their registered texts under Details in the start confirmation. C40 and C41 are answered at Start in the travel modal (Start anyway), with a plain title and short sentences, the registered texts under Details; when the board's work zero is not the plan's, the modal says so and leads with Set work zero first. SAFETY §5 (W5), §6 (C30, C31, C32, C36, C40, C41, including the mode column) and §4.4 are amended; packages/safety/src/strings.ts holds every string.
