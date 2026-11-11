# TinyG 450.04 readiness proposal

Prepared 2026-11-11. This is a proposal, not approval to control a machine or publish firmware.
The firmware pin, signed and unsigned approved-builds files, registered safety strings and SAFETY.md are unchanged.
450.04 remains read-only with the shipped manifest. Tests use an explicit test-only approval.

## Candidate and proposed entry

- Release: https://github.com/synthetos/TinyG/releases/tag/450.04 (pre-release).
- Commit: `ee98f02b545f3548fe53e59d143715141cfaf510`.
- HEX SHA-256: `a67aa65d4b9fa8bed1c9693de87d2cd9fbe3b0113d4560415eaced4088a483a1`.
- Runtime protocol reference: https://github.com/synthetos/TinyG/wiki/Runtime-Session-(rt).

Proposed build object for the **staging bench channel only**, after owner review and signing:

```json
{
  "dialect": "tinyg-en",
  "fb": 450.04,
  "fbs": null,
  "commit": "ee98f02b545f3548fe53e59d143715141cfaf510",
  "note": "TinyG 450.04 candidate for staging bench use only. HEX SHA-256 a67aa65d4b9fa8bed1c9693de87d2cd9fbe3b0113d4560415eaced4088a483a1. Review docs/ops/firmware-450-04-proposal.md and approve safety wording before signing. No D5 image approval is claimed."
}
```

The existing build schema does not have a HEX hash field; the hash above belongs to the release artifact and note,
not to `fbs`. With `fbs: null`, approval matches the reported build number and capability shape, not this specific
HEX. Do not treat the hash as a board identity check. No production approval is proposed here.

## Readiness changes and checks

**E060:** the identity probe accepts numeric `spph` 0 or 1 for EN 450.04 and later, still requiring every other
capability and the signed manifest. Older EN builds still require the stubbed answer. Output pause is never
inferred from build number alone: the UI says settings decide it, and reported `spe` decides whether it says
“spindle still on.” The paused job card explains that Resume can restart outputs and wait for spin-up; the
read-only Stop description no longer promises unchanged outputs for 450.04.

The optional 450.04 test model implements `spph` (default 1), `spde` (default 1 second), `coph` (default 0),
external hold output latching, restart delay, repeated Pause during spin-up, and cancellation on flush, kill,
alarm and reset. Homing/probe internal holds are exempt. The model retains its existing commanded-speed and
simplified motion limitations; it is not a physical timing oracle. New research citations use `EN45004` at the
full commit above, separately from the unchanged vendor pins. Source: `canonical_machine.c:2167–2241`,
`config_app.c:653–655`, and `spindle.c:87–92` at the candidate commit.

The machine integration tests actually pause, resume and inspect position: it stays fixed during the default
spin-up, then advances. With `spph=0` and a configured 10-second `spde`, it advances within 100 ms of resume.
Run leaves the restart delay to firmware; it does not inject an M3 or a second dwell. The session can be in its
feeding phase while the board still reports HOLD during spin-up; that is not evidence that motion restarted.

**N104:** preflight blocks an arc without a centre before streaming; typed-move validation also refuses it before
sending. Injected controller status 157 is covered in both streaming and typed movement, with plain wording
“the arc centre is missing or at its start.” The terminal uses the same meaning. The 450.04 model returns 157
without entering alarm; older model behavior is retained. Source: `plan_arc.c:212–236`. Tests cover the G17
model; this change does not claim new multi-plane model fidelity.

**N93:** startup input may receive no reply. The candidate source explicitly discards startup RX data and an
uncertain partial tail (`xio/xio_usb.c:407–426`, RX ISR at 202–209). After a 450.04 READY banner the connection
probe now waits at least 500 ms before retrying its splice guard. The test confirms the retry is `{sr:null}`,
with no early write; older builds keep the existing 300 ms settle. No unclassified motion is retried.

