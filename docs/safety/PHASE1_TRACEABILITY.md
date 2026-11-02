# Phase 1 safety traceability

Phase 1 ("Bench read-only") requirements, traced task by task to the code
that implements them, the test that proves each one, and that test's result.
Same status values as `PHASE0_TRACEABILITY.md`: **PASS** (a test that fails
without the behaviour ran and passed), **HIL** (needs the physical bench; the
owner signs it, `docs/bench/README.md`), **OPEN** (not done; owner task named).

Sources: synthetos.com `docs/run/` (ROADMAP "Phase 1: Bench read-only",
SAFETY §3, §4.1, §4.4, §10, PROTOCOL_NOTES §2.3). Firmware pins as Phase 0
(`vendor/firmware-pins.json`: EN `ead63997`, TG `d0418390`).

## P1-00: the Web Serial gate change

Code: `eslint.config.js` (`navigator.serial` admitted only in
`packages/machine/src/webSerialTransport.ts`), `tools/gates/src/source/`,
`.dependency-cruiser.cjs`, `tools/gates/src/bundle/` (Web Serial only in
the `assets/serial/` chunk), `workers/run/src/` (`SERIAL_GRANTED_SECURITY_HEADERS`,
`grantsSerial`), `tools/gates/src/bench/` (localhost bench server).

| Requirement | Implementation | Test | Status |
|---|---|---|---|
| `navigator.serial` only in the Web Serial module, in source and through aliases | lint rule, source scan, dependency-cruiser | `acceptance.test.ts` "navigator.serial in machine fails lint", "... through an alias fails lint"; `eslint-rules.test.ts`; `source-scan.test.ts` | PASS |
| Web Serial only in the serial chunk; production artifact refuses it | bundle scan targets `production`, `staging`, `bench` | `bundle-scan.test.ts` "fails on navigator.serial in every spelling", "staging admits ... in the serial chunk", "bench still refuses Web Serial outside the serial chunk"; `serial-chunk-acceptance.test.ts`; `artifact-diff.test.ts` (P1-00) | PASS |
| Production `serial=()`; staging and localhost bench `serial=(self)` | Worker header sets; bench server | `worker-config.test.ts` "P1-00: staging runs the Worker first ..."; `workers/run/test/headers.test.ts`; `headers-file.test.ts`; `headers.e2e.ts` (production set, `SecurityError` in page and worker); `bench.bench.ts` | PASS |
| The bench build is never deployable: marked, localhost only, differs from the release only in the channel chunk, no test kit | bench marker, `bench-cli.ts`, bench server (127.0.0.1, Host check) | `bench-diff.test.ts`, `bench-acceptance.test.ts`, `bench-server.test.ts`; `bench.bench.ts` "refuses a request under another Host name" | PASS |
| BENCH-P100-1..5 | | `docs/bench/README.md` | HIL (P100-3 needs the port chooser; P100-4 needs the staging deploy; P100-5 needs the axis-mode facts rendered, see "Open at the Phase 1 gate") |

## P1-01: `WebSerialTransport`

Code: `packages/machine/src/webSerialTransport.ts`, open policy
`packages/machine/src/openPolicy.ts`, `guardedTransport.ts`, worker seam
`apps/web/src/machine-worker/transport.ts`.

