# Sanitiser, allow-matrix and overrun bound (ROADMAP P0-10)

This note records how `packages/safety` implements SAFETY §4.1, §4.3 and
§4.7, and every place where the code had to interpret the design. Each
interpretation errs towards blocking or denying. A reviewer who disagrees
with one changes the design document first, then the code.

## `sanitizeJob(lines, dialect, options)`

The steps run in the order SAFETY §4.7 gives them (see the header of
`packages/safety/src/sanitize/sanitize.ts`). The output is the single source
of truth: the streamer writes exactly `SentLine.text` plus one LF, and the
preview, analyser and preflight interpret exactly those lines.

`options` carries what the design leaves to the live session:

- `motion`: the queued-motion ceiling (2–20 s, default 5), `k` (default 0.5),
  the board's `vm` per axis (rapids), its `fr` per axis (feed moves) and the
  `am`/`ra` of each rotary axis. These are needed for step 6a. A rapid on an
  axis with no `vm`, a feed move on an axis with no `fr`, and a move word on a
  rotary axis with no `am` (or in radius mode with no `ra`) are blocked.
- `start`: the live start state (units, distance and arc-distance mode,
  plane, motion mode, feed, coordinate system and offsets, machine position,
  stored G28/G30 positions, and the board's G-code defaults `gun`, `gdi`,
  `gpl`, `gco`). Every field is optional. **What is missing is unknown, and a
  move whose length depends on something unknown is blocked**
  (`unknown-state`). Without a start state, a G91 move can still be modelled;
  an absolute move cannot. Arm needs live data anyway, so this blocks nothing
  that could run.
- `c14`, `c22`, `optionalStop`: the user's answers.

### Interpretations

1. **Control bytes are checked before comments are stripped.** A C0 control
   byte (other than tab) anywhere on a line, even in a comment, rejects it.
   Non-ASCII text inside a comment is allowed, because comments are never
   sent. `!`, `~` and `%` are checked after comment stripping, so
   `(50% stepover)` passes (T-S2).
2. **Further comments after a trailing comment are allowed**
   (`G0 X1 (a) (b) ;c`). Anything else after a comment is rejected.
