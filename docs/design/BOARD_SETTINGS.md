# Board settings: walkthrough

Built from the design `docs/superpowers/specs/2026-11-18-board-config-design.md` and the owner's answers in
`docs/ops/owner-decisions.md` OD-44, then the owner's staging walk of 2026-11-19 (pictures 165 and 166: "we dont like
scroll bars"). Pictures are 1280 × 800, the owner's window, dark and light, from the fake-serial build:

- **approved:** the plain simulator (build 450.02, approved, settings writes on);
- **read-only:** the edge-next simulator reporting 449.01 (READ_ONLY). The test kit has no stock-449 simulator, so the
  owner's exact 449 file (fixed probe contact, no `prbp`) is covered by unit tests instead.

Retake them with:

```
pnpm build:fake-serial
cd tools/e2e && BOARD_CONFIG_SHOTS=$PWD/../../docs/design/screenshots/board-config/built RUN_E2E_FAKE_SERIAL=1 RUN_E2E_PORT=8795 pnpm exec playwright test --config playwright.fake-serial.config.ts specs/board-config-shots.fake-serial.ts
```

The simulator reports 0 for jerk, junction deviation and junction acceleration, so those rows read 0 in the pictures.

## Nothing scrolls

At 1280 × 800 no Board tab scrolls, at Simple or Advanced, on an approved or a read-only board. Nothing inside a panel
scrolls either. What does not fit is split into sub-tabs, or a list pages with **Back**, "Page n of m" and **Next**.
`tools/e2e/specs/board-no-scroll.fake-serial.ts` checks every tab and every sub-tab, both levels, both boards.

| Tab | Sub-tabs or paging |
|---|---|
| Overview | None. The board facts are tighter, and the approval sentence has its own line. |
| Motors | One per motor, "Motor 1 · X", with a count of its pending changes. |
| Axes | All axes, one per axis in use, and Other axes. |
| Inputs | Switches and Homing. |
| Spindle and coolant | Outputs and PWM. |
| All settings | The group chips are tabs. Search and "Only pending" look across every group. The rows page. |
| Firmware | Update, Firmware backups and Custom firmware. The releases page. |
| Backups | None. It already fit. |

## A first-time user's path

1. Connect a board and open **Board**. Until the board is classified, one neutral line says "Reading the board…" and
   every control stays locked. Every tab names each setting in plain words and spells out its value with its unit.
   The words come from the board's settings file (`packages/schema/settings/tinyg-*.json`), not from code.
2. Lengths follow the board's units. A board in G20 reports lengths in inches, so every tab shows them in inches
   ("End 5.906 in", "Steps per inch"). The data marks each length with `convert`, from the firmware's F_CONVERT flag,
   so 449 and 440 boards are covered too. Writes stay millimetres only.
3. On a board Run may not change, one notice above the tabs says why, with **Back up settings** and **Update
   firmware**. Back up settings follows the same rule as the Backups tab. Every option is still shown, locked, with
   the board's value marked.
4. On an approved board, controls sit in place. There is no Edit values toggle. Choosing a value makes it a pending
   change: the row is outlined and says "was …". Choosing the board's value again removes it.
5. The bar at the bottom counts pending changes and high-risk ones. **Review and apply…** opens the diff. **Apply**
   asks C5 (each consequence ticked, WRITE typed for high-risk changes). A change Run can't write makes the bar say
   "1 change can't be applied. Review it." The review lists the reason, and Apply stays off.
6. Run backs up every setting first and downloads the file. It writes one setting at a time and reads each back. The
   controls and Restore are locked while it runs. **Revert to the backup** writes the backed-up values back the same
   way.
7. **Backups** lists every backup on this computer. **Add a backup file…** adds one to the list. **Restore…** on a row
   stages its differences as pending changes and opens the tab of the first one. Nothing is written until Apply.
   **Delete** asks first.
8. Pending changes belong to one board. Changes with no owner, or made for another board, are dropped with one line
   saying so. On a board Run can't change, changes left from before get a bar with **Discard** only. The tabs show
   that board as it is.

## Inputs (owner picture 153)