**N99 is not applied:** standalone G4 does not start a machining cycle. In particular a G4 after M30 retains
`stat=4` (PROGRAM_END) while the dwell timer still runs; from READY it can retain `stat=1`.
Do not reinterpret 4 as a new dwell state. `cm_dwell()` at `canonical_machine.c:1588–1597` only calls `mp_dwell()`;
`canonical_machine.h:65–66` still names 4 PROGRAM_END and 5 RUN. A model regression checks G4 after M30 keeps
4 while the model's planner is busy. **Model limitation:** real firmware frees the dwell planner slot before
the timer finishes, so it can report both `stat=4` and `qr=32` during the dwell. The model retains that slot;
this regression tests the status mapping only and cannot validate real-board dwell completion.
Run's state mapping and dwell handling are unchanged. Neither stat alone nor idle/end plus a full planner
proves completion: outstanding dwell time or a firmware completion marker must also be accounted for.
Review that completion boundary before approving 450.04; this proposal does not certify it.

Firmware-team clarification (2026-11-11, mailbox `20261111T110050-269aaa11`): N99's test-first commit is
`c1faefec`, its unmerged fix is `2c1489fd`, and the cases are in
`tests/hil/tests/bugs/test_n99_dwell_status.py` on `fix/N99-dwell-status`. They include lone-after-end,
before-end, output commands and M0/M1 followed by dwell. No stored board run was supplied for those tests;
these are source/test observations, not recorded bench passes. The merged `9928f545` change only makes the
E059 harness test wait out its own dwell; it does not fix firmware N99.

**N102 needs no change:** EN already caps unanswered bytes at 180 (`tinygEn.ts`, byte-window engine), below
the recommended 192-byte host limit. The actual firmware RTS thresholds are off at 224 and back on below
192 of the 248-byte usable ring (`xio/xio_usart.h:68–73`). Run opens with `flowControl: 'none'` and asserts
host RTS for board TX; hardware flow-control mode remains refused. No window increase is proposed.

**N43 needs no change:** existing Stop uses the same ^D / hold-and-% paths; firmware now also returns canned
program input to USB (`canonical_machine.c:2120`, `xio.c:464–477`). Run does not start built-in programs.
No new control byte or host resume action is needed, and no new canned-program simulator fidelity is claimed.

The runtime wiki describes `fs.v=2`, seven causes and the opt-in `fg` report. Existing step-3 parsing is not
changed or enabled by this proposal; the pin and production feature flags remain as they were.

## Registered wording for owner review only

No replacements in this section have been applied to `packages/safety/src/strings.ts` or `SAFETY.md`.
Keep old-build wording where its premise still holds. These are proposed 450.04 variants:

| Registered text / location | Issue | Proposed replacement or rule |
|---|---|---|
| W2 tooltip (`w2Tooltip`, SAFETY W2) | Says spindle and coolant keep running unconditionally. | “Decelerates and pauses motion. Spindle and coolant may pause according to board settings. Resume may restart them. Use Stop job to end the job, and your E-stop in an emergency.” |
| W10 (`w10`, SAFETY W10) | Says TinyG feedhold never stops outputs. | “Pause may turn off the spindle and coolant according to board settings. Resume may restart them. Use Stop job to end the job with the spindle off.” |
| W17 (`w17`, program pause) | Says this firmware does not turn outputs off at program stop. | “WARNING — Program paused. Spindle and coolant may still be running. Resume may restart them. Wait for the spindle to stop, or use your E-stop, before reaching in.” |
| W31 (`w31`, hold countdown) | Its assertion that the spindle is on is wrong if a countdown is driven by prior commanded state or coolant alone. | “This paused job will be stopped in N s. Spindle or coolant may still be running. Choose Keep paused to wait longer.” Gate any stronger wording on current reported output state. |
| STOP_TEXT.resumed / SAFETY Resume result | “Resumed” can appear while firmware is still in spin-up HOLD. | “Resuming” until HOLD clears; then “Resumed.” This is a proposed presentation change, not an extra host timer. |
| W26 (historical dwell warning) | Invalid for EN 450.04 as it already was for EN 450.02; repeated Pause can interrupt spin-up. | Keep suppressed for EN >=450.02, as H43 already requires. If explaining it: “Pause holds motion. Resume may wait for spindle spin-up. Use Stop job to end the job.” |

