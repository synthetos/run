# Probe Z: UI design for v1

Baseline: run at `d7b2ef6`, firmware facts in `firmware-facts.md`. Design only; nothing in the repository was changed.

v1 is one owner-started, single-stage, Z-only touch plate probe on approved edge-next builds. It is not offered on TG or read-only sessions, or inside a job (including the manual tool-change stop).

**The shape of it:** a `Probe Z` button under the Position readout opens a small card that stays in the page flow. Same steps at Simple and Advanced; Advanced only adds numbers. The session owns the state; the card shows it and sends narrow commands.

## 1. Where it lives

**Under the Position readout, directly below the Z row, at both levels.** The mount is one line in `positionBody` (`RunView.ts:334`, just before `card`):

```ts
h(ProbeZ, { model }),
```

Why here:

- A hobbyist thinks "I need to set Z zero" and looks at the Z number and its Zero button. That is this panel. A tab would hide it, and Simple has no tabs at all.
- `PositionPanel` is the one component both inspector branches share, so one line covers both. A fifth inspector tab would touch `RunView.ts` in three places and still miss Simple.
- The Z number stays in view all through the probe.
- Jog stays below the card in the same scroll, for positioning during Setup.

The closed row is one short button (plate icon plus the text "Probe Z", class `small`, never full width). It has text as well as an icon because the concept is new. A second line appears only when something needs saying (section 3, "Plate still out").

### Unavailable

The button always opens the card, because opening moves nothing. It is muted when blocked, and its tip gives the reason. Pressing it shows the reason and next step in place of Setup, with `Close`. Why not a plain disabled button: a tooltip can't carry a next step, and it doesn't work on touch.

If a block arrives while the card is open at Setup, the card swaps to the block and keeps the typed values. At Touch test or Ready it also drops the touch pass.

| Block | Reason | Next step |
|---|---|---|
| Not connected | No machine is connected. | Connect, then open Probe Z again. |
| Connection lost | The connection is lost. | Reconnect, then check the machine. |
| No status (STALE) | No status from the machine. | Wait for it to answer. |
| Another tab controls | This machine is controlled in another tab. | Use that tab. |
| Wrong firmware (TG, stock, read-only) | This firmware can't probe. Probe Z needs an approved edge-next build. | Zero Z by hand: touch off, then use Set Z work zero here. |
| Motion off in this build | Motion control is not enabled in this build. | None; say so and stop there. |
| Settings not read | Run hasn't read the board's probe settings yet. | Wait for the read to finish. |
| No probe input (252) | This board has no probe input set. | Zero Z by hand: touch off, then use Set Z work zero here. |
| Several probe inputs (253) | This board has more than one probe input set, so Run won't guess. | Zero Z by hand, as above. |
| Input on the A axis (254) | The probe input is on the A axis. Probe Z needs one on X, Y or Z. | Zero Z by hand, as above. |
| Z jerk unread | Run can't work out how far Z will travel after contact. | Reconnect so Run reads the board again, or zero Z by hand. |
| Stop distance over the limit | Z would travel too far after contact on this machine, even at the slowest feed. | Zero Z by hand. |
| Alarm | The controller is in alarm. | Clear the alarm, then open Probe Z again. |
| Spindle on | The spindle is on. | Turn it off, then open Probe Z again. |
| Machine busy | A move is running. | Wait for it to finish. |
| Homing | Homing is running. | Wait for it to finish. |
| Paused | The machine is paused. | Resume or use Stop job first. |
| Job loaded or running | Not available while a job is in progress. | Finish or stop the job. |
| Manual tool change | Not available during a tool change. | Set Z with the tool-change Z zero. |
| Position unverified | The previous session ended while connected. | Check the machine, then confirm above. |
| Settings differ | The board's settings differ from the reference. | Review them first. |
| Temporary offset in force | A temporary offset is in force. | Clear it on the Offsets tab (Advanced). |
| No work system | No work coordinate system is active, so there's no Z zero to set. | Choose G54 to G59 on the Offsets tab (Advanced). |

