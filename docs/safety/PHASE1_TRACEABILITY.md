# Phase 1 safety traceability

Phase 1 ("Bench read-only") requirements, traced task by task to the code
that implements them, the test that proves each one, and that test's result.
Same status values as `PHASE0_TRACEABILITY.md`: **PASS** (a test that fails
without the behaviour ran and passed), **HIL** (needs the physical bench; the
owner signs it, `docs/bench/README.md`), **OPEN** (not done; owner task named).

Sources: synthetos.com `docs/run/` (ROADMAP "Phase 1: Bench read-only",
SAFETY §3, §4.1, §4.4, §10, PROTOCOL_NOTES §2.3). Firmware pins as Phase 0
(`vendor/firmware-pins.json`: EN `ead63997`, TG `d0418390`).

## P1-02: `machine.worker` and the read-only `MachineSession`

Code: `packages/machine/src/session/` (reducer, executor, write gate,
snapshot), `packages/safety/src/allowMatrix.ts` (`PHASE_1_RELEASE`),
`apps/web/src/machine-worker/` (RPC v3, host).

| Requirement | Implementation | Test | Status |
|---|---|---|---|
| Pure reducer NOT_CONNECTED → PORT_REQUEST → OPENING → IDENTIFYING → READING → CONNECTED_UNKNOWN (+ BLOCKED) with every overlay | `session/reducer.ts` (`reduce`, no clock, no I/O) | `session-reducer.test.ts` "the connection path", "ORPHANED_MOTION", "LOST, STALE, NEEDS_REVIEW", the generated test reaching every base state and every overlay | PASS |
| Allow-matrix permits only `read` (allowlisted), `feedhold`, `enq` (EN) and `ackFault` among machine intents; ^X denied | `PHASE_1_RELEASE`; every intent goes through `allowed()` first (`onIntent`); session-level checks after | `allowMatrix.test.ts` "Phase 1 release gate" (generated over every cell); `session-reducer.test.ts` "every other intent is denied" | PASS |
| Stop job and Spindle off are `!` plus "Use your E-stop" (never ^D, `%`, M-codes) | `onIntent` stop class → `writeFeedhold`, `notices.adviseEstop` | `session-reducer.test.ts` "Pause, Stop job and Spindle off write only !" | PASS |
| Realtime bytes bypass the XOFF gate (T-S5, XOFF part) | `machineSession.ts`: lines wait in `#drainLines` while XOFF; `#writeRealtime` never waits | `session-executor.test.ts` "T-S5 (XOFF part)" | PASS |
| No effect ever contains 0x18 or 0x04 (T-S26, T-S24a) | effect types cannot express them; `writePolicy.ts` refuses them at the byte level before the transport | `session-reducer.test.ts` "T-S26, T-S24a" (fast-check over states × events, 3000 runs); `session-write-policy.test.ts` (every single byte, property over arbitrary bytes) | PASS |
| Banner after Ready → FAULT then UNKNOWN, both banner shapes (T-S10) | `onBanner` | `session-reducer.test.ts` "T-S10" (bare-sr and r-footer, boot banner, 440.21 jv=1 banner, during READING) | PASS |
| Device id mismatch → BLOCKED, no writes (T-S21) | `finishProbe` (expected device id from the window's `open.boardId`) | `session-reducer.test.ts` "T-S21"; `apps/web/test/machineWorker.test.ts` "board id ... BLOCKED" | PASS |
| T-S3 (the matrix decides every intent; generated) | `onIntent` | `allowMatrix.test.ts` T-S3 over Phase 0, Phase 1 and all-open releases; `session-reducer.test.ts` | PASS |
| Model test: 10k random sessions against both test-kit models; first line `{"sr":null}`; only allowlisted GETs, ENQ (EN, never before a rev-2/3 footer) and `!` | `sessionModel.ts` (random requests, device faults, link faults; checks every connection's writes against what it had read) | `session-model-en.test.ts`, `session-model-440.test.ts` (5000 each) | PASS |
| T-S38: fuzz every read path, no token outside the allowlist, side-effect tokens never | probe list before classification, `isReadAllowed` after; byte gate | `session-write-policy.test.ts` "T-S38" (fast-check over request tokens on EN and 440.21); model test random reads | PASS |
| T-S39: only `MachineSession` writes to the transport | `machineSession.ts` is the only caller above `GuardedTransport` | `session-write-policy.test.ts` "T-S39" (source scan; no web-app module outside `machine-worker/` imports `@synthetos/machine`) | PASS |
| One line in flight; answers matched in order; late answers consumed; an answer before the write completes | `owedAnswers`, `consumeOwed`, line `seq` | `session-reducer.test.ts` "ordering of answers and writes"; generated test invariant | PASS |
| ackFault only after hold = 0 and qr = plannerBlocks in two polled reads 250 ms apart; then a full re-probe | `onAckFault`, `onVerifyAnswer` | `session-reducer.test.ts` "FAULT triggers and ackFault" | PASS |
| Pause is never queued behind another request in the worker | `host.ts` handles requests independently | `apps/web/test/machineWorker.test.ts` "answered at once even while a close is still pending" | PASS |
| The worker posts snapshots at most 20 per second | `host.ts` `SNAPSHOT_INTERVAL_MS` | `machineWorker.test.ts` subscribe tests; `open-mock-port.fake-serial.ts` | PASS |
| In the built app, against the simulated board | fake-serial build | `tools/e2e/specs/open-mock-port.fake-serial.ts` | PASS (run with `pnpm e2e:fake-serial`) |
| HIL-1.1, HIL-1.2 (identify EN, 440.21; transcript only GETs, ENQ, `!`), HIL-1.5 (USB pull → LOST then UNKNOWN; reset → FAULT then UNKNOWN), HIL-1.6 (busy board → no writes beyond the probe; ORPHANED_MOTION) | all of the above | `docs/bench/README.md` BENCH-P102-* | HIL (needs the Connect gesture, see below) |

Design points recorded with this task (also in the task report):

- **Connect gesture.** The window still has no `requestPort()` call (the
  P1-01 note in `docs/ops/owner-decisions.md`), so on the bench nothing can
  yet produce a `PortSelector` for a real board. P1-02's worker side is
  complete; the chooser is its own reviewed gate change.
- **Manifest in the worker.** The worker classifies against
  `NO_APPROVED_BUILDS` (every board READ_ONLY) until P1-03 verifies the
  signed manifest inside it. Phase 1 writes the same bytes either way.
- **ORPHANED_MOTION has no exit in Phase 1 except unplugging or a board
  reset.** The matrix denies Disconnect under ORPHANED_MOTION (its exits are
  Stop job and Reset controller, SAFETY §3), and Phase 1 has neither ^D nor
  ^X. A board reset (its banner) ends the overlay and the probe restarts.
  Closing the tab also releases the port. Raised for the owner.
- **READING trusts only its own reads.** Values from the `{"sr":null}`
  answer are dropped when READING starts, so a failed `stat`/`hold`/`vel`/
  `qr` read leaves the board "not resting" (ORPHANED_MOTION), never idle by
  default.

## P1-03: probe, classification, profile suggestion, READ_ONLY handling

Code: `packages/machine/src/session/reducer.ts` (probe, READING, `ex`,
probe log), `session/notices.ts` (W25), `src/suggest.ts` (T-S50),
`src/platform.ts` and `apps/web/src/machine-worker/host.ts` (T-S77).
The probe and classifier themselves are P0-08 (`packages/protocol`).

| Requirement | Implementation | Test | Status |
|---|---|---|---|
| T-S55 against live-shaped transcripts | session against the EN and 440.21 test-kit models (booting and already powered), with and without an approval | `p1-03-live.test.ts` "T-S55"; classifier fixtures `protocol/test/capability.test.ts` (incl. stock 449, conflicts) | PASS |
| T-S86: first line `{"sr":null}` in every connect path; a spliced fragment never runs | `startProbe` (fresh, after LOST, after ackFault) | `p1-03-live.test.ts` "T-S86 (live)" (partial `G0 X1` left in the RX ring on both models: no motion, error answer); `session-reducer.test.ts` splice guard; model tests | PASS |
| T-S87: ENQ never before a rev-2/3 footer, never on rev 1, after classification only on `tinyg-en` | `enqByte` | model tests (10k random sessions, both models); `session-reducer.test.ts` ENQ tests | PASS |
| T-S60: a held, moving or queued board is ORPHANED_MOTION, not READ_ONLY; only `!`; `~` never | READING (`stat hold vel qr`), unsolicited reports, 3 s first-answer timeout | `p1-03-live.test.ts` "T-S60 (live)" (previous sender leaves each model held with a queue, or moving); `session-reducer.test.ts` "ORPHANED_MOTION" | PASS |
| `ex` = 2 (RTS/CTS) → READ_ONLY on both dialects (PN §5.3); unreadable `ex` the same | READING reads `ex`; `finishReading` → reason `flowControl` | `session-reducer.test.ts` "flow control"; `p1-03-live.test.ts` "ex = 2" (set by a previous sender on the EN model) | PASS |
| W25 for READ_ONLY builds | `readOnlyNotice` (fixed reason phrase per classifier reason, probed `fb`, upgrade advice where offered) | `p1-03-host.test.ts` "W25" | PASS (rendering lands with the Connect UI) |
| Suggest machines by `(family, board_id)`, local and (signed in) cloud; several → the user picks; never auto-selected (T-S50); a different bound device is a hard block | `suggestMachines`, `checkSelection`; on the wire T-S21 (BLOCKED) | `p1-03-host.test.ts` "T-S50" | PASS (M); E with the Connect UI |
| No Connect and no LIVE on a mobile OS whatever `navigator.serial` reports (T-S77) | `liveControlPlatform`; the worker refuses `open` (code `platform`) before asking the transport source | `p1-03-host.test.ts` "T-S77"; `machineWorker.test.ts` "T-S77" | PASS (worker); E (no Connect control) with the Connect UI |
| Probe result recorded in the session log | `log` effect from `finishProbe` and the probe-failure paths (`probeRecord`) | `session-reducer.test.ts` "recorded in the session log"; `p1-03-live.test.ts` | PASS |
| HIL-1.1, HIL-1.2, HIL-1.4, HIL-1.10, HIL-1.12, B-PROBE-1 | all of the above | `docs/bench/README.md` BENCH-P103-* | HIL |

Open with this task:

- **Manifest in the worker.** The worker still classifies against
  `NO_APPROVED_BUILDS`, so every board is READ_ONLY there (fail closed).
  HIL-1.1 expects `tinyg-en` **full**, which needs the signed manifest
  fetched and verified in the worker (`protocol/approvedBuilds.ts` has the
  verifier). Not in the P1-03 work list; owner to place it (P1-05 fetches
  the signed advisory the same way).
- **B-PROBE-1** fixtures (`test-fixtures/probe/`) are recorded on the bench
  (BENCH-P103-1); none are committed until then.

## P1-04: watchdog (read-only), STALE, LOST, UNKNOWN, audible alarm

Code: `packages/machine/src/session/reducer.ts` (watchdog: `syncWatchdog`,
`onWatchdog`, `askForLife`, `enterStale`; LOST and UNKNOWN), `session/types.ts`
(`livenessIdleMs` 1 s, `staleAfterMs` 2 s), `session/snapshot.ts` (`stale`),
`apps/web/src/machine-ui/OverlayBanners.ts` (W3, W4) and
`apps/web/src/machine-ui/alarm.ts` (tone, AudioContext unlock).

| Requirement | Implementation | Test | Status |
|---|---|---|---|
| Receive-timestamp liveness (SAFETY §4.2) | every received line sets `lastRxAt`, clears a pending liveness request and STALE, and restarts the idle watchdog | `p1-04-watchdog.test.ts` "a board that talks on its own" | PASS |
| ENQ probe on EN, at most one outstanding; a `stat` GET where ENQ is not available | `askForLife`: ENQ only via `enqByte` (classified `tinyg-en`, rev-2/3 footer) and the matrix; an unanswered ENQ stays outstanding and the watchdog falls back to `{"stat":null}`; a reset banner clears the owed ack | `p1-04-watchdog.test.ts` "T-S11 (idle subset)" (both halves), "a reset banner clears the owed ENQ"; model tests (10k sessions) | PASS |
| T-S11 (idle subset): expected silence never STALE; 2 s of unexpected silence STALE | idle board answering: never STALE (100 rounds, 60 s on the 440.21 model); no byte within 2 s of asking: STALE with `silentForMs` | `p1-04-watchdog.test.ts` (reducer and both firmware models, silence injected with link latency) | PASS (G4 P10 and the 5 s RUNNING FAULT need jobs: Phase 3, T-S11 full) |
| LOST on a transport error; T-S8 (read-only subset): nothing written after LOST; the next connect is UNKNOWN | `onLinkLost` cancels every timer including the watchdog; the next connect adds UNKNOWN | `p1-04-watchdog.test.ts` "T-S8" (reducer and both models, link cut at four byte offsets); `session-executor.test.ts` LOST tests | PASS |
| UNKNOWN rules | after LOST and after a banner after Ready (P1-02); after ackFault | `session-reducer.test.ts`, `p1-04-watchdog.test.ts` | PASS for these; discard and reload-while-LIVE come with the W6 marker (P1-05) |
| W3 (`role="alert"`, `aria-live="assertive"`, tone) and W4 ("for N s") | `OverlayBanners`; `AlarmTone.sync` sounds on LOST only in Phase 1 (W12 and FAULT during a job arrive with jobs) | `apps/web/test/overlayAlarm.test.ts` "T-S30", "W4" | PASS (unit); the E2E run lands with the Connect UI |
| AudioContext unlocked in the Connect gesture | `AlarmTone.unlock()` creates and resumes the context; to be called synchronously from the Connect click | `overlayAlarm.test.ts` | PASS (unit); wired when the Connect button exists |
| HIL-1.5 | all of the above | `docs/bench/README.md` BENCH-P104-1 | HIL |

Open with this task:

- **No Connect UI yet.** The banners, the alarm and the `unlock` call are
  built and tested but not mounted: the workspace has no Connect button or
  snapshot subscription until the LIVE entry work (P1-05). T-S30 as an E2E
  test (axe, AudioContext `running` in a real browser) runs then.
- **Thresholds** are bench-validated in B-WD-1 (Phase 3); the 1 s idle
  interval is this task's choice (SAFETY §4.2 gives only the 2 s STALE).

## P1-05: LIVE entry gates and the pluggable D1 sign-in gate

Code: `apps/web/src/live/` (`authGate.ts`, `advisoryGate.ts`, `c1.ts`,
`liveMarker.ts`, `fullscreen.ts`, `liveGates.ts`, `liveEntry.ts`,
`ConnectPanel.ts`, `mount.ts`, `deviceSafety.ts`), `apps/web/src/cloud/live.ts`
(the two `no-store` reads), `apps/web/src/channel/bench.ts` (bench identity),
`apps/web/src/shell/SafetyBar.ts` (W6), `packages/protocol/src/safetyAdvisory.ts`,
`workers/run/src/accessIdentity.ts` and `routes.ts` (`GET /api/identity`),
`tools/gates/src/release/safetyAdvisory.ts` (`pnpm sign:advisory`).

| Requirement | Implementation | Test | Status |
|---|---|---|---|
| D1 gate at Connect, UI/auth layer only; never reachable from the machine path | `AuthGate` over three providers (`run-session`: none until A1-07; `access`: staging only; `bench`: bench channel, loopback only); dependency-cruiser `machine-path-never-reaches-live-gates` | `apps/web/test/liveEntry.test.ts` "D1 sign-in gate", "signed out"; `tools/gates/test/bench-acceptance.test.ts` "AuthGate"; `channel.test.ts` bench identity | PASS |
| Signed out: Connect refused | `LiveEntry.begin` refuses before the advisory, C1 or the chooser | `liveEntry.test.ts` "signed out: Connect is refused" | PASS |
| Mid-session identity loss changes nothing in the machine path | `LiveGates`: never-gated actions allowed without an identity read; nothing in live/ sends the worker anything but `open`, `close`, `subscribe` | `liveEntry.test.ts` "mid-session loss of the identity" | PASS |
| Staging: verified Access identity | `GET /api/identity`: RS256 under the team certs, AUD, issuer, expiry; staging Worker on the staging host only | `workers/run/test/identity.test.ts` | PASS (unit); the live check needs Access configured (LEAD_ACTIONS) |
| T-S31 / H27: signed advisory, `no-store`, revoked or unverifiable refuses LIVE, 7-day cache | `checkAdvisory` (re-verifies the cached raw file on use, never falls back to the cache after a bad fetch) | `packages/protocol/test/safetyAdvisory.test.ts`; `liveEntry.test.ts` "advisory gate" | PASS (unit) |
| T-S75: production rejects staging entries; expired cache fails closed; revocation while LIVE denies Arm/Start/jog, never a job or a stop | per-environment entries and keys; `AdvisoryPoller` (15 min, sticky revocation) feeding `LiveGates` | `safetyAdvisory.test.ts` "T-S75"; `liveEntry.test.ts` "T-S75" | PASS (unit) |
| C1 per LIVE session, full/short by version and date in this browser | `c1.ts` (`ack.safety@<version>@<date>` in `device-safety`; version = hash of the full text) | `liveEntry.test.ts` "C1 per LIVE session", "same-day reconnect" | PASS (unit); browser E2E needs a signed advisory (below) |
| Leave fullscreen on entering LIVE | `leaveFullscreen` in the C1 confirm click | `liveEntry.test.ts` | PASS |
| T-S17: W6 marker and banner, overrides NOT CONNECTED | marker written at LIVE entry and on `pagehide`/`freeze` while LIVE, removed only by a clean Disconnect; `document.wasDiscarded`; SafetyBar swaps W7 for W6 | `liveEntry.test.ts` "W6" | PASS (unit) |
| AudioContext unlocked in the Connect click (P1-04) | `LiveEntry.begin` calls `unlockAlarm` before any await; mount subscribes to snapshots and calls `alarm.sync` | `liveEntry.test.ts` "T-S30" | PASS (unit) |
| HIL-1.3 | C1 same day short, next day full | `docs/bench/README.md` BENCH-P105-1 | HIL |

Open with this task:

- **No port chooser yet.** Every gate runs, then `mount.ts` stops at the
  chooser: `requestPort()` may only be called from the Web Serial module, and
  the main-thread chooser needs its own reviewed gate change (OD-3 in
  `docs/ops/owner-decisions.md`). That change is the next step before any
  bench connect.
- **The committed advisory is unsigned** (`apps/web/public/safety-advisory.json`
  has no entries), so every origin refuses LIVE until the owner signs it
  (`pnpm sign:advisory`, LEAD_ACTIONS). For the same reason the browser E2E
  for C1 short/full cannot pass the advisory gate yet; it is covered by the
  controller tests above.
- `Cache-Control` for `/safety-advisory.json` is the asset default; the
  client fetches with `cache: 'no-store'`.
