# Typed commands in the terminal: safety design

Approved by the owner on 2026-11-09. Hazard **H91** in SAFETY.md; decision **OD-31** (typed moves: design approved, long lines split, ask first on a low-Z G0; owner verbatim "split, ask first").

## The rule
Every typed line goes through the same path as the button that does the same thing. There is no second path to the board.

## When typing can move the machine
Only when all of these are true:
- The board is connected and approved, and writes are allowed.
- No job, hold, homing, alarm or other run move is in progress.
- Two polled reads agree that the machine is idle (SAFETY §4.2).

Otherwise the input stays open for reads only, and a short line says why.

## One line at a time
- The next line is accepted only after the previous one finishes (idle confirmed).
- Pasting more than one line offers "Open as a job" instead.

## What each line can contain
| Typed | Handling |
|---|---|
| G0 G1 G2 G3 G4, G17–G19, G90 G91, G20 G21, G53, G54–G59, F | Allowed. Checked as below. |
| M3 M4 (spindle on) | Same confirmation as the Spindle button. |
| M7 M8 (coolant on) | Same confirmation as the Coolant button. |
| M5 M9 | Allowed. |
| G10 L2/L20, G92, G28.3 | Same confirmations as the zero and offset buttons. |
| G28, G30, homing | Through the Home button's flow. |
| T, M6 | Refused: "Use the tool change button." (H74) |
| M0 M1 M2 M30, M100+ | Refused, with the reason. |
| `!` `~` `%` Ctrl-X | Press the real Pause, Resume and Stop handlers. |
| `$` text commands | Mapped to their JSON form, or refused with the reason. The board never leaves JSON mode. |
| Non-ASCII, over-long lines, H61 forbidden writes | Refused by the existing sanitiser. |

## Checks before a move is sent
1. **Modes are shown.** Units, distance mode and work offset are read from the board, never assumed. A preview line shows what will happen, for example "Moves X to 10 mm (absolute, G54)".
2. **Travel check on the one line**, the same as for a job (C40/C41 wording). If an axis isn't homed, the same modal opens: Home / Move anyway / Cancel.
3. **Feed.** A G1, G2 or G3 with no F and no F in effect is refused: "Add a feed, e.g. F500."
4. **Safe-Z rules** are the same as for go to zero.

## Stop
- The Stop button and the Esc key stay live during a typed move.
- Typed realtime characters press the same handlers.

## Notice
Shown once per session, the first time you type a move:
"Typed moves run straight on the machine. Stop is the red button or Esc."

## Afterwards
- The job start rule (OD-19) already resets absolute mm, so a typed G91 or G20 can't affect the next job.
- Every typed line is logged in the transcript and the wire log.

## Tests
- Unit tests for each row of the table.
- Fake-serial e2e: idle only, one line at a time, the confirmations, Stop mid-move.
- HIL on bench 2 through TG Firmware: a typed G0, a G1 with feed, Stop mid-move, and a refusal during a job.

## As built (slice A, 2026-11-09)
- **Session.** `typedMove` is its own allow-matrix intent (idle only; `JOGGING` only for its own line). The session parses the line again with the closed grammar the page also uses (`packages/safety/src/typedLine.ts`), reads the board's modes and the job's prep reads, the feed in effect and the homing state, then checks the line like a one-line job (`packages/machine/src/session/typedTravel.ts`: the sanitiser, the queued-motion ceiling, the travel). Only then is the line written, and the write gate admits only that exact line from `typedMove`. Two polled reads at rest end it. Pause and Stop job use the jog path (`beginHold`).
- **Modes are not put back.** A typed G91 or G20 stays. Stop job keeps its own closing lines (`M5`, `M9`, `G90` and the units read).
- **Refused, not asked:** a move past the travel of an axis homed in this connection; a move that cannot be split into short enough pieces; a sanitiser block; G1, G2 or G3 with no feed in the line and none in effect (the feed in effect counts only in millimetres).
- **Asked (Home / Move anyway / Cancel):** a move past the travel of an axis not homed here, or a limit or position not read. "Move anyway" sends the line again with the finding's text; the session matches it exactly.
- **Page.** `apps/web/src/terminal/` classifies each line (`translate.ts`) into the path of the matching button. The Terminal tab (`workspace/dock/tabs/terminalTab.ts`, Simple and Advanced) replaces the Console, beside the wire transcript (3:1): a move goes to the session's `typedMove` (worker op `typedMove`), spindle, coolant, zero, offset and home lines to the buttons' commands after the buttons' confirmations (`TerminalAsk.ts`), `!` `~` `%` Ctrl-X to the page's real Pause, Resume and Stop job, and the session's typed notice back as the result, the travel question or "Z is low".
- **Not typed:** a mode, feed or axis word alone (put it in the move line); G28 and G30 (no button goes to a stored position); G10 L2 and non-zero offsets (Set zero sets 0 here); a dwell over 60 s.

## OD-31 (owner, 2026-11-09: "split, ask first")
- **Long lines are split.** A typed line goes as the sanitiser's own split, each piece at most ceiling ÷ lookahead of modelled time (5 s ÷ 4 = 1.25 s at the defaults). The session feeds them like a hold jog: a piece goes while fewer than 4 are in the planner (`qr` polled after each), so the queue stays within the §4.3 ceiling and three pieces wait behind the one running. Bench 2 showed every piece slowing to 0 with only one waiting. The travel check runs on the whole line; the user sees one line in flight. Pause and Stop job work as for a job: Resume feeds the rest.
- **Ask first on a low-Z G0.** A G0 that moves X or Y while machine Z is below go to zero's safe Z asks "Z is low. Raise Z first?" with Raise / Move as typed / Cancel. Raise sends go to zero's own lines (`G90 G21`, `G53 G0 Z<safe>`, then the modes read before the move put back), and only when Z was homed in this connection (safe Z `ztm − 1`), the move has no Z word and the modes were read. Otherwise only Move as typed and Cancel, with the reason. G1, G2 and G3 are never asked.
