# PROTOCOL_NOTES amendments (P0 review)

`PROTOCOL_NOTES.md` (PN) lives with the design in the synthetos.com
repository. The P0 review found facts PN is missing or states wrongly. The
code already follows the facts below; each needs the owner's update in PN.
Citations use the PN §1 tags at the pins in `vendor/firmware-pins.json`
(EN = edge-next 97321391 since the 2026-11-02 re-pin, before it ead63997;
TG = master d0418390).

## §2.2 Banners: a 440.21 reset can be invisible or msg-less

- TG prints its boot banners through `json_print_response` (TG
  report.c:88-103), so `jv` and `js` apply to them.
- SYSTEM READY is printed after `canonical_machine_init()` has set
  MACHINE_READY (TG main.c:131-143), so the verbosity filter applies: at
  `jv`=1 `msg` (NV_TYPE_MESSAGE) is dropped and the banner arrives as
  `{"r":{"fv":..,"fb":..,"hp":..,"hv":..,"id":".."},"f":[1,0,0,ck]}` (TG
  json_parser.c:490-511, :576). A forum capture of a 438.02 board shows
  exactly this shape (`test-fixtures/forum-json/movement-issues-after-homing.txt`).
  `classifyLine` treats an `r` with no `tid` whose body is exactly
  `fv fb hp hv id` as a Banner with `ready: null`.
- At `jv`=0 TG prints no banner at all, and no responses either, so the
  probe gets no answers and the board stays unclassified. **A TG reset is
  invisible at `jv`=0.**
- On an EEPROM boot TG never prints "Loading configs from EEPROM": it is
  printed while `jv` in RAM is still 0 (JV_SILENT), before the stored `jv`
  is loaded (TG config.c:134, json_parser.c:485). Only a fresh EEPROM prints
  "Initializing configs to default settings".
- Edge-next is not affected: its banner uses `json_print_object` and ignores
  `jv` (EN report.c:68-81).

## §2.3 / D4 Probe and approval: `fbs` is read by GET, and `fb` alone approves nothing in production

- The probe now GETs `fbs` after the identity tokens. A board that is
  already powered sends no banner, so reading `fbs` only from the banner
  let a build that reports `fbs` look like one that does not, and match a
  manifest entry approved with `fbs: null`. A TinyG build without the token
  answers 100 (the only answer that means "reports none"); a banner `fbs`
  that disagrees with the GET is a conflict (READ_ONLY).
- An entry with `fbs: null` matches **every** build that reports that `fb`.
  The current bench entry (fb 450.01, commit 97321391 in the reviewed
  unsigned file; the signed file still names ead63997 until the owner
  re-signs) therefore approves any edge-next build that still defines
  TINYG_FIRMWARE_BUILD 450.01 (EN tinyg.h:52), including d254eb0b, 222a45c0
  and any build of an uncommitted working tree.
  The classifier no longer prints the manifest commit for such an entry
  ("commit not verifiable: the build reports no fbs ... (bench only)") and
  returns `buildIdentity: 'fbOnly'` for the UI.
- A `release` (production) channel entry without `fbs` is rejected as a
  malformed payload: production never approves a build by `fb` alone.

## §2.3a Probe step 0: a leftover partial line can still run; detect it by the missing `sr`

Measured on bench 2 on 2026-11-02 (TinyG HIL diagnostic
test_leftover_line_reconnect, edge-next d254eb0b, 440.21 d0418390, merged
to edge-next (97321391)). Another program leaves a partial line in the RX
buffer; after a 0.5 s gap the connect line and LF arrive and join it.

| Leftover fragment | Connect line | edge-next | 440.21 |
|---|---|---|---|
| `G0 X0.5` or `G0 X0.` | `{sr:null}` | rejected (101), no move | rejected (102), no move |
| `G0 X0.5` | `{"sr":null}` | rejected, no move | **RUNS** (X to 0.5) |
| `G0 X0.5 (rough` or `G0 X0.5 ;rough` | either form | **RUNS** (X to 0.5, status 0) | **RUNS** (X to 0.5, status 0) |

- PN §2.3 step 0 ("a spliced fragment fails to parse on both dialects") is
  wrong for a fragment that ends in a comment: the comment swallows the
  connect line and the fragment runs. No host prefix fixes this.
- The bare-key `{sr:null}` is right: the quoted form also runs on 440.21.
- Detection is clean: in every case the reply to the connect line is a
  G-code reply `{"r":{},"f":[...]}` with **no `sr` key**. run now
  classifies such a reply as ORPHANED_MOTION (only `!`, "Use your E-stop")
  instead of repeating `{sr:null}` (`packages/machine/src/session/reducer.ts`,
  SAFETY H49 mitigation 3 as amended).
