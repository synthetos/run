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
