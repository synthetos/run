# Board settings: see every setting in plain words, change it safely

Design, 2026-11-18. Status: **draft for owner review**. Calls made while writing are marked **(call)**; the owner can
overturn any of them. Owner questions are in §9, each with a recommendation. No product code changed for this design.

Inputs: the owner's staging feedback of 2026-11-18 (TinyG v8, stock firmware 449.01, dark theme), screenshots
`docs/design/screenshots/board-config/owner/152.png` to `156.png`, and an audit run in the fake-serial build (§2).

> **Owner, verbatim:** "look at the whole board config ui its a mess you cannot set anything. each input for homing has a
> bunch of options but the ui does not auto build this and show the user what they could be set to nor a way to apply
> these changes once the ui is built this is a glaring missing feature here." … "make sure we populate these values from
> a boards json file … this way we can support g2core later with possible different defs if needed not in code."

## 1. Intent

A person connects a board and can set it up from the Board view alone:

- every setting the board reported is listed, named in plain words, with its value spelled out and its unit;
- every setting Run may change has a control that lists every allowed value by meaning;
- changes collect as pending, side by side with what the board holds, and one Apply writes them through the existing
  safe path (backup, write one at a time, read back, revert);
- a board Run may not change says so once, still shows every option, and offers the firmware update;
- the words, units, value meanings and risk come from a versioned data file per firmware family, so g2core is a new
  file, not new UI code.

## 2. Audit, by running it

**How.** `pnpm build:fake-serial`, then a throwaway spec drove the Board view at 1280 px in both themes for two boards:

- **(a) read-only:** the edge-next simulator reporting build 449.01. It is classified `tinyg-en`, not approved, and
  READ_ONLY. The test kit has no stock-449 simulator, so the owner's exact dialect (`tinyg-449-stock`) was checked
  from the code instead (below) and from the owner's screenshots.
- **(b) approved:** the plain simulator, build 450.02, approved, settings writes on (the staging phase switch).

Screenshots: `docs/design/screenshots/board-config/audit/<case>-<tab>[-editing]-<theme>.png`. Every Board tab, both
themes, both cases, plus edit mode, Advanced All settings, a pending switch change, and Backups after one backup.

**What the schema knows per dialect.** Measured with the schema's own functions:

| Dialect | Mode | Settings shown in All settings | With a plain meaning |
|---|---|---|---|
| `tinyg-449-stock` (the owner's board) | read only | 182 | **0** |
| `tinyg-440` | writable, but no reviewed entries | 182 | 0 |
| `tinyg-en` (450.x) | writable | 189 | 106 |

The meanings live in one TypeScript overlay (`packages/schema/src/overlays/tinygEn.ts`) that exists only for
`tinyg-en`. Every other dialect falls back to a short hand table in `apps/web/src/workspace/boardFacts.ts`
(`PLAIN_LABEL`, 37 keys, labels only) or to the raw token. That is exactly what the owner saw: "1ma", "1mi 2",
"What it does 1 0 4", "Default units 1".

### 2.1 Findings, ranked by how much they block setting up a machine

1. **Stock 449 boards show raw tokens and raw numbers everywhere.** No dialect but 450 has meanings, and the UI has no
   other source. Owner 153, 154, 155. Fix: §4 (data files for every dialect, 449 included, describe-only).
2. **Edit mode on a read-only board pretends it can edit.** `editBlocked` (`SettingsUi.ts`) checks only the phase
   switch, not READ_ONLY. On the read-only simulator, Edit values is enabled, 106 editors in All settings are live,
   the motor draft takes values, and Restore from a file stages changes. None can ever be applied; the reason appears
   only in the pending tray after the fact. On a true stock-449 board the toggle is enabled but every compact editor
   renders nothing (owner 153: "Done editing" over a table of raw numbers). Audit:
   `readonly-inputs-editing-dark.png`, `readonly-motors-dark.png`, `readonly-backups-dark.png`.
3. **What can be set is hidden behind a per-tab toggle.** Axes, Inputs and Spindle and coolant hide their controls until
   Edit values is pressed; Motors always shows a draft column; All settings shows editors inline. Three editing
   models in one view. Allowed values are never shown before editing. Audit: `approved-inputs-dark.png` vs
   `approved-inputs-editing-dark.png`.
4. **All settings at Simple is not all settings.** At Simple the tab renders `GuidedSettings`: default units plus seven
   fields per axis, 22 settings, with raw values on 449 (owner 155). Advanced shows the 189-row table. Audit:
   `approved-settings-dark.png` vs `approved-settings-advanced-dark.png`.
5. **No way to see Apply until something is pending, and the tray pushes the page down.** The pending tray appears at
   the top of the Board view only after a change. There is no "Review and apply" in reach of the control just changed.
   Audit: `approved-inputs-pending-dark.png`.
6. **Inputs do not read as inputs.** One row per pin, with "What it does" as a bare select ("Keep: off"), the shared
   switch type repeated in every row's Contact column, and the switch type editor at the bottom, below the fold. No
   homing summary, no live switch state, no warning when a limit is turned off. Audit: `approved-inputs-editing-dark.png`.
7. **Backups antipatterns.** The primary "Back up settings" floats mid-page away from its heading (owner 156). Two
   near-synonym file actions ("Import a backup file…" adds to the list; "Restore from a file…" stages pending changes)
   with no words on the difference. The empty state does not say what a backup is. Rows have no settings count and
   Delete sits beside Restore with equal weight. Audit: `approved-backups-after-one-dark.png`.
8. **Stale and wrong copy.** Overview, read-only: "Phase 1 connects every board read-only: Run reads positions and
   settings and writes nothing." Axes: "This release never moves the machine." Both are false now. The J6 coolant row
   says "Reserved on this firmware" on 449, where `coph` does not exist at all (the `RESERVED` set ignores the dialect).
   Audit: `readonly-overview-light.png`, `approved-axes-editing-dark.png`, owner 152.
9. **Units hide or repeat.** "1.8 deg/step" in a cell and "°" in the input; jerk as "0 M mm/min³"; the raw-key style is
   applied at both levels, against OD-13. Audit: `approved-axes-editing-dark.png`.
10. **The communications and status-report lists are read only without one shared rule.** Communications says why in a
    dismissable note; All settings says "Read only" on every row with no reason. Audit: `approved-settings-advanced-dark.png`.

### 2.2 Per tab

| Tab | What a person sees | What they can change (approved board) | What stops them | Words that explain why |
|---|---|---|---|---|
| Overview | Board drawing, board facts | Nothing | Nothing to change | Stale "Phase 1 … writes nothing" on read-only |
| Motors | Table of 4 motors, a draft column for one | ma, sa, tr, mi, po, pm (no Edit toggle) | Nothing on a read-only board: the draft accepts values | None until the tray refuses |
| Axes | Motion and homing tables | am, vm, fr, tn, tm, jm, jd, sn, sx, sv, lv, lb, zb, jh after Edit values | Edit values toggle | "Review pending changes before applying." |
| Inputs | One row per switch pin | sn/sx per pin and `st`, after Edit values | Edit values toggle; `st` editor below the fold | One fine line on pull-ups |
| Spindle and coolant | J6 pins, readouts, PWM values | spep, spdp after Edit values | `spph`, `coph` reserved (450) | "Reserved on this firmware", also on 449 where wrong |
| Communications | Serial link and status-report list | Nothing | Forbidden writes (H61) | Dismissable note |
| All settings | Simple: 22 guided fields. Advanced: 189 rows | Every row with a reviewed entry | Level; "Read only" on 83 rows with no reason | Per-row "Read only" |
| Firmware | Releases and update steps | Update | Not approved | Clear: "update it to use jobs, jogging and settings changes" |
| Backups | Heading, floating primary, two file actions | Back up, compare, restore, export, delete | Restore needs the phase switch | One lead line |

**Raw values and tokens.** On 449 every enumerated setting renders raw: switch modes (`xsn` … `asx`), switch type
(`st`), axis modes (`xam`), motor map, microsteps, polarity, power (`1ma` … `4pm`), default units and distance mode
(`gun`, `gdi`), soft limits (`sl`). On 450, the 83 settings without reviewed entries render raw: the communication and
identity keys, `ct`, `ja`, `gco`, `gpa`, `gpl`, the ten PWM keys `p1*`, and the 48 offsets `g54*` to `g30*`.

**Reported vs shown.** All settings lists the members of the read groups (`settingsReadGroups`), not everything the
board holds. Missing on purpose and correctly: live readouts (`pos`, `mpo`, `ofs`, `hom`, `prb`, `g92`), the jog and
`rt` families. Missing but useful: **`in1` to `in8`, the live state of each switch input**, which both the 449 and 450
read allowlists already allow and nothing reads.

## 3. Principles

1. **Data, not code.** No label, unit, enumerated value or risk sentence for a setting is written in UI code. The UI
   reads them from the dialect's settings file.
2. **Name first, value spelled out.** "Microsteps: half step (2)". "Direction: reversed". "X min switch: homing and
   limit". The token is small and secondary, at Advanced only (OD-13).
3. **Show the options in place.** Every enumerated setting renders all its allowed values by meaning, on writable and
   read-only boards alike. No "Edit values" toggle. **(call; owner question Q1)**
4. **One path to the board.** Every change, restore included, becomes a pending change and goes through the existing
   apply pipeline (SAFETY §4.6 as amended 2026-11-02). Nothing in this design adds a write path.
5. **Say why once.** A read-only board gets one notice above the tabs with the way out. Rows do not repeat it.
6. Owner rules carried in: short sentences, no reassurance filler, inputs sized to their content, zebra rows for every
   table-like list in both themes.

## 4. Setting definitions as data

### 4.1 Files

```
packages/schema/settings.schema.json          JSON schema, format "synthetos-settings@1"
packages/schema/settings/tinyg-449.json       dialect tinyg-449-stock   describe-only
packages/schema/settings/tinyg-440.json       dialect tinyg-440         describe-only until its review
packages/schema/settings/tinyg-450.json       dialect tinyg-en          describe + reviewed write fields
packages/schema/settings/g2core-101.json      later (Phase 7), same schema
```

**(call)** One file per firmware family, named by build family. A file declares the dialect id it serves and the
`fb` range. Deltas inside a family (450.05 removed hold keys, 450.06 added spindle override readouts, today in
`firmware45005.ts` and `firmware45006.ts`) become per-token `since` / `until` build numbers in the same file.

### 4.2 Shape

```jsonc
{
  "format": "synthetos-settings@1",
  "dialect": "tinyg-en",
  "firmware": { "family": "TinyG edge-next", "fb": { "min": 450.02 }, "source": "EN@a7489b79" },
  "mode": "writable",                       // "readOnly" files carry no "write" objects
  "enums": {                                // shared value lists
    "switchMode": [
      { "value": 0, "label": "Off", "help": "The input is ignored." },
      { "value": 1, "label": "Homing", "help": "Used only to find home. Pressing it at other times does nothing." },
      { "value": 2, "label": "Limit", "help": "Stops the machine with an alarm when pressed." },
      { "value": 3, "label": "Homing and limit", "help": "Finds home, and stops the machine at other times." },
      { "value": 4, "label": "Probe", "help": "The touch plate input. One per board." }
    ],
    "labelSrc": "EN canonical_machine.c:3174 fmt_Xsn; switch.h:42-47"
  },
  "groups": [                               // UI groups, in order (replaces GROUP_TEXT and the head arrays)
    { "id": "system", "title": "System", "explanation": "Units and modes at power-up, cornering, soft limits, motor idle time." },
    { "id": "inputs", "title": "Inputs", "explanation": "What each switch does." }
  ],
  "inputs": [                               // the board's inputs as people name them (drives the Inputs tab)
    { "id": "xmin", "label": "X min switch", "pin": "J7.3", "function": "xsn", "contact": "st", "state": "in1" }
  ],
  "families": [                             // templates for repeated tokens; expanded at load
    {
      "pattern": "{m}mi", "for": { "m": ["1", "2", "3", "4"] },
      "rows": { "1": 211, "2": 221, "3": 232, "4": 243 },     // cfgArray line per instance, for src
      "label": "Motor {m} microsteps", "short": "Microsteps",
      "description": "How finely the driver divides each full step.",
      "unit": "enum", "group": "motor-{m}", "tab": "motors",
      "values": [
        { "value": 1, "label": "Full step (1)", "help": "200 steps per turn on a 1.8° motor." },
        { "value": 2, "label": "Half step (2)" },
        { "value": 4, "label": "Quarter step (4)" },
        { "value": 8, "label": "Eighth step (8)", "help": "The TinyG driver's finest setting." }
      ],
      "labelSrc": "EN stepper.c:1653 fmt_0mi [1,2,4,8]",
      "access": "write",
      "write": { "valueType": "integer", "range": { "min": 1, "max": 8 }, "rangeSource": "…", "hwAllowed": [1, 2, 4, 8],
                 "e158": true, "convert": false, "scope": "persisted", "risk": "high",
                 "typedConfirm": { "kind": "never" }, "afterWrite": "W20",
                 "invalidates": ["scale.*", "homing.*", "softlimits"], "whatGoesWrong": "…" }
    }
  ],
  "tokens": {                               // one-off tokens
    "st": { "label": "Switch contact", "…": "…" },
    "ex": { "label": "Flow control", "unit": "enum", "values": [ … ], "access": "forbidden",
            "reason": "Changes how the board and Run talk; never written (H61)." }
  }
}
```

**Fields every token has:** `label` (full plain name), `short` (the name inside its group: "Microsteps" under Motor
1), `description` (one or two short sentences), `unit`, `display` (decimals), `values` or `enum` (for `unit: "enum"`,
every value with `label` and optional `help`), `group`, `tab`, `access`, `src` (from `rows` or explicit:
`"EN config_app.c:214"`), `labelSrc` (the firmware's own text-mode help string or enum the meanings were taken from).

**`access`:** `write` (has a `write` object; the only kind a plan may contain), `read` (shown, never written:
`ja`, `ct`), `forbidden` (shown, with the forbidden rule's reason: `ex`, `baud`, `jv`), `readout` (a live value: `in1`,
`spe`), `reserved` (the firmware stubs it: `coph`, `spph`, `spde` on 450, from den.json `_reserved_hold_setting`).

**The `write` object** carries exactly today's reviewed `OverlayEntry` fields: `valueType`, `range`, `rangeSource`,
`hwAllowed`, `e158`, `convert`, `scope`, `risk`, `typedConfirm`, `afterWrite`, `invalidates`, `whatGoesWrong`. The
validator (`jsonSchema.ts`) implements no conditional keywords, so cross-field rules live in the loader, as for board
files: `access: "write"` if and only if `write` is present; `mode: "readOnly"` files have no `write`; `values` present
if and only if `unit` is `enum`; every `{placeholder}` resolved.

**Where meanings come from.** TinyG prints its own value legend in text mode, and both pinned commits carry it.
Each `labelSrc` cites one of these, so the words are traceable to firmware, like board facts:

| Setting | 449 (c5024186) | 450 (a7489b79) | Firmware legend |
|---|---|---|---|
| Switch mode `{a}sn`/`{a}sx` | canonical_machine.c:2396 | canonical_machine.c:3174 | 0 off, 1 homing, 2 limit, 3 limit+homing, 4 probe |
| Switch type `st` | switch.c:315 | switch.c:387 | 0 NO, 1 NC |
| Microsteps `{m}mi` | stepper.c:1317 | stepper.c:1653 | 1, 2, 4, 8 |
| Polarity `{m}po` | stepper.c:1318 | stepper.c:1654 | 0 normal, 1 reverse |
| Power `{m}pm` | stepper.c:1319; stepper.h:266-269 | stepper.c:1655 | 0 disabled, 1 always on, 2 in cycle, 3 when moving |
| Motor map `{m}ma` | stepper.c:1314 | stepper.c:1650 | 0 X, 1 Y, 2 Z … |
| Axis mode `{a}am` | canonical_machine.c:1831-1835 | canonical_machine.c:2356-2360 | disabled, standard, inhibited, radius |
| Default units `gun` | canonical_machine.c:2321 | canonical_machine.c:3099 | 0 G20, 1 G21 |
| Distance mode `gdi` | canonical_machine.c:2324 | canonical_machine.c:3102 | 0 G90, 1 G91 |
| Flow control `ex` | config_app.c:971 | config_app.c:1115 | 0 off, 1 XON/XOFF, 2 RTS/CTS |
| Receive mode `rxm` | config_app.c:972 | config_app.c:1116 | 0 character, 1 line |
| Input state `in1`..`in8` | switch.c:318; switch.h `swState` | switch.c:390 | -1 disabled, 0 inactive, 1 active |

Two firmware differences the data must carry, not the UI:

- **Probe contact.** 449 always reads a probe input as normally open, whatever `st` says (449 switch.c:126-128: "This
  is a hack. Not all probes are NO"). 450 has its own probe contact setting `prbp` (EN switch.c:133-134,
  config_app.c:657). The 449 file says so with an `inputs` note; the 450 file adds `prbp`.
- **Where a probe may be.** 449 refuses a probe on A min or A max, and more than one probe input (449
  switch.c:258-280). The schema's cross-key rule already refuses two probes; the data adds `probeAllowed: ["x","y","z"]`.
  Check the same in EN when authoring the 450 file.

### 4.3 Runtime

- `settingsDefsFor(dialectId, fb)` in `packages/schema` loads and expands the dialect's file once. The classified
  dialect and the board's `fb` select it.
- `buildSettingsSchema` takes the `write` objects instead of `TINYG_EN_OVERLAY`. Its existing checks stay: a write
  entry must name a table token with a value setter and must not be a forbidden write.
- `boardFacts.settingMeta` and `plainValue` read the definitions. `PLAIN_LABEL`, `PLAIN_VALUES`, `RESERVED`, the
  `OUTPUT_FUNCTION` notes, `GUIDED_AXIS_FIELDS` labels, `GROUP_TEXT` and the column-head arrays in the Board tabs are
  deleted.
- A dialect with no file (unclassified, g2core today) shows tokens raw under "No definition yet". Nothing becomes
  writable without a `write` object.

### 4.4 Tests and CI

1. **Schema:** every file validates against `settings.schema.json`; the loader's cross-field rules hold.
2. **Golden migration:** for every key, the `write` object expanded from `tinyg-450.json` deep-equals today's
   `TINYG_EN_OVERLAY` entry (and the 450.05 / 450.06 deltas). This test lands with the file and the TypeScript overlay
   is deleted only when it passes. Safety review (§7).
3. **Drift, writable:** every token with `access: "write"` has a complete `write` object, is in the vendored table with
   a value setter, and is not forbidden. **Drift, coverage:** every member of every read group of the dialect has a
   definition; a firmware re-pin that adds a token fails CI until the token is described or listed with
   `access: "read"` and a reason.
4. **Agreement:** a token in both the 449 and 450 files has the same value meanings unless it carries `differs` with a
   citation (`prbp`, probe contact).
5. **No labels in UI code:** a gate test fails if `apps/web/src/workspace/views/board/` or `boardFacts.ts` contains a
   setting label table (a record keyed by tokens with string values), and checks that `settingMeta(k).label !== k`
   for every read-group member of every dialect with a file.
6. **src lines:** every `src` names a cfgArray row of the vendored table's commit (the overlay test's rule today).

Requests to the firmware owner, not blocking: have `gen_tables.py` emit `F_CONVERT`, the factory default and the
text-mode legend per row, so the meanings can be generated and checked instead of cited by hand.

## 5. The Board view

### 5.1 Rows and controls

- A row: **plain name**, value spelled out with unit, then the control when writable. Token after the name, small, at
  Advanced only.
- **Enumerated** settings with up to five short values render a segmented choice (switch mode, contact, direction,
  units). Longer lists render a select whose options are the value labels (microsteps, power, motor map). The current
  value is selected; there is no "Keep: …" option.
- **Numbers** render a number field sized to its content with the unit beside it ("1.25 mm"). The range from the data
  is the field's min and max and is shown on focus ("0.001 to 5 mm").
- **Read only, forbidden, reserved:** the value as text, plus a lock tag only when the reason is not already said by the
  group header ("Not changed by Run" for `ja`, `ct`).
- Units come from the data. Lengths and speeds are shown in the board's reported units; writes stay millimetres only
  (H60), and a board reporting inches blocks writes with "Set the board to millimetres (G21) to change lengths."
  **(call)** This adds a reason to `settingsWriteBlocked`; the session already refuses.

### 5.2 Pending and Apply

- Changing a control makes it **pending** at once. The row is tinted, the control outlined, and "was *board value*"
  shown beside it. Changing it back to the board value removes the pending change.
- A **sticky bar** at the bottom of the Board view appears with the first pending change: count, high-risk count, the
  one-line consequence when there is one change, **Discard** and **Review and apply…**. It replaces the tray at the
  top **(call)**. Tab badges count pending changes per tab.
- **Review and apply…** opens today's tray content as a panel: the diff table (setting, on the board, new value, what
  changes, risk), then C5 (`ConfirmSettings`) with its ticks and typed WRITE for high-risk changes.