| Requirement | Implementation | Test | Status |
|---|---|---|---|
| `bufferSize` 256, 8N1, `flowControl:'none'` only; `open({flowControl:'hardware'})` throws and never opens | `WebSerialTransport.open` + open policy | `web-serial-transport.test.ts` "opens the port once, 8N1 ... bufferSize 256", "open({flowControl:'hardware'}) throws"; `t-s16.test.ts` "refuses flowControl 'hardware'" | PASS |
| T-S16: 1200 baud needs the flasher's single-use token; 2341:003D refused before `open()` | open policy | `t-s16.test.ts` (all cases); `web-serial-transport.test.ts` "refuses 1200 baud before open", "refuses the Due programming port" | PASS |
| No `abort()`; close waits for the write in progress | `close` | `web-serial-transport.test.ts` "has exactly the Transport members ... (SAFETY H2b)", "closes (never aborts) the writable" | PASS |
| `getInfo()` recorded once | constructor | `web-serial-transport.test.ts` "getInfo() is recorded once, at construction" | PASS |
| `ReplayTransport` conformance against EN-HIL transcripts | | `web-serial-conformance.test.ts` (replay identical on both paths; divergence fails the same way; live vs replay against both models); `replay-conformance.test.ts` | PASS |
| BENCH-P101-1 (B-ID-1), BENCH-P101-2 | | `docs/bench/README.md` | HIL (needs the port chooser) |

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
| Model test: 10k random sessions against both test-kit models; first line `{sr:null}`; only allowlisted GETs, ENQ (EN, never before a rev-2/3 footer) and `!` | `sessionModel.ts` (random requests, device faults, link faults; checks every connection's writes against what it had read) | `session-model-en.test.ts`, `session-model-440.test.ts` (5000 each) | PASS |
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
- **READING trusts only its own reads.** Values from the `{sr:null}`
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
| T-S86: first line `{sr:null}` in every connect path; a spliced fragment never runs | `startProbe` (fresh, after LOST, after ackFault) | `p1-03-live.test.ts` "T-S86 (live)" (partial `G0 X1` left in the RX ring on both models: no motion, error answer); `session-reducer.test.ts` splice guard; model tests | PASS |
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

- **Port chooser: closed 2026-11-02.** The owner approved the gate change
  (OD-3): `packages/machine/src/webSerialChooser.ts`, one main-thread
  importer `apps/web/src/live/portChooser.ts`, admitted by every gate
  (02fea94); the C1 confirm click shows Chrome's chooser and hands the
  selector to the worker (c75f8c1). Tests: `web-serial-chooser.test.ts`,
  `portChooser.test.ts`, `tools/e2e/test/connect-chain.test.ts` (bench
  identity to a classified simulated board), `bench.bench.ts` (the real
  Connect reaches the chooser inside the click, chooser stubbed).
- **The committed advisory is unsigned** (`apps/web/public/safety-advisory.json`
  has no entries), so every origin refuses LIVE until the owner signs it
  (`pnpm sign:advisory`, LEAD_ACTIONS). For the same reason the browser E2E
  for C1 short/full cannot pass the advisory gate yet; it is covered by the
  controller tests above.
- `Cache-Control` for `/safety-advisory.json` is the asset default; the
  client fetches with `cache: 'no-store'`.

## P1-06: Pause, Escape, Web Lock, cross-tab stop requests

Code: `apps/web/src/machine-worker/stopChannel.ts` (protocol, lock names),
`stopService.ts` (worker: lock while a port is open, stop requests),
`apps/web/src/live/tabStop.ts` (requests, lock watcher, Escape),
`stopControls.ts`, `ObserverPanel.ts`, `deviceSafety.ts`
(`forgetDeviceSafety`), `apps/web/src/shell/SafetyBar.ts` (W2, W30, outcome
line), `packages/safety/src/strings.ts` (`STOP_TEXT`). Gate changes:
`navigator.locks` admitted, `synthetos-machine:` exempt from the
url-scheme literal rule (both tested in `tools/gates`).

| Requirement | Implementation | Test | Status |
|---|---|---|---|
| T-S18: Escape from any focus, capture phase; Space never | `installEscapeStop` on window, capture | `tabStop.test.ts` "Escape"; `tab-stop.fake-serial.ts` "Escape from any focus" | PASS |
| T-S19: stop under 100 ms with a 1M-segment preview | request posted before any await | `tabStop.test.ts` "posts the request synchronously"; `tab-stop.fake-serial.ts` "under 100 ms with a 1M-segment preview loaded" (1M segments drawn in the full preview in the same tab, then keydown to `!` on the wire) | PASS (2026-11-02: 0.7 ms on the development machine; CI and the bench record their own) |
| T-S29: request from another tab with the controlling tab frozen arrives as `!` | `machine.worker` subscribes to the stop channel itself | `tab-stop.fake-serial.ts` observer test (3 s busy loop in tab A) | PASS |
| T-S73: W29 on release; unacknowledged = STOP NOT DELIVERED; two machines; non-stop messages ignored; destructive storage refused while locked | `LockWatcher`, `TabStop` (250 ms window, one ack per held lock), `parseStopRequest`, `forgetDeviceSafety` | `tabStop.test.ts`; `tab-stop.fake-serial.ts` | PASS (two machines at unit level only: the fake-serial build has one port per tab) |
| W30 for a hold, never "STOPPED"; PAUSE REQUESTED first | `StopControls` band | `tabStop.test.ts` "a hold shows W30 with W10" | PASS |
| Phase 1 stop path writes only `!` | session reducer maps every stop-class intent to `!`; a delivered Stop job / Spindle off request reads "as Pause (spindle stays on)" | `tab-stop.fake-serial.ts` `phase1Only`; `tabStop.test.ts` "went out as Pause" | PASS |
| HIL-1.7, HIL-1.9, HIL-1.11 | | `docs/bench/README.md` BENCH-P106-1..3 (HIL-1.9 also BENCH-P102-6) | HIL |

Open with this task:

- A LIVE tab's Pause sends feedhold to its own worker and also broadcasts,
  so its own machine gets `!` twice (harmless; the hold is idempotent).
- The W2 button is enabled only once LIVE (step `live`); during `opening`
  Escape still broadcasts and the worker answers once its port is open.
- `STOP_TEXT` and the W29/STOP NOT DELIVERED paths render through Preact
  text nodes; the board id in a lock name is reduced to `[A-Za-z0-9._-]`.

## P1-08: transcript export and bench runner

| Requirement | Where | Test | Status |
|---|---|---|---|
| EventLog export, JSONL `{t, dir, hex}` | `packages/machine/src/eventLog.ts`; `MachineSession.exportTranscript()` (one log per link, from the open); worker `transcript` request | `p1-08-transcript.test.ts`; `machineWorker.test.ts` "transcript (P1-08)" | PASS |
| Transcripts replay byte-identically through `ReplayTransport` | | `p1-08-transcript.test.ts` (EN and 440.21 models: replay has no divergence, ends exactly at the last step, and the replayed session's transcript equals the original) | PASS |
| A partial transcript is never exported | 8 MiB bound; past it the log stops and export refuses | `p1-08-transcript.test.ts` "never exports a partial transcript", "refused when the transcript passed its bound" | PASS |
| Bench runner refuses to start if the lock is held | `apps/cli/src/bench/runner.ts`, `hilLock.ts`, `hil_lock_helper.py` (EN-HIL `BoardLock`, no wait) | `bench-lock.test.ts` (real flock held by a second process: exit 3, no browser, tinyg_hil never run); `bench-runner.test.ts` | PASS |
| Snapshot, then Chrome, then checklist, then close, restore, unlock, on every path | `runBench` `finally` | `bench-runner.test.ts` (order; quit; Chrome fails; restore fails) | PASS |
| HIL never in CI | `runBench` refuses when `CI` is set | `bench-runner.test.ts` "never runs in CI" | PASS |
| Only staging or the localhost bench build | `checkTargetUrl` | `bench-runner.test.ts` | PASS |
| B-POL-1 | `docs/bench/policy.md` | BENCH-P108-1..3 | HIL |

Open with this task:

- The page has no "save transcript" control yet. The worker's `transcript` request is in place;
  the button (a Blob behind `<a download>`) is a UI follow-up.
- Items that need EN-HIL on the board at the same time (BENCH-P102-4/-6, P103-4/-5, P106-2/-3)
  can't run inside the runner, because the harness takes the same lock. Use `--only` and record
  them by hand.

## P1-07: DRO, allowlisted settings read, drift check, live position marker

| Requirement | Where | Test | Status |
|---|---|---|---|
| Machine DRO and marker from polled `mpo` only (S §4.2; EN's default `sr` has no `mpo*`) | `packages/machine/src/positionPoller.ts` (500 ms, one poll owed at a time, through `session.read`); `dro.ts` uses `values.mpo`, never `live.mpo` | `p1-07-dro.test.ts` "a status report with mpo* changes neither the machine DRO nor the marker", poller tests; `dro.fake-serial.ts` (built app: moving the simulated machine changes the DRO only after a further `{"mpo":null}`) | PASS |
| Source and age labels; lag badge amber at 1 s, red at 2 s or STALE | `droView`/`lagOf`; `apps/web/src/machine-ui/Dro.ts` ages it on the window clock between snapshots | `p1-07-dro.test.ts` "lagOf", droView ages; `p1-07-readout.test.ts` "ages the badge in the window" | PASS |
| DRO: work and machine coordinates, active WCS with offsets, homed flags | `droView` (`coor`, `g5x`, `ofs`, `hom` reads); `Dro.ts` | `p1-07-dro.test.ts`; `p1-07-readout.test.ts` "Dro panel" | PASS |
| Settings view reads through the allowlist only, grouped and explained | `packages/schema/src/settingsRead.ts` `settingsReadGroups` (allowlisted group tokens with table members); `apps/web/src/live/readout.ts` reads via the worker `read`; `SettingsView.ts` | `settingsRead.test.ts`; `p1-07-readout.test.ts`; `dro.fake-serial.ts` (only allowlisted GETs on the wire) | PASS |
| `deviceHash` and drift → NEEDS_REVIEW | `deviceHash`, `settingsDrift` (schema); reference per (dialect, board id) in `device-safety`; worker `drift` request → `MachineSession.reportDrift(epoch)` | `settingsRead.test.ts`; `p1-07-readout.test.ts` drift; `p1-07-dro.test.ts` "reportDrift"; `machineWorker.test.ts` P1-07 | PASS |
| "Keep the board's settings" writes nothing to the machine | `LiveReadout.keepBoardSettings` replaces the local reference only | `p1-07-readout.test.ts` (no write button exists; Keep updates the store only) | PASS |
| T-S85: serial strings via text nodes with bidi sanitising | `packages/safety/src/boardText.ts`; `Dro.ts`, `SettingsView.ts` | `boardText.test.ts`; `p1-07-readout.test.ts` "hostile board id" | PASS |
| HIL-1.6 (connect while another tool runs a buffered job: no writes, state shown) | | test kit: `dro.fake-serial.ts` moves the model as another program would | HIL |
| HIL-1.8 (read all settings and poll status for 10 minutes: no denied token in the transcript) | | test kit: `dro.fake-serial.ts` checks the transcript; run the bench for 10 min and export the transcript (P1-08) | HIL |

Open with this task:

- The 3D preview shows the live position as a readout line, not a drawn point; the 2D view draws it.
- The drift reference is per computer (`device-safety`). The comparison with a profile draft
  (`settingsDrift` `draft`) and the cloud head revision arrives with the profile store (TB-04, A2).
- NEEDS_REVIEW stays until the next connect; there is no in-session clear yet.

## Track B items in the Phase 1 gate: TB-01, TB-02, TB-03, TB-05a, TB-05

| Item | Acceptance | Code | Test | Status |
|---|---|---|---|---|
| TB-01 | Property test from old P1-01 | `packages/schema/src/` fact store (`addFact`, `invalidate`, `view`) | `facts.test.ts` "property test (old P1-01)" (three properties, one an independent oracle over the §5.2 table) | PASS |
| TB-01 | T-S22 (import: facts need re-verify, `boundDevice` cleared) | profile import | `profile.test.ts` "import (T-S22)"; `facts.test.ts` "T-S22: after importing a profile ..." | PASS |
| TB-01 | 5 MB + 1 byte profile rejected before parsing | profile reader | `profile.test.ts` "a 5 MB + 1 byte file is refused with ProfileTooLarge before it is parsed" | PASS |
| TB-01 | Fact-age rule with an injected clock | `view` age rule (H28) | `facts.test.ts` "fact age with an injected clock (H28)" | PASS |
| TB-01 | T-S47 precursor: stored/exported schema has no fact fields | MachineProfile v2 schema, `exportProfile` | `profile.test.ts` three "T-S47 precursor" tests; "exportProfile strips facts ... even when smuggled in through a cast" | PASS |
| TB-01 | Gate DSL | `parseGate`, `evaluateGate` | `gate.test.ts` (grammar, fail closed, property: never met while a named fact is not valid) | PASS |
| TB-02 | EN `G10 L20 P1 X0` sets the offset; TG blocks | `packages/gcode/src/` interpreter, dialect data | `interpreter.test.ts` "EN: G10 L20 P1 X0 ...", "TG: the interpreter itself refuses G10 L20" | PASS |
| TB-02 | TG G18 arc blocked; EN E029 fixture dips to Z-0.5 | | `interpreter.test.ts` "EN draws the E029 fixture G18 arc", "TG: a G18 arc is blocked" | PASS |
| TB-02 | Mid-file M30 block (EN) / warn (TG); M201.3 block (EN); `S1000 T1 M6 M3 M8 G4 P1` block (TG, E088) | | `interpreter.test.ts` (one test each) | PASS |
| TB-02 | Old P1-03 goldens | | `interpreter.test.ts` "old P1-03 goldens" | PASS |
| TB-02 | Differential against `gsim.py` over the corpus, disagreements triaged | committed gsim results + `test/differential/triage.json` | `differential.test.ts` (every corpus file has a gsim result; triage only for corpus files) | PASS |
| TB-03 | 1M lines, no main-thread slice over 50 ms; cancel; preview equals interpretation of the sanitised lines | `apps/web/src/gcode-worker/`, `packages/gcode-view/` | `gcodeLarge.test.ts` "1M lines ..."; `gcodeWorker.test.ts` "cancel terminates the worker at once", "the preview draws exactly the interpretation of the sanitised lines"; `preview.e2e.ts` "Cancel stops a load at once" | PASS |
| TB-03 | T-S41: no Play or Simulate | `PreviewView.ts` (scrubber only) | `apps/web/test/preview.test.ts` "T-S41"; `preview.e2e.ts` | PASS |
| TB-03 | 750k lines in lite mode without exhausting memory | lite mode, virtual list | `gcodeLarge.test.ts` "750k lines open in lite mode"; `preview.e2e.ts` "lite mode" | PASS (CI machine; the "mid-range laptop" recording is an owner measurement) |
| TB-05a | Drift test: regenerate equals committed | `tools/gates/src/boards/` | `boards-gen.test.ts` "packages/schema/%s is byte-identical to a fresh render", "re-extracting at the pinned commit reproduces ... byte for byte" | PASS |
| TB-05a | Every overlay pin exists in the generated data | overlay merge | `boards-gen.test.ts` "refuses an overlay pin naming a signal ..."; `boardCatalog.test.ts` "every overlay connector pin ..." | PASS |
| TB-05a | Capability-driven panel set per board | `apps/web/src/` BoardPanels, `boardCatalog` | `boardPanels.test.ts` "TinyG v8 shows its connectors; v6 does not ..."; `boardCatalog.test.ts` "capability-driven panels" | PASS |
| TB-05a | Unknown `hv` → safe subset with "unrecognised board revision" notice | board selection | `boards.test.ts` "an unknown revision gets the empty subset"; `boardCatalog.test.ts` "an unknown hv selects the empty safe subset ..."; `boardPanels.test.ts` "an unknown hv renders no panels and an alert" | PASS |
| TB-05 | One test per rule, every finding cites a source | `packages/wiring/src/rules` | `rules.test.ts` (one per rule; "every rule in RULES has a test named after it") | PASS |
| TB-05 | EN rule text (boot float); active-low BLOCK reason per dialect | | `rules.test.ts` "WR-ACTIVE-LOW EN rule text ..." | PASS |
| TB-05 | Keyboard-only build; watermark on and off (W14); typed confirmation per key class | wiring editor | `wiringEditor.test.ts` (keyboard path, one Accept per key, typed confirmation, W14); `render.test.ts`; `wiring.e2e.ts` (keyboard-only, axe clean) | PASS |

## Phase 1 exit: HIL and bench items

Every item below needs the physical bench and the owner's signature
(`docs/bench/README.md`, `docs/bench/GUIDE.md` §8). Each one has a
procedure and, where the test kit can model it, a test that runs the same
steps against the simulated board in CI.

| Item | Procedure | Runs today against the test kit | Status |
|---|---|---|---|
| HIL-1.1 identify EN, transcript only GETs, ENQ, `!` | BENCH-P102-1, BENCH-P103-1 | `session-model-en.test.ts`; `open-mock-port.fake-serial.ts` | needs bench |
| HIL-1.2 449.01 / 440.21 READ_ONLY, no G-code | BENCH-P102-2, BENCH-P103-2 | `session-model-440.test.ts`; `p1-03-*.test.ts` | needs bench |
| HIL-1.3 C1 short form same day, full next day | BENCH-P105-1 | `apps/web/test/liveEntry.test.ts`; `live-entry.e2e.ts` | needs bench |
| HIL-1.4 two boards, same board id, nothing auto-selected | BENCH-P103-3 | `p1-03-host.test.ts` (T-S50) | needs bench |
| HIL-1.5 USB pull → LOST then UNKNOWN; reset → FAULT then UNKNOWN | BENCH-P102-3, BENCH-P104-1 | `p1-04-watchdog.test.ts`; `session-reducer.test.ts` T-S10 | needs bench |
| HIL-1.6 connect during another tool's buffered job | BENCH-P102-4 | `dro.fake-serial.ts`; `session-reducer.test.ts` ORPHANED_MOTION | needs bench |
| HIL-1.7 stop request while the controlling tab is frozen | BENCH-P106-1 | `tab-stop.fake-serial.ts` (T-S29) | needs bench |
| HIL-1.8 10-minute settings read and poll, no denied token | GUIDE §8.2 HIL-1.8 | `dro.fake-serial.ts` (transcript check) | needs bench |
| HIL-1.9 feedhold during a slow move, latency recorded | BENCH-P102-6, BENCH-P106-2 | `tab-stop.fake-serial.ts` (T-S18, T-S19) | needs bench |
| HIL-1.10 orphaned motion after a killed tab | BENCH-P103-4 | `session-reducer.test.ts` T-S60 | needs bench |
| HIL-1.11 port exclusivity across browsers and OSes (B-EXCL-1) | BENCH-P106-3 | `tab-stop.fake-serial.ts` "STOP NOT DELIVERED" | needs bench |
| HIL-1.12 partial-line splice (B-SPLICE-1) | BENCH-P103-5 | `p1-03-live.test.ts` T-S86 | needs bench |
| B-ID-1 FT230X VID:PID read from a v8 board | BENCH-P101-1 | n/a (a hardware fact) | needs bench |
| B-SIG-1 Chrome DTR/RTS at `open()` on macOS/Linux | BENCH-P109-1 | n/a | needs bench |
| T2.1 port selection between window and worker | BENCH-P109-2 | `bench.bench.ts` (the worker calls `getPorts()`) | needs bench |
| B-POL-1 `SerialAllowUsbDevicesForUrls` | BENCH-P108-1 | n/a | needs bench |
| B-PROBE-1 recorded probe fixtures | BENCH-P103-1 | `bench-docs.test.ts` (fixture placeholder check) | needs bench |
| B-MD-1 a GET of `md` de-energizes the motors | BENCH-P109-3 | testkit `honesty/behaviours.ts` (E138); `md` is denied by the allowlist | needs bench |
| B-EXCL-1 | BENCH-P106-3 | as HIL-1.11 | needs bench |
| B-SPLICE-1 | BENCH-P103-5 | as HIL-1.12 | needs bench |

## Open at the Phase 1 gate (final check, 2026-11-01)

These are not done and are not trivial fixes:

1. **Closed 2026-11-02: the window's port chooser (OD-3).** Approved and
   implemented (02fea94 gates, c75f8c1 Connect wiring).
2. **Closed 2026-11-02: the axis-mode facts are rendered** in the live
   readout ("Axis modes (read only)", `apps/web/src/machine-ui/AxisModes.ts`;
   `axisModes.test.ts`, `dro.fake-serial.ts`). BENCH-P100-5 still checks it on
   the bench with an inhibited axis.
3. **Closed 2026-11-02: Save transcript** (`TranscriptSave.ts`,
   `dro.fake-serial.ts` downloads one and checks `{sr:null}` first and every
   write allowlisted). Transcripts hold the board id as hex and stay private.
4. **Closed 2026-11-02: T-S19 with the 1M-segment preview loaded**
   (`tab-stop.fake-serial.ts`).
5. **P1-09 release record.** `RELEASES.md` entry with the HIL record id,
   artifact hash and bench board EN commit and `fb`: owner, after the bench.

## Final gate run (2026-11-01, at 600ba81 plus this docs commit)

From a clean install (`node_modules`, `apps/web/dist*`, e2e results and
`.wrangler` removed; `pnpm install --frozen-lockfile`):

| Check | Result |
|---|---|
| `pnpm check` (typecheck, gates, unit tests with coverage, build, scan, fake-serial build and diff, bench build and check) | pass (after one fix: a fixed test for a `migrate.ts` branch that only the fuzz sometimes reached, which failed the 100 % branch threshold) |
| `pnpm e2e` (source) | 72 passed |
| `pnpm e2e:fake-serial` | 8 passed |
| `pnpm e2e:bench` | 7 passed |
| `pnpm e2e:artifact` (artifact suite, staging headers, canary) | 72 + 5 passed; canary failed as it must, all 4 planted URLs reported |
| Production artifact served by the Worker | `Permissions-Policy: serial=(), ...`; `navigator.serial.getPorts()` in the page throws `SecurityError`; channel chunk `{kind:'release', benchIdentity:null}`; title and page carry no bench marker. Web Serial code is only in `assets/serial/`, and `--target production` refuses that chunk, so production deploys keep the Phase 0 shell |
| Bench artifact | `serial=(self)`; title `[bench] ...`; differs from the release only in the channel chunk |
| End to end on the simulated board (fake-serial build, same app code as bench apart from the test kit and channel chunk) | connect, probe (`tinyg-en`, READ_ONLY, not approved), DRO from polled `mpo`, settings read and recorded, Escape writes `!`, preview, wiring. First write `{sr:null}`; every write an allowlisted GET or `!` (47 writes) |

The bench build cannot be driven end to end against the simulated board
itself: the bench tree refuses the test kit by design, and the window has
no port chooser yet (item 1 above).