"Not homed" is not a block; the firmware doesn't need homing. Ready says so instead (section 2). "Zero Z by hand" is the only next step for a settings cause. This flow reads switch settings, polarity and jerk, and never tells anyone to change them.

## 2. The steps

```
closed -> Setup -> Touch test -> Ready -> Starting -> Probing -> Setting Z -> Result -> closed
             \________\___________/          \__________\___________/
              Cancel (nothing moved)          every other outcome goes to Result
```

All steps sit in one in-flow card with a one-line step marker: `Setup · Touch test · Ready`. Pause and Stop job stay in the strip, W1 stays where it is, and nothing here overlays anything. Buttons are `small`, left-aligned, content width. At phone width the field rows stack and the buttons still don't stretch.

Focus: Setup focuses the first empty field. Touch test and Ready focus `Cancel`. Enter does not start anything. Probing and Result focus the card heading (`tabindex=-1`), so focus is never lost on a button that vanishes.

### Step 1: Setup (no machine action)

```
Probe Z                                 Setup · Touch test · Ready
Sets G54 Z zero from a touch plate.

Jog the tool over the spot you want to measure. Leave room for the
plate under it, and stay closer to it than the depth limit.

Plate thickness  [ 12.70 ] mm     Measure it; Run can't check this.
Depth limit      [ 10    ] mm     How far Z may go looking for the plate.
Feed             ( 25 | 50 ) mm/min
[Advanced only]  Stop distance about 0.02 mm, calculated from zjh 40 at F25.

[ ] The spindle or router is stopped. Switch off a router at its own switch.

[Cancel]  [Test the plate]
```

- Plate thickness has no built-in default. It prefills the last value used on this machine in this browser, with the hint "Last used. Check it matches this plate."
- `Test the plate` stays off until the form is valid; each bad field says why ("Enter the plate's thickness." "Depth limit can be up to 15 mm.").
- Fields follow the board's display units; the page converts and the session only ever sees mm.
- The checkbox is there because TinyG cannot report a real spindle, and the next step puts a hand at the tool.
- `Cancel` closes the card. Jog still works here.

### Step 2: Touch test (mandatory, every time; reads only)

Pressing `Test the plate` starts it. From here until Result the session refuses jog, because a hand may be at the tool and a pass is only good for the position it was made at.

```
Touch test                              Setup · Touch test · Ready

Probe input (Z min)    NOT TOUCHING        <- live, large, words not colour

(tick) Reads not touching
( )    Touch the plate to the tool
( )    Let go

[Advanced only]  in5 = 0 · prbp 0 (active low) · read only

[Cancel]  [Back]
```

The three ticks fill in from readings only: inactive, then active, then inactive again. When all three pass:

> Touch test passed. The lead worked just now. Set the plate on the work under the tool.

Then `Continue` appears beside `Cancel`, and it is not auto-focused.

| What the reading does | Shown | Buttons |
|---|---|---|
| Touching before you touch anything | The input reads touching with nothing touching it. Check that the plate isn't against the tool, and check the lead and clip. | `Cancel` `Test again` |
| No change for 60 s | The input didn't change. Check the lead and its clip, and that the plate is the one connected to the board. | `Cancel` `Test again` |
| Input reads disabled, or no reading | Run can't read the probe input. | `Cancel` |

### Step 3: Ready (the confirmation)

This step is the confirmation for starting. It uses the new `C39`, in flow, with the live reading on show. It deliberately isn't `ConfirmCard`: that now renders as a scrim below the strip (OD-16) and would hide the reading. See question 6.

```
Ready                                   Setup · Touch test · Ready

Probe input (Z min)    NOT TOUCHING

Z will move down at 25 mm/min until the board reports contact, up to
10 mm (about 24 s). On contact Run sets G54 Z so the tool reads as
12.70 mm above the work. This is saved on the controller.

If the lead comes off now, the board can't tell. Z keeps going to the
depth limit. Keep your E-stop in reach.

Pause won't pause a probe: it ends it in an alarm. To stop, use Stop job.

[Not homed only]  This machine isn't homed, so soft limits won't check this move.
[Advanced only]   G38.2 Z-10 F25, then G10 L20 P1 Z12.68 (12.70 less 0.02)

[ ] The plate is flat on the work, under the tool.

[Cancel]  [Start probe]
```

