# Workspace features and data model

Status: design for review (increment 2). It does not change shipping code. The
[clickable prototype](workspace-prototype/) shows each feature; the
[tenets](WORKSPACE_TENETS.md) and [proposal](WORKSPACE_PROPOSAL.md) set the rules.
The machining assistant (tool and materials libraries, the store, the feeds and
speeds advisor, live tuning, the AI seam and multi-depth simulation) is
specified in [MACHINING_ASSISTANT.md](MACHINING_ASSISTANT.md). Where the two
differ, that document is newer and wins.
Firmware facts are from edge-next d254eb0b and the TinyG v8 bootloader, as
reported by the firmware maintainer's session.

## Phase tags

| Tag | Meaning |
| --- | --- |
| **P1** | Read-only, ships now: read, show, prepare. Nothing is written to the board. |
| **P2** | Motion control: jog, home, set zero, spindle and coolant commands. |
| **P3** | Jobs: arm, stream, pause/resume, tool changes, live job data. |
| **PW** | Settings writes: restore, configurator apply. A later, separately reviewed phase. |
| **PF** | Firmware update: its own safety-reviewed phase (see Firmware update). |
| **Host** | Runs in the browser only; needs no firmware change. |
| **Mock: firmware pending** | UI is built against a mocked value. It becomes real when the firmware ships the feature. Mocks live behind one seam, `telemetry.mjs` in the prototype (the session snapshot in the app). Swapping in real telemetry changes that one provider, not the views. |

Pause and Stop job are never part of any phase gate: they are always reachable
and enabled whenever a port is open (SAFETY §4.1). OD-6 labels: "Pause" and
"Stop job"; W1 stays on top; the paused state reads "Paused · spindle still on".

## Entities

All identifiers are stable ids, never display names. Lengths are millimetres,
feeds mm/min, speeds rpm. Every cloud-synced record carries
`{ id, owner, revision, updatedAt, device }`; provenance is written by the
server (SAFETY threat table). Nothing below carries homing, safety facts,
confirmations or permission to resume: those stay on the device.

### Machine profile (Host; P1 to view, PW to apply)

```
Machine { id, name, templateId?, templateVersion?, controller: {family, hv}, drive: belt|screw|rack,
          travel: {x, y, z}, axes: [{axis, motor, travelPerRev, stepAngle, microsteps}],
          spindle: {kind, minRpm, maxRpm, powerW, cooling}, rigidity: hobby|rigid|industrial }
Template { id, name, drive, source, revision, version, illustration, reviewStatus }
```

Catalogue cards (X-Carve, Shapeoko, OpenBuilds LEAD and WorkBee, 3040/6040,
Custom) each have their own drawing, generated from simple solids in the
blueprint style. A copy pins the template version and copies no board settings.

### Workholding and bed (Host, P1)

```
Bed     { width, depth, thickness, material, surfacedAt? }        // spoilboard; bed top is z = 0 of the scene
Fixture { id, name, source: {file, kind: dxf|svg, hash}, outline: [[x,y]...], holes: [[x,y,r]...],
          height, position: {x, y}, material, clamps?: [{kind, x, y, w, d, h}] }
```

DXF (LWPOLYLINE, CIRCLE) and SVG (rect, circle, polygon, polyline, simple
paths) are parsed locally; the largest closed outline becomes the solid and
circles become holes. The file never leaves the computer unless the project
syncs. Units are taken as millimetres; a unit picker is a later refinement.

### Stock and material (Host, P1)

```
Stock    { shape: block|round|sheet, width, depth, diameter?, thickness, materialId, materialVersion,
           position: {x, y}, zero: {corner: front-left|...|center, height: top|bottom} }
```