W30 (“SPINDLE MAY BE RUNNING”), loss warnings W3/W32, and reported-on `STOP_TEXT.pausedSpindleOn` remain
conservative and correct. W5's host-loss warning is not relaxed: losing the browser does not itself send a
feedhold. C9/C9 spindle-restart strings remain defined but are already not shown (OD-20); do not add a host
restart command to an ordinary E060 resume. Tool-change C35 still applies to Run's separate M5/M9 sequence.

SAFETY prose also needs the owner's amendment in these locations (line numbers at base 7b8cc72):

- Lines 29, 58 and H16 (335–340): scope the spindle-stays-on premise to old builds or disabled output pause.
  Proposed: “From EN 450.04, board settings govern output pause; physical stop is never established by Pause.”
- H13 cause (320): remove the unconditional “spindle on” premise for a program pause; keep the orphaned-motion
  refusal. Proposed: “A previous session may leave held or queued motion; outputs may be on or restart on resume.”
- H43 amendment (559): replace “no spin-up dwell of its own” with “G4 keeps its existing timer semantics;
  E060 can add a separate, interruptible spindle restart wait before motion resumes.”
- §4.4 Pause step 5 (1227), W2 explanation (1528), W10 (1537), W17, W31 and Resume result: use the variants
  above and current reported output state, not the pre-hold command, for an asserted-on label.
- §7 residual 4 (1654): replace universal feedhold/program-stop spindle behavior with the setting-dependent
  450.04 rule, while retaining the warning that loss of control cannot switch off physical power.

These wording amendments and any owner-required bench comparison remain prerequisites to approval. This
readiness branch deliberately leaves the registered wording unchanged, as requested.

## Bench evidence supplied by the firmware team

Source handoff: `/Volumes/External/projects/TinyG-work/handoffs/2026-11-11-450.04-bench-evidence.md`.
Artifact directory: `/Volumes/External/projects/TinyG-work/releases/450.04/ci/tinyg-450.04-ee98f02b545f3548fe53e59d143715141cfaf510/`.
Run directories below are under `/Volumes/External/projects/TinyG/.analysis/hil-runs/`.
This is the firmware team's recorded evidence; no hardware run was performed for this Run change.

| Evidence | Outcome and limit |
|---|---|
| Gate build, merge-candidate tree matching ee98f02b | Normal: 511 passed, 77 skipped, 3 xfailed. Hooks: 581 passed, 10 skipped, 3 xfailed. |
| CI HEX, bench 2 board 3Y2462-WWR; `20261111T065100Z-remotes_origin_edge-next` | Regression: 483 passed, 75 skipped, 3 xfailed, zero failed. |
| `20261111T072220Z-remotes_origin_edge-next` | RTS soak with three holds passed, 493 seconds. |
| `20261111T073034Z` / `073449Z` | Original dense file stopped at M0; soak did not resume it. Test limitation, not a full pass. |
| `20261111T084131Z-remotes_origin_edge-next` | M0/M1 removed; 29,712-line file, three holds. About 10,200 lines / 83 minutes without error or alarm, then 5,000-second time cap. Pytest marked failure; not a completed soak pass. |
| E060 cases | Five of seven pass on the CI HEX. Two need debug struct information and pass on the gate build, not the stripped CI build. |

The run records mark firmware `known: false` because it was flashed prebuilt; each run.json names the CI ELF.
The HEX digest above must still be verified when selecting an artifact for any future flash or approval.

## Validation of this readiness branch

- `pnpm typecheck`: passed across the workspace.
- ESLint on every changed/new TypeScript file and `git diff --check`: passed.
- Machine `test/firmware-45004.test.ts`: 6 passed.
- Protocol `test/capability.test.ts`: 33 passed.
- Testkit `test/firmware-45004.test.ts`, `test/citations.test.ts`, `test/honesty.test.ts`: 14 passed;
  citations checked with `RUN_FIRMWARE_REPO=/Volumes/External/projects/TinyG` against actual Git source.
- Web `test/pausedJob.test.ts`, `test/stopJobText.test.ts`, `test/terminalModules.test.ts`: 36 passed.
- The downloaded CI HEX was hashed locally with `shasum -a 256`; it matches the candidate digest above.

Only targeted tests were run, 89 tests total. Full suites and browser/hardware verification are left to the
lead's merge checks. No server was started, no firmware was flashed, and nothing was deployed or pushed.
