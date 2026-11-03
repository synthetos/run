# run.synthetos.com: safety case

> **D34 is superseded by D39 (owner, 2026-11-01).** run and accounts stay in the **current** Cloudflare account, locked down: a CI-only deploy token scoped to the run and accounts Workers (and their Access apps), minimal account members, a hardware-key owner login, audit-log alerts on any change not made by CI, and no local wrangler login used to deploy run or accounts. Wherever this document says "the dedicated (or separate) run account", read "the current account with the D39 lockdown". **One consequence:** service bindings now work within the account, so another Worker in the account (the site or forumbot) *could* declare a binding to `accounts`' `RunEntrypoint`. That is prevented by review and the D39 token scope, not by the platform: the CI policy must refuse any Worker config other than run's that binds `accounts`, and forumbot keeps using OIDC over HTTPS (product-neutral), not RPC.

Status: design, 2026-10-31. **This document outranks RUN_PLAN.md: where the two disagree, this one wins.**

It revises `docs/tools/SAFETY.md` (cited as `OLD-S`) for three changes in direction:
1. TinyG **edge-next** is the primary firmware.
2. The product now has **accounts and cloud storage**.
3. The user-facing **simulator is removed**.

Everything in OLD-S that is still true is kept here, either restated or cited by section. Protocol facts are in `PROTOCOL_NOTES.md` (cited `PN §n`). That file defines the tags `EN` (edge-next, pinned to 4e2ed838), `TG` (master 440.21) and `XB`.

Anything not confirmed in source or on hardware is marked **UNVERIFIED** and carries a bench task (`B-*`, PN §15) or a citation task (`CIT-1` ISO 13850 clause; `CIT-2` EU 2023/1230 application date; `CIT-3` source for "do not hot-plug steppers").

**Approach (ISO 12100 order, unchanged).**
1. Design the hazard out.
2. Guard against what remains.
3. Inform the user about what is left after that.

Warning text is never accepted in place of a design measure that would have been feasible. Synthetos owns the firmware, so "design it out in firmware" is a real option (D7 E138 fix, D8 host heartbeat, D9 spindle pause on hold). The firmware decisions in DECISIONS.md are safety decisions.

---

## 0. What changed from OLD-S, in one list

**Firmware (edge-next):**
- **Stop job on edge-next is ^D** (ALARM 207: the spindle and coolant go off immediately, also during a dwell or a hold), followed by a confirmed `{clear}`. TG keeps `! → % → M5 → M9`.
- **On edge-next, alarms already stop the spindle and inhibit outputs** (E019, E044). H7 and H16 get weaker residuals on EN. **A feedhold still leaves the spindle on** (E060 is unmerged), so W10 stays on every TinyG dialect.
- **On EN, `!` is ignored during a dwell** (PN §8). There is a new hazard, H43, and the stop UI changes during dwells.

**Corrections to OLD-S:**
- **M0/M1/M60 do not pause on stock 440.21** (PN §9.2). OLD-S C14 and H23 assumed they did. Every TinyG dialect now treats program stops as a **host barrier** (H36).
- **Stock 440.21 does not soft-limit arcs** (PN §10.2). OLD-S H3 cited dead code.

**New hazards:**
- **H35:** a standalone M2/M30 clears an alarm on EN (E135).
- **H37:** reads with side effects (E138, plus `md`).
- **H44:** stock 449 misclassified as edge-next (same `fb`).

**Accounts and cloud** add H29–H34, H38–H42 and H45. They rest on these core rules (§4.10):
- the cloud never drives the machine;
- facts are never synced;
- profiles are compared, never applied automatically;
- G-code is hash-verified and loaded locally before Arm;
- a session or network loss never touches a connected machine.

**No user-facing simulator:**
- W7 (SIM band) and C2 (SIM → LIVE) are retired.
- H15 becomes "preview or library mistaken for machine state".
- The mock device exists only in the test kit and must never reach the production bundle.

**Red-team round 2 (2026-10-31; full changelog and rejections in RUN_PLAN §14):**
- New ORPHANED_MOTION overlay: a hold, program pause or queue left by a previous session can only be ended, never resumed (H14).
- FAULT now ends the job with the spindle off (integrity faults at once, liveness faults after a grace period); Resume is never offered after a FAULT (§3).
- Feedhold, Stop job and Spindle off are allowed in every connected overlay by a normative rule above the allow-matrix (§4.1).
- The feedhold control is "Pause (spindle stays on)"; a hold is never called "STOPPED"; a hold timeout and an automatic ^D during dwells on EN (§4.4).
- Long moves are split so no single line exceeds the queued-motion ceiling (§4.7); a screen wake lock is held during jobs (§4.3); the UI heartbeat is visibility-aware (H17).
- Stop verification, barrier drain and live machine position use polled reads, because EN reports are filtered and `mpo` is not in the default `sr` (§4.2).
- Flash restore uses this run's local snapshot as the source and the baseline, and mains stay isolated until `spep`/`spdp` are confirmed (H47).
- New hazards: H46 (deploy, DNS or Cloudflare-account compromise), H47 (wrong or forged backup restored after a flash), H48 (job ends with the spindle on).

**Completeness and safety critic (2026-10-31, after round 2):**
- New H49: a partial line left in the controller's RX buffer by a previous sender must never be completed into a line that runs. The first line at connect is `{"sr":null}` (PN §2.3 step 0).
- ENQ is never sent before a footer revision 2/3 has been seen (TG does not trap it). The H14 "busy board" test no longer depends on ENQ; an unanswered probe leads to ORPHANED_MOTION **unclassified**, where Stop job is `!` plus "Use your E-stop".
- The advanced console (MDI) is specified as a one-line generated job: motion and spindle-on lines go through preflight, the ceiling and a confirmation naming the target (§4.1 Console row, T-S88). It ships no earlier than Phase 4.
- New HIL items: HIL-1.12 (partial-line splice), HIL-2.13 (hardwired E-stop pressed during a jog and a job), and HIL-6.5 (real loaded machine before public beta). The bench fixture has no cutter and no mass, so overrun, spindle run-down and Z-drop behaviour must be measured on a real machine before the public can drive one.
- HB numbering made consistent: HB-1..HB-13 gate W5-HB; HB-14 is added for images that carry E060.

**Phase 2, bench motion (owner, 2026-11-02; firmware facts from the edge-next maintainer at 6ec70652):**
- Motion is behind a **motion capability flag** that is on for the loopback bench server and the staging host only. Production's host never turns it on (T-S93), and production still serves `serial=()` with no serial chunk. Settings writes stay a separate phase.
- Jog, go to zero, set work zero (`G10 L20 P1`), manual spindle (`M3`/`M4` with S, `M5`) and coolant (`M7`/`M8`/`M9`) are new. They are written through their own **motion** command kind in the session's write gate, from a closed line grammar (§4.5b, T-S94).
- A jog is fed in short pieces with a small lookahead, never more than a bounded distance and time ahead. A press-and-hold jog stops when the button is released, the window loses focus or visibility, or the page stops renewing it (H50).
- **Stop job, in a motion session, is no longer sent as Pause** (amends the Phase 1 behaviour in §4.4): `!`, then `%` once the hold is confirmed by polled reads, then `M5` and `M9`. The message is "Stopped: queue cleared, spindle and coolant off". ^D stays reserved for jobs (Phase 3). READ_ONLY and ORPHANED_MOTION sessions keep `!` with "Use your E-stop".
- Resume (`~`) is offered only for a hold of motion this session sent.
- New hazards H50–H56; new W34, C24 and C25; new tests T-S89–T-S94.
- The firmware watchdog (D8 phase B) is not built: nothing here relies on it. The `{rt:null}` heartbeat (phase A) is not used.
**Settings writes (amendment 2026-11-02; the owner approved moving past read-only):**
- run writes board settings on the **bench and staging builds only**. One switch (`packages/safety/src/settingsPhase.ts`, pinned by a test) turns the new `settings` intent kind on for the staging environment, which includes the localhost bench. Production stays read-only until the owner changes that switch.
- A settings write needs an **approved board**: the machine worker now verifies the bundled, signed approved-builds manifest for its own origin (P1-03), and a READ_ONLY board is never written.
- Each write passes an **idle gate of polled reads** taken right before it, then goes out **one token at a time**. Its answer is awaited before any other line, because a persisted write stalls the board while EEPROM is written and bytes sent meanwhile are lost. The token is then **read back** and compared at the table's precision.
- Every apply takes a **mandatory backup** first. A run **stops at the first failure** and offers **revert** from that backup.
- High-risk changes need a confirmation that **names the consequence**. Communication and identity settings are never written.
- New hazards H57-H63, tests T-S95-T-S100, checklist item 42 and HIL-4.8/4.9. §4.1 (Settings write row) and §4.6 are amended.

---

## 1. Scope and intended use

**What the software is.** run.synthetos.com is a browser workspace for configuring, wiring, flashing and operating hobby and light-industrial CNC machines that use Synthetos TinyG v8 (edge-next primary, stock 440.21 fallback) and, from Phase 7, g2core controllers. Users sign in with a Synthetos account (GitHub sign-in at launch) to save projects, G-code, machine profiles, wiring diagrams and settings backups.

**Intended users.** An informed adult operator who:
- has built or owns the machine;
- has installed a hardwired emergency stop;
- has read this safety contract;
- agrees to stay present and attentive while the machine is powered.

**Intended environment.**
- Desktop Chrome or Edge, on mains power.
- The run.synthetos.com tab is visible in its own window, and OS sleep and screen lock are off.
- The computer is connected by USB to a single controller.
- A personal computer is assumed. Shared computers are handled (H33) but discouraged.

**What the software is NOT.**
- **It is not an emergency stop and not a safety function.** The on-screen Pause sends a feedhold, and Stop job ends the job with the spindle off. Both are controlled stops similar to IEC 60204-1 Category 2, sent over a channel that is not safety-rated. They may be delayed or never delivered.
- It is not certified to any ISO 13849 performance level (CIT-1, OLD-S §1).
- It is not a guard. It does not detect people or fire, and it cannot remove energy from actuators.
- **Neither the cloud service nor the account is part of any safety path.** The machine is controlled only from the browser tab that holds the serial port. Nothing on Synthetos servers can start, stop or change a machine.

**Reasonably foreseeable misuse that we design against.** OLD-S §1 still applies:
- treating the software stop or the board's reset button as an E-stop;
- running unattended, in a background tab, or with the screen locked;
- running a file without previewing it;
- pasting configuration found on the forum;
- flashing the wrong image;
- wiring 24 V sensors to 3.3 V inputs;
- using a laser on TinyG;
- having two identical boards on one PC;
- having two tabs open.

New misuse cases:
- Opening a project on a different machine from the one it was made for.
- Trusting a profile or G-code because "it is in my account".
- Signing in on a shared shop computer and leaving the account signed in.
- Loading a file shared by someone else, or found on the forum, and running it without review.
- Believing the 3D preview or the library shows what the machine is doing.
- Running a job with a phone pendant or remote page, which does not exist in v1 and must not be improvised.
- Controlling the machine through remote-desktop software (RDP, VNC, TeamViewer) from somewhere else: disconnecting the remote session can lock the console and hide or throttle the tab (H17), and the operator is not at the machine.
- Connecting from a phone or tablet operating system whose browser happens to expose Web Serial. Mobile operating systems freeze and kill background tabs aggressively, so live control is refused there in v1 whatever the API reports (RUN_PLAN §2.3).

**Regulatory note.** As in OLD-S §1. EU 2023/1230 applies from 2027-01-20 (CIT-2). It requires resistance to malicious interference, which the account hazards below address. A product version needs legal review (D25).

---

## 2. Hazard register

**Scales (unchanged):**
- Severity: S4 death, serious injury or fire; S3 minor injury; S2 machine or tool damage; S1 lost work.
- Likelihood before mitigation: L4 expected in normal use; L3 likely across the user base; L2 occasional; L1 rare.

**Verification codes:**
- U: unit or property test.
- M: model-based session test against the test kit.
- E: Playwright end-to-end test on the production build.
- H: hardware-in-the-loop checklist item (§9).
- R: review checklist item (§8).
- S: server or API integration test.

"EN" means edge-next and "TG" means stock 440.21. A row that does not name a dialect applies to both.

### H1. Host loss while the machine is moving
| Field | Content |
|---|---|
| **Cause** | Tab closed, crashed (including a renderer out-of-memory caused by a hostile file, H39) or discarded. OS sleep. USB unplugged. EMI drops the link. |
| **Why it matters** | Neither TinyG build notices that the host has gone (PN §3.1). Queued blocks keep running: up to 20 on EN and 28 on TG (PN §6.2), plus up to 250/254 bytes in the RX buffer. Chromium does not protect a background tab with an open serial port from discard (OLD-PN §3.3). |
| **Rating** | S4, L3 |
| **Mitigations** | 1. A hardwired E-stop is mandatory and acknowledged (W1, plus C1 at every LIVE session start). 2. Shallow queue: at most 180 bytes in flight on both dialects, at most 10 lines in flight on EN, and a **queued-motion ceiling** (default 5 s modelled) that pauses feeding (§4.3), enforced per line by **host-side splitting of long G0/G1/G2/G3 moves** (§4.7 step 6a), so no single line can queue more than the ceiling. 3. An overrun display: an upper bound in mm and an estimate in seconds. 4. Event-driven streaming in a dedicated worker. 5. A per-machine host-loss policy; `drain` is the only policy on TinyG (§4.3). 6. LOST state with an audible tone; the next load shows UNKNOWN. 7. Web Lock and tab-hygiene guidance. 8. **Design-out: D8, the firmware host heartbeat** (PN §14). It is not available yet, and no wording changes until HB-1..HB-13 pass on the exact image. 9. A screen wake lock is held from Arm until DONE, STOPPED or FAULT (§4.3). |
| **Residual** | **Medium.** Motion after host loss is bounded but not zero. After the queue drains, the spindle stays in its last commanded state **indefinitely** on both dialects until D8 ships. That is a fire risk, stated in W3 and W5. |
| **Verification** | M: the overrun mm bound is at least the modelled motion. H: HIL-3.6 (pull USB mid-job; measure motion; record spindle state after drain). E: LOST banner and tone. |

### H2. Real-time bytes or truncation inside job data
**H2a. Real-time bytes in job data**
| Field | Content |
|---|---|
| **Cause** | TG traps `! ~ % ^X` anywhere in the stream, including inside comments, and latches `%`. EN traps `!`, ^D, ENQ and ^X anywhere. On EN, `%` and `~` act only at a line boundary (E021), and a mid-line `%` makes the line malformed (E161). |
| **Effect** | A surprise hold, resume, deletion of queued moves, job kill or hard reset. |
| **Rating** | S2–S4, L3 |
| **Mitigations** | The sanitiser (§4.7), the same on every dialect: reject any line that contains `! ~ %` or any byte < 0x20 except tab, or ≥ 0x7F (including 0x04, 0x05, 0x11, 0x13, 0x18, 0x1B); drop `%`-only lines; reject first characters `$ ? H h {`. Preview and preflight interpret exactly the bytes that will be sent. |
| **Residual** | Low. |
| **Verification** | U: T-S1, T-S2. |

**H2b. Truncated or merged line on stop.** Unchanged from OLD-S H2b:
- the Transport has no `abort()`;
- one complete line per awaited write;
- no newline is ever written after a failed write;
- on TG, a `%` is sent before anything else after a write failure;
- on EN, a write failure leads to UNKNOWN, and Stop job uses ^D (§4.4).

On EN, E162 also guarantees that a damaged line never executes (PN §7.2). Residual Low. Verification M (T-S5).

### H3. Motion outside the work envelope
| Field | Content |
|---|---|
| **Cause** | Soft limits are off by default (`sl=0`) and skipped for unhomed axes. **TG does not check arcs at all** (PN §10.2, correction). EN checks arcs on homed axes with `sl=1` (E041). Offsets can change between preview and run. |
| **Rating** | S2–S4, L3 |
| **Mitigations** | Preflight in machine coordinates, using the live WCS, G92 and tool offsets read from the board, exact arc extents and the approach move. **Host arc-extent preflight is mandatory on TG.** G10 handling is dialect data: TG blocks any L ≠ 2; EN allows L2/L20 and blocks other L values. A first feed move without F is a block. Arm is invalidated on any change to offsets, coordinate system, units or homing. Run requires homed axes; overriding needs expert mode and C10. We recommend `sl=1`. Every jog target is checked. The preview is labelled advisory (W13). |
| **Residual** | Medium on unhomed machines. Low on homed machines with `sl=1` (EN also checks arcs). |
| **Verification** | U (bounds properties), M, H (HIL-3.9: an arc past the envelope is blocked by preflight on both dialects; EN also alarms when preflight is bypassed in the test kit). |

### H4. Machine state misread
| Field | Content |
|---|---|
| **Cause** | Stat numbering differs: TG 11 = SHUTDOWN, EN 11 = INTERLOCK (unused), EN 12 = SHUTDOWN, EN 13 = PANIC. Status codes differ: TG limit 204 and alarmed 203; EN limit 203 and alarmed 204, 207 = job kill. A feedhold is ignored when nothing is moving. Optimistic UI state. |
| **Rating** | S2–S4, L3 |
| **Mitigations** | **Three generated TinyG tables** (EN, TG, stock 449), never inferred from `fb` (PN §11). The UI shows only state mapped from firmware reports. STOP shows "requested" until a report confirms it. `!` is re-sent if motion resumes while the user wants a hold. A conflicting identity leads to READ_ONLY. |
| **Residual** | Low. |
| **Verification** | U: T-S4. M. |

### H5. Bad settings change how the machine moves
| Field | Content |
|---|---|
| **Cause** | Values written in G20 units. Few range checks on TG; EN adds E158, E112 and E106. Writable `hv` and `baud`. Pasted profiles. **Cloud profiles authored elsewhere** (H38, H41). New EN polarity keys `spep`, `spdp`, `prbp`. |
| **Rating** | S2–S4, L3 |
| **Mitigations** | The write pipeline (§4.6). Exact per-build schemas generated from the firmware; unknown builds are READ_ONLY. Risk classes and a forbidden list (PN §12.4). `spep`, `spdp` and `prbp` are in the polarity class and need typed C5. Profiles are bound to the device and **never applied automatically** (§4.10). Cross-build mapper. Writes invalidate facts. |
| **Residual** | Low. |
| **Verification** | U, M, H (HIL-4.x). |

### H6. Runaway or oversized jog
Unchanged from OLD-S H6, with one EN note. E157 refuses only the firmware `jog*` tokens; it does not gate G-code jogs. **run never uses `jog*` tokens.** The host rules in §4.5 are the protection. On EN, an M400 barrier confirms idle before the next jog. Residual Low. Verification: M, E, H (HIL-2.x).

*Amended 2026-11-02 (Phase 2, owner).* run still never uses the `jog*` tokens. A jog is short `G21 G91 G1` steps fed by the session with a bounded lookahead, then `G90` (and `G20` when the board was in inches) to restore the modes (§4.5b). The M400 barrier is replaced by polled idle confirmation (two consecutive polled reads with `stat` idle, `vel` 0 and `qr` = plannerBlocks): an M400 answer is deferred until the planner drains, and while it is owed no polled read can be answered, which the release and stop paths need. Continuous (press-and-hold) jog is allowed in Phase 2 and replaces "no continuous jog in v1" in §4.5; the runaway hazards are H50 and H54.

### H7. Alarm while moving
| Field | Content |
|---|---|
| **Cause** | TG: a soft alarm keeps queued moves running and limits are ignored (OLD-S H7). EN: an alarm holds, flushes, turns outputs off and inhibits them (E044, E019, PN §10.1), **but limits are still ignored during the deceleration**. |
| **Rating** | TG S4, L2. EN S3, L2. |
| **Mitigations** | **TG:** the alarm reflex, `!` then `%`, then FAULT. **EN:** stop feeding, then FAULT; sending `!` is harmless and is still done. On both: the recovery card, C13, and re-homing when the axes were un-homed (EN limit → ALARM 203 with axes un-homed). |
| **Residual** | TG Low-Medium (the reflex needs the link). EN Low. |
| **Verification** | M: T-S9 per dialect. H: HIL-3.10. |

### H8. Stale view
Unchanged (OLD-S H8):
- receive-timestamp watchdog;
- STALE blocks new commands;
- FAULT plus `!` after more than 5 s of unexpected silence while RUNNING;
- lag badge.

On EN, `line` in the default `sr` and ENQ make the watchdog more precise (§4.2). Residual Low.

### H9. A wrong or lost line executes
| Field | Content |
|---|---|
| **Cause** | Corrupted bytes, RX overrun, a firmware-rejected arc. |
| **Rating** | S2–S3, L2 |
| **Mitigations** | Host N numbers on every job line. EN: E162 means a damaged line never executes and every line gets an answer (status 13 → FAULT); E159 and E161 remove silent number changes. TG: the byte window keeps overruns from happening and the footer field 3 cross-check catches mismatches. Any non-zero footer status → FAULT. Lines are never resent automatically. |
| **Residual** | Low. On TG, splice protection depends on the host window (PN §7.2). |
| **Verification** | U, M (T-S12), H (B-N-1). |

### H10. Unintended reset or bootloader entry
As OLD-S H10, with two additions:
- On EN, any SET of `boot` enters the bootloader (PN §12.3). `boot` is forbidden outside the flasher.
- ^X is ISR-level on EN.

Residual Low.

### H11. Firmware flashing
As OLD-S H11 and §4.8. The EN boot ordering leaves the spindle and coolant pins high-impedance while settings load (PN §13.1). That is a firmware statement of the float hazard, so mains isolation in C6 stays mandatory. **Mains stay isolated until the restore read-back confirms `spep`/`spdp`** (§4.8, H47). The factory default is `spep=1` (EN settings_default.h:52), and `_exec_spindle_control` drives the enable pin low for OFF when the polarity is 1 (EN spindle.c:202-203), which an active-low relay or VFD enable reads as ON. B-FL-1 and B-FL-2 are re-run on EN. Residual Low once they pass; the flasher does not ship before then.

### H12. Malicious or compromised code drives the machine (XSS, supply chain)
| Field | Content |
|---|---|
| **Cause** | XSS on run.synthetos.com. Supply-chain compromise (polyfill.io 2024; chalk/debug and Shai-Hulud 2025). Clickjacking. **An account page, the forum or any other synthetos.com page scripting the port.** **A preview or `workers.dev` URL serving unreviewed code with its own serial grant** (H45). |
| **Rating** | S4, L1 |
| **Mitigations** | A dedicated origin, run.synthetos.com, that serves no user HTML, no forum content and no third-party script. Strict CSP with Trusted Types and `connect-src 'self'` (RUN_PLAN §6.4). `frame-ancestors 'none'`. Zero runtime dependencies in the safety path; vendored three.js. CI-only deploy from an attested artifact. **Panels are compiled in:** no runtime-loaded widgets and no raw-send API (the ChiliPeppr anti-pattern, RUN_PLAN §5.1). User strings render with `textContent` only. The session cookie is HttpOnly, so an XSS cannot steal the session, and §4.10 means a session cannot make the machine move anyway. `serial=()` on every other Synthetos origin. |
| **Residual** | Low. An XSS can still act inside the page, which is why every motion still needs a local user gesture through `safety.allowed`. |
| **Verification** | E: T-S25 (headers), T-S39 (no external origins, no raw-send). R. |

### H13. Wiring errors
As OLD-S H13. The rules engine, export watermark, meter checklist and outputs test stand. Add the EN boot float note (PN §13.1). Residual Medium: we cannot see the real wiring.