- The test-kit models reproduce every row (`firmware-semantics.test.ts`).
- **Firmware fact since edge-next 97321391 (E195, merged 2026-11-02):** a
  line in progress that has had no byte for about 1 s (103 RTC ticks of
  9.77 ms) is taken as left by a host that went away, and a `{` after it
  starts a fresh line. The RX interrupt puts a mark (0x1A) in the ring ahead
  of that `{`, and the reader drops the stale start when it reaches the mark
  (EN xio/xio_usb.c:43-48, :245, :255-272; xio/xio_usart.c:343-346;
  EN-HIL tests/bugs/test_e195_stale_partial_line_runs.py). A 0x1A byte from
  the host is discarded (EN xio/xio_usb.c:242-244). It is a framing
  heuristic: it needs the quiet gap and a `{` next, and any host pause that
  long just before a `{` inside a line has the same effect. The diagnostic
  now also runs every case with a 1.5 s gap; no 1.5 s result is recorded
  here yet. The 0.5 s table above is inside the quiet time, so E195 does not
  change it.
- The host-side rule stays: a reply to the connect line with no `sr` is
  ORPHANED_MOTION on every dialect. 440.21, edge-next before 97321391, and
  any fragment followed by the connect line within about 1 s still behave
  as in the table.

## §5 Status 13 on edge-next has two sources

- E162 (EN controller.c:253-266): a line that lost bytes in an RX overrun
  never runs. The first raises ALARM 13 and prints `er` 13; later ones arrive
  while that alarm stands (no new `er`).
- E102 (EN json_parser.c:887-893): a reply too big for the 512-byte output
  buffer (EN controller.h:32) loses its body: `{"r":{},..,"f":[rev,13,n]}`,
  with 13 in place of OK. **The command has already run.**
- The EN status table now classes 13 as `bufferFull`; `resolveBufferFull`
  returns `damagedLine` (safe to resend) only with an `er` 13 or ALARM 13,
  and `responseLost` (never resend, re-read state) otherwise.

## §5.2 Footers: the 440.21 checksum is mandatory for that dialect

- TG always prints `[1,status,n,checksum]` (TG json_parser.c:529,
  :543-550); a g2core rev-1 footer has three fields. `caps.footerChecksum`
  says which, and `checkFooterForDialect` turns a mismatch into
  `Garbled{bad-footer}` once the dialect is known.

## §6 Reports: 440.21 prints `{"rx":n}` after every `%`

- `cm_queue_flush()` calls `qr_request_queue_report(0)` and
  `rx_request_rx_report()` (TG canonical_machine.c:1302-1303). The main loop
  prints the queue report only when `qv` is not 0 (in the `js` syntax), then
  `rx_report_callback()` prints `{"rx":%d}` with no `jv`, `js` or `qv` check
  (TG report.c:541-548; controller.c:173-174). Every `%` the firmware honours
  therefore produces `{"rx":254}` from a healthy board, including step 5 of
  the TG Stop job. `classifyLine` returns `RxReport` for exactly `rx` with an
  unsigned integer up to 255 (anything else is `bad-value`).
- Edge-next never requests an rx report (`rx_request_rx_report` has no
  caller). PN §7.3's `{rx:null}` is a GET, a different thing.

## §5 / §8 Echo of `gc` on errors

- Both firmwares run the verbosity filter on every error response (EN
  json_parser.c:830-844 despite its comment; TG json_parser.c:490-500), and
  the filter drops the `gc` echo unless `jv`=5. A failed G-code line at the
  default `jv`=3 is answered `{"r":{},"f":[3,st,n]}`: nothing may match an
  error to its line through a `gc` echo.

## SAFETY §4.4 EN Stop job when already alarmed (design change)

- `cm_alarm()` returns without printing when the machine is already ALARM,
  PANIC or SHUTDOWN (EN canonical_machine.c:806-812), so `^D` on an alarmed
  board raises no `er` 207. The EN sequence now (a) ends early with E-stop
  advice and the reset path when the last `stat` is 12 or 13 (`haltIfStat`),
  and (b) treats an existing ALARM (stat 2) as the stop in `awaitAlarm`
  (`alreadyAlarmedStat`), then C13 and `{clear}` as usual. `SAFETY.md` §4.4
  in this repository is amended to match.

## RUN_PLAN §5.5 deviation: read allowlists and forbidden writes are schema data

RUN_PLAN §5.5 sketches `Dialect.readAllowlist` and `Dialect.forbiddenWrites`.
They are not members of `Dialect`: they are generated from the vendored HIL
tables (ROADMAP P0-09) and live in `packages/schema` (`READ_ALLOWLISTS`,
`readAllowlistFor(dialectId)`, `getLineFor`, `FORBIDDEN_WRITES`), keyed by
`DialectId`. `protocol` is the bottom layer (RUN_PLAN §5.3, enforced by
`layer-protocol`) and cannot import `schema`, and the tables are generated
data that `protocol`'s hand-written dialect files should not duplicate.
Phase 1's `MachineSession` (in `machine`, which may import both) looks the
allowlist up by `classification.dialect.id`; an unclassified board
(`dialect: null`) gets no allowlist and stays on the probe's fixed GETs.