Owner, on 449: "Done editing" over a table of raw numbers. Built: two sub-tabs. **Switches** has the switch contact
in the table's header line and one five-way choice per input. **Homing** has the homing summary, with a chip per axis
that opens that axis on Axes, and a line for each consequence. Each input has one name from the settings file ("X min
switch") on Inputs, Axes, the pin card and in every consequence. There is no fixed probe-contact line: on 449 the
probe contact is not a setting, so the tab says nothing about it.

| Owner | Built, read-only, dark | Built, read-only, light |
|---|---|---|
| ![153](screenshots/board-config/owner/153.png) | ![](screenshots/board-config/built/readonly-inputs-switches-dark.png) | ![](screenshots/board-config/built/readonly-inputs-switches-light.png) |

| Homing, approved, dark | Homing, approved, light |
|---|---|
| ![](screenshots/board-config/built/approved-inputs-homing-dark.png) | ![](screenshots/board-config/built/approved-inputs-homing-light.png) |

| Built, approved, one pending change, dark | Built, approved, one pending change, light |
|---|---|
| ![](screenshots/board-config/built/approved-inputs-pending-dark.png) | ![](screenshots/board-config/built/approved-inputs-pending-light.png) |

Test switches (the live Pressed / Released column) is not built yet. It waits for the safety review and bench checks
BC-1 to BC-4.

## Review and apply

| Dark | Light |
|---|---|
| ![](screenshots/board-config/built/approved-review-dark.png) | ![](screenshots/board-config/built/approved-review-light.png) |

A change Run can't write: the bar says so, and the review names the reason in words.

| Bar, dark | Review, light |
|---|---|
| ![](screenshots/board-config/built/approved-refused-bar-dark.png) | ![](screenshots/board-config/built/approved-refused-review-light.png) |

A read-only board with a change left from before: the controls show the board's values, and the bar offers Discard
only.

| Dark | Light |
|---|---|
| ![](screenshots/board-config/built/readonly-leftover-discard-dark.png) | ![](screenshots/board-config/built/readonly-leftover-discard-light.png) |

## Motors (owner picture 154)

Owner: "1mi 2" should be spelled out. Built: one sub-tab per motor; steps per mm, shown board → new while a change is
pending; **Motor idle timeout** as one field above the motor. Each select is as wide as its longest option. A motor
that drives A, B or C reads its travel per turn in degrees ("360°") and its steps per degree. The data says so with
`rotary` on `{m}tr`.

**Microsteps** read as fractions from the settings file: Full step (1), Half step (1/2), Quarter step (1/4), Eighth step
(1/8). Those are the steps the TinyG v8 drivers can do. A microstep change is high risk: the review asks for the
consequence to be ticked and WRITE typed. The review shows the result before Apply, for example "Steps per mm: 160 →
80". It does the same for a step angle or travel per turn change.

There is no Custom field. The 450 firmware refuses any microstep value but 1, 2, 4 or 8, so a custom value could never
be written. 449 and 440 store any value. If such a board reports one, it reads "1/16 step (custom)", from the data's
`custom` label.

| Owner | Built, read-only, dark | Built, approved, light |
|---|---|---|
| ![154](screenshots/board-config/owner/154.png) | ![](screenshots/board-config/built/readonly-motors-1-dark.png) | ![](screenshots/board-config/built/approved-motors-1-light.png) |

## Axes (owner pictures 157 and 166)

Owner: "axes doesnt look like there is a good way to set anything", then a page that scrolled past every axis card.
Built: sub-tabs. **All axes** has soft limits, junction acceleration and chordal tolerance. Each axis in use has its
own sub-tab with a card in three columns: Mode and Speed, Travel (and what the board does with it, in words), and
Homing. **Other axes** lists the axes not in use, one row each with its mode. Switch modes are set on Inputs only. Each
card has one link to Inputs, and none on a read-only board.

| Owner | Built, X axis, approved, dark | Built, X axis, read-only, light |
|---|---|---|
| ![166](screenshots/board-config/owner/166.png) | ![](screenshots/board-config/built/approved-axes-x-dark.png) | ![](screenshots/board-config/built/readonly-axes-x-light.png) |

| All axes, dark | Other axes, light |
|---|---|
| ![](screenshots/board-config/built/approved-axes-all-dark.png) | ![](screenshots/board-config/built/approved-axes-other-light.png) |

## All settings at Simple and Advanced (owner picture 155)

Owner: Simple showed 22 guided fields with raw values. Built: every reported setting at both levels, grouped from the
settings file, with the same control as the tabs. The group chips act as tabs and show one group at a time. A search,
or "Only pending", looks across every group. The rows page to fit the window. A small "i" on a row puts its
description in one line under the list. Simple shows the plain name and the value. Advanced adds the raw token beside
the name, in the same cell (OD-44).

**Communications** and **Status report** are groups at Advanced only. Every setting in them is read-only, with one
reason: "Run sets this itself. Changing it could cut the connection." The Status report group lists the report fields
in words ("Machine state", "X machine position"), one chip per field. There is no Communications tab.

| Owner | Built, Simple, dark | Built, Advanced, Communications, dark |
|---|---|---|
| ![155](screenshots/board-config/owner/155.png) | ![](screenshots/board-config/built/approved-settings-dark.png) | ![](screenshots/board-config/built/approved-settings-advanced-dark.png) |

| Built, Simple, light | Built, Advanced, light |
|---|---|
| ![](screenshots/board-config/built/approved-settings-light.png) | ![](screenshots/board-config/built/approved-settings-advanced-light.png) |

## Backups (owner picture 156)

Owner: the primary button floated mid-page, and two file actions meant different things. Built: one header line with
the heading and both actions together at the right edge of the same box as the list (**Back up settings**, then **Add a
backup file…** in the outlined style). The empty state is one sentence. The list is a zebra table with Why, Firmware,
Board and Settings. Each row's Compare, Restore…, Download and Delete sit in one group, centred on the row, all in the
same small style; Delete is quieter in colour and asks first. Compare shows each column in the units it was read in.
On a read-only board the notice leaves out its own Back up settings on this tab, so there is only one.

| Owner | Built, after one backup, dark | Built, after one backup, light |
|---|---|---|
| ![156](screenshots/board-config/owner/156.png) | ![](screenshots/board-config/built/approved-backups-after-one-dark.png) | ![](screenshots/board-config/built/approved-backups-after-one-light.png) |

| Delete, dark | Delete, light |
|---|---|
| ![](screenshots/board-config/built/approved-backup-delete-dark.png) | ![](screenshots/board-config/built/approved-backup-delete-light.png) |

## Spindle and coolant (owner picture 152)

Owner: the coolant row said "Reserved on this firmware" on 449, where that setting does not exist. Built: two
sub-tabs. **Outputs** has each output's polarity from the settings file ("No setting on this firmware" where the
firmware has none), and what is wired to the coolant output from the machine record. **PWM** has the spindle speed
settings in three columns: General, Clockwise and Counter-clockwise.