### H14. Automatic resume after reconnect, and orphaned motion from a previous session (revised, red-team round 2)
| Field | Content |
|---|---|
| **Cause** | The tab crashes or closes while the board is in a feedhold (EN stat 6), at a program pause (EN stat 3 with `hold` 6 and the spindle on, PN §8), or with blocks still queued (up to 20 on EN) and up to 10 unread lines in the RX ring. After a reconnect, `~` would resume moves the new session never sent, never preflighted and cannot see. A `qr` read on a non-empty queue would also corrupt any "empty planner" value learned at the handshake, and GETs queued behind a stalled RX backlog may get no answer, which used to be classified as a conflict (READ_ONLY, feedhold only, spindle still running). |
| **Rating** | S4, L2 |
| **Mitigations** | 1. Reconnect always lands in UNKNOWN. No job state is persisted **locally or in the cloud**; a `runs` row is history only and can never be resumed. 2. **ORPHANED_MOTION overlay** (§3). It is entered when, at connect, stat ∉ {1, 4}, `hold` ≠ 0 (a readable token on EN, config_app.c:154; on TG only stat and `vel` are used, because `hold` on 440.21 is UNVERIFIED), `vel` ≠ 0, or `qr` is below the dialect's bench-verified empty value. **(Amended 2026-11-02, bench 1 false positive.)** On EN, stat 3 with `hold` 0, `vel` 0 and `qr` at the empty value also counts as resting: every cycle that ends without M2/M30 finalizes to PROGRAM_STOP (EN canonical_machine.c `cm_cycle_end`, also after `{clear}`), so an idle board after another program's moves reads stat 3, while a program pause (M0/M1/M60) on EN reads stat 3 **with `hold` 6** (EN canonical_machine.c `_exec_program_stop`) and stays ORPHANED_MOTION. On TG stat 3 is still not resting, because `hold` is UNVERIFIED there and a program stop cannot be told apart. An unclassified board still needs stat ∈ {1, 4}. Its only exits are Stop job (EN ^D then C13; TG `!` `%` `M5` `M9`) and Reset controller (C15). Home, jog, settings writes and Resume are denied. W32 explains it. 3. **`~` is allowed only to resume a hold or program pause of a job started by the current session id.** It is never available after a reconnect. 4. `plannerBlocks` is a **bench-verified dialect constant** (B-QR-1), never learned at the handshake. A lower reading means the queue is not empty. 5. The identity probe sends `{"sr":null}` first (PN §2.3 step 0). **No answer within 3 s, or unsolicited status reports showing motion, is "busy", never "conflicting identity"**: the session goes to ORPHANED_MOTION, not READ_ONLY. Until the probe has classified the board, ORPHANED_MOTION is **unclassified**: Stop job is `!` plus "Use your E-stop" (no ^D, `%` or M-codes to an unknown dialect) and Reset controller (C15) is available; the dialect's own Stop job becomes available once classification completes. ENQ is sent only after a footer revision 2/3 has been seen, because TG does not trap it (PN §2.3). "Conflicting identity" means answers whose values conflict, never missing answers. |
| **Residual** | Low. |
| **Verification** | M: T-S60. E. H: HIL-1.10 (kill the tab while held with a full planner and an RX backlog, reconnect, and check that only stop-class intents are offered). |

### H15. Preview, library or recovered state mistaken for machine state (replaces "simulation and live confused")
| Field | Content |
|---|---|
| **Cause** | A 3D preview that looks like a running machine. A library or project page showing "last run" data. A second tab. A forum user ran a file whose "simulation ran ok" while the firmware ignored G40/G41/G43 (forum topic `tiny-g-not-doing-what-chilipeppr-simulation-do`). |
| **Rating** | S4, L2 |
| **Mitigations** | There is **no simulator and no Play or Simulate button.** The preview scrubber highlights lines only. The NOT CONNECTED band (W7) shows whenever no port is open. Live position is drawn only from `mpo` values **polled from the board**, labelled with their source and age. EN does not put `mpo*` in its default `sr` (EN settings_default.h:84), and run does not change the `sr` list (D24), so the position cannot come from status reports (§4.2). Nothing animates from a model. W13 is pinned to the preview. Other tabs show "Machine is controlled in another tab". `runs` history is labelled "history, not machine state". The W6 previous-session banner overrides NOT CONNECTED. Preflight flags codes unsupported by the dialect. The production bundle cannot contain the test kit (T-S40). |
| **Residual** | Low. |
| **Verification** | E: T-S17, T-S41. R. |

### H16. Spindle keeps running in a hold or alarm
| Field | Content |
|---|---|
| **Cause** | **Both TinyG dialects: a feedhold leaves the spindle and coolant on** (EN: E060 unmerged; `spph` answers 17). TG: alarms leave the spindle on, and M5 is queued behind held moves. EN: alarms, shutdown and panic turn the spindle off (E019), but M5 is still queued behind held moves. |
| **Rating** | S4, L3 |
| **Mitigations** | Honest labelling (W10 on every TinyG hold; the spindle shows "UNCONFIRMED" unless reported). On every TinyG dialect the feedhold control is labelled **"Pause"** (W2, amended 2026-11-02 by OD-6; the spindle-stays-on fact is shown with the paused state), a hold is shown as **"PAUSED — SPINDLE MAY BE RUNNING"** (W30) and never as "STOPPED", and Stop job is the most prominent stop control. A **hold timeout** (default on, 60 s) ends the job with the spindle off if nobody acts (§4.4). **Stop job: on EN, ^D turns the spindle off immediately in any state, including a hold or a dwell; on TG, the flush sequence** (§4.4). "Spindle off now" in the safety bar is ^D on EN and `M5` (queued) on TG, with the queue caveat shown. Lasers and plasma stay unsupported on TinyG (W15), because a hold leaves the output on. Long-term: D9 (E060) and D8 (heartbeat). |
| **Residual** | EN Low-Medium: the operator must act; ^D is one click. TG Medium. After a host loss and drain, the spindle runs indefinitely on both (W5). |
| **Verification** | H: HIL-2.6 and HIL-3.4 with the spindle LED and relay on J6 (B-KILL-1). |