- `Cancel` has the focus.
- `Start probe` needs the checkbox, and a live reading of Not touching. If it reads Touching: "The tool is on the plate. Go back and raise it." with `Back to setup`.
- The pass lapses after 2 minutes ("Touch test timed out.") and on any position change or board state change. Either sends the owner back to Touch test.
- Sending one `probeStart` gives one G38.2. Run never retries by itself.

### Step 4: Probing

No Cancel or stop button in the card: a second stop that isn't the real one is worse than none.

```
Probing Z

Moving down until the board reports contact, up to 10 mm (about 24 s).

Probe input (Z min)    NOT TOUCHING

To stop, use Stop job. Pause won't pause a probe: it ends it in an alarm.
In an emergency, use your E-stop.
```

- `Starting…` shows after the send and before stat 7. The board's status 0 is not completion and is not shown as success.
- The strip title reads `Probing Z`, and Pause and Stop job are prominent, as for any motion.
- `Resume` is never offered. If Pause is pressed, the strip shows `Pausing…` for its moment, then the alarm.

### Step 5: Setting Z

Only after e=1 and at rest: `The board reported contact. Setting Z…`. No claim of zero until the write is answered and the read-back agrees.

### Step 6: Result, then the plate

Every run that reached Touch test ends here. The card stays open until the owner says the plate is off. See section 3.

## 3. Outcomes

Each result names what the board reported and whether zero changed. The word "contact" is the board's: any edge at the input counts, so the card never says the tool touched the plate. The status number shows in Advanced only. All failures except contact are `role="alert"`.

`Clear alarm…` opens the existing C13 confirmation with the meaning given below. Run never clears an alarm or retries by itself. After a clear, `Lift Z 5 mm` appears, except where noted.

| Outcome | Headline | Body and what to do | Buttons |
|---|---|---|---|
| Contact, zero set (e=1, write answered, read-back agrees) | Contact. Z zero is set. | The board reports G54 Z at 12.68 mm after 6.32 mm of travel. The tool is resting on the plate. Lift Z, then take the plate and lead off. If a job is loaded, it will be checked again before it starts. | `Lift Z 5 mm` `The plate is off` |
| No contact (ALARM 250, Z moved) | No contact. Z zero is unchanged. | Z went down 10 mm and the board reported no contact. Check the lead and clip, and look at the tool: if the lead came off it may have pressed into the plate or the work. Clear the alarm, then raise Z. | `Clear alarm…` |
| Contact lost before the stop (ALARM 250, Z stopped short) | Contact was lost. Z zero is unchanged. | The input closed, then opened again before Z had stopped, so the board reported no contact. Check the clip and that the plate didn't shift. Clear the alarm, then raise Z. | `Clear alarm…` |
| Already tripped (ALARM 250, no motion) | Input already touching. Z didn't move. | Z zero is unchanged. Check that the tool isn't on the plate, then check the lead and clip for a break or short. Clear the alarm, then raise Z if you need to. | `Clear alarm…` |
| Soft limit (ALARM 220) | That move would pass the soft limit. Z didn't move. | Z zero is unchanged. Clear the alarm, raise Z, and try a smaller depth limit. | `Clear alarm…` |
| Limit switch (ALARM 203) | A limit switch tripped. Z stopped fast. | Z zero is unchanged. A fast stop can lose position: home before you trust it. Clear the alarm, then jog away from the switch. | `Clear alarm…` (no Lift afterwards; the jog pad is the way out) |
| Reply refusal, depth too short (251) | The board refused the move. Z didn't move. | The depth limit is too small for the board. Z zero is unchanged. No alarm. Use a larger depth limit. | `Back to setup` |
| Reply refusal, input (252-254) | The board refused the probe. Z didn't move. | It says its probe input isn't usable, which doesn't match what Run read. Z zero is unchanged. Zero Z by hand. | `The plate is off` |
| Reply refusal, other (131, 134, 135, 142, 143) | The board refused the probe. Z didn't move. | It said: "{board's words}". Z zero is unchanged. | `Back to setup` |
| Stop job (ALARM 207) | Stopped. Z zero is unchanged. | Stop job ended the probe. Spindle and coolant were commanded off. Clear the alarm, then raise Z. | `Clear alarm…` |
| Pause pressed | Pause ended the probe. Z zero is unchanged. | A probe can't be paused or resumed. Clear the alarm if the board shows one, then raise Z. | `Clear alarm…` when alarmed |
| Disconnect or connection lost mid-probe | The connection dropped during the probe. | W3 is already showing. Run can't tell whether Z is still moving or where it stopped. Use your E-stop if anything is unsafe. Z zero wasn't set. Reconnect and check the machine; Run treats the position as unverified. | `The plate is off` |
| No report in time (STALE or past the time limit) | No answer from the board. | Z should have stopped by now, and Run has no result. Use your E-stop if it's still moving. Z zero wasn't set. | `The plate is off`, once the machine answers |
| Contact, write refused | Contact, but Z zero wasn't set. | The board refused the zero: "{board's words}". Z zero is unchanged. Lift Z and probe again, or zero Z by hand. | `Lift Z 5 mm` `The plate is off` |
| Contact, write unanswered, or read-back disagrees | Contact, but Run can't confirm Z zero. | The board didn't confirm the new zero. Check the Z reading above before you cut anything. | `Lift Z 5 mm` `The plate is off` |
| Lost during Setting Z | The connection dropped while setting Z. | Run can't tell whether Z zero changed. Check it after you reconnect, before you cut anything. | `The plate is off` |

