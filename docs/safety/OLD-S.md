# Synthetos Machine Tools: safety case

Status: design, dated 2026-10-31. This document outranks TOOLS_PLAN.md: where the two disagree, this one wins.

Firmware references:
- `TG` is TinyG 440.21, `firmware/tinyg/`.
- `G2` is g2 edge-preview 1fb5940, `g2core/`.
- `XB` is the xboot bootloader.

Anything not confirmed in source or on hardware is marked **UNVERIFIED** and carries a bench task (`B-*`, listed in PROTOCOL_NOTES §14) or a citation task (`CIT-*`: CIT-1 ISO 13850 clause; CIT-2 EU 2023/1230 application date; CIT-3 source for "do not hot-plug steppers").

**Approach.** We follow the ISO 12100 order of risk reduction:
1. Design the hazard out.
2. Guard against what remains.
3. Inform the user about what is left after that.

Warning text is never accepted as a substitute for a design measure that would have been feasible.

---

## 1. Scope and intended use

**What the software is.** A browser-based set of tools for configuring, wiring, flashing and operating hobby and light-industrial CNC machines that use Synthetos TinyG (v8, firmware 440.21) and, from Phase 7, g2core controllers.

**Intended users.** An informed adult operator who has:
- built or owns the machine;
- installed a hardwired emergency stop;
- read this safety contract;
- agreed to stay present and attentive while the machine is powered.

**Intended environment.** Desktop Chrome or Edge on mains power. The tools tab is visible in its own window, OS sleep is disabled, and the computer is connected by USB to a single controller.