### H17. Main thread frozen while the worker keeps streaming
As OLD-S H17:
- a UI heartbeat every 500 ms; 5 s of missed heartbeats **while the document is visible** during a job → FAULT (liveness class, §3). The main thread posts `visibilitychange` to the worker. While the page is hidden the heartbeat check is suspended and the worker relies on its own receive watchdog: Chrome throttles chained timers in hidden pages to about once a minute after 5 minutes hidden (https://developer.chrome.com/blog/timer-throttling-in-chrome-88), and whether an open serial port exempts the page is UNVERIFIED (B-HIDE-1);
- chunked geometry upload;
- stop latency under 100 ms;
- the machine worker subscribes to the stop-request BroadcastChannel itself.

Cloud sync runs in its own worker at low priority and pauses while RUNNING or HELD (§4.10), so it cannot add main-thread load. Residual Low.

### H18. Wrong machine addressed
As OLD-S H18, plus the cloud dimension in H38. The read-only identity handshake runs, the profile is bound to the device `id`, a mismatch blocks, nothing is pushed, there is a per-board Web Lock, and confirmations are never exported or synced. Residual Low.

### H19. Board resets mid-session without a disconnect
As OLD-S H19. Any banner after Ready leads to FAULT and then UNKNOWN. **The detector must accept the EN bare-`sr` banner** (PN §2.2). Residual Low. Verification M (T-S10, with both banner shapes).

### H20. Gantry racks from a mismatched dual motor
Unchanged (OLD-S H20).

### H21. Program stop treated as idle
As OLD-S H21:
- a session-level "job active" state overrides the firmware's idle class;
- the PROGRAM_PAUSED state exists;
- mutations need all of: stat ∈ {1,4}, no job, `qr` = plannerBlocks, `vel` = 0, nothing outstanding in RX.

On EN, stat 3 with hold 6 means a firmware pause (PN §8). Residual Low.

### H22. Firmware or setup data from an untrusted source
As OLD-S H22:
- a manifest with pinned sha256;
- approval needs a hash match **and** a signed HIL run of the exact image (D5);
- the client re-hashes;
- strict parse;
- no local-file flashing in v1.

The edge-next image must be published as a reviewed GitHub release first (D6). Residual Low.

### H23. Tool change or program stop with the spindle live
| Field | Content |
|---|---|
| **Cause** | M6 does not pause on any TinyG build. **M0/M60 do not pause on TG** (PN §9.2), so the machine keeps cutting. On EN, M0 pauses with the spindle still on. |
| **Rating** | S4, L3 |
| **Mitigations** | Preflight blocks M6 unless the user accepts C14. C14 makes the sanitiser insert `M5`, `M9`, `M0` before each M6, and the streamer treats that M0 as a **host barrier** (H36): feeding stops after it and the streamer waits for drain. PROGRAM_PAUSED is entered only once the barrier has drained. It shows W17. Resume needs C9 plus a separate spindle-restart confirmation. |
| **Residual** | Medium. The inserted M5 is queued and runs only when reached. A file edited outside the tool is not protected. |
| **Verification** | U: golden tests. M: barrier present before every M6 and no line after it is sent before drain. H: HIL-3.5 on both dialects. |

### H24. Session normalisation breaks another sender
As OLD-S H24. Persisted reporting keys on EN are `ej, jv, js, tv, qv, sv, si, ex, rxm` and `se00..se29` (PN §12.2). **The default plan on EN normalises nothing.** The default `sr` already contains `line`, and run does not write `jv`, `qv`, `rxm` or the `sr` list. Any future normalisation is consented, uses W19, and is restored on disconnect, with C17 recovery. `os` (and the proposed `hbt`) are session-only, so this hazard does not apply to them. Residual Low.

### H25. A second program commands g2 through the other CDC port
Unchanged (OLD-S H25). Phase 7.

### H26. Temporary homing search distance left in EEPROM
As OLD-S H26 and §4.5a. The `pendingRestore` record is **device-local** (IndexedDB `device-safety`) and is **never** cleared by logout, account switch or Clear-Site-Data (§4.10 rule 7). Phase 4.

### H27. A revoked app version keeps driving machines
Revised in red-team round 2:
- `safety-advisory.json` is **signed** with the offline release key (as `approved-builds.json` is, RUN_PLAN §6.3) and fetched with `no-store` from run.synthetos.com at every LIVE entry.
- A verified copy is cached in `device-safety`. If the fetch fails, the cached copy is used while it is younger than **7 days**. After that, LIVE is refused (fail closed). This bounds how stale a safety verdict can be for a session that is already connected when the network drops. Under D1 (sign-in required) a new Connect or Start needs a reachable identity service anyway, so the offline shell (P6-04) offers preview, cached library and wiring only, never new machine sessions.
- A revoked version, or an expired or unverifiable advisory, refuses LIVE.
- **While connected, the main thread re-fetches the advisory every 15 minutes.** On revocation it denies new Arm, Start and jog and shows a banner. It **never interrupts a running job, a hold or any stop-class intent**.

The API also refuses mutating calls from revoked app versions (advisory only, not security). Residual Low.

### H28. Facts outlive the hardware they describe
As OLD-S H28:
- `switch.*` facts are re-confirmed once per LIVE session;
- `dir.*` and `scale.*` show their age and are re-checked after 30 days.

Facts are device-local and never synced (H34). They are **bound to (machine id, board id, deviceHash)**, not to the board alone. Moving a board to another machine, or selecting a different machine for the same board id, invalidates `dir.*`, `scale.*` and `homing.*` (H38). Residual Medium.

### H29. Account takeover changes stored profiles or G-code (NEW)
| Field | Content |
|---|---|
| **Cause** | A stolen GitHub account, a phished session, or a hijacked session (H42). The attacker edits a profile (polarity, travel, homing direction) or replaces a G-code file version so that the next run crashes the machine or injures the operator. |
| **Rating** | S4, L2 |
| **Mitigations** | §4.10. **Profiles are never applied automatically**: on connect the stored profile is only compared, and any difference since this browser last applied it shows a key-level diff with author device and time, then goes through the write pipeline with typed C5 for polarity, homing, switch and travel keys. **G-code carries a device-local trust anchor** (NEW / CHANGED / SAME, H39) that the server cannot forge. Profile and file revisions, **operations and file head pointers** are append-only and record the author session and device. **Provenance is written by the server from the authenticated session and is never accepted from the client** (RUN_PLAN §4.2). "Made on this computer" is shown only when the revision carries a signature that verifies with this browser's non-extractable device key; everything else is "made elsewhere". Edits from a session id that this browser did not record itself raise W24. A settings backup restored to a board at factory defaults is diffed against this browser's own pre-flash snapshot, not against the defaults (H47). The account page lists sessions and offers "sign out everywhere". Step-up re-authentication is required for identity changes. GitHub 2FA is recommended in the sign-in copy. |
| **Residual** | Low. A user who confirms an attacker's diff without reading it is not protected; W24 and the diff make that hard to do by accident. |
| **Verification** | E: T-S42 (no auto-apply: connect with a newer cloud revision → zero settings writes in the transcript), T-S43 (CHANGED state and diff). S: revision immutability. |

### H30. Server or storage compromise serves altered content (NEW)
| Field | Content |
|---|---|
| **Cause** | A compromised D1 or R2, an API bug, or a malicious insider serves altered G-code, profiles or backups with matching metadata, while the client code is still the reviewed code. (Compromise of the Worker code, its assets, the deploy path or DNS replaces the client itself: that is H46.) |
| **Rating** | S4, L1 |
| **Mitigations** | Against altered **data** served to an honest client: the device-local trust anchor (H39), keyed by machine and operation and computed from the locally recomputed hash, so altered content shows as CHANGED or NEW; device-signed provenance (H29); every load re-runs the sanitiser and preflight locally (`client_analysis_json` is never trusted); no auto-apply; no server-to-machine channel; restore baselines from local snapshots (H47). Data access by staff is break-glass only and audited, and Cloudflare dashboard roles on the run account are restricted (RUN_PLAN §9.4). **Every one of these is JavaScript on run's own origin. If the Worker code, its assets, the deploy path or DNS for run.synthetos.com are compromised, all of them are defeated**: the malicious code holds the origin's serial grant, can rewrite `device-safety` and renders its own confirmations. That case is H46, rated S4, and its controls are operational, not in-page. |
| **Residual** | Low for altered data. For replaced code, see H46. |
| **Verification** | E: T-S43 with a tampered server fixture. R. |

### H31. Session or network loss mid-job (NEW)
| Field | Content |
|---|---|
| **Cause** | A session expires, the user signs out in another tab, an identity outage, a 401, or loss of Wi-Fi while a job runs. |
| **Rating** | S4, L2 (the hazard is the software reacting, for example pausing, reloading or disabling the stop button) |
| **Mitigations** | **The machine worker contains no network code** (enforced by lint and dependency rules). A job streams only from an in-memory copy that was verified and preflighted before Arm. Auth state lives in the main-thread UI layer only. A 401 while LIVE shows W22 and nothing else. Sign-out and account switching are disabled while LIVE. The app never reloads itself. Sync pauses while RUNNING or HELD. |
| **Residual** | Very low. |
| **Verification** | E: T-S44 (expire the session, sign out in a second tab, and cut the network during a streamed job on the mock device: zero changes to the TX stream). H: HIL-3.8 on the bench. |

### H32. Same-site request forgery from another synthetos.com host (NEW)
| Field | Content |
|---|---|
| **Cause** | Every `*.synthetos.com` host is same-site, so SameSite cookies do not stop requests from synthetos.com, the forum (archived user HTML), or a legacy or compromised subdomain. Bluehost malware-host records existed in the zone as recently as 2026-10-29. |
| **Rating** | S3, L2 |
| **Mitigations** | Host-only `__Host-` cookies (never `Domain=.synthetos.com`). On every state-changing request: the Origin header must match the app's own origin exactly; a required custom header (`X-Synthetos-Request: 1`), which forces a CORS preflight that is never answered; JSON or octet-stream bodies only; and no state change on GET. No CORS headers at all. `frame-ancestors 'none'`. |
| **Residual** | Low. Even a successful forgery cannot move a machine (§4.10). |
| **Verification** | S/E: T-S45 CSRF matrix (forged POSTs from a synthetos.com test page are refused). |

### H33. Wrong account's data on a shared computer (NEW)
| Field | Content |
|---|---|
| **Cause** | Two people use one shop PC. One leaves the account signed in, or a profile from account A is used with account B's machine. |
| **Rating** | S3, L2 |
| **Mitigations** | IndexedDB is partitioned: `device-safety` (account-independent: pending restores, facts, trust anchor, last-applied revisions per board) and `cloud-cache:<userId>` (cleared on logout or switch). Logout and account switching are refused while LIVE. A profile's bound device must match the connected board, a non-overridable gate. Logout never clears `device-safety` (Clear-Site-Data never includes "storage"). The safety bar shows the signed-in account name. |
| **Residual** | Low. |
| **Verification** | E: T-S46. |

### H34. Cloud-synced facts open gates on another computer (DESIGNED OUT)
| Field | Content |
|---|---|
| **Cause** | If commissioning facts (`dir.x.verified`, `switch.*`) synced through the account, a fact attested on one computer could unlock motion on another for a machine nobody re-checked. |
| **Rating** | S4, L2 |
| **Mitigations** | **Facts, confirmations, overrides, E-stop acknowledgements and pending restores are never uploaded** (§4.10 rule 3). Cloud profiles arrive like imports: facts need re-verification and the board must be re-bound. The account may store the date and version of the user's last full C1 acceptance **for display only**. It never satisfies C1. |
| **Residual** | None by design. |
| **Verification** | U: T-S47 (the sync payload schema has no fact fields; a server returning facts is ignored). S: the API rejects unknown fields. |

### H35. Buffered program end clears an alarm (EN, E135) (NEW)
| Field | Content |
|---|---|
| **Cause** | On EN, a standalone `M2`, `M30` or `N<k> M30` line clears ALARM (PN §9.3). E145 keeps host input after an alarm, so a program-end line already in the RX buffer can silently clear an alarm the operator has not seen. |
| **Rating** | S3–S4, L2 |
| **Mitigations** | The streamer **holds back the final M2/M30** until every earlier line is acknowledged and the state is not an alarm. Preflight blocks M2/M30 anywhere except the last motion-relevant line. An alarm during a job is FAULT, which stops feeding at once, so no later line is sent. |
| **Residual** | Low. |
| **Verification** | M: T-S48. H: B-M30-1. |

### H36. Program stop does not stop the machine (TG) (NEW, correction)
| Field | Content |
|---|---|
| **Cause** | On stock 440.21, M0, M1 and M60 do not pause (PN §9.2). The old plan's C14 "pause for the tool change" would not stop a 440.21 machine. |
| **Rating** | S4, L3 |
| **Mitigations** | On every TinyG dialect, M0, M60, M1 (when optional stop is enabled) and the inserted tool-change stop are a **host barrier**. The streamer sends nothing after that line until drain is confirmed (stat 3/4, `qr` = plannerBlocks, `vel` = 0). Then PROGRAM_PAUSED. On EN the firmware pause is a second layer. |
| **Residual** | Low. |
| **Verification** | M: T-S49 on both dialect models. H: HIL-3.5 (TG: the machine stops at the barrier even though the firmware would not). |

### H37. Reads with side effects (E138, plus `md`) (NEW)
| Field | Content |
|---|---|
| **Cause** | On EN, a GET of `alarm`, `panic` or `shutd` performs the action. A GET of `me` energizes the motors. **A GET of `md` de-energizes all motors, so Z can drop.** A GET of `er` fakes an exception. A GET of `clear` or `clr` clears an alarm. Any SET of `boot` enters the bootloader. `md` behaves the same on TG (PN §12.3). A status poll or a "read all settings" feature could trigger any of these. |
| **Rating** | S4, L2 |
| **Mitigations** | **Reads come only from a generated, reviewed, per-dialect allowlist** (PN §12.3). Group reads are allowed. `clear` is sent only by the C13 intent. The console cannot issue JSON GETs outside the allowlist. Design-out: D7, fixing E138 in firmware. |
| **Residual** | Low. |
| **Verification** | U/M: T-S38 (fuzz every read path; no non-allowlisted token is ever emitted). R (CODEOWNERS on the allowlist). |

### H38. Wrong profile applied to a machine (NEW)
| Field | Content |
|---|---|
| **Cause** | A user has several machines or boards. TinyG board ids can **collide**: they are built from the lot number plus 3 × 5 bits of wafer coordinates (EN hardware.c:123-144). Any device can report any id. A profile written for a router is pushed to a plasma table. A board is moved between machines. |
| **Rating** | S4, L2 |
| **Mitigations** | A `board_id` match only **suggests** a profile; several matches mean the user picks. There is never a cross-user lookup. The profile's `boundDevice` (id + family) must match, a non-overridable gate. The machine name and photo or label are shown in the safety bar. Any difference between profile and board is shown as a diff and needs C19. The `deviceHash` drift check (OLD TOOLS_PLAN §5.2) leads to NEEDS_REVIEW. Profiles for another firmware schema are never pushed across schemas. |
| **Residual** | Low-Medium. Two machines with colliding board ids and similar profiles rely on the user reading the machine name. |
| **Verification** | M: T-S21, T-S50 (two machines, same board id: no automatic selection). H: HIL-1.4. |

### H39. Malicious or corrupted stored G-code (NEW)
| Field | Content |
|---|---|
| **Cause** | Corruption in storage or transit. A tampered file version (H29, H30). A file name spoofed with bidi overrides ("cn.efas"). An old file version run by mistake. |
| **Rating** | S4, L2 |
| **Mitigations** | Content addressing: SHA-256 of the raw bytes. **The client re-hashes after download (after gunzip) and stops hard on a mismatch** (not confirmable). The whole file is loaded locally before Arm; **streaming from the network is forbidden**. Arm binds to the hash and re-hashes the in-memory copy. The arm panel shows name, size, line count, short hash, uploaded when and from which device, whether this is the newest version of the file ("this is not the newest version" otherwise), and the trust-anchor state: SAME / NEW / CHANGED. **The trust state uses the hash computed locally after decompression, never `file_versions.sha256` from the server.** It is keyed by (machine id, board id, local sha256, project id, operation id, tool-note hash), so SAME means "the same content for this operation on this machine". Content seen before in a different operation or project shows "seen before, in a different operation or project" and needs C20. Decompression is streamed with a hard byte cap equal to the expected size, and library downloads and decompression are denied while RUNNING, HELD, BARRIER_DRAINING or STOPPING_JOB, so a decompression bomb cannot crash the tab mid-job (H1). NEW and CHANGED require C20 with the full preflight report; CHANGED offers a line diff. Display names are sanitised (C0/C1 controls, bidi overrides U+202A-202E and U+2066-2069, zero-width characters) and rendered with `textContent` inside `<bdi>`. The sanitiser and preflight always run locally. |
| **Residual** | Low. |
| **Verification** | U: T-S51 (hash mismatch → hard stop; name sanitiser). E: T-S43. |

### H40. Shared or foreign G-code and profiles (NEW)
| Field | Content |
|---|---|
| **Cause** | A file or profile from another user, the forum, or a "share" link. It may be malicious, or written for another machine or dialect. |
| **Rating** | S4, L2 |
| **Mitigations** | **No sharing at launch** (D20). When sharing is added, a shared item arrives as a **copy** in the recipient's account with provenance ("from @x"), the state forced to NEW, and the full sanitiser and preflight applied. Shared profiles carry no facts. No deep link, URL parameter or forum link may load, select or arm a job or apply a profile. |
| **Residual** | Low. |
| **Verification** | E: T-S52 (deep links open a project page only; nothing is armed or selected). |

### H41. Stale or concurrently edited cloud configuration (NEW)
| Field | Content |
|---|---|
| **Cause** | A profile edited in two tabs or on two computers. A cached copy older than the head revision. The cloud draft and the board diverge after a change made with another program. |
| **Rating** | S3–S4, L2 |
| **Mitigations** | Revisions are append-only with compare-and-set on `parent_rev`: a conflict returns 409 and is shown as a diff, never last-write-wins. On connect, the **board is the source of truth** for what the machine will do. The cloud profile is a draft to compare against, and `deviceHash` drift leads to NEEDS_REVIEW. The local record of "revision last applied to this board from this browser" drives the "profile changed since your last session" banner (W23). Offline edits queue, and conflicts produce copies. |
| **Residual** | Low. |
| **Verification** | S: concurrent-edit test (409). E: T-S53. |

### H42. Session hijack and token theft (NEW)
| Field | Content |
|---|---|
| **Cause** | A stolen session cookie (malware, a shared computer, XSS), session fixation, an open redirect, or interception of an OAuth code. |
| **Rating** | S3, L2 (S4 if combined with H29 and a careless confirmation) |
| **Mitigations** | 256-bit opaque session tokens, stored hashed in D1. `__Host-` HttpOnly Secure cookies (run SameSite=Strict, accounts Lax). PKCE and `state` on both legs, with `state` **bound to the browser** by a `__Host-` pre-auth cookie nonce on each leg (this stops login CSRF). Single-use auth codes valid for 60 s, bound to client, redirect and challenge. Exact `redirect_uri` match. `return_to` limited to same-origin relative paths (`^/(?![/\\])[a-z0-9/_-]*$` plus a `new URL()` origin check, stored server-side with the state). Step-up passes only when the re-authenticated provider subject matches an identity already linked to the user. `Referrer-Policy: no-referrer` (accounts pages that carry a form use `same-origin` so the browser sends a real Origin to the exact-Origin CSRF guard; `Origin: null` is never accepted; RUN_PLAN §6.4). Idle and absolute session expiry. Instant revocation (D1, not KV). Session list, "sign out everywhere", and a new-device notice. No GitHub tokens are stored anywhere in the identity layer. And §4.10: a hijacked session cannot move a machine. |
| **Residual** | Low. |
| **Verification** | S: auth test suite (code reuse, wrong verifier, wrong redirect, revoked session). E. |

### H43. Software stop ignored during a dwell (NEW)
| Field | Content |
|---|---|
| **Cause** | On EN (and probably TG; B-FH-1), `!` does nothing during a G4 or spin-up dwell, because the motion state is STOP (PN §8). The operator presses Stop and nothing happens until the dwell ends, and then the next move starts. |
| **Rating** | S3–S4, L2 |
| **Mitigations** | When the executing line is a dwell (EN: `line` in `sr`; TG: the host model), the safety bar shows W26 next to the stop button and highlights **Stop job**. On EN that is ^D, which ends the dwell at once and turns the spindle off. On TG it is the flush sequence, which waits for the dwell to end. `!` is still sent and is re-sent when motion starts, so the hold takes effect at the first move. |
| **Residual** | EN Low. TG Medium (no immediate dwell abort exists on TG). |
| **Verification** | M: T-S54. H: HIL-2.7 (B-FH-1). |

### H44. Stock edge-0.97 misclassified as edge-next (NEW)
| Field | Content |
|---|---|
| **Cause** | Stock edge-0.97 and edge-next both report `fb` 449.01 today. Stock 449 has E094 (a line-mode wrap overwrites queued lines), E019 (alarms leave the spindle on), E042 (unknown words alarm), E162 (silent splice), E045 (shutdown cannot be cleared), E033 (no RUN state), E104 (bad `hp`) and E096 (^D ignored). |
| **Rating** | S4, L2 |
| **Mitigations** | Classification uses the capability probe (PN §2.3) plus the manifest, never `fb` alone. Stock 449 is READ_ONLY. Edge-next is released under a new build number (D4) with `fbs` and `cap` tokens. |
| **Residual** | Low. |
| **Verification** | U: T-S55 (classifier fixtures). H: B-PROBE-1. |

### H45. Unreviewed code obtains a serial grant through another origin (NEW)
| Field | Content |
|---|---|
| **Cause** | Workers preview URLs, `workers.dev`, staging hosts, or a percentage rollout serving mixed versions. Each preview origin gets its own serial permission and could run unreviewed code against a real machine. |
| **Rating** | S4, L1 |
| **Mitigations** | `workers_dev: false` and `preview_urls: false` on the run Worker. Staging sits behind Cloudflare Access and runs only attested artifacts from `main`. No gradual deployments; deploys are 100%. `serial=()` on every Synthetos origin except run (and staging for the bench). |
| **Residual** | Low. |
| **Verification** | R. A post-deploy smoke test confirms the preview URL is disabled and that the headers are correct. |

### H46. Deploy, DNS or Cloudflare-account compromise serves malicious code with the serial grant (NEW, red-team round 2)
| Field | Content |
|---|---|
| **Cause** | Anyone holding an account-wide Cloudflare credential deploys a new run Worker or swaps its assets. That includes the owner's local `wrangler login` token, another project's deploy path (forumbot, built by a separate workflow) and any over-scoped API token. Or anyone who can edit the synthetos.com zone, or hijack it at the registrar, points `run` at their own server and gets a DV certificate. The zone held Bluehost malware-host records as recently as 2026-10-29 (H32). The Web Serial grant belongs to the origin, so the attacker's code inherits every user's grant. |
| **Rating** | S4, L1 |
| **Mitigations** | 1. run and accounts live in a **separate Cloudflare account** (D34). Its only API token is the CI deploy token, scoped to Workers Scripts:Edit for those scripts. Owner dashboard access requires a hardware security key. The site, forumbot and any local wrangler login have no access to it. 2. DNS-edit permission is removed from every day-to-day token. Registrar lock and DNSSEC are on. A CAA record limits issuers. Certificate Transparency monitoring alerts on any certificate for `run.`, `accounts.`, `staging.run.` or `staging.accounts.` that CI did not expect. 3. Every Cloudflare audit-log event for the run and accounts Workers (deploy, version, route, custom domain) that did not come from the CI token raises an alert. 4. The service worker (Phase 6) is registered with `updateViaCache: 'none'` and its script is served `no-store`. The incident runbook keeps a CI-deployable self-unregistering service worker, because a malicious service worker installed during an incident would otherwise survive the fix (`Clear-Site-Data: "storage"` is never used). 5. CI supply-chain controls (RUN_PLAN §6.2). 6. The hardwired E-stop (W1). |
| **Residual** | Medium. In-page controls cannot help against replaced code. /safety/ says so (§7 item 11). |
| **Verification** | R: account, token and role audit at each release; the post-deploy smoke test checks DNSSEC, CAA and the expected certificate issuer. A drill of the self-unregistering service worker before Phase 6. |

### H47. Wrong or forged settings backup restored after a flash (NEW, red-team round 2)
| Field | Content |
|---|---|
| **Cause** | After a flash the EEPROM is at factory defaults, so a diff against the board lists every key and a wrong backup does not stand out: one from another machine, from a colliding board id, or a `pre-flash` row inserted after an account takeover. Meanwhile the default `spep=1` switches an active-low spindle relay or VFD enable ON until the restore (H11). A tab crash between flash and restore leaves no record that a restore is pending. |
| **Rating** | S4, L2 |
| **Mitigations** | 1. The mandatory post-flash restore pre-selects and locks the **device-local snapshot taken in this flasher run**; its hash is kept in `device-safety`. Cloud backups are never the default source. 2. The diff is shown against that pre-flash snapshot. When a cloud backup or profile is applied to a board at defaults, the diff is against the last local snapshot or last-applied revision for this machine, never against the board. With no local baseline the dialog says "No baseline on this computer — every value below came from your account" and needs a typed review of the high-risk keys. 3. Choosing any other backup is an explicit choice that shows machine name, photo, board id, `fb`, date and provenance ("made on this computer" only with a valid device signature). 4. A `flashRestorePending` record in `device-safety`, handled like H26, forces the restore first on the next connect to that board. 5. Spindle and VFD mains stay isolated until the restore read-back confirms `spep`/`spdp` (C6 box, W28, blocking post-restore checkbox). 6. C18 is a **hard stop** when the snapshot has `spep=0` or the profile or wiring says the enable is active-low. |
| **Residual** | Low. |
| **Verification** | M/E: T-S71, T-S72. H: HIL-5.7. |

### H48. Job ends, or waits, with the spindle commanded on (NEW, red-team round 2)
| Field | Content |
|---|---|
| **Cause** | A file with no M5, M2 or M30 reaches its end with the spindle or coolant commanded on, the UI shows "done", and the operator reaches in. A hold left without a time limit with the spindle on (H16). |
| **Rating** | S4, L3 |
| **Mitigations** | Preflight blocks a file whose final commanded state has the spindle or coolant on, unless the user accepts C22, which appends `M5` and `M9`. On EN a final M2/M30 counts as off, because program end stops the spindle and coolant (EN canonical_machine.c:2034-2074). On TG this is UNVERIFIED (B-M2-1), so `M5 M9` are also offered before a final M2/M30 when the spindle is on. DONE shows the commanded spindle and coolant state. The hold timeout (§4.4) covers holds. |
| **Residual** | Low. |
| **Verification** | U: T-S76. M. |

### H49. A partial line left by a previous sender is completed and runs (NEW, completeness critic)
| Field | Content |
|---|---|
| **Cause** | A previous host (a crashed tab, CNCjs, a script) died part-way through writing a line, so the controller's RX ring holds the start of a line, for example `G0 X1` of `G0 X100`. The FT230X has no DTR→RESET path, so connecting does not reset the board. The first newline the new session sends completes that fragment, and it runs as a different command. A partial `$` text-mode line could also write a setting. |
| **Rating** | S3–S4, L1 |
| **Mitigations** | 1. run's own Transport writes one complete line per awaited write and never a newline after a failed write (H2b), so run itself does not leave fragments on a clean close. 2. **The first line written at connect is `{"sr":null}`.** A spliced G-code fragment then fails to parse on both dialects and the whole block is rejected before execution (EN gcode_parser.c:152-158, E161; TG gcode_parser.c:172-197, 403-405; PN §2.3 step 0). 3. **(Amended 2026-11-02, bench measurement.)** A reply to that first line that carries no `sr` key (a G-code reply, `{"r":{},"f":[...]}`) means a leftover fragment joined it: the session classifies **ORPHANED_MOTION** (only `!` and "Use your E-stop"; no further probe). This covers both the rejected case and the case where the joined line RAN: a fragment ending in a comment (`G0 X0.5 (rough`, `G0 X0.5 ;rough`) runs on edge-next and 440.21 whatever the guard line, and no host prefix prevents it. Only an error reply that does carry `sr` is repeated once, as before. 4. The `deviceHash` drift check after the read (§3 READING) shows any setting changed by a spliced text-mode fragment as NEEDS_REVIEW. 5. W6 and the UNKNOWN overlay after an abnormal end tell the user to check the machine; the safety page recommends power-cycling the controller after another program crashed. |
| **Residual** | Medium: a leftover fragment ending in a comment is executed by the board before run can see anything; run detects it (no `sr` in the reply) and stops at ORPHANED_MOTION, and the hardwired E-stop is the control. **(Amended 2026-11-02, E195 merged.)** The firmware-side fix is merged to edge-next (97321391, the EN pin): a line in progress that has had no byte for about 1 s is taken as left by a host that went away, and a `{` after it starts a fresh line; the stale start is dropped and never runs (EN xio/xio_usb.c:44-49, :248; xio/xio_usart.c:343-346). It is a framing heuristic, not a guarantee: it acts only after about 1 s of quiet and only when the next byte is `{`. The host-side ORPHANED_MOTION rule (mitigation 3) therefore stays for every dialect: 440.21 and edge-next builds before 97321391 have no such reset, and a fragment followed by the connect line within about 1 s still joins it and can run, as measured below. |
| **Verification** | U/M: T-S86 (the first written line at connect is `{"sr":null}` in every connect path; the test-kit models reproduce the measured table below; every row ends in ORPHANED_MOTION: `p1-03-live.test.ts`, `session-reducer.test.ts`, `firmware-semantics.test.ts`). H: HIL-1.12 (B-SPLICE-1). Bench measurement (2026-11-02), TinyG HIL diagnostic test_leftover_line_reconnect, measured on bench 2 (edge-next d254eb0b, 440.21 d0418390), merged to edge-next (97321391); a partial line, a 0.5 s gap, then the connect line and LF: |

| Leftover fragment | Connect line | edge-next | 440.21 |
|---|---|---|---|
| `G0 X0.5` or `G0 X0.` | `{sr:null}` | rejected (101), no move | rejected (102), no move |
| `G0 X0.5` | `{"sr":null}` | rejected, no move | **RUNS** (X to 0.5) |
| `G0 X0.5 (rough` or `G0 X0.5 ;rough` | either form | **RUNS** (X to 0.5, status 0) | **RUNS** (X to 0.5, status 0) |

In every row the reply to the connect line is a G-code reply `{"r":{},"f":[...]}` with no `sr` key (status 0 plus motion where it ran). run's bare-key `{sr:null}` is the right form (it stops the quoted-form 440.21 case).

### H50. Runaway jog: a lost key-up, pointer-up, focus or frozen page (NEW, Phase 2, 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | A press-and-hold jog whose release never arrives: the pointer leaves the button, the window loses focus while a key is held, the tab is hidden, the main thread freezes, or the release message is lost. TinyG has no continuous jog with cancel, so a host that kept feeding steps would keep the axis moving. |
| **Rating** | S3–S4, L3 |
| **Mitigations** | 1. **The session, not the page, feeds the jog**, one short `G21 G91 G1` piece at a time, and only while the planner holds fewer than the lookahead (`qr` polled after each piece): at most 2 pieces of at most 150 ms each are ever queued, so the machine stops within that much travel after feeding stops. 2. **Keep-alive:** a held jog needs a renewal from the page every 200 ms; with none for 500 ms the session ends the jog on its own (`!`, then `%` once held). A frozen main thread therefore stops the jog. 3. Release, `pointercancel`, `lostpointercapture`, window `blur` and `visibilitychange` to hidden all release the jog in the page. 4. Keyboard jog acts only while the jog panel has focus and the window is focused; auto-repeated key presses are ignored. 5. Releasing ends with `!`, then `%` once the hold is confirmed, so the board is never left held (H56). 6. A single step longer than one piece is fed the same way, so no jog ever queues more than the bound. |
| **Residual** | Low. Overrun after a lost release is bounded by the lookahead plus the 500 ms keep-alive, plus deceleration. |
| **Verification** | U/M: T-S89 (hold, release, focus loss, visibility, keep-alive expiry, maximum lookahead). E: jog hold and release on the fake board. H: HIL-2.2. |

### H51. Jog into an unhomed limit (NEW, Phase 2, 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | Soft limits are skipped for unhomed axes (H3). The owner chose to allow jogging before homing on the bench. |
| **Rating** | S2–S3, L3 |
| **Mitigations** | The homing state is read at connect (`home`) and shown. While not homed, the jog panel shows W34 and every jog confirmation names it. Jog speed is capped (5000 mm/min, and by the firmware's own `fr`). Hard limits and the E-stop remain the protection. An alarm from a limit switch stops all motion (§4.5b, ALARM). |
| **Residual** | Medium on unhomed machines. Low once homed with `sl=1`. |
| **Verification** | U: T-S92 (the warning is part of the decision). H: HIL-2.9. |

### H52. Spindle starts unexpectedly (NEW, Phase 2, 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | A mis-click on Spindle on, a double click, a stale page, or a spindle command sent while something else was planned. |
| **Rating** | S4, L2 |
| **Mitigations** | Spindle on needs C24 ("Spindle will start … Hands clear?") unless the user turned that off for this browser session (the choice is never stored). The intent is allowed only from idle with every motion precondition (§4.5b). `M3`/`M4` carry an explicit S, capped at 100000. The readouts are labelled "commanded" (TinyG measures nothing). Stop job always ends with `M5` and `M9`. |
| **Residual** | Low-Medium: a user who switched C24 off for the session is not asked again. |
| **Verification** | U: T-S92. E: spindle on and off on the fake board. |

### H53. Go to zero crashes Z (NEW, Phase 2, 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | A rapid straight to work zero drags the tool through the stock or a clamp, or Z descends before X and Y have arrived. |
| **Rating** | S2–S3, L3 |
| **Mitigations** | For any move that includes X or Y, Z is first raised in machine coordinates (`G53 G0 Z<safe>`, never lower than where Z already is), then X and Y move (`G90 G0`), then Z descends to work 0 when Z was asked for. Each step waits for polled idle before the next. C25 shows the exact path before anything is sent. The work offset is shown next to the controls. |
| **Residual** | Medium: a safe height that is wrong for the setup is the user's choice. |
| **Verification** | U/M: T-S91 (the order of lines, the idle wait between them, Z never lowered first). E: go to zero on the fake board. |

### H54. Connection lost mid-jog (NEW, Phase 2, 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | USB unplugged, the tab crashes, or the board resets during a jog. |
| **Rating** | S3, L2 |
| **Mitigations** | The board keeps only what is queued: at most the jog lookahead (H50), never a long move (a long step is fed in pieces). LOST stops the feeder at once and shows W3. The next connect is UNKNOWN; motion needs "I've checked the machine" (`positionVerify`) first. The firmware watchdog (D8 phase B) is not built and is not relied on. |
| **Residual** | Low. |
| **Verification** | M: T-S89 (LOST ends the feeder, nothing more is written). H: HIL-3.6 adapted to jog. |

### H55. Two tabs drive motion (NEW, Phase 2, 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | A second tab of the same browser on the same machine. |
| **Rating** | S3, L2 |
| **Mitigations** | Only the tab that holds the machine Web Lock has a worker connection to the port. Other tabs get Pause and Stop job requests only, and the worker accepts only stop-class messages on the BroadcastChannel (§4.3), so a second tab can never jog, zero or start the spindle. |
| **Residual** | Low. |
| **Verification** | E: T-S73. |

### H56. Stale state after `!` (NEW, Phase 2, 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | After a feedhold the page shows the last report, which can still say "moving" or "idle"; filtered reports may never repeat a value; a `%` sent before the hold has finished is ignored, which would leave the board held with moves queued. |
| **Rating** | S2–S3, L3 |
| **Mitigations** | Stop and release decisions use polled `stat`, `hold`, `vel` and `qr` (§4.2), never the last report. `%` is written only after two polled reads show the hold complete (`hold` 6) or the machine already at rest, and only after every written line has been answered (no line is cut). After `%` the session waits for `hold` 0 and an empty planner before it reports "Stopped" or returns to idle; a timeout is W12 and FAULT. No message says "requested": the page shows "Paused" or "Stopped" only from polled state. |
| **Residual** | Low. |
| **Verification** | M: T-S90. |
### H57. A settings write lost or merged during the EEPROM stall (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | A persisted write stalls the board while EEPROM is written, and bytes sent meanwhile are lost (firmware maintainer, 2026-11-02, edge-next 6ec70652). A status poll, a read or a second write sent during the stall can be lost whole or in part. The rest of the line can then join the next one, or a write can be dropped without the host noticing. |
| **Rating** | S2–S3, L3 |
| **Mitigations** | 1. **One token at a time:** `{"<key>":<value>}` and LF, one key per line (SAFETY §4.6 as amended). 2. **The session never has more than one line unanswered.** Every line, the pollers' GETs included, waits until the write's answer has arrived (`pump` waits for owed answers). 3. A second write is refused until the first is done: gate, answer and read-back. 4. **Read-back** of the key, compared at the table's precision. A write that went unanswered is `unconfirmed` (STALE), never assumed. 5. The write gate gives settings lines their own command kind (`setting`). It accepts only the exact key and value the session is writing now. |
| **Residual** | Low. The stall length is UNVERIFIED (B-EEPROM-1); the design does not depend on it. |
| **Verification** | U/M: T-S95, T-S98 (test-kit model with the stall: zero bytes lost across writes with reads queued). E: T-S99. H: HIL-4.8. |

### H58. Wrong switch type or switch mode written (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | `st` (normally open or closed, one value for every input on this firmware) or a per-axis `sn`/`sx` mode is written so that it does not match the wiring. Every switch then reads as always pressed or never pressed: a limit no longer stops the machine at the end of travel, and homing never finds its switch or stops at once. A backup from another machine restored by name does the same. |
| **Rating** | S3–S4, L2 |
| **Mitigations** | 1. **High-risk confirmation (typed C5):** each change of switch type or mode is listed with its consequence in plain words, for example "Changing the switch type from normally open to normally closed when the switches are wired the other way means every switch reads as always pressed or never pressed … Test each switch after applying". Each needs its own tick and the word WRITE (schema `changeRisk`). 2. The schema's cross-key rules: all 8 switch modes known, no axis with a homing switch on both ends, at most one probe input, `st` matching a declared switch type. 3. A mandatory backup before the write, and revert. 4. W20 after the write, and the confirmation says to test each switch. The fact store is not yet wired to writes, so `switch.*` facts are not yet invalidated automatically (§4.6 step 8 as amended); until it is, the switch test is a step the user is told to do, not one that is enforced. |
| **Residual** | Medium: run cannot see the wiring. The confirmation and the switch test are the controls. |
| **Verification** | U: T-S96. E: T-S99 (the high-risk confirmation is shown and blocks until ticked and typed). H: HIL-4.9. |

### H59. Motor, axis, travel or homing settings written wrong (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | Motor polarity (`po`), power mode (`pm`), the motor map (`ma`), axis mode (`am`), travel (`tn`/`tm`), soft limits (`sl`) or homing (`sv lv lb zb jh`) is written wrong. An axis then moves the other way, another axis moves, Z drops when its motor is not powered, a disabled axis ignores moves, or the machine runs past its end or homes into a hard stop. |
| **Rating** | S3–S4, L2 |
| **Mitigations** | 1. Every key in these classes is **high-risk**: its consequence is named, it is ticked one by one and the typed C5 is needed. 2. The schema refuses impossible values: ranges, enums, the hardware microstep set, and the travel rules (`tn < tm`, float32 ends and soft-limit semantics, travel.ts). 3. W20 after polarity, motor-map, scale or travel writes, until the commissioning tests run. 4. Backup and revert. |
| **Residual** | Medium, as H58. |
| **Verification** | U: T-S96. H: HIL-4.1, HIL-4.6. |

### H60. Settings written while the machine is not idle, or in inches (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | A write is sent while a move, a hold or a queued plan is active, or while the board works in G20. The firmware may refuse the save but keep the RAM value: EN 106 plus `er`, TG `er` 9 with status 0 (EN-SETTINGS-GATE, TG-SETTINGS-GATE). Or a length setting can be written and read in inches. |
| **Rating** | S2–S3, L2 |
| **Mitigations** | 1. The allow-matrix allows `settingsWrite` only in an idle-class base state: IDLE_* or CONNECTED_UNKNOWN (amended), with no overlay but NEEDS_REVIEW. UNKNOWN, ORPHANED_MOTION, FAULT, STALE, READ_ONLY and LOST all deny it. 2. **Immediately before each write**, the session reads `stat`, `hold` (where the dialect trusts it), `vel`, `qr` and `unit`. Nothing is written unless stat is idle or end, hold is 0, vel is 0, `qr` equals the dialect's bench-verified `plannerBlocks`, and `unit` is 1 (G21). The matrix is asked again after the gate. 3. An `er` 106 or 9 during the write is a refusal of that write (`rejected`), never a silent success. The value is reverted with the rest. 4. run sends no G-code in the settings path: no G21 and no M400. |
| **Residual** | Low. |
| **Verification** | U/M: T-S97. H: HIL-4.2, HIL-4.3. |

### H61. Communication or identity settings written (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | A setting that changes how the board answers is written: `js`, `ee`, `ec`, `ej`, `ex`, `rxm`, `jv`. Run and other senders then stop understanding the board (echo on breaks the JSON parser). Or an identity or hardware key is written (`fb`, `fv`, `hp`, `hv`, `id`, `baud`), or a read-only readout or the `rt` family: the pin map, the link or the session controls change. A restored backup carries all of these. |
| **Rating** | S2–S4, L2 |
| **Mitigations** | 1. The forbidden-write list (PN §12.4: `hv baud ex ej js=0 jv qv fd rxm rt*`, `boot`, `defa`, `se00..se29`, `jog*`) is enforced by the schema, the session and the write gate. 2. Only keys with a reviewed overlay entry can be written. `js`, `ee` and `ec` have none, so no communication setting is writable today, and the Communications view stays read-only with the reason given. 3. A restore maps by token name and skips identity keys (`fb fbs fv hp hv id baud`), readouts (`spe spc spd sps cof com`), `rt*` and every forbidden or unreviewed key, listing each with its reason. 4. If a communication key ever becomes writable, it is written after every other key, and `jv` very last (schema `orderWrites`), with a high-risk confirmation. |
| **Residual** | Low. |
| **Verification** | U/M: T-S95 (forbidden and identity keys refused at the intent and at the gate), T-S96 (ordering). |

### H62. A partial apply leaves the board between two configurations (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | A multi-key apply stops part-way: a refusal, a mismatch, the link dropping or a tab closing. Some keys hold the new value and some the old, and the user may not know which. |
| **Rating** | S2–S3, L2 |
| **Mitigations** | 1. **A mandatory backup before the first write:** every allowlisted group is read and saved on this computer (`device-safety`) and offered as a download. If the backup cannot be completed, nothing is written. 2. The plan is screened as a whole before anything is written: one refused value refuses the plan. 3. **Stop at the first failure:** the remaining steps are marked "not written". 4. **Revert** writes the backed-up values back through the same path, one token at a time with read-backs. It covers every step that was written or may have been (verified, mismatched, unconfirmed, interrupted or rejected). 5. After any write, the settings are read again, and that read becomes this computer's reference. 6. Per-token results are shown during the run. |
| **Residual** | Low-Medium: a tab closed mid-apply leaves the board partly written. The downloaded backup and the drift check on the next connect (NEEDS_REVIEW) show it. |
| **Verification** | U: T-S99. E: T-S99 (fake-serial: apply, backup downloaded, read-back verified, revert). |

### H63. Settings writes reach production, or an unapproved build, before review (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | A build flag, a release object or a dialect check lets settings writes run on the production origin, or on a board whose firmware is not approved. |
| **Rating** | S3, L1 |
| **Mitigations** | 1. A single phase switch, `SETTINGS_WRITES = { staging: true, production: false }`, pinned by a test. The worker derives its environment from its own origin: the production host is production, the staging host and plain-HTTP loopback are staging, and anything else has no environment and stays off. 2. `settingsWrite` has its own matrix kind, `settings`, so a later release that turns on other writes (work zero) does not turn it on. 3. Production also refuses any artifact that carries the serial transport (P1-09). 4. P1-03: the worker classifies against the signed manifest, and a board that does not match an approved build is READ_ONLY, which denies settings writes. |
| **Residual** | Low. |
| **Verification** | U: T-S100. |

### H64. Run rewrites the board's status reporting (NEW, amendment 2026-11-02, push-driven state)
| Field | Content |
|---|---|
| **Cause** | So that the page is driven by pushed status reports instead of polling, run writes the board's status report list (`{sr:{...}}`) and, where needed, `sv` (filtered reports) and an absurd `si` (above 1000 ms). The list, `sv` and `si` are saved in EEPROM, so other senders (CNCjs, ChiliPeppr, scripts) see the change, and a persisted write stalls the board while EEPROM is written (H57). A list that does not carry what run needs leaves the page without position or spindle and coolant updates. |
| **Rating** | S1–S2, L3 |
| **Mitigations** | 1. The owner decided that run may set the list (2026-11-02). It is written **only when the board's list differs** from what run needs (stat, hold, line, vel, feed, unit, coor, dist, work and machine position X, Y, Z, A, and the spindle and coolant readouts), `sv` only when it is not 1, `si` only when absurd; the firmware also compares before it writes EEPROM. 2. One line at a time, each answered before the next (no line is sent during the EEPROM stall), each followed by a read-back GET; a refusal or a read-back that differs is recorded and shown, never assumed. 3. Its own command kind in the write gate (`report`): only the exact shapes, only the step in progress, only run's fields, never a `ram` key, and its own matrix kind (`reports`, `configureReports`) that is on only with the Phase 2 release (bench and staging), never in a read-only release, never to a READ_ONLY (unapproved) board, never under ORPHANED_MOTION, STALE or FAULT, and never in ALARM (the firmware refuses SETs while alarmed; the session configures after Clear alarm). 4. The change is said in plain words in the Run view and the session log (W35; W36 for `sv` and `si`). 5. The heartbeat (`{"rt":{"hb":N}}`) is RAM only and off at every reset; it is turned on only when `{"rt":null}` answers. 6. A RAM-only write mode was designed with the firmware maintainer and is parked; the seam is the one function that builds the steps. |
| **Residual** | Low: another sender sees a longer list and `sv` 1. Nothing moves. |
| **Verification** | U/M: T-S101 (written only when it differs, read back, never `ram`, the gate shapes), T-S107 (the test-kit report model). H: HIL-1.13. |

### H65. Homing with a wrong switch configuration (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | G28.2 drives each axis toward the switch its settings name. A switch set on the wrong end, the wrong switch type (`st`), a switch that is not wired, a reversed motor or a wrong motor map (H59) sends the axis the wrong way or past its switch. |
| **Rating** | S2–S3, L2 |
| **Mitigations** | 1. Run offers homing only for an axis whose settings, as read this session, have exactly one homing switch (mode 1 or 3), a search velocity above 0 and an enabled axis; any other axis is refused with the reason, and nothing is sent. 2. C4 names the axes and says that the machine moves each toward its switch, with the search distance from the controller's settings. 3. Pause and Stop job work during homing: Pause ends the homing (`!`, then `%` once held), Stop job runs the flush sequence; afterwards the axes read not homed. 4. The end of homing is confirmed by two polled reads, then `hom`, `home`, `mpo` and `pos` are read back; IDLE_HOMED only when the board reports X, Y and Z homed. 5. After a switch write, W20 and the switch test (H58). |
| **Residual** | Medium: run cannot see the wiring. The hardwired E-stop and the hard limits are the controls. |
| **Verification** | U/M: T-S104. H: HIL-2.15. |

### H66. Homing crashes into a hard stop (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | The search travels up to `|tm − tn| + lb`. A switch that does not trigger (broken wire, wrong polarity) or travel larger than the machine lets the axis reach its mechanical end at the search velocity. |
| **Rating** | S2–S3, L2 |
| **Mitigations** | 1. C4 states the search distance computed from live values. 2. Pause and Stop job stay in their fixed place, prominent while homing. 3. The bench motors are unloaded on a fixture (§9.1); the temporary search cap is Phase 4 (§4.5a). 4. Homing is never started on its own: only from the confirmation. |
| **Residual** | Medium until the Phase 4 temporary cap ships. |
| **Verification** | U: T-S104 (confirmation text and refusals). H: HIL-2.15. |

### H67. Set machine position (G28.3) puts the wrong position in place (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | G28.3 sets the machine position here without moving and marks the axes homed, so soft limits and every later move trust it. Used on a machine that has switches, or with the tool somewhere else than where the user believes, every machine-coordinate move (go to zero's safe Z, soft limits) is wrong by the error. |
| **Rating** | S2–S3, L2 |
| **Mitigations** | 1. Offered as the alternative when homing is not configured, behind C26, which says to use it only on a machine without switches and that a wrong position makes soft limits and every later move wrong. 2. Its own matrix intent (`setMachinePosition`), allowed from idle and from UNKNOWN (it is a way out of UNKNOWN), never under any other overlay. 3. The new position and homing state are read back; UNKNOWN clears only when the board reports X, Y and Z homed. |
| **Residual** | Medium: the user decides where zero is. |
| **Verification** | U/M: T-S105. H: HIL-2.16. |

### H68. A temporary offset (G92) is mistaken for a saved one, or forgotten (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | G92 shifts the work coordinates without saving anything: a reset or a program end clears it, and while it is in force the saved work offset (G54..G59) is not what positions are measured from. A user who forgets it, or expects it after a reset, sends the tool to the wrong place. |
| **Rating** | S2, L3 |
| **Mitigations** | 1. Shown apart from Set work zero, labelled temporary, with C27 saying it is not saved, that a reset or program end clears it, and that Clear temporary offset (G92.1, C28) removes it. 2. The active offsets are shown: the active system with its saved offset, the temporary offset when non-zero, and the total. 3. Each change is read back (`g92`, `ofs`, `pos`). 4. Set work zero is G10 L20 in the active system (saved, C16) and never G92. |
| **Residual** | Low-Medium. |
| **Verification** | U/M: T-S106. E: the offsets panel. H: HIL-2.17. |

### H69. Push-driven state: a short state missed, or a quiet link taken for a live one (NEW, amendment 2026-11-02)
| Field | Content |
|---|---|
| **Cause** | Pushed status reports are change-filtered and sampled when they print, and only one is pending at a time, so a state that comes and goes between two reports never appears (firmware maintainer, report.c). An idle board says nothing, so silence alone cannot tell a quiet board from a dead link. |
| **Rating** | S2–S3, L3 |
| **Mitigations** | 1. Pushed values drive the display only; every decision (the release and stop sequences, the idle gate before a settings write, the end of homing, the hold check before `%`) keeps its confirming polled reads (§4.2, item 35). 2. A persistent state always appears within about `si` ms, and a pushed report never reflects a write before that write's answer. 3. The heartbeat gives a line every `hb` ms while nothing else prints: no report, heartbeat or answer for the silence window (3 s) is STALE, shown as "No reports from the board" (W4), which blocks every new intent but the stop class. Without the heartbeat the watchdog asks once after 5 s of silence (§4.2). 4. The full state is read once at every connect and reconnect, and every value run changes is read back once. |
| **Residual** | Low. |
| **Verification** | U/M: T-S102, T-S103. H: HIL-1.13. |

---

## 3. Connection and motion state machine

One hierarchical statechart, implemented as a pure reducer in `machine/statechart.ts`: `(state, event) → (state, effects[])`. **Account and cloud state are not part of it.** They live in the UI layer and cannot cause a transition.

Overlay precedence: **FAULT > LOST > ORPHANED_MOTION > UNKNOWN > STALE > READ_ONLY > NEEDS_REVIEW > base state.** ORPHANED_MOTION is new in red-team round 2 (H14).

```
             ┌──────────────── page load (always) ─────────────────┐
             ▼                                                     │
      NOT_CONNECTED ──"Connect" + C1 (this session) + advisory ok──► PORT_REQUEST (user gesture)
        ▲  (W6 previous-session banner must be dismissed first;           │
        │   preview, library, profiles, wiring all usable here)            ▼
        │                                   OPENING (115200, flowControl 'none'; refuse 1200;
        │                                    refuse 2341:003D before open)
        │                                                                  ▼
        │                                   IDENTIFYING (reads only; banner ≤3 s; capability
        │                                    probe PN §2.3; allowlisted GETs only)
        │              stock 449 / unknown / conflict ──► READ_ONLY overlay (+ upgrade offer)
        │              busy (no answer to the first GET, or unsolicited moving sr) /
        │                stat∉{1,4} / hold≠0 / vel≠0 / qr < dialect constant
        │                ──► ORPHANED_MOTION (stop job or reset only; unclassified: `!` only)
        │              id ≠ selected profile.boundDevice ──► BLOCKED (user picks machine)
        │                                                                  ▼
        │                                   READING (allowlisted groups; stat; offsets; qr vs const)
        │              deviceHash ≠ profile, or cloud head rev ≠ last applied ──► NEEDS_REVIEW
        │                                                                  ▼
        │                                   CONNECTED_UNKNOWN (position untrusted)
        │                   ── home(token) or typed "position verified" ──►
        │                                   LIVE_READY {homed axes, fresh}
        │                                                                  │
        │     ┌──────────────── base states under LIVE_READY ─────────────────┐
        │     │ IDLE_UNHOMED ⇄ IDLE_HOMED                                     │
        │     │ JOGGING (one move in flight; EN: M400 barrier) → IDLE_*       │
        │     │ HOMING → IDLE_HOMED | ALARM                                   │
        │     │ SETTINGS_WRITE (§4.6) → IDLE_* (+ CONFIG_CHANGED)             │
        │     │ JOB_LOADED (hash-verified local copy) → PREFLIGHT_OK|BLOCKED  │
        │     │ PREFLIGHT_OK → ARMED (expires 60 s / any change / re-hash)    │
        │     │ ARMED → PREAMBLE (confirmed modal) → RUNNING                  │
        │     │ RUNNING ⇄ HOLD_REQUESTED → HELD (confirmed by sr)             │
        │     │ RUNNING → BARRIER_DRAINING (M0/M60/M1/C14 stop sent; feeding  │
        │     │   stopped) → PROGRAM_PAUSED (drained: stat 3/4, qr full,      │
        │     │   vel 0; spindle "may be running (UNCONFIRMED)")              │
        │     │ RUNNING → END_HOLDBACK (all but final M2/M30 sent) → DONE     │
        │     │   (final line sent only when all acked and no alarm, H35)     │
        │     │ RUNNING|HELD|PROGRAM_PAUSED → STOPPING_JOB (§4.4 per dialect) │
        │     │ ALARM / SHUTDOWN / PANIC / INTERLOCK (dialect-mapped)         │
        │     │ BOOTLOADER_MODE (flasher only, from IDLE gate)                │
        │     └───────────────────────────────────────────────────────────────┘
        │
  any state: disconnect / NetworkError / stream end ──► LOST overlay
  next connect after LOST, discard, reload-while-LIVE, banner-after-Ready ──► UNKNOWN overlay
  watchdog: 2 s unexpected silence ──► STALE overlay (blocks new intents except stop-class)
  FAULT triggers ──► FAULT overlay (latched; ackFault with cause shown)
  NOT_CONNECTED is re-entered only by an explicit Disconnect or after LOST is acknowledged.
```

*Amended 2026-11-02 (push-driven state, homing).* After READING the session reads the machine's full state once (homing per axis, units, coordinate system, distance mode, tool, machine and work position, every offset, the spindle and coolant readouts, `sv` and `si`; the window's settings read takes the saved g54..g59 and the settings) and then configures status reports (H64, §4.2). HOMING is a base of motion sessions: G28.2 sent, ended by two polled reads at rest, then a read-back; it returns to IDLE_HOMED when the board reports X, Y and Z homed. **UNKNOWN has three exits, offered as primary actions in the banner:** "I've checked the machine" (`positionVerify`, which also clears UNKNOWN in a session without motion: it moves nothing), Home machine, and, where homing is not configured, Set machine position here (G28.3, C26). UNKNOWN never traps the user.

**FAULT triggers.** Everything in OLD-S §3:
- an unexpected alarm, shutdown or panic class;
- an `er` report;
- a non-zero footer status during a job;
- an `n` mismatch where `n` is present;
- a garbled frame during a job;
- a broken flow-accounting invariant;
- a write failure;
- STALE for more than 5 s while RUNNING;
- a missed UI heartbeat during a job;
- a banner after Ready;
- an unexpected response.

Added:
- **EN status 13** (damaged line, E162);
- **a response whose `tid` does not match an outstanding request** (EN);
- **a footer revision that changes mid-session** (the board was reconfigured or reset);
- **any reply to a token that is not on the allowlist** (the code path that sent it is the bug).

**FAULT classes** (red-team round 2). Each trigger is one of two kinds:
- **Integrity:** the job's byte stream or the board's state can no longer be trusted, and lines are never resent. This covers an `er` report, a non-zero footer status, an `n` mismatch, a garbled frame, a broken flow invariant, a write failure, a banner after Ready, EN status 13, a `tid` mismatch, a footer-revision change, a reply to a non-allowlisted token, an unexpected response, and an unexpected alarm, shutdown or panic class.
- **Liveness:** nobody may be watching, or the board went quiet. This covers STALE for more than 5 s while RUNNING, and a missed UI heartbeat while the document is visible (H17).

**FAULT entry effects.** The old "send only `!`" left the spindle running in a hold that nobody was watching, so it was revised:
1. Stop feeding.
2. If a job was running or the machine was moving, send the dialect feedhold `!`.
3. **Integrity FAULT during a job:** the job cannot be recovered, so end it at once (the `faultStop` effect). EN: ^D. TG: `%`, then `M5`, then `M9` (the flush sequence, §4.4). For an unexpected EN alarm the firmware has already flushed and turned the outputs off, so ^D is not needed.
4. **Liveness FAULT during a job:** after `!`, show W33 with a countdown, and send ^D (EN) or the TG flush sequence after a **grace period** (default 20 s, range 10–30 s) unless the operator acts. The operator can choose Stop job now, or "Keep paused", which restarts the countdown once and needs a visible document.
5. Show the cause and the line number.
6. Show "STOP NOT CONFIRMED" until a report shows hold, stop, end or alarm.

**Exits:**
- **From FAULT:** `ackFault`. It **cannot complete while `hold` ≠ 0 or the planner is not empty** (checked by polled reads, §4.2). In that case the operator must first use Stop job or Reset controller. Then the session goes to CONNECTED_UNKNOWN if position may have been lost, otherwise to the base idle state. On EN after a Stop job or `!%`, also verify `hold == 0` and `qr == plannerBlocks` (E114) or stay in FAULT with W12. **Resume is never available after a FAULT**: the faulted job can only be ended.
- **From ORPHANED_MOTION:** only Stop job (then C13 on EN and the E114 verification) or Reset controller (C15, then a full re-handshake). Never `~`. While the board is still unclassified, Stop job is `!` plus "Use your E-stop" (never ^D, `%` or M-codes); the overlay stays until the probe classifies the board and its own Stop job, or a reset, has ended the motion.
- **From ALARM:** the user confirms `{"clear":null}` (C13). Re-homing is required when the dialect un-homed the axes (EN limit 203, EN shutdown) or lost position (TG hard alarm).
- **EN SHUTDOWN (stat 12):** `{clear}` with C13 and re-homing (shutdown un-homes, but position is kept, E046).
- **EN PANIC (13), TG SHUTDOWN (11):** reset button, power cycle, or the explicit "Reset controller" action (W16, W18, C15), then a full re-handshake and re-homing.
- **`^X` rule (unchanged):** 0x18 is written **only** as the effect of the `resetController` intent with C15 (T-S26).
- **`^D` rule (new):** 0x04 is written only on `tinyg-en`, and only as the effect of the `stopJob` or `spindleOffNow` intent or of the session's own stop policies derived from them: `faultStop` (FAULT effects 3–4), `holdTimeout` and `dwellStop` (§4.4) (T-S24a). It is never written to TG, stock 449 or a READ_ONLY session.

---

## 4. Fail-safe behaviour

### 4.1 Allow-matrix highlights

**Normative rule (red-team round 2; it overrides any row below).** Feedhold, Stop job and Spindle/coolant off now are allowed in **every connected state and every overlay in which the port is open**: FAULT, ORPHANED_MOTION, UNKNOWN, STALE, READ_ONLY and NEEDS_REVIEW included. They are **never gated by facts, profiles, auth, the advisory, the wake lock or page visibility**. On READ_ONLY sessions the dialect is unclassified, so Stop job and Spindle off map to `!` plus "Use your E-stop" (§4.4), and ^D is never sent there. Home is denied under FAULT, STALE and ORPHANED_MOTION. T-S3 and T-S62 are generated over every overlay × base-state cell to prove it.

| Intent | Allowed when |
|---|---|
| Read (JSON GET) | Any connected state except BOOTLOADER_MODE. **Only allowlisted tokens** (H37). |
| Feedhold (`!`) | Any connected state, including Phase 1 (read-only). Also from non-controlling tabs, through the BroadcastChannel that the machine worker receives directly. Written even under XOFF. |
| Liveness probe (ENQ) | `tinyg-en` only, after classification; any connected state. During the probe, only after a footer revision 2/3 has been seen (PN §2.3). Never on TG. |
| Console line (advanced, MDI) | No earlier than Phase 4. IDLE_* and fresh, no overlay, controlling tab, visible document. G-code only, through the sanitiser and the dialect blocks (no JSON, `$`, realtime bytes or non-allowlisted tokens). A line with motion (G0–G3, G28/G30, G53 motion) or spindle/coolant on is a **one-line generated job**: preflight against the live envelope and WCS (homed axes required, or the unhomed jog caps of §4.5), first feed needs F, the queued-motion ceiling (split per §4.7 step 6a), and a single confirmation naming the end point in machine coordinates and the spindle state. G10, G92 and work-offset changes need C16. A line that would change settings or offsets invalidates preflight and disarms. Never while a job is loaded and armed. |
| Stop job | Every connected state and overlay (normative rule above). EN: ^D. TG: the flush sequence (§4.4). READ_ONLY: `!` only, with "Use your E-stop". |
| Spindle/coolant off now | Any connected state without LOST. EN: ^D when a job is active or the machine is moving; `M5`/`M9` when idle. TG: `M5`/`M9` (queued; the UI says so and offers Stop job). Never gated by facts. |
| Set work zero | IDLE_* and fresh, no overlay, controlling tab, no job RUNNING or HELD; C16. TG: G10 L2 from a post-idle `mpo`. EN: an M400 barrier first; L2 or L20 allowed. Invalidates `job.*.preflight` and disarms. Persisted on the board, which C16 says. |
| Manual spindle/coolant on | IDLE_* and fresh, no overlay, controlling tab, `outputs.spindle` fact, single confirmation naming the speed. Refused while alarmed on EN (outputs inhibited). |
| Optional stop (`os`) | EN: IDLE_*; session-only write; the preview follows it. TG: host-side only. |
| Reset controller (`^X`) | Any connected state except BOOTLOADER_MODE; explicit action after W16, W18 and C15. TG also shows "may not work if the controller is stalled; use the reset button" (E128). |
| Jog | IDLE_* and LIVE_READY and fresh, no overlay, controlling tab, visible document, `dir.<axis>` fact (except the guided first move). |
| Home | IDLE_* and fresh, `dir.<axis>` verified, `switch.<axis>` tested this session; dual-motor axes need both motors verified. Denied under FAULT, STALE and ORPHANED_MOTION. |
| Settings write | IDLE, stat ∈ {1,4}, no job loaded or armed, `qr` = plannerBlocks, `vel` = 0, nothing outstanding in RX, `mots` = 0. EN: an M400 barrier first. *Amended 2026-11-02:* its own release kind (`settings`), on only where the phase switch allows it (staging and the localhost bench). Also allowed in CONNECTED_UNKNOWN, because a settings write moves nothing. Denied under every overlay but NEEDS_REVIEW, UNKNOWN included. The idle conditions are proven by polled reads of `stat`, `hold`, `vel`, `qr` and `unit` (= 1) right before each write, and no other line is outstanding. The M400 barrier is replaced by those reads (no G-code in the settings path). The board must be approved (not READ_ONLY). H57-H63. |
| Apply stored profile | As settings write, plus a diff shown (C19) against the machine's baseline (H47), typed C5 for high-risk keys, bound device matching, and the same firmware schema. Host-gate fields that loosen a gate also need C19 (§4.10 rule 4). **Never automatic.** |
| Load job | Not RUNNING or HELD (no native pickers while running). From the library: download complete and the hash verified locally. Library download or decompression, including previewing another library file, is denied while RUNNING, HELD, BARRIER_DRAINING or STOPPING_JOB; decompression is streamed with a byte cap (H39). |
| Arm | PREFLIGHT_OK; trust state SAME, or C20 accepted for NEW/CHANGED; hash re-checked on the in-memory copy; this version not revoked by the advisory poll (H27). |
| Start | Only from ARMED, with a matching ticket, the tab visible, all job gate facts, no overlay, the screen wake lock held (or C21 accepted), and this version not revoked (H27). |
| Resume (`~`) | Only from HELD or PROGRAM_PAUSED, with a fresh report, unchanged offsets, a named confirmation, and the spindle-restart step where it applies. **Only for a job started by the current session id.** Never after a reconnect, never from ORPHANED_MOTION and never after a FAULT. |
| Flash | As settings write. TG stat 11 or EN stat 12 allowed with confirmation. Never stat 2. |
| Sign out, switch account, delete the armed file, change the selected profile | **Denied while LIVE** (any state other than NOT_CONNECTED or LOST-acknowledged). |
| Destructive `device-safety` operations ("forget this machine on this computer", logout clean-up) | Denied while `navigator.locks.query()` shows any `synthetos-machine:*` lock held by any tab of this browser. |
| Cloud sync | Any state. Pauses while RUNNING, HELD, BARRIER_DRAINING or STOPPING_JOB. Never touches the machine worker. |
| Anything else | Denied under FAULT, ORPHANED_MOTION, LOST and UNKNOWN, except reads, the stop-class intents (normative rule) and, under UNKNOWN only, home and position-verify. STALE: reads and stop-class only. READ_ONLY: reads and stop-class (sent as `!`) only. NEEDS_REVIEW: reads, stop-class, **"Keep the board's settings and update the profile from the board"** (the default resolution, C23, zero serial writes, T-S70) and, as the secondary action, writes that resolve the drift through C19. |
| Enter LIVE | A signed `safety-advisory.json` verified (fetched now, or a cached copy younger than 7 days, H27) and this version not revoked; C1 (or the short re-attestation) accepted **in this browser session**; not a mobile operating system (RUN_PLAN §2.3); the classifier did not return READ_ONLY (otherwise LIVE becomes LIVE_READ_ONLY). |

*Amended 2026-11-02 (Phase 2, owner).* In a Phase 2 session (`PHASE_2_RELEASE`, motion flag on): **Jog** and **Go to zero** are allowed from IDLE_* (and JOGGING for the next piece of the jog already running), with no overlay, an approved build (no READ_ONLY), no ORPHANED_MOTION, no alarm and no job; the `dir.<axis>` fact and the unhomed caps are replaced by W34 while not homed (H51). **Set work zero** is `G10 L20 P1` (persisted on the controller, said in C16) and is a motion-kind intent of this phase, not a settings write. **Manual spindle/coolant on** needs C24 unless turned off for the session. **Clear alarm** (`{"clear":null}`, C13 with the alarm's meaning) is allowed only from ALARM. **Resume** (`~`) only from a hold of motion this session sent. Pause, Stop job and Spindle off stay never gated, in the same place, always enabled.

*Amended 2026-11-02 (push-driven state, homing, offsets).* **Home** (G28.2) is allowed from IDLE_* and from CONNECTED_UNKNOWN under UNKNOWN (and HOMING only for the line being written), for axes whose homing is configured (H65), after C4. **Set machine position** (`setMachinePosition`, G28.3) has the same states and overlays, after C26 (H67). **Temporary offset** (`tempOffset`, G92 and G92.1, C27 and C28) and **Work coordinate system** (`selectCoordSystem`, G54..G59, C29) are allowed from IDLE_* with no overlay. **Set work zero** is G10 L20 in the active system (P1..P6), not always P1. **Report configuration** (`configureReports`, kind `reports`) is the session's own: idle or CONNECTED_UNKNOWN, under UNKNOWN or NEEDS_REVIEW only, never in ALARM, and only with a release that has `reports` (Phase 2) (H64). Each is a separate intent with its own confirmation and read-back.

**UI rules that protect the stop path while LIVE** (OLD-S §4.1, extended):
- No fullscreen while LIVE.
- No native file pickers or selects while RUNNING or HELD.
- The stop button is visible and focusable in every state.
- **The safety bar, stop button and state area are fixed.** They are never covered by drawers, toasts, modals or account UI, and are never user-rearranged.
- No toasts or modals from sync, the forum or marketing while LIVE. Notifications queue until idle.
- "New version available" is a passive chip.

### 4.2 Watchdog

Liveness comes from receive timestamps (OLD-S §4.2).

**EN:**
- `line` in the default `sr` gives the executing line, so expected silence (G4 P seconds + 1 s, spin-up, PROGRAM_PAUSED) is known exactly.
- **ENQ is allowed as a probe while the planner is full.** At most one is outstanding. A missing `ack` within 2 s counts as silence.
- M400 waits are expected silence until their reply.

**TG:** the host-side inference from the last acknowledged host N plus the modelled queue (OLD-S §4.2). No probe while the planner is full.

*Amended 2026-11-02 (push-driven state; owner, from the bench: "on connecting we should get the machine state totally, then the rest is driven by motion sr reports").* Nothing polls while idle. The once-a-second spindle and coolant poll and the `mpo` poll are removed. At connect the session reads the full state once (§3 amendment), sets the status report list run needs where it differs, `sv` 1 and an absurd `si` back to 250 ms, each read back (H64), and turns on the heartbeat (`{"rt":{"hb":1000}}`) when `{"rt":null}` answers (status 100 means the firmware has none). From then on the page follows pushed reports and heartbeat lines; machine position comes from `mpox`.. in the reports. **Liveness with the heartbeat:** no report, heartbeat or answer for 3 s is STALE ("No reports from the board", W4), and nothing is sent to ask. **Without the heartbeat:** after 5 s of received silence the session asks once (ENQ on edge-next, else a `stat` GET); no byte within 2 s is STALE. **Confirming reads that stay:** the polled reads of the stop and release sequences and of a running jog or go-to-zero (§4.4, §4.5b), the idle gate before each settings write (§4.6), the end of homing (two polled reads; a pushed report says when to look, and a check at most once a second covers a missed one), the `ackFault` verification, and the single read-back after every value run changes (a settings write, set work zero, G92, G92.1, G28.3, a coordinate system, homing). The full read runs again after every reconnect.

**Thresholds:** STALE after 2 s of unexpected silence (blocks new intents except stop-class); FAULT after 5 s while RUNNING; LOST on a transport error. Bench validation is B-WD-1, before Phase 3 ships.

**Polled reads (red-team round 2).** EN defaults are `SR_FILTERED` and `QR_OFF` (EN settings_default.h:79, 88), and run writes neither `sv` nor `qv` (D24). Filtered reports do not repeat unchanged values, so "`vel == 0` in two consecutive reports" may never happen, and `qr` never arrives unless asked for. Every check in this document that needs a value therefore uses **explicit polled reads with `tid`**: `{"stat":null}`, `{"vel":null}`, `{"hold":null}`, `{"qr":null}`, and the `{"mpo":null}` group.
- **Cadence:** every 250 ms during stop verification and barrier drain; every 500 ms for `mpo` while RUNNING (each poll counts as one line in flight and is skipped when the flow budget is full); once per second for `hold` and `qr` while HELD or PROGRAM_PAUSED.
- **Confirmation:** wherever this document says a condition is "confirmed" or holds in "two consecutive reports", read it as **two consecutive polled reads that agree**.
- **Ordering:** polled GETs travel in the same FIFO RX ring as job lines. EN reads control lines before the planner gate (`_dispatch_control` at EN controller.c:179 runs before `_sync_to_planner` at :199), but a GET queued behind job lines is answered only after those lines are read. The latency is measured in B-POLL-1 (UNVERIFIED until then).
- On TG, polling uses the same cadence through the byte window.
- The test-kit model implements filtered-report semantics, so a check that relies on repeated reports fails in CI (T-S67).

### 4.3 Host loss, hidden tab and page lifecycle

As OLD-S §4.3.

**Host-loss policy:**
- **`drain`** is the only policy on TinyG. While the tab is hidden the worker keeps streaming, driven by events. `!` is not sent on hide. While the tab is hidden, the UI-heartbeat FAULT trigger is suspended (H17) and the worker's own receive watchdog continues. A remote-desktop disconnect that locks the console is treated like a hidden tab; remote-desktop control is a foreseeable misuse (§1).
- **`hold-and-spindle-pause`** is offered only when the probe shows spindle-pause-on-hold (EN `spph` stops answering 17, or g2 with `spph=1`/`coph=1` confirmed). Until then it does not exist on TinyG. When D8 ships and passes HIL, run enables `hbt` and the safety bar shows "Controller dead-man: ARMED T s" from a read of `hbt` (never assumed). The W5 text then changes (W5-HB).

**Screen Wake Lock (red-team round 2: the ISO 12100 design measure comes before the attestation).** The app requests a screen wake lock (`navigator.wakeLock.request('screen')`, permitted by `screen-wake-lock=(self)`, RUN_PLAN §6.4) at Arm and holds it until DONE, STOPPED or FAULT. The browser releases the lock when the document is hidden, so the app re-acquires it on `visibilitychange` back to visible. The safety bar shows "Wake lock: ON | OFF". Start is refused if the lock cannot be acquired, unless the user accepts C21 (expert mode). A screen wake lock keeps the display awake; whether it also prevents OS sleep on every platform is UNVERIFIED (B-HIDE-1), so the attestation stays as a second layer.

**Before Start** the user attests: "Screen lock and sleep are disabled; I will stay at the machine."

**`pagehide`, `freeze`, `beforeunload`:** record the `liveSession` marker in `device-safety` and send nothing. `beforeunload` shows a prompt while LIVE.

**On load,** if the marker exists or `document.wasDiscarded` is true, show W6, which overrides NOT CONNECTED. The next connect goes to UNKNOWN.

**Overrun display** (both dialects):
- **Distance, a true upper bound:** the sum of queued segment lengths, plus lines in the RX window, plus arc lengths. Labelled "machine may continue up to N mm".
- **Time, an estimate:** computed with `v_eff = min(F, fr) × k` for feed moves (G1/G2/G3 and their sub-segments) and `v_eff = vm × k` for rapids (G0, G28/G30 legs), k = 0.5 by default (bench-tuned in B-WD-1). Labelled "about T s (estimate)". `fr` and `vm` are the smallest board value among the moving axes. **Amended in P0 review:** TinyG limits feed moves by the axis feed rate maximum `fr`, never by `vm` (EN plan_line.c:377-381 `_calc_move_times`; TG the same), so the earlier `min(F, vm)` under-modelled any feed move with `fr < vm/2` beyond what k covers. A move on an axis with no live `fr` (feed) or `vm` (rapid) is blocked.
- **F units:** F is converted with the units in force **before** the line's own G20/G21 (both firmwares set the feed before they apply the units: EN gcode_parser.c:627-633 vs :659; TG :455 vs :474). With unknown prior units, an F on the line is unknown and a feed move is blocked.
- **Rotary axes** (gap closed in P0 review): an A/B/C axis in **radius mode** (`am`=3) reads the word in linear units and turns it into degrees, `value × units × 360 / (2π × ra)` (EN canonical_machine.c:497-500 `_calc_ABC`; TG the same). The sanitiser takes the live `am` and `ra` of every rotary axis and models radius mode exactly; a move word on a rotary axis whose `am` is unknown, or in radius mode with an unknown `ra` or unknown units, is blocked. G28/G30 are blocked while any rotary axis is in radius mode or of unknown mode (440.21 converts the stored position again). Disabled and inhibited axes only ever move less than modelled. Rotary offsets (G10, G92, G43.1) are never radius-converted; 440.21 scales them by 25.4 under G20 (TG canonical_machine.c:669, :788-789), EN does not (dialect data `rotaryOffsetsUseUnits`). The EN tool length offset is applied to X/Y/Z targets only (EN canonical_machine.c:515-518 vs :530-536). Changing a rotary `am` is a typed C5.
- On EN, at most 20 blocks can be queued; on TG, 28.
- **Ceiling:** queued path length is limited so the estimate stays at or below the configured time (default 5 s, range 2–20 s). **A single line cannot exceed the ceiling:** the sanitiser splits any G0/G1/G2/G3 whose modelled duration exceeds it into sub-segments (§4.7 step 6a), and preview and preflight interpret exactly the split lines. C7 states the longest single move.

**Web Lock** `synthetos-machine:<board id>` is taken when entering LIVE. Other tabs get Pause-request and Stop-job-request buttons and are otherwise read-only. Revised in red-team round 2:
- Observer tabs watch the lock. When it is released (the controlling tab crashed or closed), they replace the request buttons with W29 "NO TAB CONTROLS THIS MACHINE".
- The machine worker acknowledges every stop request on the BroadcastChannel within 250 ms. Without an acknowledgement, the requesting tab shows "STOP NOT DELIVERED — use your E-stop".
- The worker accepts **only stop-class messages** (pause, stop job, spindle off) on the channel.
- When more than one machine is LIVE in this browser, a Pause or Stop job from any tab, including Escape, is broadcast to **every** LIVE machine worker, and the result lists each machine.
- Port exclusivity across Chrome, Edge and other programs (CNCjs) on Windows, macOS and Linux is inherited from OLD-S, not cited: UNVERIFIED, bench task B-EXCL-1.

**Audible alarms:** W3, W12 and FAULT during a job. The AudioContext is unlocked in the Connect gesture. Sound is never counted as a mitigation on its own.

**Normal disconnect** restores any pending temporary settings (H26) and any consented normalisation (H24) before closing.

### 4.4 Stop semantics (exact sequences)

**Pause button (feedhold), or Escape, on every dialect.** On every TinyG dialect the button is labelled **"Pause"** (W2). **Stop job** is the larger, primary stop control beside it (red-team round 2). *Amended 2026-11-02 (OD-6):* the labels were shortened; the button no longer says "spindle stays on" or "not an E-stop", and the Stop job button reads "Stop job", no longer "spindle off". Pause and Stop job sit in a fixed place in the machine strip of every view, quiet while the machine is idle and prominent while it is moving, held or has motion this page did not send (ORPHANED_MOTION); they are never disabled by a view, a mode or sign-in.
1. Await the in-flight single-line write (at most about 120 B, roughly 10 ms). XOFF never delays a realtime byte.
2. Write `!`.
3. Stop feeding.
4. Show "PAUSE REQUESTED". *Amended 2026-11-02 (owner, bench 1; tenet 3):* the word "requested" is never shown. Until a report shows the held class the machine strip shows "Pausing…"; it resolves to "Paused" or "Paused · spindle still on" (step 5) once the hold is reported, to "Paused: the machine was idle, nothing changed" when the machine was or comes to rest, or, after 2 s without a hold, to "No answer from the board yet: use your E-stop if it's still moving". Pause and Stop job stay prominent while a hold is wanted.
5. When a report shows the held class, the state band shows **"PAUSED — SPINDLE MAY BE RUNNING"** (W30) with the spindle state (reported, or UNCONFIRMED) plus W10. The word "STOPPED" is never used for a hold. *Amended 2026-11-02 (OD-6):* the machine strip names the state in plain words: "Paused · spindle still on" when the spindle was commanded on, otherwise "Paused", always with W30 and W10 beside it. A Pause pressed while the machine was idle is reported as "Paused: the machine was idle, nothing changed".
6. If motion resumes while the user wants a hold, re-send `!`.
7. **Dwell case (H43):** if the executing line is a dwell, the firmware ignores `!`. On EN the session **sends ^D automatically** (`dwellStop`), because the operator asked to stop and the only immediate stop is to end the job; W26 explains what happened. On TG (no immediate dwell abort exists), show W26, highlight Stop job, keep `!` requested and re-send it at the first motion.
8. **Hold timeout** (default on, 60 s, configurable 15–600 s per machine; turning it off needs expert mode). While HELD or PROGRAM_PAUSED with the spindle or coolant commanded on, a visible countdown runs (W31). "Keep paused" restarts it and needs a visible document. At zero, EN sends ^D (`holdTimeout`) and TG runs the flush sequence (`%`, `M5`, `M9`).

**Stop job, `tinyg-en`** (ends with spindle and coolant off immediately):
1. Await the in-flight write. Stop feeding. **If the last known `stat` is 12 (SHUTDOWN) or 13 (PANIC)**, stop here: `{clear}` cannot leave those states and ^D would raise nothing, so show "Use your E-stop" and offer the reset path (C15); the spindle state is unknown. (Amended in P0 review.)
2. Write **^D** (0x04).
3. Wait up to 2 s for ALARM with status 207 (stat 2, an `er` with 207). **If the machine is already in ALARM** (last known or reported `stat` 2: a limit 203, lost input 13, ...), no 207 will come: `cm_alarm()` returns without printing when the machine is already ALARM, PANIC or SHUTDOWN (EN canonical_machine.c:810-816). The existing alarm is then the stop (it already held, flushed and inhibited the outputs), and the sequence continues with step 4 naming that alarm and C13. (Amended in P0 review; the earlier text waited for a 207 that never comes and ended in W12 and FAULT.) Expected effects (PN §9.1): feedhold, planner flush, spindle and coolant off immediately, outputs inhibited. ^D is serviced in the main loop, not in the ISR: the RX ISR only sets `job_kill_requested` (EN canonical_machine.c:1773-1782) and the alarm is raised by `cm_feedhold_sequencing_callback`, which is dispatched after the report callbacks (EN controller.c:183-187 at tip 9569e1bd). A stalled main loop therefore delays the spindle-off. HIL-2.6 measures the latency with the host not reading (TX full).
4. Show "JOB STOPPED — spindle commanded OFF by the controller (alarm 207). Clear the alarm to continue." The spindle indicator shows "OFF (controller alarm)", not "confirmed": TinyG does not report spindle state.
5. The user confirms C13 (clear). Send `{"clear":null}` with `tid`.
6. Verify with polled reads (§4.2): stat ∈ {1, 3, 4}, `hold == 0`, `qr == plannerBlocks` (the bench-verified dialect constant, B-QR-1, never a value read at the handshake), and `vel == 0`, each in two consecutive polled reads 250 ms apart. This is the E114 check. On failure: FAULT with W12.
7. Position is kept (E044). Homed flags are kept unless the dialect reports otherwise; read `homx..` and require re-homing if any is 0.
8. Reset counters. Go to IDLE.

**Stop job, `tinyg-440`** (unchanged from OLD-S §4.4):
1. `!`.
2. Wait up to 3 s for HELD (skip if not moving).
3. `%`.
4. Wait up to 3 s for `qr` = plannerBlocks and stat ∈ {3,4} in two consecutive polled reads (or the polled `vel` = 0 fallback until B-QR-1).
5. `M5`, wait for its `r`, then `M9`.
6. Reset counters.
7. IDLE, spindle "UNCONFIRMED".

**Stop job, Phase 2 motion session** (*amended 2026-11-02, owner; supersedes "Stop job went out as Pause" from Phase 1 for these sessions*). Applies to a classified, approved board (no READ_ONLY, no ORPHANED_MOTION) in a session with the motion flag on. There are no jobs in Phase 2, so ^D is not used; it stays the Stop job of a running job from Phase 3.
1. Stop feeding (a jog's pieces, a go-to-zero sequence). Await the in-flight line.
2. Write `!`.
3. Poll `stat`, `hold`, `vel`, `qr` every 100 ms until two consecutive reads show the hold complete (`hold` 6) or the machine at rest with an empty planner, and every written line has been answered. Up to 3 s.
4. If the board is held or the planner is not empty, write `%`. Then poll until `hold` is 0 and `qr` = plannerBlocks twice. Up to 3 s.
5. `M5`, then `M9`, each answered; then `G90` (and `G20` if the board was in inches).
6. Show "Stopped: queue cleared, spindle and coolant off". IDLE.
Any timeout: W12 and FAULT. **Pause** in a motion session writes `!` and stops feeding; the hold is shown as "Paused" from polled state (W30 and W10 still apply). **Resume** writes `~` only for a hold of motion this session sent, and shows "Resumed".

**Stop job, READ_ONLY sessions** (stock 449, unknown builds): only `!` is available. The UI says "Use your E-stop or the controller's own stop" and never sends ^D or `%` to an unclassified build.

**Escalation.** Any step that times out shows W12 and latches FAULT.

After any stop the tool never auto-clears an alarm. No stop sequence sends `^X`.

**Spindle off now** (safety bar button, visible whenever the spindle is commanded on):
- EN with a job active or motion: same as Stop job.
- EN idle: `M5` then `M9`, each waiting for `r`.
- TG: `M5` then `M9`, labelled "queued behind any held moves — use Stop job to end the job".

**Reset controller.** As OLD-S §4.4: Advanced disclosure, W16, W18, C15, then 0x18. Then UNKNOWN and re-homing. On TG, the guidance adds E128.

**Alarm handling while moving:**
- **TG (soft alarm):** `!` immediately, then `%`, latch FAULT, show "spindle may still be running" with Stop job.
- **EN:** stop feeding, latch FAULT, show the alarm meaning. The spindle is off by firmware (E019); show "OFF (controller alarm)".

### 4.5 Jog rules

As OLD-S §4.5:
- increments of 0.01, 0.1, 1 and 10 mm;
- the first move per axis after any `dir`/`scale` invalidation is 0.25 mm at min(100 mm/min, 10% of `vm`), with the expected step count shown (C3 formula);
- unhomed: at most 1 mm until direction and scale are verified, then 10 mm;
- 2 s time cap;
- `G21 G90 G53 G1 <axis><target> F<f>` with the target computed from a post-idle `mpo` no older than 1 s;
- units and distance mode restored and confirmed;
- one jog in flight; key repeat dropped;
- feed capped at min(`vm`, 50% of `fr`);
- the envelope checked when homed;
- keyboard jog off by default;
- no continuous jog in v1;
- a job's first feed move before any F word is a preflight block.

**EN additions:**
- Each jog line is followed by `M400` alone on a line. The next jog is accepted only after the M400 `r` and a report with `vel` = 0 (this replaces the pure timing inference).
- **Never use `jog*` tokens** (E157) or M114 for targets (PN §9.3).

### 4.5b Phase 2 bench motion (owner, 2026-11-02)

**Phase gate.** The machine worker uses `PHASE_2_RELEASE` only where the motion capability flag is on: `http://localhost` and `http://127.0.0.1` (the loopback bench server, any port) and `https://staging.run.synthetos.com`. Every other origin, `https://run.synthetos.com` included, keeps `PHASE_1_RELEASE` (T-S93).

**Preconditions for any motion intent** (the matrix plus the session): connected, classified and approved (no READ_ONLY); no FAULT, LOST, ORPHANED_MOTION, UNKNOWN or STALE; not in ALARM (an alarm needs **Clear alarm** with C13 and the alarm's meaning); no job; nothing else in motion. The homing state (`home`, read at connect) is shown; while not homed every jog shows W34. After a reconnect (UNKNOWN), motion needs "I've checked the machine" (`positionVerify`).

**Jog.** Steps 0.01, 0.1, 1, 10 and 100 mm (0.001, 0.01, 0.1, 1 and 4 in), or Hold. Jog speed up to 5000 mm/min. Each piece is one line `G21 G91 G1 <axes> F<f>`, at most 150 ms of travel at the jog speed; at most 2 pieces are queued in the planner (`qr` polled after each piece). A step longer than one piece is fed in pieces the same way. Hold jogs need a keep-alive every 200 ms and end after 500 ms without one (H50). Ending a jog: stop feeding, `!`, then `%` once held (H56), then `G90` (and `G20` if the board was in inches). A jog that ran to its end waits for polled idle and restores the modes the same way. Keyboard jog (arrows for X and Y, Page Up and Page Down for Z) only while the jog panel has focus and the window is focused.

**Go to zero.** Per axis or all. If X or Y moves: `G53 G0 Z<safe>` with `<safe>` never below the current machine Z, then `G90 G0 X0 Y0` (the axes asked for), then `G90 G0 Z0` if Z was asked for. Each line waits for polled idle before the next. C25 shows the path first.

**Set zero.** `G10 L20 P1 <axes>0` (G54, persisted on the controller; never G92, which is a temporary offset). C16 states it. The work offset (machine minus work position) is shown.

**Spindle and coolant.** `M3 S<rpm>` (CW), `M4 S<rpm>` (CCW), `M5`; `M7` mist, `M8` flood, `M9` both off (TinyG has one off command for both). Readouts (`spe`, `spc`, `spd`, `sps`, `cof`, `com`) are labelled commanded, never measured. Spindle on needs C24 unless the user turns it off for the browser session.

**Homing** (*amended 2026-11-02*). `G28.2 X0 [Y0] [Z0] [A0]` for the axes asked for, each configured (H65); C4 first. HOMING until two polled reads show the machine at rest after the cycle was seen running (or three in a row), then `hom`, `mpo`, `pos`, `ofs` and `home` are read back. Pause ends the homing (`!`, then `%` once held: a homing cycle is not resumed); Stop job runs the Phase 2 flush sequence. A G28.2 the board refuses ends at once, without a hold, and the homing state is read back.

**Set machine position** (*amended 2026-11-02*). `G28.3 X0 [Y0] [Z0] [A0]`, after C26, for machines without homing switches (H67). Then polled idle and the read-back of `mpo`, `pos`, `hom`, `ofs` and `home`; UNKNOWN clears when X, Y and Z read homed.

**Offsets** (*amended 2026-11-02*). Set work zero is `G10 L20 P<n>` in the active system (`coor` 1..6; refused when it is not known or G53), saved on the controller (C16); its offsets are read back. **Temporary offset:** `G92 X0 [Y0] [Z0] [A0]` (C27) and `G92.1` (C28), not saved; `g92`, `ofs` and `pos` are read back. **Work coordinate system:** `G54`..`G59` (C29); `coor`, `ofs`, `pos` and g54..g59 are read back. Each change waits for polled idle before its read-back; a refused line ends it without a hold.

**Write gate.** Motion lines are their own command kind in the session's write gate (writePolicy.ts). A line is written only if it matches the closed grammar above exactly (numbers bounded, LF-terminated, no other words), the session release allows motion, and the allow-matrix allows the intent that issued it in the current state. `%` is written only by the stop and release sequences, `~` only by Resume, `{"clear":null}` only by Clear alarm. ^D and ^X are still never written in Phase 2. *Amended 2026-11-02:* the grammar adds `G28.2`, `G28.3`, `G92`, `G92.1`, `G54`..`G59` and `G10 L20 P1..P6` (axis words `X0`..`A0` only), and each line kind is admitted only from the intents that may send it (no G28.2 issued as a jog). The status-report configuration lines are a separate kind (`report`, H64).

### 4.5a Temporary homing search cap (TinyG, Phase 4)

As OLD-S §4.5a: snapshot, `pendingRestore` record in `device-safety`, write the temporary `tn`/`tm`, home, restore, read back, next-connect recovery with C17.

**Until Phase 4 ships** (Phases 2–3 on the bench), homing uses the board's existing travel. C4 states the full search distance `|tm − tn| + lb` computed from live values. The bench motors are unloaded on a fixture.

### 4.6 Settings write pipeline

As OLD-S §4.6:
1. Gate.
2. Snapshot all allowlisted groups to `device-safety` and, if signed in, to the account as a settings backup (§4.10 rule 6).
3. Diff and write plan with risk classes.
4. Record `unit`.
5. `G21` and wait for its `r` (EN: then `M400`); confirm `unit` = 1.
6. One key per line, each read back (EN: with `tid`). A non-zero status stops the plan and offers rollback. **On EN, 106 plus `er` means a cycle was active** (EN persistence.c:88-92); on TG the refusal is status 9.
7. Restore `unit` and confirm.
8. Invalidate facts.
9. W20 after polarity, motor-map, scale or travel writes until the commissioning tests run.

Typed C5 for:
- homing input or direction, motor polarity, switch type or modes;
- **`spep`, `spdp`, `prbp`** (EN; `spep`/`spdp` are refused by firmware unless the spindle is off and the planner idle, PN §12.2);
- `sl=0`;
- jerk or velocity ×2 or more;
- travel changes;
- motor map.

Forbidden keys: PN §12.4.

**Session normalisation:** not performed on EN by default (H24). Where it is needed (TG `qv` for queue reports), it follows OLD-S §4.6 with W19 and restore.

**Amendment 2026-11-02 (settings writes on the bench and staging; H57-H63).** The pipeline as built:
1. **Gate:** the phase switch is on, the board is approved (not READ_ONLY), the allow-matrix allows `settingsWrite`, and the session refuses a second write while one is in progress.
2. **Snapshot:** before the first write of an apply, the full settings backup (every allowlisted group) is read, kept in `device-safety` and downloaded. If it is incomplete, nothing is written. Account backups follow with §4.10 rule 6 when sync ships.
3. **Diff and plan:** the pending changes are compared with the last read at the table's precision. The plan is screened as a whole (schema `screenWritePlan`: forbidden keys, reviewed overlay, ranges, enums, travel and switch rules) and ordered: communication keys last, `jv` very last. Every key is screened again in the session, against the values the session itself read.
4-5. **Units:** no G21 is sent. Instead the session reads `unit` right before each write, together with `stat`, `hold`, `vel` and `qr`, and writes nothing unless `unit` = 1 and the board is at rest. Lengths are therefore written and read back in millimetres, and the board's units are never changed by the settings path.
6. **One key per line**, `{"<key>":<value>}` with a plain decimal number. Its answer is awaited before any other line is sent (H57), then the key is read back. A non-zero status, an `er` 106 or 9, a read-back that differs at the table's precision, or no answer stops the plan, and revert is offered.
7. Not applicable: the units are never changed (steps 4-5).
8. **Re-read:** after the run, every group is read again and becomes this computer's reference. Facts that depend on the written keys are invalidated when the fact store is wired to writes. Until then, W20 is shown after any write.
9. W20 after a write of a key whose overlay says so (polarity, motor map, scale, travel).

The confirmation is C5. When a change is high-risk (switch type or mode, homing, motor polarity, power or map, axis mode, travel and soft limits, the EN polarity keys `spep`/`spdp`/`prbp`, communications, or a jerk or velocity ×2), C5 also names each high-risk change with its consequence, each needs its own tick, and the word WRITE must be typed.

### 4.7 Sanitiser (job and console)

Order of operations (OLD-S §4.7, per dialect):
1. Normalise line endings to LF; never send CR or blank lines (E164 accounting, PN §7.3).
2. Comments: on **every TinyG dialect**, reject lines with text after a comment, leading comments followed by code, and unclosed `(`. Strip trailing comments.
3. Trim.
4. Drop empty and `%`-only lines.
5. Strip user N words.
6. Reject the line (this blocks the job) if:
   - it contains `!`, `~` or `%`;
   - it contains a byte < 0x20 other than tab, or ≥ 0x7F;
   - its first character is `$ ? H h {`;
   - it contains M100;
   - it is longer than 120 bytes after the N prefix;
   - it contains G38.x;
   - it contains a code unsupported by the dialect, a dotted code, or a modal conflict (EN rejects these too, E150/E152);
   - it contains negative F or S;
   - M6 without C14 (with C14, insert `M5`, `M9`, `M0` and mark that M0 as a barrier);
   - it contains M201.3 (EN);
   - TG only: G10 with L ≠ 2; **G18 arcs; G28/G30 under G20 or G91; G28.4; an `E` word**; more than 3 queued commands per line (E088);
   - EN only: G10 with L ∉ {2, 20};
   - both dialects: G93 (until B-E130).
6a. **Split long moves** (red-team round 2). Any G0, G1, G2 or G3, including modal motion with no G word, whose modelled duration at `v_eff` (§4.3: `fr` for feed moves, `vm` for rapids, rotary radius mode and F units as stated there) exceeds the queued-motion ceiling is replaced by explicit sub-segments that each stay within it. Straight moves are divided exactly. Arcs and helices are divided into sub-arcs with recomputed I/J (an R-form arc is re-expressed as I/J), with endpoints rounded to 0.0001 mm (0.00001 in) and continuity re-checked. Incremental (G91) moves divide the distance. The report lists every split. A move that cannot be split within tolerance is a preflight block.
7. Mark barriers: M0, M60, the inserted C14 M0, and M1 when optional stop is on. M1 when optional stop is off: TG drops it with a report entry; EN sends it (the firmware skips it, because `os`=0).
8. Mark the final M2/M30 for holdback (H35). Reject M2/M30 that are not the last motion-relevant line (EN), or warn (TG).
8a. **End state (H48):** if the interpreter's commanded spindle or coolant state at the end of the file is on, preflight blocks unless the user accepts C22, which appends `M5` and `M9` (on TG also before a final M2/M30, B-M2-1).
9. Prefix `N<k>`.

**Single source of truth (unchanged).** Preview, analyser and preflight interpret exactly the sanitised `SentLine[]` with dialect semantics (T-S1). The sanitiser always runs locally on the bytes that will be sent, never on server-provided analysis.

### 4.8 Flash gate (TinyG)

As OLD-S §4.8:
- identity check before anything bootloader-related;
- idle gate;
- C6 ordered checklist;
- automatic backup;
- image checks;
- Wake Lock;
- the stub-vector flow;
- guard filter;
- post-flash wait for the banner;
- **required restore** from **this run's local pre-flash snapshot** (H47), with spindle and VFD mains isolated until the read-back confirms `spep`/`spdp` (C18 to leave without it; C18 is a hard stop when the snapshot has `spep=0` or the profile or wiring says active-low).

EN-specific steps:
- The post-flash banner is the bare-`sr` form. Check `fb` (later also `fbs`) against the manifest.
- After the flash, re-run the full capability probe. The result must classify as `tinyg-en`, full, or the session stays READ_ONLY with "unexpected firmware after flash".
- The backup is also saved to the account when signed in. Restore always goes through §4.6 and the cross-build mapper, never directly from the cloud.
- **Restore source and baseline (H47):** the pre-flash snapshot taken in this flasher run is pre-selected and locked, and its hash is kept in `device-safety`. The diff is shown against that snapshot, not against the board's defaults. Choosing another backup is an explicit choice that shows machine name, photo, board id, `fb`, date and provenance.
- **Mains isolation through the defaults window:** C6 gains the box "Spindle and VFD mains are switched off and will stay off until my settings are restored and confirmed". After the restore read-back confirms `spep` and `spdp`, a blocking checkbox asks the user to confirm before restoring mains. W28 is shown from flash start until then, including after a failure and during xboot recovery, where the outputs float (PN §13.1).
- **`flashRestorePending`:** written to `device-safety` before the first page is sent (board id, machine id, snapshot hash, time) and cleared only after a confirmed restore. On the next connect to that board it forces the restore before anything else, as H26 does.
- A downgrade across config layout 2 needs a reviewed manifest flag and a full typed review of the mapped restore.

### 4.9 Failure-mode table

OLD-S §4.9 rows still apply, with SIM read as NOT CONNECTED. Rows added or changed:

| Failure | Detected by | Behaviour |
|---|---|---|
| Session expires or user signs out elsewhere while LIVE | 401 from the API, BroadcastChannel from the other tab | W22; a running job and every never-gated action (Pause, Stop job, Spindle off, Reset, Disconnect, recovery) unaffected; new requests from the identity-gated set G denied until sign-in (RUN_PLAN §2.2); cloud save paused |
| Network loss while LIVE | fetch errors | Same as above. Nothing in the machine path uses the network |
| Identity service outage | sign-in fails | D1 (sign-in required): new requests from the identity-gated set G (Connect, Start, jog, home, settings write, flash…) are refused until sign-in works again; an already-connected session keeps its running job and every never-gated action (Pause, Stop job, Spindle off, Reset, Disconnect, recovery); library unavailable (RUN_PLAN §2.2) |
| Download hash mismatch | client re-hash | Hard stop "file damaged or altered"; not confirmable; file not loadable |
| Cloud profile head ≠ last applied from this browser | revision compare on connect | NEEDS_REVIEW with W23 and diff; nothing written until C19 |
| Profile edit conflict | 409 from the API | Diff and choose; never last-write-wins |
| Two machines match a board id | lookup | User picks; nothing preselected |
| Stock 449 or unapproved EN build | probe | READ_ONLY plus upgrade offer |
| EN status 13 on a job line | streamer | FAULT; firmware alarm 13; recovery card explains "damaged line, not run" |
| EN alarm 207 not seen after ^D | timeout | W12 and FAULT |
| E114 check fails after stop (`hold` ≠ 0 or `qr` short) | post-stop verify | FAULT, W12, guidance to use the reset button and re-home |
| Buffered M30 would clear an alarm | holdback rule | final line never sent while alarmed (H35) |
| Read of a non-allowlisted token attempted | read path guard | throw in code; FAULT if it happens while connected (a bug), never sent |
| Feedhold during a dwell | `line`/model | W26; Stop job highlighted |
| Logout attempted while LIVE | allow-matrix | denied with reason |
| Revoked app version calls the API | `X-App-Build` | API refuses mutations; LIVE refused at next entry (H27) |
| Preview URL or `workers.dev` serves the app | deploy config | disabled; smoke test fails the deploy |
| Advisory fetch fails | fetch error | Use the cached signed advisory if it is younger than 7 days; otherwise refuse LIVE (H27) |
| Advisory revokes this version while LIVE | 15-minute poll | Banner; new Arm, Start and jog denied; a running job, a hold and every stop are unaffected |
| Board held, paused, moving or queued at connect | probe (ENQ, `sr`, `hold`, `vel`, `qr`) | ORPHANED_MOTION with W32; only Stop job or Reset controller (H14) |
| Wake lock unavailable or lost | Wake Lock API, `visibilitychange` | Start refused (C21 override); while running, re-acquire on visible and show "Wake lock: OFF" |
| Controlling tab gone while another tab observes | Web Lock released | Observer shows W29 |
| Stop request not acknowledged by the worker | 250 ms timeout | "STOP NOT DELIVERED — use your E-stop" |
| Tab crashes between flash and restore | `flashRestorePending` | Next connect forces the restore first (H47) |
| Hold with spindle on reaches the timeout | hold timer | EN ^D; TG flush sequence (§4.4) |

### 4.10 Cloud and account rules (new; normative)

1. **The cloud never drives.**
   - No server-to-browser command channel exists: no WebSocket, push or remote start into the machine worker.
   - Nothing fetched from the API can cause bytes to reach the serial port without the same local load, preflight, Arm and confirmation path as a local file.
   - `protocol`, `safety`, `machine` and `flasher` contain **no network API identifiers** (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `navigator.sendBeacon`). This is lint-enforced.
   - Firmware bytes and the advisory verdict are fetched by the main thread and passed in, then re-verified in the machine worker.
2. **The network is never in the motion or stop path.**
   - Jobs stream from a local, hash-verified in-memory copy.
   - Session expiry, logout, a 401, an outage or network loss never pauses, stops, reloads or changes a connected session.
3. **Facts, confirmations, overrides, E-stop acknowledgements and pending restores are never uploaded.**
   - Cloud profiles load as imports: facts need re-verification and the board must be re-bound.
   - The sync payload schema has no fields for these things, and the API rejects unknown fields.
4. **Never auto-apply.**
   - A stored profile is compared on connect and applied only through C19 and the write pipeline.
   - The same applies to wiring-derived "expected settings": per-key accept, never all at once.
   - **Profile field classes** (red-team round 2). Every MachineProfile field is classed as (a) a firmware setting, (b) a host gate, or (c) descriptive. Host gates are spindle kind (which gates W15), dual-motor layout, the queued-motion ceiling, jog caps, homing order, the hold timeout and the host-loss policy. A class (b) change that **loosens** a gate is shown in the same diff and needs C19 before this browser uses it, typed "WRITE" for a spindle kind changed away from laser or plasma, for the ceiling and for jog caps. The work envelope is never taken from the profile: it comes only from the live board's `tn`/`tm`.
   - On NEEDS_REVIEW the default action is **"Keep the board's settings and update the profile from the board"** (C23). It writes nothing to the machine (T-S70). Writing the profile to the board is the secondary action.
5. **Content integrity.**
   - SHA-256 of the raw bytes, re-hashed on download, hard stop on mismatch.
   - The device-local trust anchor gives NEW / CHANGED / SAME.
   - Arm binds to the hash.
   - Server-side analysis is informational only.
   - The trust state uses the hash computed locally after decompression, never the server's `sha256` field, and is keyed by machine, board, project, operation and tool note (H39).
6. **Settings backups may sync** (they are values, not attestations). Restoring one always goes through §4.6 with a diff against a local baseline (H47). The post-flash restore uses this run's local snapshot by default. The *pending-restore* and `flashRestorePending` records stay device-local.
7. **Storage partitions.**
   - `device-safety` (pending restores, facts, trust anchor, last-applied revisions, `liveSession` marker) is account-independent and is never cleared by logout, account switch or `Clear-Site-Data` (which never includes `"storage"`).
   - `cloud-cache:<userId>` is cleared on logout or switch.
8. **No deep link arms anything.**
   - URLs may open a project or machine page.
   - They may never load, select or arm a job, apply a profile, or start a connection.
9. **No sharing at launch.** When it comes, shared items arrive as copies with provenance, in the NEW state, with full local checks.
10. **Board ids suggest; they never authorise.**
11. **Provenance comes from the server's session record or this browser's own key, never from the client payload.** `created_by_*` and `taken_at` are written by the server from the authenticated session. "Made on this computer" needs this browser's device signature. W24 is decided from session ids this browser recorded itself.

---

## 5. Required warnings (exact wording)

Signal words follow ANSI Z535 and ISO 3864-2 (OLD-S §5). **Single source:** every W and C string lives in `packages/safety/src/strings.ts`. A CI test parses §5–§6 of this document and fails unless every string matches byte for byte (T-S32). The synthetos.com landing page carries W1, checked by a cross-repo test at a pinned ref.

- **W1 (persistent bar on every page of run.synthetos.com):** "WARNING — This software is not an emergency stop. Your machine must have a hardwired E-stop that removes motor and spindle power. Keep it within reach whenever the machine is powered."
- **W2 (pause button label, every TinyG dialect; amended 2026-11-02, OD-6):** "Pause". Tooltip: "Decelerates and pauses motion. The spindle and coolant keep running. Use \"Stop job\" to stop with the spindle off, and your E-stop in an emergency."
  Amended 2026-11-02 (OD-6, owner): the label is the single word Pause. The words 'spindle stays on' and 'not an E-stop' are no longer on the button: W1 stays at the top of every page and says the software is not an emergency stop, the tooltip above is unchanged, and the spindle-stays-on fact is shown with the paused state (§4.4 step 5). The Stop job button reads Stop job, without 'spindle off'. Pause and Stop job are still never gated.
- **W3 (LOST banner, full width, `--danger`, `role="alert"`, audible tone):** "DANGER — Connection lost. The machine may still be moving and the spindle may still be running. Use your E-stop if anything is unsafe. Machine position is now unknown."
- **W4 (STALE banner):** "WARNING — No status from the machine for N s. Commands are blocked. What you see may be out of date."
- **W5 (before Start, and while RUNNING):** "WARNING — If this browser tab closes, crashes, sleeps or loses USB, the machine will continue the queued moves (up to N mm, about T s — an estimate) and the spindle will stay in its last state indefinitely, even after motion stops. A spindle left running against the work is a fire risk. Disable screen lock and sleep, keep this tab visible, and stay at the machine."
- **W5-HB (replaces W5 only on an image whose D8 heartbeat passed HB-1..HB-13 and with `hbt` read back as armed):** "WARNING — If this tab stops responding, the controller is set to stop motion and turn the spindle off within about T s. This is not an E-stop and can fail. Keep this tab visible and stay at the machine."
- **W6 (previous session; overrides NOT CONNECTED):** "WARNING — The previous session ended while connected to a live machine. The machine may have kept moving after this page stopped. Check the machine before doing anything. Machine state is UNKNOWN until you reconnect and re-home."
- **W7 (NOT CONNECTED band; replaces the retired SIM band):** "NOT CONNECTED — no machine. Preview and setup only; nothing on this page is moving a machine."
- **W8 (LIVE band):** "LIVE — connected to <machine name> (<board id>, <firmware>) on <port>. Commands move the real machine."
- **W9 (unhomed envelope):** "Soft limits are inactive: axis <X> is not homed. The machine can travel past its limits."
- **W10 (feedhold spindle note; every TinyG dialect):** "On TinyG a feedhold does not stop the spindle or coolant. Use \"Stop job\" to end the job with the spindle off."
- **W11 (flash banner):** "DANGER — Flashing resets the controller. Motors lose holding torque and outputs may switch on or toggle. Do not unplug the board or close this tab until flashing finishes. An interruption in the last seconds can leave the board needing a programmer."
- **W12 (stop not confirmed, `role="alert"`, tone):** "DANGER — STOP NOT CONFIRMED. The machine did not report that it stopped. USE YOUR E-STOP."
- **W13 (preview disclaimer):** "NOTICE — This preview uses our interpreter, not your firmware. It can miss problems. Configure homing and firmware soft limits ($sl=1)."
- **W14 (wiring export without E-stop):** watermark "INCOMPLETE — NO E-STOP SHOWN". Footer: "This diagram does not replace a qualified electrician. Emergency stop circuits must remove motor and spindle power in hardware."
- **W15 (laser or plasma on TinyG; per build):**
  - TG: "Laser and plasma control on TinyG is not supported by this tool. This firmware has no output polarity setting and a feedhold leaves the output on."
  - EN: "Laser and plasma control on TinyG is not supported by this tool. A feedhold leaves the output on, so a laser would keep firing."
- **W16 (reset button):** "The reset button on the board is not an E-stop. A reset makes outputs float and may switch an active-low relay ON."
- **W17 (PROGRAM_PAUSED):** "WARNING — Program paused. The spindle and coolant may still be running (UNCONFIRMED): this firmware does not turn them off at a program stop. Wait for the spindle to stop, or use your E-stop, before reaching in."
- **W18 (Reset controller):** "WARNING — Resetting the controller drops motor holding torque, so axes that can fall (Z) may drop. Outputs float during the reset. Machine position will be lost and homing will be required."
- **W19 (session normalisation consent):** as OLD-S W19, verbatim: "NOTICE — These reporting settings are stored on the board. Other programs (CNCjs, ChiliPeppr, serial-port-json-server, your own scripts) read them too, and may stop working correctly if they change. This tool restores the original values when you disconnect normally. If this tab crashes, reconnect here and choose \"Restore original reporting settings\" before using another program."
- **W20 (after a polarity, motor-map, scale or travel write, before commissioning):** "WARNING — Direction and distance are not verified. Before running anything, check with small moves (1 mm or less), hand on the E-stop, that each axis moves the right way and the right distance."
- **W21 (wiring and power):** shown on the wiring checklist: "Switch motor power OFF before connecting or disconnecting motors."
- **W22 (signed out or offline while LIVE; inline, not modal):** "Signed out. A running job and Pause, Stop and Spindle off are not affected. Sign in again to start a job, jog, home, or change settings. Cloud save is paused until you sign in again."
- **W23 (stored profile changed):** "WARNING — The saved profile for <machine name> changed since this browser last applied it (revision <a> → <b>, changed from <device> on <date>). Nothing has been written to the controller. Review the differences before applying."
- **W24 (changes from a new sign-in):** "WARNING — This <profile | file> was changed from a sign-in this browser has not seen before (<device>, <date>). If you did not make this change, do not use it, and sign out everywhere from your account page."
- **W25 (READ_ONLY firmware):** "This controller's firmware (<fb>, <reason>) is supported read-only. You can view settings and send a feedhold, but not move the machine. <Upgrade to the approved TinyG firmware | Use your usual sender>."
- **W26 (stop during a dwell):** "The controller ignores feedhold while it is dwelling or waiting for the spindle. Use \"Stop job\" to stop now, or your E-stop."
- **W27 (Stop job result, EN):** "Job stopped. The controller turned the spindle and coolant off and is in alarm 207. Check the machine, then clear the alarm to continue."
- **W28 (flash and factory-defaults window):** "DANGER — Keep spindle and VFD mains switched off. While flashing, while the board is in the bootloader and until your settings are restored, the controller's outputs float or use factory polarity, which can switch an active-low spindle relay or VFD ON."
- **W29 (observer tab after the controlling tab is gone):** "NO TAB CONTROLS THIS MACHINE — the controlling tab closed or crashed. The machine may still be moving and the spindle may still be running. Use your E-stop."
- **W30 (state band during a hold, every TinyG dialect):** "PAUSED — SPINDLE MAY BE RUNNING"
- **W31 (hold timeout countdown):** "This job will be stopped with the spindle off in N s, because it is paused with the spindle on. Choose \"Keep paused\" to wait longer."
- **W32 (ORPHANED_MOTION):** "WARNING — This controller is paused, holding or still has queued moves from a previous session. This page did not send them and cannot resume them. Use \"Stop job\" to end them with the spindle off, or reset the controller."
- **W34 (jog panel while not homed; Phase 2, 2026-11-02):** "WARNING — The machine is not homed, so soft limits may not protect it. A jog can drive an axis into its end. Use small steps and keep a hand on the E-stop."
- **W33 (liveness FAULT countdown, `role="alert"`, tone):** "DANGER — This page lost track of the machine (<cause>). The machine is paused and the spindle may be running. The job will be stopped with the spindle off in N s. Check the machine now."
- **W35 (status report list set at connect; amendment 2026-11-02, H64):** "NOTICE — Run set this board's status report list to include machine position and spindle/coolant. The list is saved on the board, so other programs that read its status reports see the change too."
- **W36 (another saved reporting setting changed at connect; H64):** "NOTICE — Run changed a reporting setting saved on this board: <setting> from <old> to <new>. Other programs that read its status reports see the change too."

---

## 6. Required confirmations (exact wording)

Typed confirmations are limited to:
- C5 when a high-risk key is involved;
- C10;
- C11/C19 when polarity or homing keys change;
- C18;
- C21;
- C19 for a host-gate loosening of spindle kind, ceiling or jog caps (§4.10 rule 4);
- the wiring "expected settings" accept for polarity or switch keys (which uses the C5 word).

An identity or chip mismatch on a flash, a bound-device mismatch on a profile, and a hash mismatch on a file are **hard stops**, not confirmations. Dialogs focus Cancel by default, and Enter never starts motion. All text is generated from live values through `strings.ts`.

| ID | When | Text | Type |
|---|---|---|---|
| C1 | At the start of every LIVE session. The full list is shown the first time, when the text version changes, and when the last full acceptance in **this browser** was on an earlier calendar day; otherwise the short form. Stored in `device-safety` as `ack.safety@<version>@<date>`. The account copy is display-only. | Full: "Before connecting, confirm: ☐ A hardwired E-stop that removes motor and spindle power is installed and I tested it today. ☐ Limit switches or soft limits are configured, or I will keep moves small. ☐ The work area is clear of people, tools and loose items. ☐ I am wearing eye and ear protection. ☐ I will not leave the machine unattended while it is powered." Short: "☐ My E-stop is within reach and I tested it today." | All boxes |
| C2 | **Retired** (there is no simulator). The ID is not reused. | — | — |
| C3 | First jog move per axis | As OLD-S C3, generated from `0.25 × (360/sa) × mi / tr` | Single |
| C4 | Homing (amended 2026-11-02: names the axes) | Phase 2–3: "Home <axes>? The machine will move each axis toward its homing switch until it triggers (the controller homes Z first). The search can travel up to <N> mm (|tm − tn| + lb from the controller's settings). Hand on E-stop?" From Phase 4: the OLD-S C4 text with the temporary cap. | Single |
| C5 | Settings write | "Write N settings to <machine name> (<board id>)? Changes: <table>. High-risk changes: <list>." | Single; typed "WRITE" if high-risk |
| C6 | Flash | As OLD-S C6 (ordered checkboxes), **plus the box "☐ Spindle and VFD mains are switched off and will stay off until my settings are restored and confirmed"** (H47), then: "Flash TinyG <id> from build <old> to <new> (sha256 <short>)?" | All boxes in order, then single |
| C7 | Arm | "Arm job <file> (sha256 <short>, <state SAME/NEW/CHANGED>): N lines, units mm, WCS G54 (read from machine), X <min..max>, Y …, Z min <z>, spindle ON S<rpm>, estimated <t>, may continue up to <mm> mm (about <s> s, estimate) if the connection is lost; no single line queues more than <c> s (<k> long moves were split). Wake lock <ON>. ☐ E-stop in reach, work clamped, area clear, screen lock off." | Checkbox |
| C8 | Start | "Start <file> now?" | Single, within 60 s of Arm |
| C9 | Resume | As OLD-S C9, including the spindle-restart second step | Single (+ single) |
| C10 | Run with unhomed axes (expert mode) | "Soft limits are inactive on X, Y. Type RUN UNHOMED to continue." | Typed |
| C11 | Retired into C19 | — | — |
| C12 | Override `hold-and-spindle-pause` to `drain` for this session (only where that policy exists) | As OLD-S C12 | Typed "BACKGROUND" |
| C13 | Clear alarm | "Clear the alarm? <meaning of the alarm code>. Position may be wrong; homing will be required." (EN 207: "The job was stopped. Position is kept; homing is recommended.") | Single |
| C14 | Preflight finds M6 | "This file has <k> tool changes (M6). The controller does not stop for M6. Insert \"M5 M9 M0\" before each M6? The sender will stop sending at each one and wait until the machine has stopped before asking you to change the tool." Declining blocks the job. | Single |
| C15 | Reset controller | As OLD-S C15. TG adds: "If the controller is stalled this may not work; press the reset button on the board." | Single |
| C16 | Set work zero | "Set <G54> <X> zero at the current position (machine <mpo> mm)? New offset: <value> mm. This offset is saved on the controller." | Single |
| C17 | Restore after an abnormal end | As OLD-S C17 | Single |
| C18 | Leaving the flasher before restoring | "The board is running factory defaults (<key defaults read from the board>), which may not match your machine. Homing and jogging stay blocked until you restore. Type LEAVE WITHOUT RESTORE to continue." **A hard stop instead of a typed override** when the pre-flash snapshot has `spep=0`, or the profile or wiring says the spindle or VFD enable is active-low (H47). | Typed (or hard stop) |
| C19 | Apply a stored profile to the connected board | "Apply profile <name> revision <b> to <machine name> (<board id>)? <key-level diff against this machine's baseline (the last local snapshot or last-applied revision; "No baseline on this computer" if there is none), with provenance per change ("made on this computer" only with a valid device signature, otherwise "made elsewhere")>. High-risk changes: <list>." | Single; typed "WRITE" if high-risk |
| C20 | Arm a file in state NEW or CHANGED | NEW: "This file has never been run on <machine name> from this browser. Review the preflight report below before arming." CHANGED: "This file changed since you last ran '<name>' on <machine name> (<when>, from <device>). <diff summary>. Review the changes before arming." | Single (with the report and diff visible) |
| C21 | Start without a screen wake lock (expert mode) | "The screen may sleep or lock during this job, which can freeze or hide this tab. Type NO WAKE LOCK to start anyway." | Typed |
| C22 | Preflight finds that the job ends with the spindle or coolant on | "This file ends with the spindle <on, S…> and coolant <on> and no program end that turns them off. Append \"M5 M9\" so the job ends with them off?" Declining blocks the job. | Single |
| C23 | Resolve NEEDS_REVIEW by updating the profile from the board (the default action) | "Keep the settings on <machine name> (<board id>) and save them as profile revision <n+1>? Nothing is written to the controller." | Single |
| C24 | Manual spindle on (Phase 2, 2026-11-02), unless the user turned it off for this browser session | "Spindle will start (<direction>, S<rpm>). Hands clear?" | Single |
| C25 | Go to work zero (Phase 2, 2026-11-02) | "Go to work zero on <axes>? The machine will move: <path>. Keep a hand on the E-stop." | Single |
| C26 | Set machine position here, G28.3 (amendment 2026-11-02, H67) | "Set the machine position of <axes> to 0 here, without moving (G28.3)? Use this only on a machine without homing switches, with each axis where you want machine zero. A wrong position makes soft limits and every later move wrong." | Single |
| C27 | Temporary offset, G92 (amendment 2026-11-02, H68) | "Set a temporary offset so that <axes> read 0 here (G92)? It is not saved on the controller: a reset or a program end clears it, and Clear temporary offset (G92.1) removes it. The saved <system> offset does not change." | Single |
| C28 | Clear the temporary offset, G92.1 (amendment 2026-11-02, H68) | "Clear the temporary offset (G92.1)? Work positions go back to the saved <system> offsets." | Single |
| C29 | Select the work coordinate system, G54 to G59 (amendment 2026-11-02) | "Use <system> for work coordinates? Work positions, Set work zero and Go to zero then use its saved offsets." | Single |

Stop job and Spindle off now are never behind a confirmation: they are direct actions in every connected state and every overlay (§4.1 normative rule).

C18a note (power off → unplug motors → support Z → power on → flash; CIT-3) stands as in OLD-S §6.

---

## 7. What the software cannot guarantee

Show this list verbatim on run.synthetos.com/safety/.
1. It cannot stop your machine in an emergency. Only a hardwired E-stop can.
2. It cannot guarantee that a stop command arrives or how quickly it arrives. The command passes through the browser, the operating system, USB and the firmware.
3. It cannot stop the machine if the browser tab closes, crashes, is discarded or sleeps, or if USB is lost. The controller keeps running its queued moves.
4. It cannot turn off a spindle, laser or coolant if the controller does not obey or the link is lost. On TinyG a feedhold, a program stop (M0/M1) or a tool change (M6) leaves the spindle running.
5. It cannot see your wiring, your switches, your workpiece or the people around the machine.
6. Its preview and bounds checks use its own interpreter and can disagree with the firmware.
7. It cannot detect mechanical faults: lost steps, loose couplers, broken switch wires.
8. A completed bring-up journey records what you attested and what small tests showed. It does not mean the machine is safe.
9. Your account stores files and settings. It does not make them correct or safe for a machine. Review every change before you use it.
10. It is not certified to any safety standard.
11. It cannot protect you if the code served at run.synthetos.com is itself replaced by an attacker. Keep your E-stop within reach.

---

## 8. Safety review checklist

Required on every PR that touches `machine`, `protocol`, `safety`, `flasher`, `schema` (allowlists and schemas), `testkit` device models, jog/control/firmware UI, the run Worker headers, or any code that moves data between `cloud` and the machine path.

A second reviewer signs the "Safety review" approval. CODEOWNERS makes the owner a required reviewer for:
- `SAFETY.md` (the in-repo copy);
- `packages/safety/src/strings.ts`;
- `packages/safety/src/allowMatrix.ts`;
- `packages/protocol/src/dialects/**`;
- `packages/schema/allowlists/**`;
- `packages/machine/src/stop*.ts`;
- `packages/flasher/**`;
- `safety-advisory.json`;
- `firmware/manifest.json`;
- `workers/run/src/headers.ts`.

OLD-S §8 items 1–21 all apply. Read "sim" as `testkit`, and read item 20 as covering 0x18 and 0x04. Added:

22. ☐ No network API identifier is used in `protocol`, `safety`, `machine` or `flasher`, and nothing in those packages imports `contracts` or `apps/web/src/cloud`.
23. ☐ No code path applies a stored profile, wiring-derived setting or settings backup without C19 or C5 and the write pipeline.
24. ☐ Nothing uploads facts, confirmations, overrides, acknowledgements or pending-restore records. The sync schema is unchanged, or this document is updated in the same PR.
25. ☐ Library jobs are loaded fully and hash-verified before Arm. No code streams from the network.
26. ☐ Sign-out, account switching and deletion of the armed file are denied while LIVE. No sync UI appears over the safety chrome while LIVE.
27. ☐ All reads go through the per-dialect allowlist. No new readable token is added without review.
28. ☐ Dialect selection uses the capability probe and manifest, not `fb` alone.
29. ☐ ^D (0x04) and ENQ (0x05) are emitted only on `tinyg-en` and only by the intents named in §3 and §4.
30. ☐ Program stops are host barriers on every TinyG dialect. The final M2/M30 holdback is intact.
31. ☐ The test kit is not reachable from any production entry (dependency rule plus bundle scan).
32. ☐ API changes keep the CSRF rules (Origin, custom header, JSON only, no CORS) and scope every query by the session's user id.
33. ☐ Feedhold, Stop job and Spindle off now stay allowed in every connected overlay; the allow-matrix generator (T-S62) passes.
34. ☐ No user-visible string calls a hold "STOPPED"; the pause control carries W2.
35. ☐ Every check that needs `stat`, `vel`, `hold`, `qr` or `mpo` uses polled reads with `tid`, not filtered status reports.
36. ☐ Every new profile field is classified (firmware setting, host gate, descriptive), and host-gate loosening goes through C19.
37. ☐ Provenance fields are server-written; no API accepts a client-supplied `created_by_*`, `device_id` or `taken_at`.
38. ☐ No sanitised line can queue more than the queued-motion ceiling.
39. ☐ The connect sequence writes `{"sr":null}` first and no ENQ before a footer revision 2/3 (H49, PN §2.3).
40. ☐ Console (MDI) motion and spindle-on lines go through preflight, the ceiling and the target confirmation; no console path writes to the Transport except through `MachineSession` and `safety.allowed`.
41. ☐ Phase 2: every motion line matches the closed grammar of the motion command kind (§4.5b); no jog ever queues more than the lookahead; `%`, `~` and `{"clear":null}` come only from their named sequences; the motion flag stays off for the production host (T-S93).
42. ☐ Settings writes stay behind the phase switch (`SETTINGS_WRITES`, production off), the approval gate and the idle gate; one token per line with its answer awaited and a read-back; a backup before every apply; no forbidden, identity or communication key is writable.
43. ☐ (amendment 2026-11-02) Nothing polls while idle: no periodic GET, only the confirming reads §4.2 lists and one read-back per change; the full state is read at every connect; liveness comes from reports and the heartbeat (STALE after the silence window).
44. ☐ (amendment 2026-11-02) The status report list, `sv` and `si` are written only where they differ, one line at a time with a read-back, through the `report` kind and the `reports` release gate; never a `ram` key; the change is shown (W35, W36) and logged.
45. ☐ (amendment 2026-11-02) Homing, G28.3, G92/G92.1 and G54..G59 are separate intents with their confirmations (C4, C26–C29) and read-backs; each motion line kind comes only from its intents; UNKNOWN always offers its exits.

---

## 9. Hardware-in-the-loop release checklist

Manual, and never in CI. Signed in `RELEASES.md` in the run repo, with the evidence attached: the browser transcript (EventLog export), the `tinyg_hil` run record, and Saleae captures where listed.

### 9.1 Bench rig (D10)
- TinyG v8 running the edge-next candidate image. A second TinyG on stock 440.21 for the fallback dialect (Phase 6). Due+gShield later.
- Unloaded motors on a fixture. No cutter.
- **A real hardwired E-stop that cuts Vmot.**
- On J6: a spindle LED, an active-low relay module and a logic probe (Saleae on J6 and on the step lines).
- A per-port USB power switch (uhubctl or similar), for host-loss tests.
- An Atmel-ICE for output reads (EN-HIL `tinyg_hil/ice.py`), optional.
- Chrome or Edge with `SerialAllowUsbDevicesForUrls` scoped to staging (B-POL-1).
- The bench runner takes the EN-HIL port lock `/tmp/tinyg-hil-<port>.lock`, snapshots settings with `python -m tinyg_hil`, drives the browser against **staging, running the exact attested artifact**, then restores settings and releases the lock.

### 9.2 Phase 1: bench read-only
- **HIL-1.1** Connect and identify EN. The transcript contains only allowlisted JSON GETs, ENQ and `!` (from the Stop button). Classification is `tinyg-en`, full. Record the probe answers (B-PROBE-1).
- **HIL-1.2** Connect to stock 449.01 (if available) and 440.21. Expect READ_ONLY (449) and fallback-classified READ_ONLY (440 until D22). The transcript contains no G-code.
- **HIL-1.3** C1 per session: same-day reconnect gives the short form; the next day gives the full form.
- **HIL-1.4** Two boards. The id binding works. Two profiles with the same board id: nothing is auto-selected.
- **HIL-1.5** Pull USB, reconnect: UNKNOWN. Press reset mid-session: the bare-`sr` banner leads to FAULT and then UNKNOWN.
- **HIL-1.6** Connect while another tool is running a buffered job on the board: no writes; state displayed correctly.
- **HIL-1.7** Stop request from a second tab while the controlling tab's main thread is frozen: `!` appears in the transcript.
- **HIL-1.8** Allowlist: run the app's "read all settings" and status polling for 10 minutes; the transcript contains no denied token (B-MD-1 evidence kept separately).
- **HIL-1.9** Feedhold during a slow move started from the EN-HIL harness: the hold is confirmed by a report; latency is recorded.
- **HIL-1.10** Orphaned motion (H14): start a slow job with M3 from the EN-HIL harness, hold it with a full planner and an RX backlog, kill the browser tab, reconnect. Expect ORPHANED_MOTION with W32; only Stop job and Reset controller offered; `~` never written; Stop job ends with the LED off.
- **HIL-1.11** Tabs and port exclusivity (B-EXCL-1): with the port open in Chrome, try Edge, a second Chrome profile and CNCjs, on Windows, macOS and Linux, and record whether each open is refused. Kill the controlling tab: the observer shows W29. Block the worker: an unacknowledged stop request shows STOP NOT DELIVERED.
- **HIL-1.13** (*amendment 2026-11-02*, push-driven state) Connect run to a board whose status report list is the firmware default: the transcript shows the full state read, then `{sr:{...}}` once, its read-back, `{"rt":null}` and `{"rt":{"hb":1000}}`; W35 is shown. Reconnect: no list write. Then leave the board idle for 10 minutes: the transcript holds no line from run, only heartbeat lines and reports. Move the machine from the EN-HIL harness: the position follows from reports. Pull the USB data line or stop the board's output: "No reports from the board" within 3 s. Afterwards CNCjs still works with the longer list.
- **HIL-1.12** Partial-line splice (B-SPLICE-1, H49): with a second program, leave `G0 X1` (of `G0 X100`) and, separately, a partial `$xvm=1` in the RX ring, close that program, then connect run. The transcript starts with `{"sr":null}`; the board reports an error for the spliced line; no motion (Saleae on the step lines) and no setting changed.

### 9.3 Phase 2: bench motion (jog, home, zero, stop job)
- **HIL-2.1** Every jog increment. First move 0.25 mm with the step count matching C3. M400 barrier present after each jog (EN).
- **HIL-2.2** Key held, then window switched: no runaway. A lost pointerup: one move only.
- **HIL-2.3** First-move scaling check with a deliberately wrong `tr` (set with the harness): the user sees the mismatch.
- **HIL-2.4** Homing on every axis with the existing travel; C4 states the computed search distance. Switch re-test required before the first homing of the session.
- **HIL-2.5** Set work zero (G10 L2 and, on EN, L20): offsets read back; preflight invalidated.
- **HIL-2.6** **Stop job (EN ^D)** during RUN, HOLD, a G4 P10 dwell and an M3 spin-up: Saleae shows the spindle/coolant pins off within the measured time; alarm 207; position kept; the clear and E114 verification pass (B-KILL-1). Repeat 50 times during motion (B-E114-1). Repeat once with the host not reading (reader paused until the TX buffer is full) and record the ^D latency, which depends on the main loop (PN §9.1).
- **HIL-2.7** Pause during a G4 dwell: `!` has no effect (B-FH-1); on EN the session sends ^D automatically (`dwellStop`) and the LED goes off; W26 shown.
- **HIL-2.8** Spindle off now: EN idle `M5`; EN running → ^D path.
- **HIL-2.9** Limit switch hit during a jog (switch pressed by hand): ALARM 203, axes un-homed, recovery card, re-home required.
- **HIL-2.10** Reset controller: W18 and C15, `^X` written exactly once, UNKNOWN.
- **HIL-2.11** Outputs test with the relay module: record the relay state at power-up, reset and flash entry (B-IO-1, PN §13.1 boot float).
- **HIL-2.12** Hold timeout: hold with M3 on; the W31 countdown runs; at zero ^D is written (EN) and the LED goes off; "Keep paused" restarts the countdown.
- **HIL-2.14** (*Phase 2, 2026-11-02*) Press-and-hold jog on each axis, then release; repeat ending with a window switch, a hidden tab and a frozen page (no renewals): each ends with `!` then `%` within the H50 bound, and `hold` reads 0 afterwards. Stop job during a jog with M3 on: `!`, `%`, `M5`, `M9`, the spindle LED off, "Stopped: queue cleared, spindle and coolant off". Go to zero from below the safe height: Z rises first.
- **HIL-2.15** (*amendment 2026-11-02*) Homing from the Home tab and from the UNKNOWN banner: C4 names the axes and the search distance; only configured axes are offered; G28.2 once; IDLE_HOMED with `hom` read back. Repeat with Pause and with Stop job mid-homing: the axes read not homed. Repeat with a switch unplugged, hand on the E-stop, and record where the axis stopped (H65, H66).
- **HIL-2.16** (*amendment 2026-11-02*) On a board with homing off: the explanation and Set machine position here (C26); G28.3; UNKNOWN cleared; the position read back (H67).
- **HIL-2.17** (*amendment 2026-11-02*) Offsets: select G55, Set work zero (G10 L20 P2), read back; G92 on X and Y, the temporary offset shown apart; reset the board: the temporary offset is gone and the page shows it after the reconnect read; G92.1 clears it (H68).
- **HIL-2.13** Hardwired E-stop (Vmot cut; TinyG logic is powered from Vmot, so the board stops): press it during a slow jog and during a held job. The app goes STALE then FAULT (or LOST if USB drops, B-PWR-1), never resends a line, and shows the recovery card. When Vmot returns, the banner after Ready gives FAULT then UNKNOWN; homing is required; record the J6 relay state during power-up (boot float, PN §13.1).

### 9.4 Phase 3: bench streaming (first real job)
- **HIL-3.1** A 100k-line job on EN. No FAULT. Free-header gating and XOFF observed. Lines in flight ≤ 10.
- **HIL-3.2** Feedhold latency during streaming, including under XOFF and with the ring near full (B-FC-1); `!` written while XOFF is in force.
- **HIL-3.3** Hold and resume (C9) mid-job; the preview progress follows `line`.
- **HIL-3.4** Stop job mid-job: LED off within the measured time; alarm 207; clear; E114 verification.
- **HIL-3.5** M0 and M6 (C14): the streamer stops at the barrier; PROGRAM_PAUSED only after drain; the LED stays on at a bare M0 (W17); with C14 the LED goes off; resume needs the spindle restart. (On 440.21 in Phase 6: the machine stops at the barrier even though the firmware would not.)
- **HIL-3.6** Pull USB mid-job (USB power switch): the measured overrun is at most the displayed mm bound; time recorded against the estimate; **the spindle LED state after drain is recorded** (expected: still on, matching W5).
- **HIL-3.7** Hide the tab for **at least 15 minutes**, then lock the screen (OS sleep disabled) for 15 minutes, then disconnect a remote-desktop session that was viewing the console: the job continues (`drain`), no heartbeat FAULT occurs while hidden, and the wake lock is re-acquired on return (B-HIDE-1).
- **HIL-3.8** During the job: expire the session, sign out in another tab, and disconnect the network: the transcript is unaffected; W22 shown.
- **HIL-3.9** Preflight blocks an arc past the envelope. EN arc soft-limit alarm when the check is bypassed through the harness.
- **HIL-3.10** An alarm mid-job (limit switch pressed by hand): FAULT, the firmware alarm stops the spindle (EN), no further lines are sent, and the buffered final M30 is not sent (B-M30-1).
- **HIL-3.11** EMI or plug-cycle stress test, if possible; E162 status 13 handling observed if an overrun can be provoked (B-N-1).
- **HIL-3.12** Watchdog with G4 P10 and spin-up delays (B-WD-1); ENQ probe latency with a full planner (B-ENQ-1).
- **HIL-3.13** Audible alarm on USB pull; W3 announced by a screen reader.
- **HIL-3.14** Wake lock held from Arm to DONE, STOPPED and FAULT; Start refused when the Wake Lock API is denied (C21 path).
- **HIL-3.15** A long single line (`G1 X300 F100`) and a long G2: the streamer sends split sub-segments; pull USB mid-move; the measured overrun is at most the displayed bound and the ceiling.
- **HIL-3.16** A job with a mid-file G92 and G10 L20: the machine DRO and the live marker (polled `mpo`) stay correct; stop verification under filtered reports gives no false W12 (B-POLL-1).
- **HIL-3.17** Integrity FAULT during a job (inject a `tid` mismatch through the harness): `!` then ^D immediately, LED off. Liveness FAULT (freeze the main thread while visible): `!`, W33 countdown, then ^D. Resume is not offered after either.

### 9.5 Phase 4: settings write and configuration
- **HIL-4.1** Write and read back each risk class, including `spep`, `spdp`, `prbp`. Rollback works.
- **HIL-4.2** A write during motion: 106 plus `er` (EN) and status 9 (TG) are handled as refusals.
- **HIL-4.3** Units restored after writes.
- **HIL-4.4** Apply a stored profile with C19: only the diffed keys are written; a connect with a newer cloud revision writes nothing until confirmed (T-S42 on hardware).
- **HIL-4.5** Temporary homing cap: pull USB mid-homing, reconnect, NEEDS_REVIEW, C17 restore; values read back equal to the snapshot (B-HOME-1).
- **HIL-4.6** After a polarity write: W20; `dir.*` cleared; the direction test is required.
- **HIL-4.7** After a session, CNCjs connects and streams correctly (no normalisation was written on EN).
- **HIL-4.8** (amendment 2026-11-02, B-EEPROM-1) EEPROM stall: time a persisted write, and send a GET during it from the EN-HIL harness: record how long the board stalls and which bytes are lost. With run, apply 10 changes with the `mpo` and readout pollers running: the transcript shows each write's answer before the next line, and every read-back matches.
- **HIL-4.9** (amendment 2026-11-02) High-risk changes on the bench: change `st` and one `xsn` with the switches wired. The confirmation names the consequence and needs the ticks and WRITE. After applying, the switch test shows the inverted reading. Revert from the backup restores it, read back.

### 9.6 Phase 5: flasher
- **HIL-5.1** B-FL-1 on EN: interrupt after the stub, mid-pages, and just before the final page 0; the board stays in xboot and a retry succeeds. Watchdog during `e`; a 2 s host stall; a power cut and a USB pull during the final page 0 write (record the outcome).
- **HIL-5.2** B-FL-2: scope PF5/J6 SpinDir, the spindle and coolant pins (EN boot float interval), and DRV8818 ENABLE and STEP during reset, in xboot and while settings load.
- **HIL-5.3** Image approval run (D5) for the exact EN release image: the EN-HIL suite (motion gate on) plus Phases 1–4 of this checklist. Signed per image hash.
- **HIL-5.4** Leave the flasher without restoring: C18; homing and jog blocked.
- **HIL-5.5** Restore from a cloud-saved backup chosen explicitly (not the default): machine, board id, `fb`, date and provenance shown; diff against the local baseline; mapper and C5; read-back matches.
- **HIL-5.6** Flash 440.21 → EN, then EN → 440.21 if the downgrade is approved; the mapper output is reviewed.
- **HIL-5.7** Flash a board whose snapshot has `spep=0`, with the active-low relay on J6: record the relay state from flash start to restore read-back (expected ON during defaults, which is why W28 isolation exists); kill the tab after the flash and reconnect: the restore is forced first (`flashRestorePending`); C18 is a hard stop.

### 9.7 Phase 6: public beta and 440.21 fallback
- **HIL-6.1** Repeat HIL-1.x to HIL-3.x on stock 440.21 with the TG dialect: byte window with the rev-1 cross-check; no 0x04, 0x05, 0x11 or 0x13 in the transcript; the M0 barrier stops the machine; G18 arcs blocked; Stop job flush sequence; E128 reset caveat shown.
- **HIL-6.2** Guided bring-up end to end on a clean board: B0 to B7.
- **HIL-6.3** Shared-computer flow: user A logs out, user B logs in; facts and pending restores survive; the cloud cache is cleared.
- **HIL-6.4** The production deployment equals the staging artifact (code hash). The HIL record identity is (code hash, manifest hash). Production rejects bench-channel manifest entries by their signed environment field. Headers verified.
- **HIL-6.5** **Real loaded machine** (the bench fixture has no cutter and no mass): on a real machine with a real spindle or VFD, a Z axis that can drop and a tested hardwired E-stop, on staging with the release-candidate artifact: HIL-2.4, 2.6, 2.13, 3.4, 3.5, 3.6 and 3.15, plus a real cut from a library file. Record spindle run-down time after ^D and after the TG flush, the measured overrun against the displayed bound with real mass (re-tune k, B-WD-1), and whether Z holds after alarm 207 and after an E-stop. Repeat on 440.21 if D22 enables it.

### 9.8 D8 heartbeat (only for an image that advertises the `cap` bit)
HB-1..HB-14 as listed in PN §14 and the research record:
- HB-1: a long G1 with M3 and M8; stop ENQ with the port open. Measure the last ENQ to braking (≤ T + 20 ms) and hold to the pins going off.
- HB-2: cut USB power.
- HB-3: kill the tab, the browser and OS sleep.
- HB-4: idle with the spindle on.
- HB-5: a user hold with the spindle on.
- HB-6: M0 pause.
- HB-7: G4 P30 followed by G1; the G1 never runs.
- HB-8: lose the host during homing and probing, 200 times (no E114 hang).
- HB-9: no false trips in a 100k-line job, a full planner, M400 waits, XOFF bursts, and jitter up to T − ε.
- HB-10: `hbt`=0 never trips; the CNCjs connect replay passes; ^X resets `hbt`; nothing is persisted.
- HB-11: main loop blocked; the backstop trips.
- HB-12: trip-time distribution over 1000 trials.
- HB-13: no double action during an existing alarm; re-arm after `{clear}`.
- HB-14: re-run HB-1 once E060 lands.

W5-HB may ship only for that exact image after HB-1..HB-13 are signed; for an image that also carries E060, HB-14 must be signed as well.

---

## 10. Safety test cases (automated)

OLD-S T-S1 to T-S37 remain, adjusted as follows:
- **T-S1, T-S2:** add EN rules (M201.3 and L ∉ {2,20} rejected) and TG rules (G18 arcs, G28/G30 under G20/G91, G28.4, `E` words, more than 3 queued commands per line). Inserted C14 lines are marked as barriers.
- **T-S3:** generated over every overlay × base-state cell; the stop-class intents are allowed in every connected cell (with T-S62).
- **T-S4:** three TinyG tables. EN 12 → shutdown, 13 → panic, 203 → limit, 207 → job kill.
- **T-S9:** per dialect. TG `!` + `%`; EN stop feeding + FAULT.
- **T-S10:** both banner shapes.
- **T-S17:** "previous-session banner overrides NOT CONNECTED".
- **T-S23:** per dialect. EN ^D → 207 → C13 → E114 verification; TG flush sequence.
- **T-S24a:** 0x04 is never sent to `tinyg-440`, `tinyg-449-stock` or unclassified boards, and is sent on EN only by `stopJob`/`spindleOffNow` and their derived policies `faultStop`, `holdTimeout` and `dwellStop`.
- **T-S24b:** 0x05 is never sent to TG; during the probe it is never sent before a footer revision 2/3 has been seen; after classification it is sent only on `tinyg-en`.

New tests:

| ID | Test | Layer |
|---|---|---|
| T-S38 | Read allowlist: fuzz every read path (status polling, "read all", console, settings editor, probe) over all dialects. No token outside the allowlist is emitted; `adc3`, `md`, `me`, `alarm`, `panic`, `shutd`, `er`, `clear`, `clr`, `boot`, `jog*` are never emitted as GETs. | U, M |
| T-S39 | Built app has no raw-send API: the only code that writes to the Transport is `MachineSession`; no panel module imports the transport. | U (dependency rule), R |
| T-S40 | Production bundle contains no test-kit marker export and no `transport=` query handling. | CI bundle scan |
| T-S41 | No element in the production app offers Play/Simulate; the NOT CONNECTED band is present whenever no port is open; the live marker moves only on `mpo` reports. | E |
| T-S42 | Connect with a newer cloud profile revision: zero settings writes in the transcript until C19; NEEDS_REVIEW and W23 shown. | E, M |
| T-S43 | Trust anchor: SAME for a previously run hash; NEW for an unseen hash; CHANGED for a new version of a file run before (diff offered). A tampered server fixture serving altered bytes with matching metadata shows a hash mismatch hard stop. | E, U |
| T-S44 | During a streamed job on the mock device: session expiry, sign-out in a second tab and network loss produce zero change to the TX byte stream; W22 shown. | E |
| T-S45 | CSRF matrix: POST/PUT/DELETE to every mutating API route from (a) a synthetos.com test page, (b) a missing custom header, (c) a wrong Origin, (d) a form-encoded body. All refused; no CORS headers in any response. | S, E |
| T-S46 | Shared computer: logout clears `cloud-cache:<userId>` and keeps `device-safety` (pending restore, facts, trust anchor). Logout while LIVE is denied. | E |
| T-S47 | The sync schema has no fact, confirmation, override, acknowledgement or pending-restore fields; the API rejects unknown fields; a server response containing facts is ignored. | U, S |
| T-S48 | EN M2/M30 holdback: in random job and alarm interleavings the final M2/M30 is never written while an alarm is active or earlier lines are unacknowledged. | M |
| T-S49 | Host barrier: after an M0/M60/M1(enabled)/C14 line, no further data bytes are written until stat 3/4, `qr` = plannerBlocks and `vel` = 0 are observed; on both dialect models (the TG model does not pause on M0). | M |
| T-S50 | Two machines with the same board id: nothing is auto-selected; a profile whose bound device differs is a hard block. | M, E |
| T-S51 | Download integrity: a single flipped byte gives a hard stop with no confirm path. Name sanitiser strips bidi overrides and zero-width characters; names render inside `<bdi>` via `textContent`. | U, E |
| T-S52 | Deep links (`/p/<id>`, `/m/<id>`, any query string) never load, select or arm a job, apply a profile, or open a port. | E |
| T-S53 | Concurrent profile edits: the second save gets 409 and a diff; no silent overwrite. | S, E |
| T-S54 | Dwell: with the executing line a G4 (EN `line`), Stop shows W26 and highlights Stop job; `!` is re-sent at the first motion. | M, E |
| T-S55 | Classifier fixtures: EN probe answers → `tinyg-en`; the same `fb` without capability tokens → `tinyg-449-stock` READ_ONLY; 440.21 rev-1 → `tinyg-440`; conflicts → READ_ONLY; an unapproved EN `fb` → READ_ONLY. | U |
| T-S56 | E114 verification: after a test-kit stop where `hold` stays non-zero or `qr` stays short, the session stays in FAULT with W12; no motion intent is allowed. | M |
| T-S57 | No network identifiers in `protocol`, `safety`, `machine`, `flasher` (lint), and `workers/run` imports no safety-path package. | U (lint, dependency rule) |
| T-S58 | Sign-out, account switch, armed-file delete and profile switch are denied in every LIVE state (generated over the allow-matrix). | U |
| T-S59 | Sync pauses while RUNNING/HELD/BARRIER_DRAINING/STOPPING_JOB (no fetch from the sync worker in those states). | E |
| T-S60 | ORPHANED_MOTION: connect to a model that is held, program-paused, moving or has a non-empty planner or RX backlog → ORPHANED_MOTION; only Stop job and Reset controller allowed; `~` never written; a busy board is not classified READ_ONLY. | M |
| T-S61 | FAULT policy: an integrity FAULT during a job emits `!` then ^D (EN) or `!` `%` `M5` `M9` (TG) at once; a liveness FAULT emits `!` then ^D after the grace period unless the operator acts; `ackFault` cannot complete while `hold` ≠ 0 or the planner is not empty; Resume is never allowed after a FAULT. | M |
| T-S62 | Stop-class always allowed: generated over every overlay × base-state cell, feedhold, Stop job and Spindle off are allowed whenever the port is open; Home is denied under FAULT, STALE and ORPHANED_MOTION. | U |
| T-S63 | Hold presentation and timers: no rendered string calls a hold "STOPPED"; the hold timeout emits ^D (EN) or the flush sequence (TG); Pause during a dwell emits ^D on EN. | U, M, E |
| T-S64 | Long-move splitting: no sanitised line has a modelled duration above the ceiling; the split path equals the original path within tolerance (lines and arcs, G90 and G91, mm and inch). | U (property) |
| T-S65 | Visibility-aware heartbeat: 15 virtual minutes hidden → no FAULT; a frozen main thread while visible → liveness FAULT. | M, E |
| T-S66 | Wake lock: requested at Arm, released at DONE/STOPPED/FAULT, re-acquired on visible; Start refused without it unless C21. | E |
| T-S67 | Filtered reports: with the model in `SR_FILTERED` and `QR_OFF`, stop verification and barrier drain complete through polled reads and never raise a false W12. | M |
| T-S68 | Mid-file G92 and G10 L20: the machine DRO and live marker follow polled `mpo` and stay correct. | M, E |
| T-S69 | Profile field classes: a host-gate loosening (spindle kind away from laser, a larger ceiling, larger jog caps) is not used without C19; the envelope comes only from `tn`/`tm`. | U, E |
| T-S70 | NEEDS_REVIEW resolved by "Keep the board's settings" emits zero serial writes and creates a new profile revision. | E, M |
| T-S71 | Restore source: after a flash the restore pre-selects this run's local snapshot and diffs against it; another backup needs an explicit choice showing machine, board id, `fb`, date and provenance; a cloud backup with no local baseline is labelled and needs a typed review. | E |
| T-S72 | `flashRestorePending`: a tab killed after the flash forces the restore on the next connect; C18 is a hard stop when the snapshot has `spep=0` or the profile or wiring says active-low. | E, M |
| T-S73 | Tabs: an observer shows W29 when the lock is released; an unacknowledged stop request shows STOP NOT DELIVERED; with two machines LIVE a stop reaches both; the worker ignores non-stop messages on the channel; destructive storage operations are refused while any machine lock is held. | E |
| T-S74 | Machine binding: selecting a different machine for the same board id invalidates `dir`, `scale` and `homing` facts; SAME needs the same machine and operation. | U, E |
| T-S75 | Signed manifest and advisory: the production origin rejects bench-environment entries by signature; an expired cached advisory fails closed; a revocation while LIVE denies Arm, Start and jog but never a running job or a stop. | U, E |
| T-S76 | End state: a file ending with the spindle or coolant on is blocked until C22; DONE shows the commanded state. | U |
| T-S77 | Mobile OS: no Connect control and no LIVE entry on a mobile OS even when `navigator.serial` exists. | E |
| T-S78 | Provenance: the API rejects client-supplied `created_by_*`, `device_id` and `taken_at`; "made on this computer" appears only when the local device signature verifies; W24 uses session ids recorded locally. | S, E |
| T-S79 | OAuth state binding: a callback without the pre-auth cookie, or with a cookie from another flow, is refused on both legs; first sign-in shows the account interstitial and never imports local data automatically. | S, E |
| T-S80 | RPC: a binding to the wrong entrypoint is refused; `validateSession` refuses a token minted for another client; no user-affecting method takes a raw user id. | S |
| T-S81 | Decompression bomb: an upload whose decompressed hash or length differs from its headers is rejected; a client load aborts at the byte cap; library decompression is denied in job states. | S, E |
| T-S82 | Open redirect: `//host`, `/\host` and `//2130706433` are refused as `return_to`. | S |
| T-S83 | Step-up with a GitHub subject not linked to the user fails, is audited and revokes the session. | S |
| T-S84 | GitHub webhook: a bad `X-Hub-Signature-256` or a replayed delivery id is refused. | S |
| T-S86 | Connect sequence: in every connect path (fresh, reconnect after LOST, after W6) the first line written is `{"sr":null}`; a reply to that first line with no `sr` key (a leftover fragment joined it, whether rejected or run: measured 2026-11-02, H49) leads to ORPHANED_MOTION unclassified, and so does no response, with only `!` and Reset controller allowed. | M, U |
| T-S87 | ENQ ordering: across random probe interleavings, 0x05 never appears before a rev-2/3 footer, never on a rev-1 board, and after classification only on `tinyg-en`. | M |
| T-S88 | Console (MDI): a motion line outside the envelope, a first feed without F, a line above the ceiling (split), an unhomed move beyond the jog caps, JSON, `$` and realtime bytes are refused or split; motion lines need the target confirmation; the console is denied under every overlay and while a job is armed or running. | U, M, E |
| T-S89 | Jog state machine (Phase 2): a step is fed in pieces with at most 2 queued; Hold stops on release, on a missed keep-alive, and (in the page) on blur and on hidden; LOST ends the feeder with nothing more written; a new jog is refused while one runs. | U, M |
| T-S90 | Stop sequence (Phase 2): `!`, polled hold, `%` only once held and every line answered, polled empty, `M5`, `M9`, then "Stopped: queue cleared, spindle and coolant off"; a timeout is W12 and FAULT; Pause and Resume write `!` and `~` only for this session's hold. | U, M, E |
| T-S91 | Go to zero (Phase 2): Z raised first in machine coordinates and never lowered first, X and Y next, Z last, each after polled idle. | U, M, E |
| T-S92 | Motion preconditions and control allowlist (Phase 2): motion controls are enabled only with the flag on, a classified approved board, no overlay, no alarm and no job; Pause and Stop job stay enabled. | U, E |
| T-S93 | Motion flag: on for loopback and staging only, off for `https://run.synthetos.com` and every other origin. | U |
| T-S94 | Write gate (Phase 2): the motion grammar admits exactly its line shapes with bounded numbers; anything else, and any motion line under `PHASE_1_RELEASE`, is refused. | U |
| T-S85 | Output encoding: download `Content-Disposition` uses RFC 6266 `filename*` with a forced `.nc`/`.gcode` extension; export zip entry paths are ids; SVG export escapes labels and is only downloaded; strings from the serial port render via `textContent` with bidi sanitising. | U, E |
| T-S95 | Settings writes, session (amendment 2026-11-02): only one write at a time (a second is refused until the first is done). The gate reads (`stat hold vel qr unit`), then exactly `{"<key>":<value>}`, then the read-back GET, with no other line while the write is unanswered. Forbidden, identity, readout, `rt*`, communication and unreviewed keys are refused at the intent and by the write gate. The write gate accepts a settings line only as the `setting` kind, for the exact key and value being written. | U, M |
| T-S96 | Settings plan: communication keys are ordered last and `jv` very last. Switch, homing, motor, motor-map, axis-mode, travel, soft-limit, polarity and communication keys are high-risk with a named consequence. A refused value refuses the whole plan. A restore maps by token name and skips identity, readout, forbidden and unreviewed keys with reasons. Read-back compares at table precision. | U |
| T-S97 | Idle gate: a board that is running, holding, moving, has moves queued, is in inches, or does not answer a gate read is not written (`refused`, with the reason in plain words). An `er` 106 during a write is a refusal, not a FAULT. A FAULT or a lost link interrupts a write in progress. An unanswered write is `unconfirmed`. | U, M |
| T-S98 | EEPROM stall: against the test-kit edge-next model with the stall modelled, writes with reads queued behind them lose zero bytes, persist, and read back verified. | M |
| T-S99 | Apply and revert: a backup is taken (and downloaded) before the first write, and none is written if it fails. Writes go one at a time, each after the previous result. The run stops at the first failure, marks the rest not written, and offers revert. Revert writes the backed-up values back through the same path. Fake-serial: edit a setting, apply, backup downloaded, read-back verified, persisted, revert. | U, E |
| T-S101 | (amendment 2026-11-02) Connect sequence: after READING the full state is read once; the status report list is written only when it differs from run's and read back; `sv` and an absurd `si` likewise; the heartbeat only when `{"rt":null}` answers; refusals, read-backs that differ, damaged and missing answers are recorded and never assumed; never a `ram` key; configured only after an alarm at connect is cleared. | U, M |
| T-S102 | (amendment 2026-11-02) No periodic polls: a configured session idle for a minute writes nothing; a move made by another program reaches the page by a pushed report. | M |
| T-S103 | (amendment 2026-11-02) Liveness: with the heartbeat on, no line for the silence window is STALE and nothing is sent; any line clears it; without the heartbeat the fallback asks once per idle window. | U, M |
| T-S104 | (amendment 2026-11-02) Homing: only configured axes, one G28.2, two polled reads at rest (three if the cycle was never seen), the read-back, IDLE_HOMED only when homed; Pause ends it (`!`, `%`), Stop job runs the flush sequence; a refused G28.2 ends without a hold. | U, M, E |
| T-S105 | (amendment 2026-11-02) UNKNOWN exits: "I've checked the machine" clears it (also without motion), homing X, Y and Z clears it, G28.3 clears it when X, Y and Z read homed; the banner offers the actions. | U, M, E |
| T-S106 | (amendment 2026-11-02) Offsets: G54..G59, G10 L20 in the active system, G92 and G92.1, each through its own intent, confirmation and read-back; a refused line says so; the grammar and the per-intent line kinds. | U, M, E |
| T-S107 | (amendment 2026-11-02) Test-kit edge-next reports: change-filtered, the first request wins and values are sampled at print, a short state is missed, a persistent one appears within `si`; the sr list GET and SET; rt and heartbeat lines; G28.2, G28.3, G92 and G92.1. | M |
| T-S100 | Phase switch and controls: `SETTINGS_WRITES` is pinned (staging on, production off). The worker turns the `settings` kind on only for the staging and loopback origins. The settings controls are disabled in the prerendered page, and enabled only when the switch is on and the board is approved, identified, read and idle. | U, E |