If e=1 arrives after Pause or Stop job was pressed, Run does not set zero. The owner asked to stop. It shows the Pause or Stop outcome.

Cancel from Touch test or Ready gets a short version: "Nothing moved. Take the plate and lead off the machine." with `The plate is off`.

### Pause during a probe

Three places say it: the Ready text, the Probing text, and the Pause result. The wording is fixed: "Pause won't pause a probe: it ends it in an alarm. To stop, use Stop job. In an emergency, use your E-stop." Pause stays enabled and in place, because the rule is never to gate it. It does stop the machine; it just can't be resumed. Escape behaves the same as Pause.

### Plate still out

`plateOut` is session state. It turns on when Touch test starts and turns off only on `The plate is off`.

1. The Result card stays open, naming the plate and lead, until that button is pressed. `Lift Z 5 mm` is the plain jog RPC, `{ op: 'jog', axes: { z: 1 }, distanceMm: 5, feed }`, sent only by that press and through the normal gate. There is no automatic retract.
2. If the card is closed by anything else (navigating away keeps it mounted, so this is mainly a reload), the closed row shows `Touch plate still out` with `The plate is off`.
3. While `plateOut` is on, the session refuses Start job and spindle on, with this reason, which the existing note path already displays: "Take the touch plate and lead off first, then confirm it under Position." Pause, Stop job and Spindle off are never affected. See question 3.

Pressing `The plate is off` closes the card and leaves one quiet line in the row: `Z zero set at 12.68 mm` for a contact, nothing otherwise. Probing again means pressing `Probe Z`, which runs the touch test again.

### Stop distance

Advanced only: Setup (updates with the feed), Ready (in the G10 line) and the contact result: "Stop distance about 0.02 mm, calculated, taken off the zero." It's always labelled calculated and never measured. Simple never shows it, though the correction applies at both levels.

## 4. Components and files

New folder `apps/web/src/workspace/probe/`. Each view gets narrow props, never the model. Only `ProbeZ.ts` touches the model.