3. **Allowed characters.** Code may contain only letters, digits, `+`, `-`,
   `.`, space and tab (PN §9.3 "sanitiser rejects bytes outside the allowed
   set"). This rejects block delete (`/`), which TinyG would skip silently.
4. **Supported codes are dialect data.** `Dialect.gcode.job.codes` lists the
   codes a job may contain. Codes the firmware has but only the host may use
   are left out: G28.2/G28.3/G28.4 (homing and set-position redefine the
   machine position preflight checked), G38.2, M105/M114/M115 (their replies
   are not line responses) and M400 (the host's own barrier). A dotted code
   outside the list is blocked; trailing zeros are not a sub-code (`G1.0` is
   G1, as EN counts significant decimals, E150).
5. **TG M201.3.** PROTOCOL_NOTES §9.3 lists M201.3 as "n/a" on TG, but the
   440.21 parser handles it (TG gcode_parser.c:370-375). It is not in the TG
   job codes, so it is blocked there too.
6. **TG G90.1/G91.1** are parsed but never applied to arcs on 440.21, so
   they are not TG job codes.
7. **Modal conflicts** follow EN's checks (E152) on every dialect: two codes
   of one modal group, a motion code and a group-0 code sharing axis words,
   G53 with a group-0 code or without G0/G1, axis words under G80, I/J/K/R
   outside an arc, R together with I/J/K, and a repeated word letter.
8. **G10** needs an allowed L and an explicit P1–P6 (P0 is rejected on both
   dialects, although EN reads it as the active system).
9. **A feed move with no feed rate is blocked** (`feed-not-set`). The
   firmware would refuse it mid-job (a FAULT); the console rule "first feed
   needs F" is the same check.
10. **Rejected lines change nothing.** A rejected line is never sent, so the
    rest of the file is analysed as it would run without it.
11. **Program end** (M2/M30) restores the board's defaults. EN restores the
    units and sets G90; TG keeps the units and restores `gdi`. A value is kept
    only where both firmwares agree on it; otherwise it becomes unknown.
12. **C22 cannot fix a last line that turns outputs on together with the
    program end** (`M3 M30` on TG): `M5 M9` before it would be undone by it,
    and after it the program end would no longer be last. That stays
    blocked. (Found by the T-S1 end-state property.)
13. **TG B-M2-1.** The 440.21 source turns the spindle and flood coolant off
    at program end (`_exec_program_finalize`, TG canonical_machine.c:1370-1371).
    SAFETY H48 keeps this UNVERIFIED until the bench closes B-M2-1, so the TG
    data keeps `programEndStopsOutputs: false`.
14. **G53 under G91 is blocked on every dialect** (P0-10 verify). TinyG
    implements G53 only by dropping the work offset; under G91 the values
    are still distances (EN canonical_machine.c:514-520, TG
    canonical_machine.c:448-451), not machine coordinates. Modelling them as
    machine coordinates would mis-size the move and, when split, write
    absolute endpoints that the firmware would run as cumulative distances.
    G53 with an unknown distance mode is blocked as `unknown-state`.
15. **G28/G30 intermediate point frame is dialect data**
    (`job.storedMoveIntermediate`, P0-10 verify). EN reads the axis words as
    work coordinates (it clears the absolute override for that leg, EN
    canonical_machine.c:1320-1335); 440.21 sets the absolute override first,
    so they are machine coordinates (TG canonical_machine.c:907-914).
16. **TG E088 counts more than PN §9.3 lists** (P0-10 verify). PN lists S,
    T, M3-M9, G4 and G54-G59. The 440.21 source also queues one planner
    buffer for each of M0/M1/M60, M2/M30, G92/G92.1/G92.2/G92.3 and the
    second leg of G28/G30 (TG canonical_machine.c:782-821, :907-914,
    :1396-1411; EN planner.h:84-89 gives the same tally), so the TG data
    counts them too. PN §9.3 needs the owner's update.
17. **TG mid-file M2/M30 still warns**, as SAFETY §4.7 step 8 says, although
    P0-08 found that a buffered program end clears the soft alarm on 440.21
    too (`caps.m2ClearsAlarm`). On 440.21 the cycle end at planner drain
    overwrites the alarm state the same way (TG canonical_machine.c:1388-1393),
    so blocking the mid-file M30 would not close the hole; the host's FAULT
    on the alarm report is the mitigation. The owner should confirm this in
    SAFETY H35 / PN §9.3.

18. **F is converted with the units in force before the line's G20/G21**
    (P0 review). Both firmwares run `cm_set_feed_rate` before
    `cm_set_units_mode` (EN gcode_parser.c:627-633 vs :659,
    canonical_machine.c:1376; TG gcode_parser.c:455 vs :474), so on a G21
    board `G20 G1 X4 F2` runs at 2 mm/min, not 50.8. With the prior units
    unknown, F on the line is unknown (`unknown-state` on a feed move).
19. **Rotary axis modes** (P0 review). In radius mode (`am`=3) the word is
    linear units turned into degrees, `v × units × 360 / (2π ra)` (EN
    canonical_machine.c:497-500); the sanitiser models that from the live
    `am`/`ra`. Unknown `am`, or radius mode with unknown `ra` or units, blocks
    the move. G28/G30 are blocked while any rotary axis is in radius mode or
    of unknown mode: 440.21 passes the stored position through `_calc_ABC`
    again. Offsets are never radius-converted.
20. **Rotary offsets under G20 are dialect data** (`rotaryOffsetsUseUnits`,
    P0 review): 440.21 applies `_to_millimeters` to rotary G10/G92 words (TG
    canonical_machine.c:669, :788-789); EN does not (EN :993, :1131).
21. **The EN tool length offset applies to X, Y and Z targets only** (P0
    review). `cm_set_model_target` adds it in the XYZ loop only (EN
    canonical_machine.c:515-518 vs :530-536), while G43.1 still stores A/B/C
    values that G92 and G10 L20 subtract. A rotary axis therefore reads
    value + stored tool offset after G92/G10 L20.

### Long moves (step 6a)

- The modelled duration of a feed move is length / (`min(F, fr) × k`), with
  `fr` the smallest feed rate maximum among the moving axes; a rapid uses
  `vm × k`. TinyG limits feed moves by `fr`, never `vm` (EN
  plan_line.c:377-381). A smaller `v_eff` only means more, shorter segments.
- Sub-segments are sized against 99.9% of the ceiling, so re-sanitising the
  output never splits again (T-S1 idempotence), and each sub-segment's
  duration is recomputed from the rounded numbers actually written.
- Straight moves: absolute endpoints are rounded positions on the line;
  incremental sub-deltas are differences of rounded cumulative positions, so
  they add up to the original delta. The last segment repeats the original
  word as written.
- Arcs follow EN's arc code (centre from I/J/K or R, P turns, full circles,
  G18 as (Z, X)). Sub-arcs are at most a quarter turn, with recomputed I/J/K
  (G90.1 writes the absolute centre). After rounding, every sub-arc is
  checked: start and end radius agree to 0.001 mm, the travel the firmware
  will compute from the written numbers equals the intended travel, and the
  chord is at least 0.01 mm (so a sub-arc never rounds to coincident
  endpoints, which EN runs as a full circle).
- Coincidence and direction are decided with each dialect's own float32 rule
  (`arcCoincidence`, Codex P0-10 #1): EN runs a centre-format arc whose end
  point is fp_EQ (`|a-b| < (float)0.00001`) to the start on both plane axes
  as a full circle in its direction, plus P turns (EN plan_arc.c:320-341);
  TG treats fp_EQ start and end ANGLES as zero travel plus P turns, and
  refuses the arc when that leaves nothing (TG plan_arc.c:276-303,
  :165-167). The rounding of the firmware's machine coordinates is bounded
  by 2^-20 of their size (sixteen float32 roundings) and of the arc's angles
  by that over the radius plus 2^-19 rad. An arc whose position or angle
  test falls inside that band, or near TG's atan2 branch cut, is blocked
  (`arc-ambiguous`), as is an R-format arc whose plane end points are not
  clearly apart (the radius code divides by their distance). The model and
  the overrun bound use the travel the firmware will run (a full circle, not
  a 0.000001 mm arc). Every sub-arc is re-checked with the same rule. The
  machine position of the plane axes must be known to size the band.
- The band also carries how well the start is known (arc uncertainty, found
  by the verification of the P0-10 #1 fix). The board reports `mpo` (always
  mm), the work offsets, G92 offsets and G28/G30 stored positions to three
  decimals (EN config_app.c:166-178, :388-450; TG config_app.c:131-143,
  :392-454), so a reported 0.000 may be 0.0004 mm away, fifty times EPSILON.
  Offsets and stored positions are taken as printed in the board's units
  (0.0127 mm apart on an inch board, and when the units are unknown). The
  analyser tracks, per axis, a bound on the error of the machine position and
  of the work position: a reported start has the half-step of each reported
  part; an absolute (G90) move leaves the work position known to one float32
  sum (the firmware stores the written target plus its offset); G53 and
  G28/G30 leave the machine position known to the target's precision; each
  incremental (G91) move adds a float32 rounding of 2^-22 of the magnitudes
  involved, so a run of them accumulates; G92 and G10 L20 make the work
  position read the written value; offset changes re-derive the work
  position from the machine position and the new offset. An absolute arc
  end word and a G90.1 centre inherit the work position's bound, which widens
  the coincidence, direction and branch-cut tests and the R-format chord
  test; inside the widened band the arc is refused (`arc-ambiguous`), never
  given the short path. An incremental end point or I/J/K offset is added to
  the firmware's own position and inherits nothing, and an omitted plane axis
  ends exactly where it was. A split line is counted as the lines the
  firmware receives: an incremental split adds one rounding per sub-segment
  or sub-arc (every sub-arc writes both plane axes), and an absolute split
  arc whose plane axis was omitted writes that axis's start rounded to the
  split decimals, so the bound grows by the rounding (found by the
  verification of c2799da: a 722-segment `G91 G1 Y30 F1` from Y600 drifts
  0.011 mm in float32, and a following G90 arc to the board's position was
  accepted as a 0.011 mm arc while EN runs a full circle). The firmware-model cross-check
  (`packages/safety/test/arc-models.test.ts`) runs these cases on the test-kit
  models, whose targets are float32 like the board's.
- No coordinate is ever assumed (Codex P0-10 #2): an absolute (G90) full
  circle needs the work start of both plane axes, and an absolute arc that
  must be split needs the start of both plane axes, because every sub-arc
  writes both. Incremental (G91) arcs write deltas only and need neither.
- Arcs with rotary words, G28/G30 above the ceiling (two moves in one block)
  and moves that would need sub-segments under 0.01 mm or more than 10 000 of
  them are blocked (`split-impossible`, "a move that cannot be split within
  tolerance is a preflight block").
- A centre-format arc whose end point is off its circle by more than
  max(0.005 mm, 0.1% of the radius) is blocked as one the firmware would
  refuse. EN's own tolerance is wider and TG's test is inverted
  (TG plan_arc.c:262-264), so the strictest common rule is used.

## `allowed(snapshot, intent, release?)`

A declarative table: one row per intent with the base states it is allowed
in and the overlays it survives. Active overlays intersect: adding an
overlay never allows more (a fast-check property). The normative rule
(stop class allowed whenever the port is open) is checked before anything
else and depends on nothing else.

Interpretations:

- **Port open** means IDENTIFYING onwards, and no LOST overlay.
- **BOOTLOADER_MODE** keeps the stop class (normative rule; ROADMAP P5-x
  "the valid stop paths remain available"), but denies reads, ENQ and Reset
  controller.
- **Reset controller, ENQ and Disconnect** ("any connected state" rows) are
  allowed under STALE, READ_ONLY and UNKNOWN. Reset is also allowed under
  FAULT and ORPHANED_MOTION (their exits). Disconnect is denied under
  ORPHANED_MOTION (its only exits are Stop job and Reset controller) and
  while a job, jog, homing, settings write or flash is in progress.
- **ORPHANED_MOTION on an unclassified board** allows only the stop class and
  Reset controller (T-S86).
- **Cloud sync** pauses in RUNNING, HELD, BARRIER_DRAINING and STOPPING_JOB
  (the design's list) and also in PREAMBLE, HOLD_REQUESTED and END_HOLDBACK,
  the transitions into and out of them.
- **Release gate.** `CURRENT_RELEASE` (Phase 0) denies every `motion`,
  `write` and `port` intent with "Not available in this release." Reset
  controller and optional stop count as writes. The tests run the whole
  matrix with every gate open as well.

## `overrunBound(queue)`

Sums the queued lengths (a true upper bound) and modelled seconds (an
estimate) of the sent lines not known to have finished. Any length or time
that is not a finite, non-negative number makes that half Infinity.

## Host gates (T-S69)

`effectiveHostGates(confirmed, proposed, c19)` applies a tightening at once
and a loosening only with C19 (typed `WRITE` for spindle kind away from laser
or plasma, the ceiling and the jog caps). `workEnvelope` takes only the
board's `tn`/`tm`. The profile field classification itself belongs to
MachineProfile v2 (TB-01).

## Not here

- "Preview geometry equals interpret(sanitize(x))" (T-S1) needs the preview
  interpreter: TB-02's acceptance.
- `ackFault`'s polled-read condition and Resume's "started by this session"
  are machine-session context (P0-12 onwards).