| Owner | Built, read-only, dark | Built, approved, light |
|---|---|---|
| ![152](screenshots/board-config/owner/152.png) | ![](screenshots/board-config/built/readonly-io-outputs-dark.png) | ![](screenshots/board-config/built/approved-io-outputs-light.png) |

| PWM, dark | PWM, light |
|---|---|
| ![](screenshots/board-config/built/approved-io-pwm-dark.png) | ![](screenshots/board-config/built/approved-io-pwm-light.png) |

## Firmware (owner picture 165)

Owner: firmware image backups, custom firmware and trusted builds sat below the update panel, past the window.
Built: three sub-tabs. **Update** has this board's firmware, the releases and the update steps. Each release is one
row of the same height, and the rows page. The release notes are the title's tooltip at Simple and one line at
Advanced. An older release always shows its downgrade note. **Firmware backups** lists the images read before each
update, with Put back. **Custom firmware** has Choose a .hex file and the trusted builds, each with Revoke. While an
update runs, or its settings check is open, only Update is shown, so the progress stays in view.

| Owner | Built, Update, read-only, dark | Built, Update, approved, light |
|---|---|---|
| ![165](screenshots/board-config/owner/165.png) | ![](screenshots/board-config/built/readonly-firmware-update-dark.png) | ![](screenshots/board-config/built/approved-firmware-update-light.png) |

| Firmware backups, dark | Custom firmware, light |
|---|---|
| ![](screenshots/board-config/built/approved-firmware-images-dark.png) | ![](screenshots/board-config/built/approved-firmware-custom-light.png) |

## The read-only 449 state

| Overview, dark | Overview, light |
|---|---|
| ![](screenshots/board-config/built/readonly-overview-dark.png) | ![](screenshots/board-config/built/readonly-overview-light.png) |

Every other tab and sub-tab of both boards, both themes, is in `screenshots/board-config/built/` as
`<approved|readonly>-<tab>[-<sub-tab>]-<dark|light>.png`. The simulator has no G20 mode, so inch boards are covered by
unit tests (`apps/web/test/boardInches.test.ts`).

## Not in this change

- **Test switches** (spec §5.4): waits for the safety review and bench checks BC-1 to BC-4.
- **Account copies of backups** (OD-44 Q5): a later slice.
- **Custom microsteps on 450**: waits for the firmware to accept values other than 1, 2, 4 and 8. Adding it then is a
  reviewed change to the 450 settings file's write range.
- **Bench checks** BC-1 to BC-10 belong to the TG Firmware session. The data marks the labels they confirm with
  `verify` (BC-1 input states, BC-7 power modes, BC-8 rotary values in radius mode, BC-10 junction acceleration unit;
  BC-5 and BC-9 are cited on `probeAllowed` and `homingTravel`).
