# G38.2 on TinyG edge-next: firmware facts (from the firmware maintainer, source at a7489b79 and edge-next, 2026-11-06)

"Tested" means a bench test exists; otherwise it is source reading.

## Commands
- Only G38.2 exists. Needs X, Y or Z and non-zero F (modal is fine). Travel under 0.254 mm: status 251.
- Probe input: one X/Y/Z min or max input with mode 4 (`zsn=4` is Z min, stock default). None: 252. Several: 253. On A: 254.
- Polarity `prbp`: 0 active-low contact to ground (default), 1 active-high. `st` is limits only. Debounce fixed at 50 ms.
- Probe jerk is `zjh`, speed is F. Setters for these refuse unless idle.

## Sequence
- The G38.2 line is answered at once with status 0 before anything moves. That is not completion.
- stat 7 (PROBE) through the whole cycle, including the stop.
- Finish: unsolicited `{"prb":{"e":1,"x":..,"y":..,"z":..,"a":..,"b":..,"c":..}}` on contact and on no-contact.
- e=1 is contact. Decide only on e.
- Frame: 450.02 work coordinates in current units; 450.03+ machine mm.
- Motion mode is cancelled afterwards; the next axis line needs its own G0/G1. G91 is restored.

## Failures (all ALARM stat 2, spindle and coolant off; cleared with {clear})
| Case | Motion | Report | Status |
| No contact | Runs to target | e=0 | 250 Probe did not trip (tested) |
| Already tripped | None | e=0 | 250 Probe already tripped (tested) |
| Lead off, prbp=0 | Runs to target or tool hits something | e=0 | 250 |
| Broken lead, prbp=1 | None | e=0 | 250 already tripped |
| Soft limit (sl=1, homed) | None | none | 220 Probe move failed |
| Limit hit | Fast stop | none | 203 |
Reply-only, no ALARM, no motion: 251, 252-254, 131/134/135/142/143.
Any edge counts as contact; the cause is unknown. If the input reopens before the stop completes: e=0 and ALARM.

## Stopping
- Normal hold, no fast stop. It stays where it stopped and does not return to the trip point.
- The result is read after the stop, not latched at the trip, so reported Z is below the trip by the stop distance.
- L mm = F*sqrt(F/(zjh*1e6)), plus up to about 5 ms at F. At zjh=40 (calculated): F25 0.02, F50 0.06, F100 0.16, F200 0.45, F300 0.82, F600 2.3 mm.
- Host computes L from the board's zjh and F.

## During probing
- Homing not required. Refused while alarmed (204). Spindle is left alone: the host must ensure it is off.
- `!` cannot pause: a hold ends the cycle; with no contact that is e=0 and ALARM 250. `~` does not resume. `%` ignored until a hold exists.
- ^D: ALARM 207, spindle off, no prb report. Limit inputs keep their action.

## Host checks
- `{"in5":null}` is Z min (in1-8 are X,Y,Z,A min/max pairs): 1 active, 0 inactive, -1 disabled. Current to about 60 ms when idle. 440.x has no in1-in8 tokens at all, so a 440 host cannot do this check.
- Before moving: find the mode 4 input and prbp; require inactive; owner touches plate to tool and the input reads active; release and it reads inactive. Proves the lead at that moment only.

## Setting Z
- In G21, at rest, after e=1: `G10 L20 P<n> Z<thickness - L>`. Independent of build.
- G10 values use current units: send G21 first, restore after. Wait for the reply and 50 ms (EEPROM). Then read posz, retract, remove the plate.
- L20 does not exist on 440/TG (acts as L2): never send it there. Do not probe on TG. Avoid G92.

## Host must refuse
No input configured, input not inactive, spindle on, stat not idle, F or L over limit, depth over a set maximum, non-G21 unless converted, zeroing on anything but e=1, any automatic retry after ALARM.

## v1 recommendation
Single-axis Z, touch plate, owner-started, approved builds, single stage, F<=50, small depth limit with the tool started close (a dropped lead on a normally-open plate is undetectable and runs to depth), mandatory touch test each time, spindle confirmed off, one G38.2 per owner action, zero only via G10 L20 with L corrected.