| File | One responsibility | Lines |
|---|---|---|
| `ProbeZ.ts` | The mount: closed row, picks the step's component, wires `send`. Same LIVE/STATIC hooks split as `homing.ts`. | 80 |
| `probeUi.ts` | Pure: `probeUi(view): ProbeUi` from the snapshot, like `homingView`. | 60 |
| `probeForm.ts` | Pure: field text and units to mm, validation messages, against `limits`. | 70 |
| `probeCopy.ts` | Pure: block code to reason and next step; outcome code to headline, body and buttons. All section 1 and 3 copy that isn't a safety string. | 130 |
| `ProbeBlocked.ts` | Reason, next step, `Close`. | 25 |
| `ProbeSetup.ts` | Step 1. Props: `form`, `limits`, `stopMm`, `advanced`, `onChange`, `onNext`, `onCancel`. | 80 |
| `InputReading.ts` | The live words: Touching, Not touching, No reading. `role="status"`. | 25 |
| `ProbeTouch.ts` | Step 2. Props: `input`, `touch`, `onContinue`, `onRetest`, `onBack`, `onCancel`. | 70 |
| `ProbeReady.ts` | Step 3. Props: `plan`, `input`, `homed`, `advanced`, `onStart`, `onBack`, `onCancel`. | 70 |
| `ProbeRunning.ts` | Starting, Probing and Setting Z. Props: `step`, `plan`, `input`. No actions. | 40 |
| `ProbeResult.ts` | Step 6. Props: `outcome`, `alarm`, `canLift`, `advanced`, and the three handlers. | 80 |
| `ProbeCard.ts` | The shared frame: heading, step marker, Advanced facts slot. | 30 |

Plus tests alongside the existing ones for the three pure files, a render test per step, and a strip test.

Small edits elsewhere:

| File | Change |
|---|---|
| `views/RunView.ts` | The one mount line and its one import. Nothing else. |
| `ui.ts` | Nothing. `focusOnMount` is reused. |
| `icons.ts` | The `probe` icon. |
| `motion.ts` | `why()` gets one line: `PROBING` returns "Probing. Use Stop job to end it." So jog and the rest stay off. |
| `status.ts` | The `Probing Z` title and tone. |
| `MachineStrip.ts` | Pause tooltip variant while probing, if agreed (question 4). No layout change. |
| `styles/features.css` | About 40 lines: `.probe-card`, the field row and the reading. |
| `packages/safety/src/strings.ts` | `C39` (start), `W51` (Pause in a probe), `W52` (dropped lead), with the SAFETY.md entries. |

### Session side

The page reads one object and sends five commands. Published on the snapshot as `snapshot.probe`:

```ts
type ProbeStep = 'closed' | 'touch' | 'ready' | 'starting' | 'probing' | 'zeroing' | 'result';
type InputReading = 'touching' | 'clear' | 'disabled' | null; // 1, 0, -1, not read

type ProbeBlock =
  | 'notConnected' | 'lost' | 'stale' | 'otherTab' | 'firmware' | 'motionOff' | 'settingsUnread'
  | 'noInput' | 'manyInputs' | 'inputOnA' | 'jerkUnread' | 'stopOverLimit'
  | 'alarm' | 'spindleOn' | 'moving' | 'homing' | 'held' | 'job' | 'toolChange'
  | 'unknown' | 'needsReview' | 'tempOffset' | 'noWcs';

type ProbeOutcome =
  | { kind: 'contactZeroSet'; zMm: number; travelMm: number; stopMm: number }
  | { kind: 'noContact' | 'contactLost' | 'alreadyTripped'; travelMm: number; status: 250 }
  | { kind: 'softLimit'; status: 220 }
  | { kind: 'limit'; status: 203 }
  | { kind: 'refused'; status: number; text: string }
  | { kind: 'stopJob'; status: 207 }
  | { kind: 'paused' }
  | { kind: 'lost'; during: 'probe' | 'zero' }
  | { kind: 'noReport' }
  | { kind: 'zeroRefused'; status: number; text: string }
  | { kind: 'zeroUnconfirmed' }
  | { kind: 'cancelled' };

interface ProbeSnapshot {
  readonly block: ProbeBlock | null;
  readonly step: ProbeStep;
  readonly input: { readonly label: string; readonly token: string; readonly reading: InputReading; readonly activeLow: boolean } | null;
  readonly touch: { readonly sawClear: boolean; readonly sawTouching: boolean; readonly sawReleased: boolean; readonly problem: 'startedTouching' | 'noChange' | 'timedOut' | null };
  readonly limits: { readonly feeds: readonly number[]; readonly minDepthMm: number; readonly maxDepthMm: number; readonly maxThicknessMm: number };
  /** Calculated stop distance per feed, mm. Null feed entries are not offered. */
  readonly stopMm: Readonly<Record<number, number | null>>;
  readonly system: string | null; // 'G54'
  readonly plan: { readonly thicknessMm: number; readonly depthMm: number; readonly feed: number; readonly zeroZ: number; readonly maxSeconds: number } | null;
  readonly outcome: ProbeOutcome | null;
  readonly plateOut: boolean;
}
```