The Material record is defined in [MACHINING_ASSISTANT.md §3](MACHINING_ASSISTANT.md#3-materials-library-p1-cloud):
built-in, mine (a fork that inherits until edited) and store sources; family
and grade; cutting data per tool material; coolant need with its reason;
behaviour; safety notes that are always shown; stock forms; purchase links. Stock
references a material by id and version, so a job records exactly what it was
cut from. The prototype's `library.mjs` holds example records in that shape.

Heights are shown as a stack above the machine table (bed top, fixture top,
stock top) with the Z room left. A check warns when the file's expected zero
differs from the chosen zero, and when the part does not fit the stock.

### Tool library (Host only; cloud-synced)

```
Tool { id, version, number, name, type: flat|ball|bull|vbit|chamfer|drill|engraver|oflute|surfacing|thread,
       diameter, shank, flutes, fluteLength, overallLength, stickout, helix?, cornerRadius?, angle?,
       toolMaterial, coating, manufacturer, partNumber, description, notes,
       purchase: [{vendor, url, sku?, price?, currency?, boughtAt?, kind: store|link}], datasheetUrl,
       cuttingData: [{materialRef, vc, fz, ap, ae, coolant, source: manufacturer|synthetos|user|ai, note}],
       life: {minutesByMaterial}, firmwareSlot?, tags, images }
```

The fields are specified in [MACHINING_ASSISTANT.md §2](MACHINING_ASSISTANT.md#2-tool-library-p1-cloud).
Links accept http(s) only and are never fetched (§8).

The library is host-side. The firmware has no tool table and none is planned:
it reports only the active tool (`tool` in `sr`, the T word) and the G43/G49
tool length. Each operation chooses its tool from the library.

**No firmware tool table for TinyG (owner, polish pass 1).** Tools live in
software, in this library; the TinyG UI shows no firmware tool table. g2core
may get one later; `Tool.firmwareSlot` keeps the shape for that and is unused.

### Operation and job (P1 to prepare; P3 to run)

```
File      { id, projectId, version, name, hash, lines, sanitizerResult, preScan }
PreScan   { toolChanges: [{line, from, to, known}], unknownTools: [T], shortestMove, estimate }
Operation { id, fileId, number, name, toolId, rpm, feed, plunge, doc, woc, coolant: none|air|mist|flood }
Job       { id, fileId, fileVersion, machineId, setupSnapshot, operations: [...], estimate,
            checks: [{kind, status: ok|warn|todo, detail}] }
```

The **Job card** in the Run inspector replaces "Next operation": file and
version, operations with their tool pickers, stock, workholding, estimated
time, checks (travel, part in stock, clamp clearance, tool changes and library,
feeds and speeds, work zero, homing, firmware version), then the start flow
"Check, Set zero, Start". Start is disabled until P3 and says so.

### Manual tool change (Host; P3)

Edge-next treats a bare T as a selection only. M6 is queued and changes `sr`
`tool` when executed, but the machine never pauses, so the host must stop:

1. The pre-scan lists every M6 (T may share the line or come earlier) and flags
   tool numbers missing from the library.
2. Streaming stops before the M6 line.
3. Run waits for `stat` idle with an empty planner queue.
4. The tool-change card shows the current tool, the next tool from the library
   (diameter, length), the spindle state, "move to the change position"
   (P2 jog), the optional Z re-zero or tool-length probe, then Resume.
5. On Resume Run sends the M6 line itself, so `sr` `tool` stays truthful, then
   streams on.

Tool changes appear as markers in the job timeline and in the G-code listing.
An opt-in firmware mode where M6 pauses until cycle start is on the
maintainer's list: a possible firmware feature, not a dependency.

### Jog (P2)

The Run inspector's jog section (where the read-only "Inspect configuration"
block was): XY pad with diagonals and go-to-XY-zero, Z up/down, steps 0.1, 1,
10, 50 and Hold, jog speed, and set-zero and go-to-zero per axis.

- Each press is one single-axis move to a target inside the soft limits,
  `{"jogx": <target>}` (also jogy, jogz, joga), or a small G91 G1 move.
- There is no continuous jog with cancel. Hold is built from short steps;
  releasing sends `!` (feedhold, honoured at once), then `%` to flush once the
  hold has stopped (`%` works only between lines).
- *Built for Phase 2 (2026-11-02, SAFETY §4.5b):* run sends short `G21 G91 G1`
  pieces (never the `jog*` tokens), at most two queued, with steps 0.01 to 100 mm
  (or inches) and Hold; a held jog needs a keep-alive from the page. Zero has its
  own tab; spindle on asks C24. Motion is on for the bench and staging origins only.
- No latency is promised. In P1 the controls are visible and disabled with
  "Jogging arrives with motion control"; during a job, "not available while a
  job is in progress"; on old firmware, locked until the update.

### Spindle and coolant (commands P2; state Mock: firmware pending)

Commands: M3/M4/M5 with S; polarity from `spep`/`spdp`. Coolant M7/M8/M9.

**Spindle state report (Mock: firmware pending).** The owner decided to design
for a reported state: on/off, direction, the commanded S after the
p1csl..p1csh clamp, and possibly the PWM duty. TinyG has no spindle speed
sensor, so actual rpm is never reported: every speed the app shows is labelled
"commanded", and live chipload uses the commanded S (MACHINING_ASSISTANT.md
§6.1). Today no status key reports the spindle, so until the key ships the app
shows only the last commanded value and says so. Candidate shape (not
decided): `{"sr":{"spe":1,"spd":0,"sps":18000}}`, with `sps` the commanded S
after the clamp.
Coolant has no report and none is planned: it always shows the last command.

### Overrides (P3 UI; Mock: firmware pending)

Feed and spindle override sliders with -10 and +10 and Reset to 100 %, and a
rapid override 25/50/100 %. Edge-next has no overrides: M48-M51 are rejected
and there are no realtime override characters. A runtime shape such as
`{rt:{fo:0.8}}` is only under discussion, so the wire format is not fixed. The
section is tagged "Mock · firmware pending", is enabled only while a job runs,
and sends nothing.

### Live job analysis (P3; Host)

A "Live job" tab next to G-code and Console. Computed host-side from today's
reports: default `sr` fields `line, posx..posa, feed` (commanded F), `vel`
(actual velocity), `unit, coor, dist, admo, frmo, momo, stat`, change-filtered
every `si` ms (default 250, minimum 100), plus `qr` with `qv` 1 or 2.

```
LiveSample { t, line, pos, feed, vel, stat, qr }
LiveEvent  { t, kind: info|warn|toolchange, text, line? }
```

It shows progress, line N of M, elapsed and remaining (estimate), actual
against programmed feed over the last 60 s, planner buffers free, and an event
stream. `qr` high while cutting means the planner is starving (the sender is
not keeping up); around 11-12 means full and corner- or jerk-limited. Short
segments that starve the planner point to arc fitting in Analyze. A firmware
feed-limit advisor reported through `rt` is planned upstream and optional here.

### Feeds and speeds advisor (P1 UI; engine later; Host)

Superseded in detail by [MACHINING_ASSISTANT.md §5](MACHINING_ASSISTANT.md#5-feeds-and-speeds-advisor-p1-rules-engine-ai-later)
(model, achievable feed, engines) and §6 (live tuning in the Live job tab). The
summary below is the increment 2 shape.

```
Advice { operationId, materialId, toolId, machineId, coolant,
         chipLoad, surfaceSpeed, removalRate, verdict: within|check|too-aggressive,
         findings: [{level, text}], suggestion?: {feed, doc, passes, coolant} }
```

Lives in Analyze, linked from the Job card check. Inputs: the stock material,
each operation's tool, the machine's rigidity and spindle, and coolant (none,
air, mist, flood). Example: a 3.175 mm two-flute end mill in 6061 at 1500
mm/min, 2 mm deep, no coolant is "Too aggressive" (63 % of diameter in a slot,
0.042 mm/tooth, 9.5 cm³/min); it suggests 900 mm/min, 4 passes of 0.5 mm, mist
or air. "Make a revised copy" creates a new file version for review, never an
edit of an armed file. The prototype's rules are rough placeholders.

### Preview and simulation (P1; Host)

The 3D view draws bed, fixture, clamps, stock and toolpath, and removes
material from a heightfield using the tool's real shape (flat, ball, V,
drill). Modes: Toolpath, Result, Both; cameras 3D, Top, Front, Fit; drag to
orbit. The timeline scrubs or plays the simulation. During a job the same view
follows reported progress. It is not the interpreter and not a collision
check; W13 stays on the view.

### Account and sync (Host)

An avatar menu replaces the old panel: "Signed in with GitHub", one sync row
(synced, syncing, paused while a job runs, offline), Account and devices, and
Sign out (disabled while a job runs). The avatar carries a small sync badge.
Synced: projects, files, setups, machine profiles, tools, settings backups.

### Firmware gate, update and backups (Configure: Wiring · Firmware · Backups)

**Minimum firmware gate (P1).** A board below the supported minimum (for
example 440.20 when 450.01 is current) may connect, identify, be viewed and be
backed up. Jobs, jogging and settings writes stay locked; the strip says why,
and the board opens straight into the Update panel.

**Settings backup (P1, read-only).** Taken automatically before any update and
on demand. Saved to the account by board id and date with the firmware
version. Read token by token in JSON, never by parsing `$$`; send G21 first so
values are in mm. Cover `sys`, motors 1-4, axes x/y/z/a/b/c, `p1`, offsets
g54-g59/g92/g28/g30, and the `sr` list by name (never se00-se29). Per board: a
list, diff of any two or against the live board, export and import as JSON.

```
Backup { id, boardId, hv, fb, takenAt, reason: manual|before-update|first-connect|import, tokens: {name: value} }
```

**Restore (PW).** A reviewed write: show the diff, then apply. Never write
`fb fv hp hv id baud`. Write one token at a time and wait for each reply
(EEPROM writes stall the board). Comms tokens `js ee ec ej ex rxm` last, `jv`
very last. Restore by token name so an older backup maps onto newer firmware;
unknown or renamed tokens are listed in the diff.

*Shipped 2026-11-02 on the bench and staging builds (SAFETY §4.6 amendment,
H57-H63); production stays read-only behind one switch.* Board, Machines and
the backup file feed one Pending changes tray. Apply backs up first (saved on
this computer and downloaded), passes the idle gate before every write, writes
one token at a time and reads each back. It stops at the first failure and
offers revert from the backup. High-risk changes name their consequence and
need WRITE typed. No communication setting is writable yet.

**Firmware update (PF: separate review).** The panel lists signed releases for
the board's hardware version only, changelog style, with Recommended on the
newest. Steps: back up → restart into update mode → write with progress →
verify → reconnect → version check → offer to restore.

- Normal entry: open the port at 115200 8N1, send `{"boot":1}` plus newline;
  the board resets into xboot and waits 60 s; discard leftovers, send ESC,
  flash over AVR109 block mode with CRC (part x192a3). No DTR/RTS.
- Recovery: with no running application, the user unplugs and replugs USB (or
  resets) while Run sends ESC repeatedly within the short LED-blink window. The
  panel shows "Unplug the USB cable and plug it back in now" with a countdown.
  The bootloader survives a failed flash, so a retry always works.
- Before writing, Run also takes a raw EEPROM read over AVR109 and stores it
  with the backup as a second recovery copy. The token-by-token JSON backup
  stays the primary copy used for restore.
- If the new firmware resets its own settings on first boot because the EEPROM
  layout changed, the restore step brings them back, and the panel says so in
  plain words: the new firmware started with fresh settings and your backup is
  being applied (as a reviewed write).
- **After the reconnect, compare the live settings with the pre-update
  backup.** A firmware change can load defaults on first boot (bench: 450 to
  440.21 and back loaded defaults, the E022 layout marker, and changed `st`
  and the Z-min switch). If anything differs, above all the switch settings
  (`st` and the per-axis switch modes), homing or limits, motor polarity or
  current, or travel, the panel shows it prominently and the restore step is
  required: there is no skip to done. After the restore Run reads every
  setting again and checks it matches the backup. Until the switch settings
  are confirmed, jobs and jog stay locked with "Check your limit switches. The
  update changed the switch settings."
- **Never send chip erase.** xboot's `e` erases the application and all of
  EEPROM. Page erase-write only. (Current avrdude no longer erases by
  default; Run's flasher simply never sends `e`.) Backup and restore stay
  mandatory around every flash because the settings layout can change.
- The flasher is a new confined module beside the Web Serial transport, under
  the same confinement gates. Releases come from a Run-hosted signed manifest:
  per hv a SHA-256-hashed `.hex` and a changelog, published by the maintainer.

## Firmware dependencies

| Feature | Status | Needs |
| --- | --- | --- |
| Live job data, progress, starvation | Works today | sr fields above, qr with qv |
| Jog | Works today (P2) | jogx/jogy/jogz/joga, `!` then `%` |
| Manual tool change | Works today (P3) | Host stops before M6; optional opt-in M6 pause later |
| Spindle state report | Mock: firmware pending | A spindle key in sr/rt |
| Overrides | Mock: firmware pending | Runtime override, perhaps `{rt:{fo}}` |
| Firmware tool table | Not for TinyG (tools live in the library) | g2core may get one later |
| Feed-limit advisor via rt | Planned upstream | Optional |
| Firmware update | PF | Signed manifest and hosting; bootloader protocol as above |

## Open questions for the owner

1. Firmware tool table: decided for TinyG (none; tools live in software). Open for g2core only.
2. Spindle state key: shape and units (commanded S after the clamp, and whether to include the PWM duty).
3. Overrides: wire format and ranges; does rapid override belong in v1?
4. Release hosting and signing: who signs, where the manifest lives, the key.
5. Minimum supported firmware number and how it is raised over time.
6. ~~The W2 label~~ Done in Stage 1: SAFETY.md W2 reads "Pause" (amended
   2026-11-02, OD-6), the tooltip is unchanged, and T-S32 follows it.
7. Units for imported DXF/SVG fixtures: assume millimetres, or ask each time?

## Console command line (owner, 2026-11-02)

The Console tab gets a command line you can type into, with history (↑/↓) and token completion that shows each token's plain-words description.

- **Always JSON on the wire.** run translates what the user types, so the board never leaves JSON mode:

  | Typed | Sent |
  |---|---|
  | `g0x100`, `G1 X10 F500` | `{"gc":"G0X100"}` (normalised and sanitised first) |
  | `$xvm`, `xvm` | `{"xvm":null}` (read) |
  | `$xvm=5000` | `{"xvm":5000}` (write) |
  | `?` | `{"sr":null}` |
  | raw JSON (`{...}`) | passed through only after it parses as an allowlisted request |

  Text-mode-only commands (`$$`, `$h` and so on) are mapped to their JSON form or refused with an explanation. Single-character realtime commands (`!`, `~`, `%`, ^X) are never typed here: Pause and Stop job are the buttons.
- **The same gates as the rest of run.** Every line goes through the sanitiser and the worker's write allowlist for the current phase:
  - **Phase 1:** reads only (`?`, `$key`). Motion lines show "Typed motion comes later; use the jog panel", and setting writes show "Typed settings writes are not sent; change settings in Board → Pending changes". Nothing is sent for either: settings change through the Board view's reviewed Pending changes tray (SAFETY §4.6, amendment 2026-11-02).
  - **Phase 2:** single motion lines are allowed, with the same checks as jog.
  - **Settings writes:** go through the reviewed settings-write path, with the read-back.
- **Never during a job.** While a job streams, the command line is read-only (queries only). It never gates Pause or Stop.
- **Replies** are shown in plain words, with the raw JSON one click away.

## Report a problem: the user picks the target (owner, 2026-11-02)

The user chooses where a report goes. When a job fails, they can say it's a run problem (run's repo, or the forum until it exists) or a firmware problem (TinyG or g2core issues, pre-filled with the board facts). See REPORT_A_PROBLEM.md §3.

## Roles (owner, 2026-11-02; with the Synthetos account)

run gets roles from the shared Synthetos account, the same list as the forum:
- **member**: their own machines, tools, materials and projects.
- **moderator**: everything a member has, plus reviewing shared material, tool and machine records before they enter the public catalogue, and reviewing shared projects.
- **admin**: everything a moderator has, plus editing the built-in catalogue, managing early-access features, and publishing firmware releases to the signed update list (signing stays an offline owner step).

A role never controls Pause, Stop job or the warning line. Until accounts land, live access to run.synthetos.com is a Cloudflare Access allowlist of the owner's and partners' emails, plus run's sign-in gate (D41).

## Status reports: push instead of polling (firmware facts, 2026-11-02)

From TinyG edge-next report.c, per the firmware maintainer:

- **Pushed sr is change-filtered and sampled when it prints.** Only one report request is pending at a time, so short states can be missed: a state that comes and goes between two reports never appears, and an intermediate stat (5 → 6 → 3) can be skipped. A state that persists, such as a finished feedhold at stat 6, always appears within about si ms.
- **Pushed stat is fine for display, never for proof.** Safety steps keep one confirming GET, for example before '%' in the jog release and in Stop job.
- **Order is safe.** A pushed sr never reflects a write before that write's reply has arrived. The reply prints in the same main-loop pass that runs the command, and the report prints on a later pass.
- **Plan.** A RAM-only session sr list (`{"rt":{"sr":{...}}}`, off at boot and reset, persisted list untouched) is proposed to the maintainer. If approved, run enables it at connect together with `{"rt":{"hb":N}}` (N whole seconds), and drops the once-a-second mpo and spindle/coolant polling. One seeding GET remains at connect and after a reconnect. Until then, polling stays.

**Built (2026-11-02, owner direction from the bench: "on connecting we should get the machine state totally, then the rest is driven by motion sr reports").** Polling is gone (SAFETY §4.2 amendment, H64, H69):
- **At connect** the session reads the full state once (homing per axis, units, coordinate system, distance mode, tool, machine and work position, every offset, the spindle and coolant readouts, `sv`, `si`), then writes the status report list run needs (`stat hold line vel feed unit coor dist posx..a mpox..a spe spc sps cof com`) only if the board's list differs, `sv` 1 only if it is not, `si` 250 only if it is above 1000 ms, each read back, and turns on `{"rt":{"hb":1}}` when `{"rt":null}` answers. (*Amended 2026-11-02:* the edge-next `hb` is whole seconds, 0 off, 1 to 60, and anything else is refused with 110; the earlier `{"rt":{"hb":1000}}` was refused, so there was no heartbeat. A beat comes only while the link and the machine are quiet. A refused heartbeat leaves the session on the no-heartbeat liveness path.) The Run view says what it changed (W35, W36) and the session log records it.
- **Persisted, by owner decision.** The list is saved on the board and other senders see it. The firmware compares before it writes EEPROM; run also diffs, which saves round trips. The RAM-only write flag discussed with the maintainer is parked: run never sends `ram`, and `reportSteps` (packages/machine/src/session/reports.ts) is the one place that would change if it lands.
- **Liveness:** with the heartbeat, no line for 3 s is STALE ("No reports from the board"); without it the watchdog asks once after 5 s of silence. (*Amended 2026-11-02*: the heartbeat is silent while held, dwelling or queued without stepping, so there each 3 s window ends with one ENQ and STALE only if it goes unanswered for 2 s; never while moving.)
- **Confirming GETs that stay:** the stop and release sequences, the idle gate before each settings write, the end of homing, `ackFault`, and one read-back after each change (set zero, G92, G92.1, G28.3, G54..G59, homing, settings).