**What the software is NOT.**
- **It is not an emergency stop and not a safety function.** The on-screen stop sends a feedhold, which is a controlled stop similar to IEC 60204-1 Category 2. It travels over a channel that is not safety-rated, and it may be delayed or never delivered.
- It is not certified to any ISO 13849 performance level. ISO 13850:2015 (https://www.iso.org/standard/59970.html) treats the emergency stop as a complementary protective measure whose required performance level comes from the machine's risk assessment; "at least PLc" is the figure commonly quoted for emergency stop functions, but we have not read the standard text (**UNVERIFIED**, citation task CIT-1: quote the clause from a purchased copy before the safety page goes live). Either way, a browser page cannot claim any PL.
- It is not a guard. It does not detect people, it does not detect fire, and it cannot remove energy from actuators.

**Reasonably foreseeable misuse that we design against:**
- Treating the software stop or the board's reset button as an E-stop.
- Running unattended, or leaving the tab in the background or with the screen locked.
- Running a file without previewing it.
- Pasting configuration found on the forum.
- Flashing the wrong image.
- Wiring 24 V sensors to 3.3 V inputs.
- Using a laser on TinyG.
- Having two machines with identical boards on one PC.
- Having two tabs open.
- Using the simulator and believing it is the live machine.

**Regulatory note.** EU Machinery Regulation 2023/1230 (https://eur-lex.europa.eu/eli/reg/2023/1230/oj) applies from 2027-01-20 (date of application per the Regulation's final article; re-check against the EUR-Lex text, citation task CIT-2). It counts software as a possible safety component and requires resistance to malicious interference. The tools must never claim to perform a safety function, and a product version needs legal review (owner decision D6).

---

## 2. Hazard analysis

**Severity**
- S4: death or serious injury, or fire.
- S3: minor injury.
- S2: machine or tool damage.
- S1: lost work.

**Likelihood before mitigation**
- L4: expected in normal use.
- L3: likely across the user base.
- L2: occasional.
- L1: rare.

**Residual risk** is stated after mitigation.

**Verification codes**
- U: unit or property test.
- M: model-based session test.
- E: Playwright E2E test.
- H: hardware-in-the-loop checklist item (§9).
- R: review checklist item (§8).

### H1. Host loss while the machine is moving
| Field | Content |
|---|---|
| **Cause** | Tab closed, crashed or discarded. OS sleep. USB unplugged. EMI drops the USB link. |
| **Why it matters** | Neither firmware stops when the host goes away. g2core only flushes its RX/TX buffers and turns reports off (G2 xio.cpp:1157-1199, controller.cpp:397-408). TinyG sits behind an FTDI bridge and cannot see the host at all. Up to 32 (TinyG) or 48/60 (g2) planner blocks keep running, plus up to 254 or 1024 bytes of RX buffer. Chromium does not protect a background tab with an open serial port from discard (discard_eligibility_policy.cc has no serial check). |
| **Rating** | S4, L3 |
| **Mitigations** | 1. A hardwired E-stop is mandatory, and the user acknowledges it (§5 W1, C1 at every LIVE session start). 2. Shallow queue: TinyG at most 180 bytes in flight, plus qr gating. **A queued-motion ceiling applies to both flow engines** (TinyG byte window and g2 line window): feeding pauses whenever modelled queued path length exceeds the ceiling. The g2 line window of 4 does **not** by itself bound motion, because each `r` frees a slot at parse time and the 48-60 block planner still fills. 3. A visible overrun display (§4.3): an **upper bound in mm** and an **estimate in seconds** (time is not bounded; see §4.3). 4. Streaming is event-driven in a dedicated worker, so hidden-tab timer throttling does not starve it. 5. A per-machine host-loss policy (§4.3). 6. A loud LOST state with an audible tone, and the next load shows UNKNOWN. 7. Web Lock plus tab hygiene guidance. 8. **Long-term design-out (owner decision D11):** a firmware host-heartbeat in TinyG and g2core that feedholds and turns the spindle and coolant off when the host goes silent. This is the ISO 12100 step-1 fix for H1 and H16; everything above is step 2/3 until it exists. |
| **Residual** | **Medium.** Bounded but non-zero motion after host loss. After the queue drains, the spindle stays in its last commanded state **indefinitely** (on TinyG and on g2 without D11), which is a fire risk with a stalled tool in contact with the work. This is stated plainly in W3 and W5. |
| **Verification** | M: overrun mm bound is at least the measured motion, on **both** flow engines (g2 model test with long segments). H: pull USB mid-job and measure motion; record spindle state after drain (HIL 22). E: LOST banner and tone appear. |

### H2. Real-time bytes or truncation inside job data
**H2a. Real-time bytes in job data.**
| Field | Content |
|---|---|
| **Cause** | TinyG traps `! ~ % ^X` anywhere in the byte stream, including inside comments (TG xio_usb.c:146-161). g2 treats a line beginning with `%` as a queue flush (G2 controller.cpp:279-284). TinyG queue flushes are latched and run later, silently deleting queued moves (TG canonical_machine.c:1259-1288). |
| **Effect** | Surprise hold, resume, deletion of queued moves, or a hard reset. |
| **Rating** | S2–S4, L3 |
| **Mitigations** | The sanitiser (§4.7): strip trailing comments; on TinyG, **reject** lines with text after a comment opener or with unclosed parentheses (TinyG ignores everything after a comment, TG gcode_parser.c:98, :108-109, :134); drop `%` lines; reject any line still containing `! ~ %` or any byte < 0x20 except tab, or ≥ 0x7F. That set explicitly includes 0x04, 0x05, 0x18 and 0x1B. Reject first characters `$ ? H h` and `{`. Reject long lines and never truncate them. Produce a visible report. Preview and preflight interpret exactly the bytes that will be sent. |
| **Residual** | Low. |
| **Verification** | U: properties over a corpus with `(50% stepover)`, `(TOOL CHANGE!)`, `N10 (c) G0X10` and 0x18; property "preview geometry = interpretation of the sanitised byte stream". |

**H2b. Truncated or merged line on stop.**
| Field | Content |
|---|---|
| **Cause** | `writer.abort()` can discard the tail of a line that is partly sent. On g2, appending `\n` then executes the fragment (`G1 X12.5` becomes `G1 X1`). On TinyG, the fragment merges with the next line. |
| **Rating** | S2–S4, L2 |
| **Mitigations** | No abort in the Transport. Each awaited write carries exactly one complete line. `bufferSize` is 256. STOP waits for the current single-line write, then writes `!`. A failed write latches FAULT, and no newline is ever written afterwards. On TinyG, `%` follows any write failure before anything else is sent. On g2, a write failure moves the session to UNKNOWN. |
| **Residual** | Low. |
| **Verification** | M: invariant "no newline after a failed write". R. |

### H3. Motion outside the work envelope
| Field | Content |
|---|---|
| **Cause** | Soft limits are off by default (`sl=0`) and are skipped for unhomed axes (TG canonical_machine.c:480-498; G2 canonical_machine.cpp:885-887). g2 has no arc soft-limit check (G2 plan_arc.cpp:579-593 is commented out). Offsets change between preview and run. |
| **Rating** | S2–S4, L3 |
| **Mitigations** | Preflight in machine coordinates using live WCS, G92 and tool offsets, exact arc extents, and the approach move. G10 semantics are dialect data: on TinyG, which has no L word (TG gcode_parser.c:400; G10 is L2 only, canonical_machine.c:652), preflight **blocks** G10 with any L other than 2, because `G10 L20 P1 X0` would set the offset to 0 rather than to the current position. A first feed move without an F word in the file is a **block** (jog leaves its own F modal behind), unless the confirmed preamble sets F. Arm is invalidated on any change to offsets, coordinate system, units or homing. Run is gated on homed axes; overriding that requires expert mode plus a typed confirmation. We recommend `sl=1`. Every jog target is checked. The preview is labelled advisory. |
| **Residual** | Medium on unhomed machines. Low on homed machines with `sl=1`. |
| **Verification** | U: bounds properties. M. H. |

### H4. Machine state misread
| Field | Content |
|---|---|
| **Cause** | `stat` 11 means SHUTDOWN on TinyG but INTERLOCK on g2. g2 uses 12 for SHUTDOWN and 13 for PANIC (TG canonical_machine.h:306-319 vs G2 :71-86). Limit-hit status is 204 on TinyG and 203 on g2. A feedhold is ignored when nothing is moving (TG canonical_machine.c:1265-1271). Optimistic UI state. |
| **Rating** | S2–S4, L3 |
| **Mitigations** | Per-dialect tables, so the UI shows only firmware-mapped state. STOP displays "requested" until a status report confirms it. `!` is re-sent if motion resumes while the user wants a hold. An identity conflict puts the session in read-only. |
| **Residual** | Low. |
| **Verification** | U: table snapshots. M. |

### H5. Bad settings change how the machine moves
| Field | Content |
|---|---|
| **Cause** | Values written in G20 (F_CONVERT; TG config_app.c:740-750). On g2, JSON lines jump ahead of a queued `G21` (G2 xio.cpp:785-797). TinyG has almost no range checks (TG stepper.c:1187-1197). Writable `hv` and `baud`. The g2 polarity meaning is inverted between 101.03 `mo` and edge `po`. g2 settings are not persistent. Profiles are pasted from elsewhere. Writes are refused during motion with status 9 (TG persistence.c:89-90). |
| **Rating** | S2–S4, L3 |
| **Mitigations** | The write pipeline in §4.6. Exact per-build schemas, with unknown builds read-only. Risk classes and a forbidden list. Profiles are bound to the device id. Cross-schema migrations. Writes invalidate facts. |
| **Residual** | Low. |
| **Verification** | U, M, H. |

### H6. Runaway or oversized jog
| Field | Content |
|---|---|
| **Cause** | A lost keyup or pointerup event. Queued repeat jogs. G91 left active. Steps/mm wrong by 10x or 25.4x. Absolute targets computed from a stale position. |
| **Rating** | S2–S4, L3 |
| **Mitigations** | §4.5: bounded increments only; one jog in flight; key repeat dropped; absolute G53 targets computed only from a report received after the machine went idle; units and distance mode restored and verified; the first move per axis is 0.25 mm at low feed; tight caps while unhomed. |
| **Residual** | Low. |
| **Verification** | M, E, H. |

### H7. TinyG soft alarm keeps moving with limit switches ignored
| Field | Content |
|---|---|
| **Cause** | In ALARM, `_limit_switch_handler` returns early while queued moves continue (TG controller.c:427-433). |
| **Rating** | S4, L2 |
| **Mitigations** | Alarm reflex: on an alarm `er` report or `stat` 2 while the previous state was moving, immediately send `!` then `%` and latch FAULT. |
| **Residual** | Low to medium, because the reflex depends on the link being alive. |
| **Verification** | M: within one read cycle. H. |

### H8. Stale view
| Field | Content |
|---|---|
| **Cause** | Throttling, EMI, a stalled worker. |
| **Rating** | S2, L3 |
| **Mitigations** | Receive-timestamp watchdog: STALE blocks new commands. FAULT plus `!` if a job is running and the stream has been silent longer than 5 s outside known silent periods. Lag badge on the 3D view. |
| **Residual** | Low. |
| **Verification** | M, H. |

### H9. A wrong or lost line executes, or a rejected line shifts every later move
| Field | Content |
|---|---|
| **Cause** | Corrupted bytes. A firmware-rejected arc. Forum topic 4067. |
| **Rating** | S2–S3, L2 |
| **Mitigations** | Host N numbers on every job line. `n` and footer checks. Any non-zero footer status means FAULT. Lines are never resent automatically. N*checksum on g2 builds where it is verified. |
| **Residual** | Low. |
| **Verification** | U, M. |

### H10. Unintended reset or bootloader entry
| Field | Content |
|---|---|
| **Cause** | Opening g2 at 1200 baud (Motate MotateUSBCDC.h:537-548). `{flash}` or `{boot}`. A DTR edge on the Due programming port (Arduino-usbserial.c:294-307). Garbage arriving during the xboot window. |
| **Rating** | S2–S4, L2 |
| **Mitigations** | 1200 baud is impossible without a capability token that only the flasher holds. The programming port (2341:003D) is refused before `open()`. Bootloader keys are on the forbidden list. After a reset the tool waits for the banner and sends nothing before it arrives. ESC is never sent to an unidentified device. |
| **Residual** | Low. |
| **Verification** | U, R. |

### H11. Firmware flashing
| Field | Content |
|---|---|
| **Cause** | A reset drops holding torque, so gravity-loaded axes fall. Outputs float or toggle (xboot blinks PF5, which is the SpinDir LED pin: XB config.mk:156-157, TG hardware.h:124-125; the pin-level effect is UNVERIFIED, task B-FL-2). Wrong image. A half-written image runs: xboot jumps to address 0 unconditionally (XB xboot.c:869), and erased flash acts as a sled. Lock or security bits get set. Settings are wiped. |
| **Rating** | S2–S4, L2 |
| **Mitigations** | §4.8: idle gate; physical checklist including mains isolation of the spindle/VFD/laser and supported Z; identity match; manifest plus sha256 plus strict parse; stub-vector page ordering; commit only after verify; guard filter; automatic backup; motion locked afterwards. |
| **Residual** | Low, once B-FL-1 and B-FL-2 pass. Until then the flasher does not ship. |
| **Verification** | U, M with disconnect at every Nth byte, H. |

### H12. Malicious or compromised code drives the machine
| Field | Content |
|---|---|
| **Cause** | Same-origin XSS. Supply-chain compromise (polyfill.io 2024; chalk/debug and Shai-Hulud 2025). Clickjacking. |
| **Rating** | S4, L1 |
| **Mitigations** | Separate deployable, with a separate origin from Phase 2. Strict CSP with Trusted Types. `frame-ancestors 'none'`. No third-party scripts. Zero runtime dependencies in the safety path. Vendored three.js. A CI job split that keeps the deploy secret only in the deploy job. |
| **Residual** | Low. |
| **Verification** | E: header test. R. |

### H13. Wiring errors
| Field | Content |
|---|---|
| **Cause** | 5 V or 24 V on 3.3 V inputs. An active-low relay runs the spindle when it should be off, or while the board resets (ATxmega pins are expected to be tri-stated during reset, so an active-low module with a pull-down or leakage may switch on; the reset-state claim needs a quote from the XMEGA A manual and the module behaviour needs a bench check: **UNVERIFIED**, B-IO-1 and B-FL-2). Series-stacked power supplies, or a ground offset causing USB cable fire (forum). The reset button used as an "E-stop". |
| **Rating** | S4, L3 |
| **Mitigations** | Wiring rules engine (TOOLS_PLAN §6.5). Exports are watermarked when the E-stop is missing. Meter-polarity checklist. Outputs commissioning test. |
| **Residual** | Medium. We cannot see the real wiring. |
| **Verification** | U with forum fixtures. H with a relay module. |

### H14. Automatic resume after reconnect
| Field | Content |
|---|---|
| **Cause** | `getPorts()` and `open()` need no user gesture. |
| **Rating** | S4, L2 |
| **Mitigations** | Reconnect always lands in UNKNOWN. No job state is persisted. Resume requires a fresh report and confirmation. |
| **Residual** | Very low. |
| **Verification** | M, E. |

### H15. Simulation and live mode confused
| Field | Content |
|---|---|
| **Cause** | Similar-looking UI. Several tabs. |
| **Rating** | S4, L2 |
| **Mitigations** | SIM (hatched) and LIVE (solid) bands with text. Switching modes resets the job and needs confirmation. A "previous session was LIVE" banner overrides SIM. Other tabs' modes are shown. |
| **Residual** | Low. |
| **Verification** | E. |

### H16. Spindle keeps running in a hold or alarm
| Field | Content |
|---|---|
| **Cause** | TinyG feedhold leaves the spindle and coolant on. g2 pauses the spindle only if `spph=1`, which defaults to false (G2 settings_default.h:97). g2 `cm_alarm` does not stop the spindle. On TinyG, M5 sent during a hold is queued behind the held moves (TG spindle.c:87-94). |
| **Rating** | S4, L3 |
| **Mitigations** | Honest labelling. "Stop job" follows the full flush sequence (§4.4). With consent, g2 profiles get `spph=1` and `coph=1`. Lasers and plasma are unsupported on TinyG in v1. **On g2, laser and plasma are blocked** until `spph`/`coph` behaviour and an output polarity check are verified per board (B-G2-8). Spindle state is shown as "UNCONFIRMED" unless the firmware reports it. Long-term: firmware host-heartbeat (D11). |
| **Residual** | Medium on TinyG. The operator must be present. After a `drain` completes with the host gone, the spindle runs indefinitely (fire risk, W5). |
| **Verification** | H, using a spindle LED or relay. |

### H17. Main thread frozen while the worker keeps streaming
| Field | Content |
|---|---|
| **Cause** | A large geometry upload, garbage collection, a modal dialog. |
| **Rating** | S3, L2 |
| **Mitigations** | UI heartbeat every 500 ms. If the worker misses heartbeats for 5 s during a job, it latches FAULT "UI unresponsive" and sends `!`. Chunked geometry uploads. Stop-latency budget below 100 ms. **The machine worker subscribes to the stop-request BroadcastChannel itself**, so a Stop request from another tab reaches the port even while this tab's main thread is frozen. |
| **Residual** | Low. |
| **Verification** | E latency test. M. |

### H18. Wrong machine addressed
| Field | Content |
|---|---|
| **Cause** | Identical VID:PID for TinyG boards (0403:6015, UNVERIFIED) and for g2 boards (1D50:606D). An imported profile. |
| **Rating** | S4, L2 |
| **Mitigations** | Read-only identity handshake. The profile is bound to the device `id`. On mismatch: block, and nothing is pushed. A per-board Web Lock. Confirmations are never exported. |
| **Residual** | Low. |
| **Verification** | M, H with two boards. |

### H19. Board resets mid-session without a disconnect
| Field | Content |
|---|---|
| **Cause** | EMI, brown-out, watchdog. TinyG's port stays open across the reset. |
| **Rating** | S3, L2 |
| **Mitigations** | Any startup banner, or an `r` carrying `fb`/`fv`, after Ready means FAULT, then UNKNOWN, a fresh handshake and a profile re-verify. |
| **Residual** | Low. |
| **Verification** | M fault plan. |

### H20. Gantry racks from a mismatched dual motor
| Field | Content |
|---|---|
| **Cause** | One motor of a pair is reversed or mis-scaled. |
| **Rating** | S2, L2 |
| **Mitigations** | Per-motor verification with the motors decoupled from the mechanics (attested). The axis jog is blocked until both motors are verified. |
| **Residual** | Low. |
| **Verification** | H. |

### H21. Program stop treated as idle
| Field | Content |
|---|---|
| **Cause** | `stat` 3 after M0/M1 while the rest of the job is still queued. |
| **Rating** | S3, L3 |
| **Mitigations** | Session state "job active" overrides the firmware's idle class. A PROGRAM_PAUSED state. Mutating actions require all of: stat ∈ {1,4}, no job loaded or armed, qr equal to planner size, velocity 0, and no RX bytes outstanding. |
| **Residual** | Low. |
| **Verification** | U allow-matrix. M. |

### H22. Firmware or setup data from an untrusted source
| Field | Content |
|---|---|
| **Cause** | A tampered release asset. HTML saved with a `.hex` extension. CRLF corruption. |
| **Rating** | S2–S4, L2 |
| **Mitigations** | Manifest with pinned sha256 and independent rebuild before approval. **Approval (D4) also requires a HIL run of the exact image** (motion, homing, alarms, EEPROM defaults; §9 item 12a), because a matching hash says nothing about whether a pre-release build behaves. Client re-hashes. Strict parse. No local-file flashing in v1. |
| **Residual** | Low. |
| **Verification** | U, E, H. |

### H23. Tool change or program stop with the spindle live
| Field | Content |
|---|---|
| **Cause** | M6 does not pause on TinyG (`_exec_change_tool` only stores the tool number, TG canonical_machine.c:1045-1055) or on g2 edge (G2 canonical_machine.cpp:1403-1413), so the machine cuts on with the wrong tool. M0/M1 leave the spindle and coolant running on TinyG (M5/M9 only on program END, TG canonical_machine.c:1365-1371); g2 source suggests the same (G2 canonical_machine.cpp:1626-1668; **UNVERIFIED**, B-G2-5). An operator reaching in at a pause meets a running spindle. |
| **Rating** | S4, L3 |
| **Mitigations** | Preflight **blocks** M6 unless the user accepts (C14) a sender-inserted `M5 M9 M0` before each M6, so the machine actually stops with the spindle commanded off. PROGRAM_PAUSED is entered only on M0/M1 (plus stat 3), never "on M6", and shows **"spindle may be running (UNCONFIRMED)"** (W17). Resuming needs C9 **and** a separate spindle restart confirmation, with the inserted `M3/M4 S…` restored from the interpreter's modal state. |
| **Residual** | Medium: the M5 is queued, so it runs only when reached; a user who removes the inserted M5 or edits the file outside the tool is not protected. |
| **Verification** | U: golden tests "M6 on TinyG blocked", "M0 → spindle-on finding". M: inserted sequence present before every M6. H: spindle LED off at an inserted pause; LED on at a bare M0 matches the W17 wording (HIL item 21a). |

### H24. Session normalisation breaks another sender
| Field | Content |
|---|---|
| **Cause** | Persisted reporting keys (`js`, `qv`, `sv`, `jv`, `fd`, the `sr` list) are EEPROM-backed on TinyG (TG config_app.c:471-482). Normalising them for our session changes what CNCjs, ChiliPeppr/SPJS or a user script sees next time. A different `jv`, `qv` or footer format can break their flow control: a hazard in someone else's software. |
| **Rating** | S2–S4, L2 |
| **Mitigations** | Normalisation is consented and lists the tools it may affect (W19). The original values are snapshotted and **restored on every normal disconnect**. If the session ended abnormally, the next connect detects the normalised values (deviceHash of reporting keys, kept separately from the motion hash) and offers "restore original reporting settings" (C17). |
| **Residual** | Low to medium: an abnormal exit followed by use of another sender before reconnecting to the tools leaves normalised values. W19 says so. |
| **Verification** | M: restore effects emitted on disconnect. H: after a normalised session and a normal disconnect, CNCjs streams a job correctly (HIL item 9a); after a killed session, the restore prompt appears. |

### H25. A second program commands g2 through the other CDC port
| Field | Content |
|---|---|
| **Cause** | g2 may enumerate two CDC ports (PROTOCOL_NOTES §3.2). Our exclusive open covers only one, so another program can open the other and send motion. |
| **Rating** | S4, L1 |
| **Mitigations** | Phase 7 control stays disabled until the session can detect the second interface for the same board and confirm it is muted (B-G2-6). Until then, g2 connects READ_ONLY when a second interface is seen. |
| **Residual** | Low once B-G2-6 passes. |
| **Verification** | H: open the second port in a terminal while the tools are LIVE; confirm the tool refuses control or that lines on the other port get status 117. |

### H26. Temporary homing search distance left in EEPROM
| Field | Content |
|---|---|
| **Cause** | TinyG's search distance is `abs(tm − tn) + lb` (TG cycle_homing.c:252), so a "temporary short search cap" means writing `tn`/`tm`, which persist (TG persistence.c:87-107). If the session dies mid-homing, the shortened travel stays in EEPROM and soft limits and the preview envelope are wrong. |
| **Rating** | S2–S3, L2 |
| **Mitigations** | Mechanism in §4.5a: snapshot, write, home, restore. The snapshot is kept in IndexedDB as a pending restore. On the next connect, the travel deviceHash drift plus the pending-restore record force NEEDS_REVIEW with a "restore travel" action (C17). |
| **Residual** | Low. |
| **Verification** | M: kill at every step of the sequence, then reconnect → NEEDS_REVIEW with restore offered. H: pull USB mid-homing, reconnect (HIL item 16a, B-HOME-1). |

### H27. A revoked tool version keeps driving machines
| Field | Content |
|---|---|
| **Cause** | Old hashed assets stay downloadable for 14 days (TOOLS_PLAN §2.5); open tabs and, later, a PWA keep running a version we have found unsafe. |
| **Rating** | S4, L1 |
| **Mitigations** | At every LIVE entry the app fetches same-origin `/tools/app/safety-advisory.json` (`no-store`), listing revoked version SHAs with a reason. A revoked version, or a failed or malformed fetch, **refuses LIVE** with the reason shown. Offline tools are unaffected. The file is generated in CI from a reviewed `tools/safety-advisory.json` (CODEOWNERS: owner). Signing it is deferred until the app can run off-origin (PWA, Phase 8). |
| **Residual** | Low. A session already LIVE when a version is revoked keeps running until it disconnects. |
| **Verification** | E: revoked SHA in the advisory → Connect refused; fetch failure → Connect refused; offline pages still work. |

### H28. Facts outlive the hardware they describe
| Field | Content |
|---|---|
| **Cause** | Facts (`dir.*`, `scale.*`, `switch.*`) persist across sessions with no expiry. A motor swapped mechanically, a re-wired switch or a loosened pulley changes nothing in `deviceHash`. |
| **Rating** | S2–S3, L2 |
| **Mitigations** | Homing-switch facts (`switch.*`) are **re-confirmed once per LIVE session** before the first homing (an idle-level read plus a press test, about 20 s). `dir.*` and `scale.*` show their age; after a configurable age (default 30 days) the tool asks "has anything changed mechanically?" and a "yes" clears them. |
| **Residual** | Medium: a mechanical change on the same day is invisible. W-level text says facts are attestations. |
| **Verification** | U: age rule; M: first homing in a session requires the switch re-test. |

---

## 3. Connection and motion state machine

The machine is one hierarchical statechart, implemented as a pure reducer in `machine/statechart.ts`: `(state, event) → (state, effects[])`. Overlays take precedence over base states in this order:

**FAULT > LOST > UNKNOWN > STALE > READ_ONLY > NEEDS_REVIEW > base state**

The allow-matrix is evaluated against the full (base × overlays) combination.

```
                 ┌──────────────── page load (always) ────────────────┐
                 ▼                                                    │
            SIM_IDLE ──"Switch to LIVE" + checklist C1──► PORT_REQUEST (user gesture)
              ▲  (previous-session-LIVE banner must be dismissed first)        │
              │                                                        ▼
              │                                      OPENING (115200, flowControl 'none',
              │                                       setSignals DTR/RTS true on g2; refuse 1200;
              │                                       refuse 2341:003D before open)
              │                                                        ▼
              │                                      IDENTIFYING (reads only: wait ≤3 s for banner;
              │                                       else {"fv":null},{"fb":null},{"hp":null},{"id":null};
              │                                       g2 ENQ; relaxed-JSON parser)
              │                    unsupported/conflict ──► READ_ONLY overlay
              │                    id ≠ profile.boundDevice ──► BLOCKED (ask user)
              │                                                        ▼
              │                                      READING (groups via JSON GETs; stat; offsets)
              │                    deviceHash ≠ profile ──► NEEDS_REVIEW overlay
              │                                                        ▼
              │                                      CONNECTED_UNKNOWN (position untrusted)
              │                       ── home(token) or typed "position verified" ──►
              │                                      LIVE_READY {homed axes, fresh}
              │                                                        │
              │      ┌───────────── base states under LIVE_READY ─────────────┐
              │      │ IDLE_UNHOMED ⇄ IDLE_HOMED                              │
              │      │ JOGGING (one move in flight) → back to IDLE_*          │
              │      │ HOMING → IDLE_HOMED | ALARM                            │
              │      │ SETTINGS_WRITE (§4.6) → IDLE_* (+ CONFIG_CHANGED facts) │
              │      │ JOB_LOADED → PREFLIGHT_OK | PREFLIGHT_BLOCKED          │
              │      │ PREFLIGHT_OK → ARMED (expires 60 s / any change)       │
              │      │ ARMED → PREAMBLE (confirmed modal) → RUNNING           │
              │      │ RUNNING ⇄ HOLD_REQUESTED → HELD (confirmed by sr)      │
              │      │ RUNNING → PROGRAM_PAUSED (M0/M1 reached + stat 3;      │
              │      │   spindle "may be running (UNCONFIRMED)"; M6 does NOT  │
              │      │   pause on either firmware, see H23)                   │
              │      │ RUNNING|HELD|PROGRAM_PAUSED → STOPPING_JOB (§4.4)      │
              │      │ RUNNING → DONE (stat 4 + queue empty + all lines acked)│
              │      │ ALARM / SHUTDOWN / PANIC / INTERLOCK (dialect-mapped)  │
              │      │ BOOTLOADER_MODE (flasher only, from IDLE gate)         │
              │      └────────────────────────────────────────────────────────┘
              │
   any state: disconnect / NetworkError / stream end / g2 ^X re-enumeration ──► LOST overlay
   next connect after LOST, discard, reload-while-LIVE, banner-after-ready ──► UNKNOWN overlay
   watchdog: 2 s silence (not expected-silence) ──► STALE overlay (blocks new intents)
   FAULT triggers ──► FAULT overlay (latched; needs ackFault with cause shown)
```

**FAULT triggers:**
- An unexpected `stat`, meaning an alarm, shutdown or panic class that the user did not request.
- An `er` report.
- A non-zero footer status during a job.
- An `n` mismatch.
- A `Garbled` frame during a job.
- A broken flow-accounting invariant.
- A write failure.
- STALE lasting more than 5 s while RUNNING.
- A missed UI heartbeat during a job (5 s).
- A banner arriving after Ready.
- A response the dialect does not expect.

**FAULT entry effects:**
1. Stop feeding.
2. If a job was running or the machine was moving, send the dialect feedhold. The host-loss policy does not apply here: the operator is assumed present and able to act.
3. TinyG soft alarm: also send `%`.
4. Show the cause and the line number.
5. Show "STOP NOT CONFIRMED" until a status report shows hold, stop or end.

**Exits:**
- From FAULT: `ackFault`, then CONNECTED_UNKNOWN if position may have been lost, otherwise the base idle state.
- From ALARM: the user confirms `{"clear":null}`. Re-homing is required when the dialect says homing is lost. g2 always un-homes; TinyG hard alarm loses position.
- From TinyG stat 11 (SHUTDOWN), g2 12 (SHUTDOWN) and g2 13 (PANIC): guidance to use the reset button, a power cycle, or the tool's explicit **"Reset controller"** action (which sends `^X` after W16/W18 and C15), then a full re-handshake and re-home. g2 13 can be cleared only by `^X`.
- **`^X` rule.** The tool writes 0x18 **only** as the effect of the `resetController` intent, which requires C15. No reducer transition, fault policy, stop sequence or reconnect path emits it. A reset makes outputs float (W16) and drops holding torque. Test T-S26.
- g2 11 (INTERLOCK): shown as "interlock open", auto-resume per firmware. The tool never sends `~` on its own.

---

## 4. Fail-safe behaviour

### 4.1 Allow-matrix highlights

| Intent | Allowed when |
|---|---|
| Read (JSON GET) | Any connected state except BOOTLOADER_MODE |
| Feedhold (`!`) | Any connected state, **including Phase 2 (read-only release)**. Also from non-controlling tabs, by a BroadcastChannel request that the controlling tab's **machine worker** receives directly (not via its main thread). Realtime bytes are written even under XOFF |
| Set work zero (`G10 L2 P<n>` from the live position; `G92` "zero here"; `G92.1` clear) | IDLE_* and fresh, no overlay, controlling tab, no job RUNNING or HELD; single confirmation C16 naming the axis, WCS and resulting offset. Uses `G10 L2` with a value computed from a post-idle `mpo` report (never `L20` on TinyG). Invalidates `job.*.preflight` and disarms. On TinyG the G10 offset is persisted to EEPROM (TG canonical_machine.c:628, 662-672), which C16 states |
| Manual spindle on/off (`M3/M4 S…`, `M5`) | On: IDLE_* and fresh, no overlay, controlling tab, `outputs.spindle` fact, single confirmation naming the speed. Off (`M5`): any connected state without FAULT/LOST, never gated by facts. On TinyG, an M5 during a hold is queued behind held moves (TG spindle.c:87-94); the UI says so and offers Stop job |
| Manual coolant on/off (`M7`/`M8`, `M9`) | Same as spindle: on is gated, off is always allowed while connected |
| Feed override | g2 only (`fro` 0.05..2, `froe`). TinyG 440.21 has no working live override: there is no `fro` config key, and `M50.1` only stores the factor, with the replanning call commented out (TG canonical_machine.c:1150-1156) and no use of the factor in `plan_*.c` (grep, 2026-10-31). The control is absent on TinyG, and preflight flags M50/M50.1 in TinyG files as "ignored by firmware". g2: RUNNING or HELD, controlling tab, range clamped to 0.5–1.2 in v1, every change logged. Phase 7 |
| Reset controller (`^X`) | Any connected state except BOOTLOADER_MODE; explicit action only, after W16/W18 and C15. Never automatic (§3) |
| Jog | IDLE_* and LIVE_READY and fresh, no overlay, controlling tab, visible document, direction fact for that axis (except the guided first move) |
| Home | IDLE_* and fresh, `dir.<axis>` verified, `switch.<axis>` tested; dual-motor axes need both motors verified |
| Settings write | IDLE, stat ∈ {1,4}, no job loaded or armed, qr = plannerBlocks, vel = 0, no RX outstanding, mots = 0 |
| Start | Only from ARMED, with a matching ticket, the tab visible at the moment of Start, all job gate facts, no overlay |
| Resume (`~`) | Only from HELD or PROGRAM_PAUSED, with a fresh report, unchanged offsets, and a named confirmation. Never as the first action after reconnect |
| Flash (enter bootloader) | Same as settings write; TinyG stat 11 also allowed with confirmation. Never stat 2 |
| Anything | Denied under FAULT, LOST, UNKNOWN (except reads, feedhold, spindle/coolant off, home and position-verify), READ_ONLY (reads and feedhold only) or NEEDS_REVIEW (reads, feedhold, and writes that resolve the drift, including "restore travel" and "restore reporting settings") |
| Enter LIVE | `safety-advisory.json` fetched at LIVE entry and this version not revoked (H27); C1 (or the short E-stop re-attestation) accepted in **this** session |

**UI rules that protect the stop path while LIVE:**
- Fullscreen is forbidden on control and preview pages while LIVE (Escape is swallowed by the browser to exit fullscreen). Requesting fullscreen while LIVE is denied; entering LIVE exits fullscreen.
- Native file pickers and `<select>` popups are blocked while RUNNING or HELD (they can swallow Escape). Job loading uses a picker only when no job is running; option lists use custom listboxes that do not trap Escape.
- The on-screen stop button stays visible and focusable in every state (T-S18).

### 4.2 Watchdog
- **Liveness signal.** Timestamps of received data: any bytes, footers, or queue reports (`qv=2` on TinyG, from Phase 3, with consent). Timer deltas are not used, so a late timer cannot declare staleness when data arrived meanwhile.
- **Expected silence.** The interpreter knows when silence is expected: G4 dwell (P seconds plus 1 s), spindle spin-up delay, PROGRAM_PAUSED, and idle with `sv=1`. When idle, a `{"sr":null}` probe is allowed because the planner is empty, so the probe is actually read.
  - **How the executing position is known.** g2 reports `line` by default (G2 settings_default.h:208). TinyG's default report has **no `line`** (TG settings.h:68), and adding it means a persisted `sr` list change (H24). On TinyG the watchdog therefore works from the host side: it tracks the host N of the last acknowledged line and the modelled queue (which queued lines are dwells, pauses or spin-ups, and how much motion precedes them). Expected silence is granted only when the model says every remaining queued motion before the silent command has had time to complete at its modelled feed. This is conservative: it may raise STALE early, never late. B-WD-1 validates it.
- **Probing while streaming.**
  - g2: ENQ (0x05 → `{"ack":true}`) bypasses the queue and uses no line slot.
  - TinyG: no probe while the planner is full. A `{sr:n}` line would sit unread in RX, because TinyG stops reading lines when fewer than 4 blocks are free.
- **Thresholds.**
  - STALE after 2 s of unexpected silence. Effect: block new intents and show a banner.
  - FAULT after 5 s while RUNNING.
  - LOST on a transport error.
  - Bench-validate these (task B-WD-1) before Phase 6.

### 4.3 Host loss, hidden tab and page lifecycle
- **Per-machine host-loss policy**, chosen during setup and shown in the safety bar:
  - **`drain`**, the default on TinyG and for any machine where a held, spinning tool is worse than finishing. While the tab is hidden, the worker keeps streaming, driven by events. `!` is not sent on hide. If the page dies, the machine finishes its bounded queue and then dwells with the spindle in its last commanded state.
  - **`hold-and-spindle-pause`**, available on g2 only when `spph=1` and `coph=1` are confirmed on the board. On `visibilitychange: hidden` during RUNNING, the tool sends `!`. The firmware pauses the spindle and coolant; Z-lift is used if `zl` > 0.
  - Screen lock fires the same visibility event, so `drain` is the safe default. W5 tells the user to disable screen lock.
- **Before Start**, the user attests: "Screen lock and sleep are disabled; I will stay at the machine."
- **`pagehide`, `freeze` and `beforeunload`:**
  - Policy `drain`: record the `liveSession` marker and send nothing.
  - Policy `hold`: send `!`.
  - `beforeunload` shows a prompt while LIVE.
- **On load**, if the `liveSession` marker exists or `document.wasDiscarded` is true: show banner W6, which overrides the SIM default and must be dismissed first. The next connect goes to UNKNOWN.
- **Overrun display** shown during RUNNING, for both flow engines.
  - **Distance (a true upper bound):** the sum of the lengths of queued segments, plus lines sitting in the RX window, plus arc lengths. Labelled **"machine may continue up to N mm"**.
  - **Time (an estimate, not a bound):** segment length divided by commanded feed is a *lower* bound on time, because acceleration, jerk and overrides only make moves slower. The display therefore computes T conservatively, as length divided by a minimum effective velocity `v_eff = min(F, vm) × k` (k = 0.5 by default, bench-tuned in B-WD-1), and labels it **"about T s (estimate)"**. W5 and C7 never call T a bound.
  - **The ceiling** limits queued *path length* so that the estimate stays at most the configured time (default 5 s; range 2–20 s). It applies to the TinyG byte window and to the g2 line window alike (H1).
- **Web Lock** `synthetos-machine:<id>` is acquired when entering LIVE. Other tabs get a Stop-request button and are otherwise read-only. The controlling tab's machine worker listens on the BroadcastChannel itself (H17).
- **Audible alarms.** W3 (LOST) and W12 (STOP NOT CONFIRMED), plus FAULT entry during a job, play a repeating tone through Web Audio. The `AudioContext` is created and resumed inside the Connect click handler (user gesture), so it is unlocked before it is needed. The banners use `role="alert"` with `aria-live="assertive"`. A muted or failed AudioContext shows "Alarm sound unavailable" in the safety bar; sound is never counted as a mitigation on its own.
- **Normal disconnect** restores any consented session normalisation (H24) and any pending temporary settings (H26) before closing the port.

### 4.4 Stop semantics (exact sequences)
**Software stop button, or Escape (feedhold):**
1. Await the in-flight single-line write. At most one line is in the stream; worst case about 120 B, roughly 10 ms at 115200 baud. **XOFF never delays a realtime byte:** the flow engine pauses data lines only; `!` and `%` bypass the XOFF gate (TinyG traps them in the RX ISR, TG xio_usb.c:146-161). `flowControl:'hardware'` is forbidden in v1, so the FT230X never holds `!` behind CTS (B-FC-1 must pass before that changes).
2. Write the dialect feedhold:
   - TinyG: `!`.
   - g2: `!\n` at a line boundary, which is guaranteed by step 1.
3. Stop feeding.
4. Show "STOP REQUESTED".
5. When a report shows the held or stopped class, show "STOPPED (feedhold) — spindle state: <reported | UNCONFIRMED>".
6. If motion resumes while the user wants hold, re-send `!`. A feedhold is ignored when the machine is not moving (TG canonical_machine.c:1265-1271).

**Stop job (abort, ends with spindle off):**
- **TinyG:**
  1. `!`.
  2. Wait up to 3 s for HELD. If the machine was not moving (dwell, M0 or spin-up) and `stat` ≠ run, skip waiting.
  3. Send `%`. The flush runs only in hold or stop with the runtime idle (TG canonical_machine.c:1272-1278).
  4. Wait up to 3 s for `qr` = `plannerBlocks` **as read during the handshake** (a `{"qr":null}` read while idle, recorded per session; not a hard-coded 32, which is only the pool size in TG planner.h:103-104) and stat ∈ {3,4}. The post-flush `qr` value is **UNVERIFIED** (B-QR-1); until it is bench-confirmed, step 4 also accepts "stat ∈ {3,4} and two consecutive reports with vel = 0" so a wrong constant cannot make every stop escalate to W12.
  5. Send `M5`, wait for its `r`, then `M9`.
  6. Reset counters.
  7. Go to IDLE with the spindle "UNCONFIRMED" (TinyG does not report it).
- **g2 (until `^D` is bench-verified, task B-G2-1):**
  1. `!\n`.
  2. Wait for HELD.
  3. `%\n`.
  4. `{"gc2":"M5"}` or, after the flush, `M5`.
  5. `M9`.
- **Escalation.** Any step that times out shows **"STOP NOT CONFIRMED — USE YOUR E-STOP"** and latches FAULT.
- After a stop the tool never auto-clears an alarm. `{"clear":null}` is sent only after user confirmation.
- No stop sequence, escalation or fault policy sends `^X` (§3 `^X` rule).

**Reset controller (explicit action only).** Shown under an "Advanced" disclosure on the control page and in SHUTDOWN/PANIC guidance. Shows W16 and W18, requires C15, then writes 0x18. The session goes to UNKNOWN at once (TinyG: the port stays open and a banner follows; g2: USB re-enumerates and the session goes LOST then UNKNOWN). Re-homing is required.

**Alarm reflex (TinyG).** When an alarm `er` report or `stat` 2 arrives and the previous class was moving: send `!` immediately, then `%`, latch FAULT, and show "spindle may still be running" with a Stop job button.

### 4.5 Jog rules
- **Increments.**
  - 0.01, 0.1, 1 or 10 mm. Default 1 mm.
  - **The first move per axis after any `dir`/`scale` invalidation is 0.25 mm at min(100 mm/min, 10% of vm).** The dialog states the expected step count: `0.25 × (360/sa) × mi / tr`. At the TinyG defaults (sa 1.8°, mi 8, tr 1.25 mm; PROTOCOL_NOTES §12.2) that is 0.25 × 200 × 8 / 1.25 = **320 steps**. The C3 text is generated from this formula, never hard-coded.
  - Unhomed: maximum 1 mm until direction and scale are verified, then maximum 10 mm.
  - Every jog is also time-capped at 2 s of motion.
- **Form.** `G21 G90 G53 G1 <axis><target> F<f>`. G53 is supported on TinyG (TG gcode_parser.c:299). The target is `mpo + delta`.
  - `mpo` must come from a report received after the idle transition, with vel = 0, and no older than 1 s.
  - The tool records `unit` and `dist` beforehand and restores them afterwards (`G20` if the machine was in inches; `G91` only if the machine was in G91, which preflight blocks for jobs anyway).
  - The next report must confirm the restored `unit` and `dist`, or FAULT.
- **Flow.**
  - **One jog in flight.** The next jog is accepted only after the `r` arrives and the class returns to idle. Key repeat (`event.repeat`) is dropped.
  - Feed is capped at min(vm, 50% of fr) and the user can configure it lower.
  - The target is checked against the envelope when homed.
- **Keyboard jog** is off by default. When enabled, it works only while the jog panel has focus. The tool stops issuing jogs on blur, visibilitychange, pointercancel, lostpointercapture or pagehide.
- **No continuous jog in v1.**
- **Modal state left behind.** A jog leaves `F` (and G1 motion mode) set in the firmware. Units and distance mode are restored, but F is not. Therefore the job preamble (§6.6 step 5 of TOOLS_PLAN) does not rely on a leftover F, and preflight **blocks** a job whose first feed move (G1/G2/G3) appears before any F word. This is a block, not only a finding.

### 4.5a Temporary homing search cap (TinyG)
TinyG's homing search distance is `|tm − tn| + lb` (TG cycle_homing.c:252); there is no separate search-distance key. A temporary short search therefore needs a temporary travel write, which persists to EEPROM (TG persistence.c:87-107). Sequence:
1. Gate: settings-write gate (§4.1) plus the homing gate.
2. **Snapshot** the axis `tn`, `tm` (and `lb`) and store a `pendingRestore` record in IndexedDB, keyed to the board id, **before** writing anything.
3. Write the temporary `tn`/`tm` through the §4.6 pipeline (G21 acknowledged, read-back).
4. Home that axis (C4 states the search cap in mm).
5. **Restore** the snapshot through §4.6 and read it back. Clear `pendingRestore` only after a successful read-back.
6. On any failure in steps 3–5 (FAULT, LOST, alarm): the next safe opportunity (idle, same session) restores; otherwise the record survives.
7. **On the next connect**, a surviving `pendingRestore` or a travel-key deviceHash drift forces NEEDS_REVIEW with a "Restore travel" action (C17). Soft limits, envelope checks and preflight are blocked until it is resolved.

Verification: M (kill at each step, reconnect), H (HIL 16a, B-HOME-1).

### 4.6 Settings write pipeline
1. Gate: see §4.1.
2. Snapshot all groups to IndexedDB.
3. Diff, then an ordered write plan with risk classes:
   - Typed confirmation: homing input or direction, motor polarity, switch type or modes, `sl=0`, `lim=0`, jerk or velocity ×2 or more, travel changes, motor map.
   - Forbidden in the UI: `hv`, `baud`, `ex`, `ej`, `js=0`, `defa`, `boot`, `flash`, `test`, `me`/`md` outside commissioning, `rx`.
4. Record the current `unit`.
5. Send `G21` and **wait for its `r`**. Then confirm `unit` = 1 with `{"unit":null}`. On g2 this ordering matters because JSON jumps the queue.
6. Write one key at a time, each `{"<key>":<value>}`, and read each back. Any non-zero status, including 9, means stop and offer rollback.
7. Restore `unit` (send `G20` if it was in inches) and confirm.
8. Apply fact invalidation and set the CONFIG_CHANGED facts.
9. **After any polarity, motor-map, scale or travel write in Phase 3** (before the tool has its own direction and scale tests in Phase 5), show mandatory guidance W20, and keep `dir.*` and `scale.*` unset.

**Session normalisation** (reporting keys `js`, `qv`, `sv`, `jv`, `fd`, the `sr` list) is a separate consented write plan, never part of a user's settings change:
- The consent dialog shows W19, naming the other senders it can affect.
- Original values are snapshotted (IndexedDB, keyed to the board id) and restored on every normal disconnect (§4.3).
- On connect, if normalised values are found together with a stored snapshot, or the reporting-key hash differs from the last known original, the tool offers "Restore original reporting settings" (C17) before anything else.

### 4.7 Sanitiser (job and console)
**Order of operations:**
1. Normalise line endings.
2. Comments, per dialect (`dialect.comments`):
   - **TinyG:** comments always end the block, and anything after a comment is silently ignored by the firmware (TG gcode_parser.c:98, :108-109; the normaliser stops at the first `(` or `;`, :134). So **reject** (block the job) any line where non-whitespace text follows a `(…)` comment, any line with a leading comment followed by code (`(c) G0X10`), and any line with an unclosed `(`. A trailing comment (`G0X10 (c)` or `G0X10 ;c`) is stripped. Never strip an embedded comment and send the remaining code: TinyG would run motion that it, and every other TinyG host, would have dropped.
   - **g2:** strip `(…)` and `;…` comments; whether g2 ignores text after a comment is **UNVERIFIED** (B-G2-7), so until then g2 uses the TinyG reject rule too.
3. Trim whitespace.
4. Drop lines that are empty or only `%`.
5. Strip user `N` words.
6. Reject the line, which blocks the job, if any of these hold:
   - It contains `!`, `~` or `%`.
   - It contains a byte < 0x20 other than tab, or ≥ 0x7F. This includes 0x04, 0x05, 0x11, 0x13, 0x18 and 0x1B.
   - Its first character is `$`, `?`, `H`, `h` or `{`.
   - It contains M100.
   - It is longer than the dialect maximum after the N prefix (TinyG 120 bytes; g2 400 bytes).
   - It contains G38.x.
   - It contains a code unsupported by the dialect.
   - TinyG: it contains G10 with an L word other than 2 (TG gcode_parser.c:400 ignores L; canonical_machine.c:652).
   - It contains M6 and the user has not accepted C14 (then the sanitiser inserts `M5`, `M9`, `M0` as separate lines before each M6, and lists them in the report).
7. Prefix `N<k>` (host monotonic numbering).

The report lists every change with its original line number.

**Single source of truth.** The preview, the analyser and preflight interpret **exactly the byte stream the sanitiser will send** (`SentLine[]`, including inserted lines such as the C14 `M5 M9 M0` and the preamble), using the dialect's G-code semantics (for example TinyG's L2-only G10). They never interpret the original file. Property test in T-S1/T-S2: for any input, `interpret(sanitize(file))` is what preview shows, and re-sanitising sanitised output is the identity.

### 4.8 Flash gate (TinyG)
1. Identity check before anything bootloader-related: `fb`, `hp` = 1 and `id` match the profile and manifest. A device that is not identified never receives ESC or `{boot}`. An already-resident xboot (no banner, SpinDir blinking) is handled by a separate guided path that requires the user to select the board explicitly and press reset.
2. Idle gate (§4.1).
3. Checklist C6 (exact wording in §6).
4. Automatic backup: every group read as JSON, downloaded and stored.
5. Image checks:
   - sha256 matches the manifest;
   - strict Intel HEX: record types 00/01/02/04, record checksums, no overlaps;
   - every address below 0x30000;
   - the first word is a `jmp`.
6. Wake Lock and the `beforeunload` guard.
7. Flow:
   1. ESC sync.
   2. `S` returns `XBoot++`.
   3. `V` = 17, `s` = 44 97 1E, `b` = Y 0x0200, `r` = NOLOCK.
   4. `e`.
   5. **Stub page 0** (`jmp 0x30000` at the reset vector).
   6. Pages N…1.
   7. Verify pages 1…N and the stub.
   8. Real page 0.
   9. Verify page 0.
   10. `E`.
8. Guard filter: never `l`, never an address at or above 0x30000.
9. Post-flash: wait for the banner with the target `fb`. All facts are invalidated, the session goes to UNKNOWN, and motion stays locked until config and commissioning are re-done.
10. **Restore is a required step.** `e` wiped the EEPROM, and at a build change all settings reset to defaults (TG config.c:122-140): `tm` 150/150/75, Z-max homing, 1.25 mm travel per revolution (PROTOCOL_NOTES §12.2), which may not match the user's machine. The flasher flow moves straight to "Restore backup" (through §4.6 with the cross-build mapper). The session cannot end normally until the restore is done and read back; leaving without it needs the typed acknowledgement C18, and the profile then carries a "defaults active — not restored" flag that blocks homing and jogging until resolved.
11. **Residuals stated to the user (W11):** an interruption during the final page 0 rewrite (step 7.8) can leave a board that runs partial code or needs a PDI programmer (PROTOCOL_NOTES §13.1); B-FL-1 records the actual behaviour. The xboot watchdog (about 1 s, not reset by `get_char()`) may fire during `e` or during a host stall; B-FL-1 covers both.

### 4.9 Failure-mode table

| Failure | Detected by | Behaviour |
|---|---|---|
| USB unplugged or EMI drop mid-job | `disconnect` / NetworkError | LOST; banner W3; job marked aborted locally; motion UI disabled; no automatic reconnect; next connect goes to UNKNOWN |
| Tab discarded, crashed or closed | Next load: marker or `wasDiscarded` | Nothing ran meanwhile; the machine drained its bounded queue; banner W6 overrides SIM; UNKNOWN |
| OS sleep | Same as unplug | Same as unplug |
| Tab hidden while running | `visibilitychange` | Policy `drain`: continue, and show a toast on return. Policy `hold`: `!` |
| Main thread frozen | Worker heartbeat | FAULT "UI unresponsive" plus `!` |
| Stale reports | Receive timestamps | STALE blocks new intents; FAULT plus `!` if longer than 5 s while RUNNING |
| Garbled or unexpected response | Framer / dialect | FAULT plus `!` during a job; ignored and logged when idle |
| Non-zero footer status or `n` mismatch | Streamer | FAULT plus `!`; never skip, never resend |
| `er` report mid-job | Dialect | FAULT plus severity; TinyG soft alarm adds `%` |
| Limit hit | stat / status | ALARM or SHUTDOWN; re-home required; TinyG hard alarm needs a reset |
| Board resets mid-session | Banner after Ready | FAULT then UNKNOWN; full re-handshake |
| g2 `^X` | Re-enumeration | LOST then UNKNOWN |
| XOFF received | Framer | Data-line writes pause; **realtime bytes (`!`, `%`) are still written**; XON resumes; window accounting unchanged |
| Board reports `ex=2` (RTS/CTS) | Handshake read | READ_ONLY with guidance; `flowControl:'hardware'` is forbidden in v1 (a held CTS could block `!`) |
| Session ended with normalised reporting keys or a pending travel restore | Snapshot record / hash on next connect | NEEDS_REVIEW; offer C17 restore before anything else |
| Safety advisory revokes this version, or advisory fetch fails | LIVE entry | Refuse LIVE with the reason; offline tools still work |
| Flasher left before restore | Flash flow state | Typed C18 required; profile flagged "defaults active" and motion blocked |
| Write failure | Transport | FAULT; no newline; TinyG `%` before anything else; g2 UNKNOWN |
| Port busy | `open()` rejects | Explain the usual culprits (CoolTerm, tgFX, ChiliPeppr/SPJS, CNCjs, another tab); no retry loop |
| Two tabs | Web Lock | Second tab read-only, with a Stop request |
| Device id mismatch | Identity | BLOCKED; nothing is written |
| Settings drift on connect | deviceHash | NEEDS_REVIEW; no motion |
| Settings write refused (status 9) | Read-back | Stop and offer rollback |
| Firmware fetch non-200 (including 429) | Catalog | Flasher refuses to start |
| Flash interrupted before final page 0 | Timeout / disconnect | Board loops in xboot; retry from erase is safe (B-FL-1) |
| Flash interrupted during the final page 0 write | Timeout / disconnect | Residual: board may run partial code or need PDI; show reset-button xboot entry guidance, then RMA/programmer guidance (B-FL-1 records the real behaviour) |
| Flash verify mismatch | Read-back | No `E`; stay in the bootloader; lock-bit guidance if it fails at 0x0000 |
| No `XBoot++` | Sync timeout | Route to programmer / RMA guidance; no retries that send data |
| Unsupported or conflicting firmware identity | detectDialect | READ_ONLY |
| Unsupported browser | Feature detection | Offline tools only; no Connect button |
| Deploy mid-session | Version check | "Reload when disconnected" notice; old assets retained for 14 days; a revoked version is refused at the next LIVE entry (H27) |
| Main thread frozen while another tab sends a Stop request | BroadcastChannel in the machine worker | `!` written by the worker without the main thread |

---

## 5. Required warnings (exact wording)
Signal words follow ANSI Z535 and ISO 3864-2. DANGER means will cause death or serious injury; WARNING means could; CAUTION means minor or moderate injury; NOTICE means property damage only and is never mixed with personal-injury content.

- **W1 (persistent bar on every app page):** "WARNING — This software is not an emergency stop. Your machine must have a hardwired E-stop that removes motor and spindle power. Keep it within reach whenever the machine is powered."
- **W2 (stop button label):** "Software stop (feedhold) — not an E-stop". Its tooltip: "Decelerates and pauses motion. The spindle may keep running. Use your E-stop in an emergency."
**Single source.** The app's W1–W21 and C1–C18 strings live in one module (`packages/safety/src/strings.ts`). A CI test parses this section and §6 of SAFETY.md and fails unless every string matches byte for byte (P1-14). The site's copy of W1 is checked by the same test (P0-04).

- **W3 (LOST banner, full width, `--danger`, `role="alert"`, audible tone):** "DANGER — Connection lost. The machine may still be moving and the spindle may still be running. Use your E-stop if anything is unsafe. Machine position is now unknown."
- **W4 (STALE banner):** "WARNING — No status from the machine for N s. Commands are blocked. What you see may be out of date."
- **W5 (before Start, and on the control page while RUNNING):** "WARNING — If this browser tab closes, crashes, sleeps or loses USB, the machine will continue the queued moves (up to N mm, about T s — an estimate) and the spindle will stay in its last state indefinitely, even after motion stops. A spindle left running against the work is a fire risk. Disable screen lock and sleep, keep this tab visible, and stay at the machine."
- **W6 (previous session, overrides SIM):** "WARNING — The previous session ended while connected to a live machine. The machine may have kept moving after this page stopped. Check the machine before doing anything. Machine state is UNKNOWN until you reconnect and re-home."
- **W7 (SIM band):** "SIMULATION — no machine connected. Nothing you do here moves a machine."
- **W8 (LIVE band):** "LIVE — connected to <board> (<id>) on <port>. Commands move the real machine."
- **W9 (unhomed envelope):** "Soft limits are inactive: axis <X> is not homed. The machine can travel past its limits."
- **W10 (feedhold spindle note, TinyG):** "On TinyG a feedhold does not stop the spindle or coolant. Use \"Stop job\" to end the job with the spindle off."
- **W11 (flash banner):** "DANGER — Flashing resets the controller. Motors lose holding torque and outputs may switch on or toggle. Do not unplug the board or close this tab until flashing finishes. An interruption in the last seconds can leave the board needing a programmer."
- **W12 (stop not confirmed, `role="alert"`, audible tone):** "DANGER — STOP NOT CONFIRMED. The machine did not report that it stopped. USE YOUR E-STOP."
- **W13 (preview disclaimer):** "NOTICE — This preview uses our interpreter, not your firmware. It can miss problems. Configure homing and firmware soft limits ($sl=1)."
- **W14 (wiring export without E-stop):** watermark "INCOMPLETE — NO E-STOP SHOWN". Footer on every export: "This diagram does not replace a qualified electrician. Emergency stop circuits must remove motor and spindle power in hardware."
- **W15 (laser or plasma on TinyG):** "Laser and plasma control on TinyG is not supported by this tool. TinyG has no output polarity setting and a feedhold leaves the output on."
- **W16 (reset button):** "The reset button on the board is not an E-stop. A reset makes outputs float and may switch an active-low relay ON."
- **W17 (PROGRAM_PAUSED):** "WARNING — Program paused. The spindle and coolant may still be running (UNCONFIRMED): this firmware does not turn them off at a program stop. Wait for the spindle to stop, or use your E-stop, before reaching in."
- **W18 (Reset controller):** "WARNING — Resetting the controller drops motor holding torque, so axes that can fall (Z) may drop. Outputs float during the reset. Machine position will be lost and homing will be required."
- **W19 (session normalisation consent):** "NOTICE — These reporting settings are stored on the board. Other programs (CNCjs, ChiliPeppr, serial-port-json-server, your own scripts) read them too, and may stop working correctly if they change. This tool restores the original values when you disconnect normally. If this tab crashes, reconnect here and choose \"Restore original reporting settings\" before using another program."
- **W20 (after a Phase 3 polarity, motor-map, scale or travel write):** "WARNING — Direction and distance are not verified. Before running anything, check with small moves (1 mm or less) in your sender, hand on the E-stop, that each axis moves the right way and the right distance."
- **W21 (wiring and power, before attesting the wiring):** shown on the wiring checklist; see TOOLS_PLAN §6.5 (power off before connecting or disconnecting motors).

---

## 6. Required confirmations (exact wording)
Typed confirmations are limited to the rows marked "typed": C5 (high-risk writes, including polarity, homing input or direction, switch type), C10, C11 (polarity or homing keys), C12, C18, and the wiring "expected settings" accept for polarity and switch-type keys (TOOLS_PLAN §6.5), which uses the C5 typed word. An identity or chip mismatch on a flash is **not** a confirmation: it is a hard stop with no override (§4.8 step 1). Everything else is a single named confirmation. Dialogs give Cancel the default focus, and pressing Enter never starts motion. All confirmation text is generated from live values through `safety/strings.ts` (no hard-coded numbers).

| ID | When | Text | Type |
|---|---|---|---|
| C1 | **At the start of every LIVE session** (full checklist the first time, when the checklist text version changes, and when the last full acceptance was on an earlier calendar day; otherwise the short re-attestation below). Stored as `ack.safety@<version>@<date>` | Full: "Before connecting, confirm: ☐ A hardwired E-stop that removes motor and spindle power is installed and I tested it today. ☐ Limit switches or soft limits are configured, or I will keep moves small. ☐ The work area is clear of people, tools and loose items. ☐ I am wearing eye and ear protection. ☐ I will not leave the machine unattended while it is powered." Short re-attestation (same day, same version): "☐ My E-stop is within reach and I tested it today." | All boxes |
| C2 | Switching SIM → LIVE in a session | "Switch to the LIVE machine? Your simulated job will be cleared." | Single |
| C3 | Each jog dialog (first move per axis) | "Axis <X> will move <+0.25> mm at <F> mm/min (expected <steps> motor steps). Hand on E-stop?" where `steps = 0.25 × (360/sa) × mi / tr` (§4.5). Example at the TinyG defaults (sa 1.8°, mi 8, tr 1.25): "Axis X will move +0.25 mm at 100 mm/min (expected 320 motor steps). Hand on E-stop?" | Single |
| C4 | Homing | "Home Z, then X, then Y. Each axis moves toward its switch until it triggers (search limited to <N> mm). To limit the search, travel (<tn>/<tm>) is changed temporarily and restored after homing. Hand on E-stop?" (§4.5a) | Single |
| C5 | Settings write | "Write N settings to <board id>? Changes: <table>. High-risk changes: <list>." | Single. Typed "WRITE" if high-risk |
| C6 | Flash | Ordered steps, each a checkbox, ticked in order: "☐ 1. Motor power is OFF. ☐ 2. Motors are unplugged from the board (only with power off). ☐ 3. Any axis that can fall (Z) is lowered or supported. ☐ 4. Spindle, VFD, laser and coolant mains power are switched off and isolated. ☐ 5. The tool is clear of the work, and the E-stop is within reach. ☐ 6. Motor power is back ON (TinyG's logic is powered from it). ☐ 7. I have downloaded the settings backup." Then: "Flash TinyG <id> from build <old> to 440.21 (sha256 c2c1…5e92)?" | All boxes (in order) + single |
| C7 | Arm | "Arm job <file> (sha …): N lines, units mm, WCS G54 (read from machine), X <min..max>, Y …, Z min <z>, spindle ON S<rpm>, estimated <t>, may continue up to <mm> mm (about <s> s, estimate) if the connection is lost. ☐ E-stop in reach, work clamped, area clear, screen lock off." | Checkbox |
| C8 | Start | "Start <file> now?" | Single, within 60 s of Arm |
| C9 | Resume | "Resume held job (paused at line <N>)? Spindle: <reported state or UNCONFIRMED>. Offsets unchanged since hold." If the pause was PROGRAM_PAUSED or the spindle was commanded off, a second step follows: "Restart spindle <M3/M4> at S<rpm> and wait <spin-up> s before motion?" | Single (+ single for spindle restart) |
| C10 | Run with unhomed axes (expert mode only) | "Soft limits are inactive on X, Y. Type RUN UNHOMED to continue." | Typed |
| C11 | Profile push on connect (g2) | "Device <id> settings differ from profile <name> in N keys. Apply the profile? <diff>" | Single (typed if polarity or homing keys change) |
| C12 | Only on a g2 machine whose policy is `hold-and-spindle-pause`: override to `drain` for this session | "This machine is set to pause the job when this tab is hidden. Keep the job running in the background for this session instead? If the tab is hidden, the job continues and the spindle stays on. Type BACKGROUND." Not shown on TinyG, where `drain` is already the only policy | Typed "BACKGROUND" |
| C13 | Clear alarm | "Clear the alarm? Position may be wrong; homing will be required." | Single |
| C14 | Preflight finds M6 (either firmware) | "This file has <k> tool changes (M6). The controller does not stop for M6. Insert \"M5 M9 M0\" before each M6 so the spindle is commanded off and the job pauses for the tool change?" Declining blocks the job | Single |
| C15 | Reset controller | Shows W18, then: "Reset controller <id> now? Holding torque drops and position is lost." | Single |
| C16 | Set work zero / G92 | "Set <G54> <X> zero at the current position (machine <mpo> mm)? New offset: <value> mm. On TinyG this offset is saved on the board." | Single |
| C17 | Restore after an abnormal end | "The last session ended before restoring <travel on Z, or reporting settings>. Restore the original values now? <diff>" | Single |
| C18a | (note, not a dialog) | C6 orders "power off → unplug motors → support Z → power on → flash" because unplugging or plugging steppers on a powered driver is widely reported to destroy stepper drivers. We found no statement of this in the TinyG wiki or the DRV8818 datasheet text we read (SLVSAX9G). **UNVERIFIED**, citation task CIT-3: find a Synthetos or TI source, or record the bench evidence. The ordering stays regardless, because it is the conservative choice. | — |
| C18 | Leaving the flasher before restoring settings | "The board is running factory defaults (travel 150/150/75 mm, Z-max homing), which may not match your machine. Homing and jogging stay blocked until you restore. Type LEAVE WITHOUT RESTORE to continue." | Typed |

---

## 7. What the software cannot guarantee
Include this list verbatim on `/tools/safety/`.
1. It cannot stop your machine in an emergency. Only a hardwired E-stop can.
2. It cannot guarantee that a stop command arrives or how quickly it arrives. The command passes through the browser, the operating system, USB and the firmware.
3. It cannot stop the machine if the browser tab closes, crashes, is discarded or sleeps, or if USB is lost. The controller keeps running its queued moves.
4. It cannot turn off a spindle, laser or coolant if the controller does not obey, if the link is lost, or (on TinyG) during a feedhold or at a program stop (M0/M1) or tool change (M6).
5. It cannot see your wiring, your switches, your workpiece or the people around the machine.
6. Its preview and bounds checks use its own interpreter and can disagree with the firmware.
7. It cannot detect mechanical faults: lost steps, loose couplers, broken switch wires.
8. A completed bring-up journey records what you attested and what small tests showed. It does not mean the machine is safe.
9. It is not certified to any safety standard.

---

## 8. Safety review checklist (required on every PR touching `machine`, `protocol`, `safety`, `flasher`, `sim` device models, jog, control or firmware UI, or the tools Worker)
The CI PR template requires each box. A second reviewer must sign the "Safety review" approval. Changes to the allow-matrix, dialect tables, stop path, flash flow or guard filter need the owner's approval. This is enforced by CODEOWNERS (P0-03): the owner is a required reviewer for `tools/SAFETY.md` (the in-repo copy of this document), `packages/safety/src/strings.ts` (warning and confirmation strings), `packages/safety/src/allowMatrix.ts`, `packages/protocol/src/dialects/**`, the stop path in `packages/machine/src/stop*.ts`, `packages/flasher/**`, `tools/safety-advisory.json` and `tools/firmware/manifest.json`.

1. ☐ No new code path writes to a Transport except through `MachineSession`.
2. ☐ No mid-line abort. One complete line per awaited write. No newline after a failure.
3. ☐ Every new intent goes through `safety.allowed`, and the generated allow-matrix test has been updated: no unclassified (state × overlay × intent) cells.
4. ☐ Machine state shown in the UI comes from firmware reports only. Nothing optimistic.
5. ☐ Every timed wait has a timeout and an escalation path that reaches W12 or FAULT.
6. ☐ No auto-resume, auto-reconnect-and-continue, or automatic resend.
7. ☐ New bytes sent to the board cannot include `! ~ %` or control bytes in data, cannot start with `$ ? H h {` in job data, and respect line limits. The sanitiser properties still pass.
8. ☐ Dialect differences are expressed in dialect or board data, not `if` branches, and table snapshots are updated with citations.
9. ☐ Every protocol or hardware claim cites a firmware file and line, or is marked UNVERIFIED with a bench task. The simulator behaviour carries the same status.
10. ☐ Settings writes go through the §4.6 pipeline (G21 acknowledged, read-back, units restored, invalidation).
11. ☐ Jog changes keep one-in-flight and bounded, time-capped moves.
12. ☐ Flash changes keep stub-vector ordering, commit-after-verify, the guard filter and the identity gate. The disconnect-at-every-Nth-byte test passes.
13. ☐ Warnings and confirmations in §5 and §6 are unchanged, or this document is updated in the same PR.
14. ☐ No new runtime dependency in `protocol`, `safety` or `machine`. Any dependency change is reviewed and licence-allowed.
15. ☐ CSP and Trusted Types are not loosened. No inline script, no third-party origins.
16. ☐ Stop latency budget (<100 ms) and the "stop visible and focusable in every state" E2E tests pass.
17. ☐ Stryker score on touched safety-path packages is ≥ 90%. `safety` branch coverage is 100%.
18. ☐ If the change affects motion or flashing behaviour on hardware, a HIL checklist run is scheduled before release.
19. ☐ Preview/preflight interpret the sanitised byte stream with dialect semantics (comments, G10 L, M6, M0), not the original file.
20. ☐ No new code path emits 0x18 except the `resetController` intent (T-S26). Realtime bytes are not gated by XOFF.
21. ☐ Any new persisted write (settings, offsets, normalisation, temporary travel) has a snapshot-and-restore path and a next-connect recovery (H24, H26).

---

## 9. Hardware-in-the-loop release checklist (manual; signed in `tools/RELEASES.md`)

**Bench rig:**
- TinyG v8 and Due+gShield (gQuintic later).
- Unloaded motors on a fixture.
- A real hardwired E-stop cutting Vmot.
- On J6: an LED, an active-low relay module and a logic probe.
- No cutter.
- Transcripts recorded with `apps/cli`.

**Read-only (Phase 2):**
1. Connect and identify both boards. Assert that only JSON GETs and `!` (feedhold, from the Stop button or a Stop request) appear in the transcript.
1a. C1 per session: disconnect, reconnect the same day → short re-attestation shown; change the system date to the next day → full checklist shown.
1b. Stop request from a second tab while the controlling tab's main thread is frozen (DevTools pause) → `!` in the transcript.
2. Connect while the board is running a buffered job started from another tool. Assert no writes and correct state display.
3. Pull USB, reconnect, and confirm UNKNOWN.
4. Two identical boards: confirm the id binding works.
5. Press reset mid-session. Confirm the banner leads to UNKNOWN.
6. EMI or plug-cycle test, if possible.

**Settings (Phase 3):**
7. Write and read back each risk class. Confirm rollback works.
8. Write during motion and confirm the status 9 refusal is handled.
9. Confirm units are restored.
9a. Session normalisation: normalise, disconnect normally, then stream a job with CNCjs (and SPJS if available) → it works. Repeat with the tab killed instead of a normal disconnect → the next connect offers C17, and after restoring CNCjs works.
9b. After a polarity write: W20 shown; `dir.*` remains unset.

**Flash (Phase 4):**
10. B-FL-1: interrupt after the stub, mid-pages, and just before the final page 0. Confirm the board stays in xboot each time and a retry succeeds.
11. B-FL-2: scope PF5/J6 SpinDir, the spindle and coolant pins, and the DRV8818 ENABLE and STEP pins during reset and in xboot. Record them and update rules and wording.
12. Lock-bit preflight on a locked sample, if one is available.
12a. **Image approval run (D4)** for every manifest image, including the pre-release 440.21: flash, restore a reference config, then motion (jog, a 1k-line job), homing on every axis, soft alarm and hard alarm behaviour, and confirm the EEPROM defaults after a build change match PROTOCOL_NOTES §12.2. Signed per image hash.
12b. Leave the flasher without restoring → C18 typed confirmation required; homing and jog blocked.
12c. B-FL-1 extensions: watchdog during `e`; a 2 s host stall mid-write; power cut and USB pull **during** the final page 0 write (record the outcome).

**Commissioning (Phase 5):**
13. Every jog increment.
14. Key held, then window switched. No runaway.
15. First-move scaling check with deliberately wrong `tr`.
16. Homing with a short search cap.
16a. Pull USB mid-homing while the temporary `tn`/`tm` are in EEPROM, then reconnect → NEEDS_REVIEW with "Restore travel" (C17); after restore, `tn`/`tm` read back equal the snapshot (B-HOME-1).
16b. Per-session switch re-test is required before the first homing of a session (H28).
17. Dual-motor decoupled flow.
18. Outputs test: confirm the relay module state at power-up and reset.

**Streaming (Phase 6):**
19. 100k-line job on both flow engines.
20. Feedhold latency measured, including **feedhold while the board has sent XOFF** and with the RX buffer near full (B-FC-1).
21. Stop job: LED off after the sequence.
21a. M0 and M6: a bare M0 leaves the spindle LED on (W17 shown); a file with M6 is blocked until C14; with C14 the inserted `M5 M9 M0` turns the LED off and pauses; resume requires the spindle restart confirmation. On g2 (Phase 7) the same test answers B-G2-5.
22. Pull USB mid-job. Measured overrun distance must be at most the displayed mm bound; record the measured time against the displayed estimate; **record the spindle LED state after the queue drains** (expected: still on, matching W5). Repeat on g2 with long segments (Phase 7).
23. Hide the tab under each policy.
24. Soft alarm reflex.
25. Watchdog with G4 P10 and spin-up delays (B-WD-1).
26. TinyG with `ex=1` and `flowControl:'none'`: no overrun (B-FC-1).
27. `ex=2` board → session READ_ONLY with guidance.
28. Audible alarm: pull USB with the speakers on → tone plays; W3 is announced by a screen reader.
29. Post-flush `qr` value recorded (B-QR-1).

---

## 10. Safety test cases (automated)

| ID | Test | Layer |
|---|---|---|
| T-S1 | Sanitiser output never contains `[!~%]` or control bytes other than tab; never shortens a kept line; always numbers with monotonic N; rejects `$?Hh{` first characters; TinyG dialect: no kept line has non-whitespace after a comment opener or an unclosed `(`; `sanitize(sanitize(x)) = sanitize(x)`; preview geometry equals `interpret(sanitize(x))` for random inputs | U (fast-check) |
| T-S2 | CAM corpus: `%` tape markers dropped; `(50% stepover)` and `(TOOL CHANGE!)` stripped; embedded 0x18 rejected; a 130-byte line rejected on TinyG; `N10 (c) G0X10` and `(c) G0X10` rejected on TinyG (not sent as `G0X10`); `G10 L20 P1 X0` rejected on TinyG; M6 without C14 rejected, with C14 preceded by `M5`,`M9`,`M0` | U |
| T-S3 | Allow-matrix: every (state × overlay × intent) cell is classified; Start is only allowed from ARMED; feedhold is allowed everywhere connected | U (generated) |
| T-S4 | TinyG stat 11 maps to shutdown; g2 11 to interlock, 12 to shutdown, 13 to panic; limit hit 204/203 | U |
| T-S5 | No newline is written after an injected write failure; TinyG sends `%` before any further data; feedhold requested while the board has sent XOFF writes `!` immediately (data stays paused) | M |
| T-S6 | Window accounting: every byte is counted in exactly one window; never below 0 or above budget; for random JSON and G-code interleavings, including XOFF bursts with realtime bytes written during XOFF | M |
| T-S7 | At most one jog in flight; a jog target uses only a post-idle report; key repeat is dropped | M, E |
| T-S8 | Disconnect at 10%, 20%, … 90%: LOST; nothing written afterwards; reconnect goes to UNKNOWN; overrun mm bound ≥ simulated motion **on both the TinyG and the g2 model, including g2 with long segments** (queued-motion ceiling applied to the line window) | M |
| T-S9 | TinyG soft alarm while moving produces `!` and `%` within one read cycle, then FAULT | M |
| T-S10 | Banner after Ready produces FAULT then UNKNOWN | M |
| T-S11 | Watchdog: G4 P10 does not cause STALE; 2 s of unexpected silence causes STALE; 5 s while running causes FAULT plus `!` | M |
| T-S12 | Footer status ≠ 0 or `n` mismatch produces FAULT; no resend | M |
| T-S13 | Settings write: G21 is sent and acknowledged before any JSON set; units are restored; status 9 triggers rollback; forbidden keys are never emitted (fuzz) | U, M |
| T-S14 | Flash: disconnect at every Nth byte means the device model never executes a partial app (sled model); `E` is never sent before verify; `l` and addresses ≥ 0x30000 are never emitted | M |
| T-S15 | Tampered image, HTML saved as .hex, CRLF damage, wrong `hp`: refused before erase | U, E |
| T-S16 | 1200 baud open throws without the token; 2341:003D refused before open | U |
| T-S17 | The previous-session banner overrides SIM on reload while LIVE | E |
| T-S18 | Escape triggers feedhold from any focus; Space never does; no motion button has default focus; fullscreen requests are denied while LIVE and entering LIVE exits fullscreen; file pickers and native selects cannot open while RUNNING/HELD | E |
| T-S19 | Stop latency is under 100 ms with a 1M-segment preview loaded | E |
| T-S20 | UI heartbeat loss during a job produces FAULT plus `!` | M |
| T-S21 | Device id mismatch: BLOCKED, no writes | M |
| T-S22 | Imported profile has no facts or confirmations; all facts need re-verify | U |
| T-S23 | Stop job sequences match §4.4 exactly per dialect; timeouts escalate to W12 | M |
| T-S24 | TinyG never receives 0x04 | U |
| T-S25 | Production CSP header present; no external origins in the built output; Trusted Types policies are only the two named ones | E |
| T-S26 | 0x18 never appears in any effect list except as the effect of the `resetController` intent with a C15 token (generated over all states × events, plus fuzzed fault plans) | U, M |
| T-S27 | Temporary homing cap: kill at each step of §4.5a, reconnect → NEEDS_REVIEW with restore; restore writes the snapshot exactly | M |
| T-S28 | Normalisation: restore effects emitted on normal disconnect; abnormal end → C17 offered on next connect before any other intent | M |
| T-S29 | Stop request from another tab with the controlling tab's main thread blocked (busy loop) arrives as `!` from the worker | E |
| T-S30 | W3 and W12 render with `role="alert"`/`aria-live="assertive"` and start the alarm tone (AudioContext state `running` after the Connect gesture) | E |
| T-S31 | `safety-advisory.json` listing the current SHA, or a failed/malformed fetch, refuses LIVE; offline pages unaffected | E |
| T-S32 | Every W/C string in the app comes from `safety/strings.ts` and byte-matches SAFETY.md §5–§6 | U |
| T-S33 | A job whose first G1/G2/G3 precedes any F word is blocked (not merely flagged) | U |
| T-S34 | PROGRAM_PAUSED shows W17 and "UNCONFIRMED" spindle state; resume requires C9 plus the spindle restart step | M, E |
| T-S35 | Leaving the flasher without restore requires typed C18 and leaves homing/jog denied | M, E |
| T-S36 | Work zero / G92 / G10 intents: allowed only in IDLE_* and fresh; C16 required; `job.*.preflight` invalidated and any armed job disarmed; on TinyG `G10 L20` is never emitted | U, M |
| T-S37 | Spindle/coolant **off** is allowed in every connected state without FAULT/LOST; **on** is denied without `outputs.spindle` | U |