Commands, added to `MotionCommand`:

```ts
| { readonly op: 'probeTouch'; readonly thicknessMm: number; readonly depthMm: number; readonly feed: number }
| { readonly op: 'probeStart'; readonly confirm: true }   // the session uses the plan it holds from probeTouch
| { readonly op: 'probeRetest' | 'probeCancel' | 'probePlateOff' }
```

`clearAlarm` and `jog` are the existing commands. Each command gets the usual `Promise<string | null>` refusal, shown as a note in the card.

Things the UI relies on that the session has to provide:

1. **Tool change.** `motionUi` returns enabled at a manual tool change (`motion.ts:78`), so the probe gate can't reuse it. It needs its own `toolChange` block.
2. **The reading.** `in1`..`in8` need to be on the read allowlist, on 450.x only. Touch test, Ready and Probing need a bounded poll, which is an exception to "nothing polls while idle" (§4.2) and is limited to those steps.
3. **Telling the 250s apart.** `noContact`, `contactLost` and `alreadyTripped` are all e=0 with 250. I've assumed the board's message plus Z travel can split them. If `contactLost` can't be told from `noContact` reliably, drop it and use the no-contact copy.
4. **A time limit.** The session ends `probing` in `noReport` at `maxSeconds` plus a margin if no report comes.
5. **`PROBING` as a base state.** Pause and Stop job go prominent, `motion.held` stays false so `Resume` never appears, and the W30 band doesn't stick. A hold at stat 7 must not arm the hold timeout or offer `~`.
6. **Disconnect.** I've assumed Disconnect is refused while `probing` or `zeroing`, with "Probing. Use Stop job first." If the strip's Disconnect can't refuse in those states, the `lost` outcome covers it anyway.
7. **Zero and job checks.** Probe zero is a Set work zero, so it invalidates any job check as usual.
8. **G92.** `tempOffset` blocks because the facts say to avoid G92 and nothing covers L20 with one in force. If firmware confirms it's harmless, the block can go.

## 5. Questions for the owner

1. **Limits.** I've used feeds 25 and 50 mm/min (default 25), depth default 10 mm with a 15 mm maximum, plate thickness up to 50 mm, stop distance limit 0.25 mm, lift 5 mm, touch pass valid for 2 minutes. Are those right for your machines?
2. **One confirmation or two?** I recommend that Ready's `C39` covers both the move and the zero, so zero is set on contact with no second click. §4.1 says Set work zero needs C16, so this needs an amendment. The alternative is a C16 step at Result, safer on paper, but it leaves the tool sitting on the plate while the owner reads.
3. **Plate block.** Should the session refuse Start job and spindle on while `plateOut` is on? I recommend yes: a forgotten plate under a running spindle is the likeliest real accident here. The cost is that someone who removed the plate and ignored the card must press one button.
4. **Pause tooltip.** W2's tooltip says "Decelerates and pauses motion", which is false during a probe. Should the strip show the W51 wording as the tooltip while probing? It's a small `MachineStrip.ts` change to a canonical string, so it's your decision. I recommend yes.
5. **Next step for a board with no probe input.** v1 says to zero Z by hand. Do you want a link to a wiring guide outside this flow? If so, where does it live?
6. **`ConfirmCard`.** It's now a scrim below the strip (OD-16), not strictly inline. It leaves the stop controls and W1 uncovered, but it would cover the live reading, so Ready is in flow and only C13 uses `ConfirmCard`. Is that exception fine, or should Ready match the other confirmations?
7. **Router users.** Can the one spindle checkbox carry a manually switched router, or do you want a stronger step for machines where run has no control of the spindle at all?