- The run itself is unchanged (`live/settingsApply.ts`): backup first (saved and downloaded; nothing written if it
  fails), one setting at a time, each read back, stop at the first failure, Revert to the backup, re-read and record
  the new reference, W20 after keys whose data says so. The progress list shows plain names and spelled-out values.
- Pending changes survive a tab switch and a reload (today's `board-draft.v1` store). After a reconnect to a different
  board, pending changes are discarded with one line saying so **(call)**.

### 5.3 Read-only boards

Applies when the classification is READ_ONLY, the dialect file is `readOnly`, or the phase switch is off.

- **One notice above the tabs:** "Run can't change settings on firmware 449.01. You can see every setting and back them
  up. Update to 450.06 to change them here." with **Back up settings** and **Update firmware** (opens Board, Firmware).
  The phase-switch case says "Changing settings is not turned on here." with no update button.
- Every control renders **locked**: the segmented choice shows all options with the current one marked; selects become
  the value text plus "of 1, 2, 4 or 8" for short lists; numbers become text. Nothing can become pending.
- `editBlocked` gains the READ_ONLY and `readOnly`-dialect checks, so the pending store, Restore and the motor draft are
  all refused at the source, not only at Apply.
- No sticky bar, no Restore buttons. Compare, Download and Back up still work (they only read).
- Mockup: `docs/design/mockups/2026-11-18-board-config-read-only-{dark,light}.png`.

### 5.4 Inputs, homing and limits

The owner's main example. Mockup: `2026-11-18-board-config-inputs-{dark,light}.png`.

**Model.** The data's `inputs` list names each input the way a person does and maps it to tokens. On TinyG:

| Input | Pin | What it does | Contact | Live state |
|---|---|---|---|---|
| X min switch | J7.3 | `xsn` | `st` | `in1` |
| X max switch | J7.4 | `xsx` | `st` | `in2` |
| Y min switch | J7.5 | `ysn` | `st` | `in3` |
| Y max switch | J7.6 | `ysx` | `st` | `in4` |
| Z min switch | J8.3 | `zsn` | `st` | `in5` |
| Z max switch | J8.4 | `zsx` | `st` | `in6` |
| A min switch | J8.5 | `asn` | `st` | `in7` |
| A max switch | J8.6 | `asx` | `st` | `in8` |

Order from cfgArray: `xsn` stores `sw.s[0]`, `xsx` `sw.s[1]` (449 config_app.c:259-260), and `in1` reports `sw.s[0]`
(449 config_app.c:484). The pins come from the generated board file. On g2core the same list maps to `di{n}mo`
(contact), `di{n}ac` (action) and `di{n}fn` (function), with homing chosen per axis; the UI renders whichever facets the
data gives an input, so g2core's extra "action" column appears without UI code.

**Layout.**

1. **Switch contact** at the top, once: "Limit and homing switches: Normally open | Normally closed", with the
   meaning ("Normally open: the switch closes when pressed"). On 450 a second line for the probe (`prbp`). On 449 the
   probe line is fixed text: "Normally open. Fixed on this firmware."
2. **Switch inputs**, one row per input: name and pin, the live state when testing, the five-way choice built from the
   data, and the pending "was …" with its risk tag.
3. **Homing summary**, computed from the board values plus pending changes (the existing `homingAxis` helper): "X
   homes towards min · J7.3", "A no homing switch". Below it, one line per consequence the rules find:
   - a limit turned off: "X max has no limit. Only soft limits stop X at the far end.";
   - homing on both ends: refused by the schema rule, shown as "Z can't home on both ends. Choose one.";
   - no homing switch on an enabled axis: "Y has no homing switch. Home all skips Y.";
   - a second probe input, or a probe on A on 449: refused, with the reason from the data.

**Live state ("Test switches").** A button in the section header. While on, Run reads `{"in":null}` four times a
second, only while the board is idle and only while the Inputs tab is open, and shows Pressed / Released / Off per
input. It stops on leaving the tab, on any motion, on an alarm, and after two minutes. The header says: "Reads each
input 4 times a second while on. A switch set to Limit stops the board when pressed." That sentence is required:
pressing a limit-mode switch at rest asserts the limit condition (EN switch.c:232-241), which stops the board with an
alarm (exact state and clear path: BC-2). The read is already allowlisted on 449 and 450 and works on read-only boards. Safety review and bench checks:
§7, §8.

**Tokens and values by firmware.**

| | Stock 449.01 | Edge 450.02 to 450.06 |
|---|---|---|
| What it does | `{x,y,z,a}s{n,x}`, 0 to 4 as above | same |
| Contact, switches | `st` 0 NO, 1 NC | same |
| Contact, probe | none: always NO | `prbp` 0 NO, 1 NC |
| Live state | `in1`..`in8`: -1 off, 0 released, 1 pressed | same |
| Writable in Run | no (READ_ONLY) | yes, when approved |

**Safety implications shown in the UI** (all already high-risk in the reviewed data, with C5 ticks and typed WRITE):
turning a limit off; moving homing to the other end (homing then drives toward a switch that may not be there);
changing the contact type (every switch reads always pressed or never pressed, H58); a probe on the wrong input. W20
after the write says to test each switch; "Test switches" is that test.

### 5.5 Motors

Mockup: `2026-11-18-board-config-motors-{dark,light}.png`. One card per motor, two columns. Rows: Drives ("X
axis"), Step angle ("1.8° per step", "200 steps per turn"), Travel per turn ("1.25 mm"), Microsteps ("Eighth step
(8)"), Direction (Normal | Reversed), Power (the four modes by meaning: "Off: never powered", "Always on", "On during a
job, off after the idle time", "Only while moving"). A derived Steps per mm row shows board → new when a change is
pending. The motor draft panel and its separate "Draft" column go away: the cards are the editor. Owner 154 answered:
"1mi 2" reads "Microsteps: half step (2)".

### 5.6 Axes, Spindle and coolant, Communications

- **Axes:** one card per enabled axis (the machine's axes, OD-13: X, Y, Z, plus A when present), with Motion and
  Homing speeds sections; switch modes move to Inputs. The stale "This release never moves the machine" note goes.
- **Spindle and coolant:** J6 rows from the board file; polarity rows from the data (`spep`, `spdp` writable on 450;
  `spph`, `coph` reserved on 450 and absent on 449, shown as "No setting on this firmware"). The coolant row shows
  the machine record's "What is wired to the coolant output" (none, flood, mist, air) from the separate builder, as an
  account value with its own edit on the J6.6 pin panel, never as a board setting.
- **Communications:** values spelled out from the data; one group sentence for why they are read only (H61).

### 5.7 All settings

Mockup: `2026-11-18-board-config-all-settings-{dark,light}.png`.

- Every setting the board reported, at **both** levels **(call; owner question Q2)**. Simple hides the token column.
  `GuidedSettings` stays where it is also used, the Machines view.
- Groups, from the data: System, Board identity, Communications, Status report, Motor 1 to 4, Axes X to C, Inputs,
  Spindle and coolant, Offsets (the stored G54 to G59, G28 and G30 positions, read only here; set them from the Job
  view's zero tools). Last: **No definition yet**, tokens raw, "Reported by the board. Run has no description for these,
  so they are shown as read and never changed."
- One-line zebra rows, 38 px: name, value on the board, control (same component as the tabs), token. A small "i" after
  the name opens the description on its own line under the row (fixes the "?" floating far right, owner 155).
- Search by name, value words or token; group chips; "Only pending". The count is the number of settings reported.
- A footer line: "Live readouts (input states, homed axes, positions) are on Inputs, Axes and the Job view."

### 5.8 Backups

Mockup: `2026-11-18-board-config-backups-{dark,light}.png`.

- One section. Heading "Settings backups" with **Back up settings** (primary) beside it, and **Add a backup file…**
  (secondary) at the right of the same line. One sentence: "Every setting on this board, saved on this computer. Run
  also backs up before every apply and every firmware update."
- A zebra table: Taken (date and time), Why (Manual, Before an apply, Before a firmware update, Added from a file),
  Firmware, Board ("this board" or an "another board" tag), Settings (count), then Compare, Restore…, Download, and a
  quiet Delete.
- **Compare** expands an inline diff under the row in plain words: setting, in the backup, on the board now.
- **Restore…** stages the backup's differing values as pending changes (today's `stageSettings` and
  `restoreChanges`: identity, communication, read-only and forbidden keys skipped and listed) and switches to the tab
  of the first change, with the sticky bar showing. Nothing is written until Apply.
- **One way to bring a file in (call; owner question Q4):** "Add a backup file…" adds it to the list as "Added from a
  file". "Restore from a file…" is removed. The person sees the file's date, firmware and board before restoring it.
- **Empty state:** "No backups of this board yet. A backup saves every setting on the board in one file. Make one before
  you change anything, so you can put it back." with **Back up settings**, and "Have a backup file from before? Add a
  backup file…".
- Account copies: owner question Q5.

## 6. What changes in code, in one view

| Today | After |
|---|---|
| `overlays/tinygEn.ts` (TypeScript) | `settings/tinyg-450.json` `write` objects, golden-tested |
| No meanings for 449 and 440 | `tinyg-449.json`, `tinyg-440.json` describe-only |
| `boardFacts.ts` label and value tables | deleted; `settingMeta` reads the data |
| `editBlocked` ignores READ_ONLY | `editBlocked` refuses READ_ONLY and `readOnly` dialects |
| Edit values toggle on three tabs, draft panel on Motors | inline controls everywhere writable; locked controls when not |
| Pending tray at the top | sticky bar at the bottom, review panel, same C5 and pipeline |
| All settings at Simple = GuidedSettings | All settings at both levels |
| Two file actions in Backups | one: Add a backup file |
| Nothing reads `in1`..`in8` | Test switches on the Inputs tab |

New modules stay small and single-purpose (owner's modular rule): a definitions loader, a `SettingControl`
component, an `InputsModel` (pure: rows, homing summary, consequences), a `switchTest` poller, a `PendingBar`. No god
files: the current `SettingsUi.ts` (360 lines) is split along these lines rather than grown.

## 7. Safety

Nothing here changes what may be written, when, or how. Every write still passes the phase switch, the approved
board, the allow-matrix, the session's screening and idle gate, one key per line with read-back, and revert.

Needs safety-path review:

1. **Moving the reviewed overlay to JSON** (CODEOWNERS: the owner reviews every change). The golden test (§4.4 item 2)
   proves the move changes no reviewed field. The file keeps the owner as code owner.
2. **New describe-only files for 449 and 440.** They add words, never writability: the loader refuses a `write` object
   in a `readOnly` file and the 440 file has none until its own review.
3. **Test switches** adds a periodic read of `in` (already allowlisted, `get_int`, no side effects). It must obey the
   single-outstanding-line rule (H57), stop on motion, and carry the limit-alarm sentence. Reviewer to decide whether
   it needs its own hazard entry.
4. **`editBlocked` READ_ONLY check** (tightening only).
5. **Removing Restore from a file** (the same staging path remains through Add a backup file, then Restore).

**Flagged proposals for the owner (not applied):**

- SAFETY H58 mitigation 4 says the switch test "is a step the user is told to do, not one that is enforced". Proposal:
  add "Run offers Test switches on the Inputs tab, which reads each input's state while the user presses it." No
  change to what is enforced.
- SAFETY §4.6 step 2 says backups go to the account "if signed in … when sync ships". Owner question Q5 decides.

## 8. Bench checks (for the TG Firmware session; none run here)

| Id | Check | Firmware | Why |
|---|---|---|---|
| BC-1 | `{"in":null}` values at rest for each mode (off, homing, limit, homing+limit, probe), NO and NC, pressed and released | 449.01, 450.06 | The live state's meaning: does 1 mean "pressed" after the contact type is applied? |
| BC-2 | Pressing a limit-mode switch at rest: the board's state, the alarm or shutdown code, what clears it | 449.01, 450.06 | The Test switches warning and the clear path |
| BC-3 | Pressing a homing-only switch at rest | 450.06 | Confirms nothing but the state changes |
| BC-4 | `{"in":null}` every 250 ms for 2 minutes at idle, status reports on | 450.06 | No lost bytes, no effect on reports (H57) |
| BC-5 | Probe on A min refused, and two probes refused, as 449 switch.c:258-280 | 450.06 | The `probeAllowed` data |
| BC-6 | Apply `xsn` 0→3 and `2mi` 2→8, read back, reset, read again, Revert | 450.06 | End-to-end apply with a switch and a motor change (HIL-4.8, HIL-4.9 cover the parts) |
| BC-7 | `pm` 2 vs 3 with `mt` 2 s: when the motor de-energizes | 450.06 | The power mode wording |

## 9. Owner questions

1. **Drop the Edit values toggle and show controls inline wherever Run may write?** Yes: the toggle hides what can be
   set, which is the core complaint. No: keep the toggle and only fix the words. **Recommend yes.** Nothing writes
   without Review and apply and C5.
2. **All settings shows every setting at Simple too?** Yes: Simple hides tokens only. No: Simple keeps the 22-field
   guided form here. **Recommend yes**, with the guided form kept in the Machines view.
3. **Add Test switches (reads input states 4 times a second while on, idle only)?** Yes: people can check wiring
   before homing; pressing a limit switch will stop the board with an alarm, and the header says so. No: show states
   only once at connect. **Recommend yes**, after the safety review and BC-1 to BC-4.
4. **Merge the two file actions into "Add a backup file…", then Restore from the row?** Yes: one action, and the
   date, firmware and board are seen before restoring. No: keep both and explain the difference. **Recommend yes.**
5. **Also keep settings backups in the account?** Yes: they survive a new computer and match SAFETY §4.6 step 2.
   No: this computer only. **Recommend yes**, as a later slice after account storage, keeping the local copy always.
6. **Write describe-only definitions for stock 449 even though Run cannot change it?** Yes: the owner's own board is
   449; people see what they have before updating. No: show 449 raw and push the update. **Recommend yes.**
7. **Sticky Apply bar at the bottom instead of the tray at the top?** Yes: the action stays in reach of the control just
   changed and the page does not jump. No: keep the top tray. **Recommend yes.**
8. **Tokens at Advanced only?** Yes: matches OD-13. No: always show them small. **Recommend Advanced only**; the
   description panel shows the token at Simple for people who search forum posts.

## 10. Mockups

Static HTML with the app's tokens, rendered at 1280 px in both themes, in `docs/design/mockups/`:

| File | Shows |
|---|---|
| `2026-11-18-board-config-inputs-*.png` | Inputs on an approved 450 board, one switch change pending, Test switches on |
| `2026-11-18-board-config-motors-*.png` | Motor cards, one microsteps change pending, the microsteps options |
| `2026-11-18-board-config-all-settings-*.png` | All settings at Advanced: groups, controls, read-only groups, no definition yet |
| `2026-11-18-board-config-backups-*.png` | Backups list with an open compare, and the empty state |
| `2026-11-18-board-config-read-only-*.png` | The owner's 449.01 board: notice, locked choices, motor values |

The implementation plan is `docs/superpowers/plans/2026-11-18-board-config.md`.
