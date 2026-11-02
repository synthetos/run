# Running the Phase 1 bench build against a real TinyG

This is the owner's step-by-step guide to running the Phase 1 (read-only)
app on this computer against a real TinyG. The detailed checks with their IDs
are in [README.md](README.md). The Chrome policy and the bench runner are in
[policy.md](policy.md).

Phase 1 is **read-only**. The app reads the board and can pause it. It never
moves the machine, changes a setting or resets the board.

## 0. Status at the time of writing (read this first)

Every command below was run on 2026-11-01 at commit `42c24a2`, up to the
point where a real board is needed. Past that point the fake-serial
Playwright suite stood in for the board. Three things still stop a real
connection from the bench build:

| # | Blocker | What you see | Who clears it |
|---|---|---|---|
| 1 | The safety advisory is not signed. `apps/web/public/safety-advisory.json` is committed with no entries, so LIVE is refused everywhere (fail closed). | Pressing **Connect** shows "The safety advisory could not be verified (no-entry), so this page will not connect a machine." | Owner: step 2.3. |
| 2 | There is no port chooser in the page. Calling `requestPort()` from the main thread needs its own reviewed gate change (owner-decisions OD-3, "The window's port chooser"). | After C1 is accepted: "This build has no port chooser yet: the main-thread chooser needs its own reviewed gate change (OD-3)." | Owner reviews the gate change, then a task implements it. |
| 3 | The page has no "Save transcript" button. The machine worker already returns the transcript (RPC `transcript`). Only the button is missing. | Nothing to click. | A later task. Until then, use the bench runner's `record.json` and a Saleae capture as the record (section 7). |

So today you can do sections 1 to 4 in full, and the offline screens in
section 5 (preview, wiring, safety). The connected screens and the HIL
checklist (sections 5 to 8) are written for when blockers 1 and 2 are
cleared. Each one says what to expect.

## 1. Before you power anything: the hardwired E-stop

**You need a hardwired E-stop that cuts motor (and spindle) power, within
reach, every time the board is powered.** This means a mushroom-head switch
that opens the motor supply (or a contactor feeding it) directly. Test it
before each session: press it, check the motors go limp and the LED or relay
on J6 drops out, then release it.

Why software is never an E-stop:

- The app talks to the board over USB serial, through the browser, the
  operating system and a USB chip. Any of these can stall or die: a frozen
  tab, a sleeping laptop, a crashed driver, a pulled cable. When that
  happens, nothing the app does reaches the board.
- **Pause** sends a feedhold (`!`). That is a request to the firmware to
  decelerate. It needs the firmware to be running and listening. It does not
  remove power, and the spindle stays on (the button says so).
- The board keeps executing what is already in its planner, whatever happens
  to the browser.

Only a switch that physically removes power stops the machine in every one
of these cases. The app tells you this on every page (the WARNING bar) and
on every Connect (C1).

Bench rig for the Phase 1 checks (ROADMAP Phase 1 gate, D10):

- the E-stop above;
- a J6 LED and relay, so you can see spindle-enable state;
- a Saleae (or similar) on the board's RX line and the step lines, to see
  exactly what bytes arrive and that no step pulses happen;
- a switched USB hub or power switch, for the pull-USB and power-up checks;
- edge-next on the bench board (fb 450.01, commit `ead63997`), plus a stock
  440.21 board (and stock 449.01 if you have one) for the read-only checks;
- the EN-HIL harness from your own edge-next checkout (`tests/hil`), for the
  items that need a second program on the board.

## 2. Build and serve the bench build

### 2.1 One-time setup

- Node 22.18 or newer (`node --version`).
- pnpm through Corepack. The package scripts call `pnpm` by name, so it must
  be on your PATH. `corepack pnpm <cmd>` on its own is not enough: nested
  scripts fail with `sh: pnpm: command not found`. Run this once:

  ```sh
  corepack enable pnpm
  ```

  If that fails for lack of permission (a system-wide Node), use
  `corepack enable --install-directory ~/.local/bin pnpm` and add
  `~/.local/bin` to your PATH.
- From the repository root:

  ```sh
  pnpm install --frozen-lockfile
  ```

### 2.2 Build, check, serve

```sh
pnpm build          # the release build, apps/web/dist
pnpm build:bench    # the bench build, apps/web/dist-bench
pnpm bench:check    # bench scan, then "only the build-channel chunk differs"
pnpm bench:serve    # serves http://localhost:8793/ on 127.0.0.1 only
```

`bench:check` must end with
`bench diff: <n> files; only the build-channel chunk differs`. If it does
not, stop: the bench build is not the release code.

`bench:serve` prints:

```
bench: serving the BENCH build from .../apps/web/dist-bench
bench: open http://localhost:8793/ (listening on 127.0.0.1 only; Web Serial granted to this origin)
bench: this build is for this computer only. It is never deployed. Stop with Ctrl-C.
```

Leave it running in its own terminal. `--port <n>` picks another port. Stop
it with Ctrl-C.

Optional self-test (no board needed): stop the server first, then

```sh
pnpm e2e:bench        # 5 tests: the page marks itself, serial headers, Host check, Web Serial allowed
pnpm e2e:fake-serial  # 8 tests: read-only session on a mock board, DRO, tab stop, Escape
```

Both passed at `42c24a2`.

### 2.3 Sign the safety advisory (blocker 1)

Connect is refused until `apps/web/public/safety-advisory.json` carries a
signed `staging` entry. The bench build counts as staging for this. You
need a key whose public half is in `packages/protocol/src/releaseKeys.ts`,
authorised for `staging`. Today that is only the placeholder key, whose
private half you should treat as disclosed. See `docs/ops/release-key.md`.

1. Review `apps/web/advisory/safety-advisory.unsigned.json`. It holds one
   staging entry, issued 2026-11-01, expiring 2027-02-01, with nothing
   revoked.
2. Sign it, keeping the key file outside the repository:

   ```sh
   pnpm sign:advisory --key /path/outside/the/repo/release.pkcs8.pem --kid <key id>
   ```

3. Rebuild both builds and check again (`pnpm build`, `pnpm build:bench`,
   `pnpm bench:check`). Then restart `bench:serve`.

## 3. Chrome settings

- Use Chrome (or Edge) on the desktop. Web Serial does not exist on mobile,
  and the app refuses Connect on a mobile OS whatever the browser reports.
- Use one dedicated Chrome profile for the bench (the bench runner's profile
  is `~/.run-bench/chrome-profile`). The Web Serial grant is per origin and
  per profile: `http://localhost:8793` is a different origin from staging.
- Keep the tab in the foreground while connected. Do not let the computer
  sleep.
- Optional: the `SerialAllowUsbDevicesForUrls` policy (B-POL-1) in
  [policy.md](policy.md). It is scoped to **staging only**, so on the
  localhost bench build you still pick the port by hand. Never add
  production to it.
- To check the headers, open DevTools, go to Network, select the document,
  and look at Response Headers. You should see
  `Permissions-Policy: serial=(self), ...`.

## 4. Open the page

Open http://localhost:8793/ in the bench profile. You should see:

- the tab title starting with `[bench]`;
- the version chip ending in `bench build, localhost only`;
- the red WARNING bar: "This software is not an emergency stop...";
- the state band showing **NOT CONNECTED**;
- the **Pause (spindle stays on) — not an E-stop** button, shown as
  "Available when a machine is connected";
- a **Connect** button.

From another device on your network, http://\<this computer's LAN
address\>:8793/ must not answer. The server listens on 127.0.0.1 only and
answers `421` to any other Host name.

## 5. Connecting, and what each screen should show

### 5.1 Connect

1. Plug in the board's USB with the E-stop pressed or motor power off (it is
   read-only, but get into the habit).
2. Press **Connect**. The gates run in this order:
   - Sign-in. On the bench build the identity is "bench operator
     (localhost)" (D41, section 9). On staging it is your Access identity.
     If you are signed out, Connect is refused with the sign-in text.
   - The safety advisory. If it is unsigned, Connect is refused (blocker 1).
   - **C1**, the safety confirmation. The first time on a given day it is
     the full form with checkboxes. A same-day reconnect gets the short
     form. Tick every box, then **Confirm and choose port**.
   - The Chrome port chooser. Pick the TinyG (FTDI, USB `0403:6015`). Until
     blocker 2 is cleared, the page says it has no port chooser and stops
     here.
3. Leaving fullscreen on Connect is expected (LIVE entry leaves fullscreen).

### 5.2 Probe and identity

Right after the port opens, the session writes `{sr:null}` as its first
line. It then probes the board and classifies it. Expect:

| Board | Classification | Mode |
|---|---|---|
| edge-next fb 450.01 (`ead63997`) | `tinyg-en` | full classification. Still read-only in Phase 1. |
| stock 440.21 | `tinyg-440` | READ_ONLY, with W25 and the upgrade offer |
| stock 449.01 | `tinyg-449-stock` | READ_ONLY |
| EN with `$ex=2` | `tinyg-en` | READ_ONLY, reason flow control |
| board moving, held, with a short queue, or silent for 3 s | **ORPHANED_MOTION** (W32) | only Pause offered |

The board id, firmware build and the other identity strings show as plain
text. Control and bidi characters are replaced (T-S85). While the board is
still unclassified, only Pause (with "Use your E-stop") is offered.

### 5.3 DRO

- Work and machine coordinates, the active work coordinate system with its
  offsets, and homed flags.
- The machine position is labelled "Machine position: polled mpo, ..." with
  its age. It comes only from polling `mpo` every 500 ms, never from status
  reports.
- The lag badge turns amber at 1 s and red at STALE.

### 5.4 Settings

- "Board settings (read only)", grouped (system, motors, axes, spindle PWM,
  coordinate offsets), each group with a plain explanation. It first shows
  "Reading the settings through the read allowlist…".
- The first read of a board on this computer is recorded as the
  **reference** ("First read of this board on this computer: recorded as
  the reference..."). A later read that matches says "The settings match
  the reference taken ...". A read that differs (the drift check, keyed by
  `deviceHash`) raises **NEEDS_REVIEW** and lists the differences. Its
  button, "Keep the board's settings (writes nothing to the machine)", only
  updates the reference stored in this browser.
- Nothing on this screen writes a setting.

### 5.5 Wiring

`/wiring/` (the **Wiring** tab) is the offline wiring editor: board
connectors, components and rule checks. It does not talk to the board in
Phase 1. It should load and work with or without a board connected.

### 5.6 G-code preview

On the Workspace page, choose a G-code file. It stays in the browser. The
NOTICE says the preview uses the app's interpreter, not your firmware. While
connected, a live position marker is drawn on the preview. It moves **only**
when a polled `mpo` read arrives, so it can step rather than glide.

### 5.7 Pause and the stop paths

- **Pause (spindle stays on) — not an E-stop**, or the **Escape** key from
  anywhere on the page, writes `!` at once. The state band shows PAUSE
  REQUESTED, then W30 (held) once a status report confirms the hold. It
  never shows "STOPPED". Space never pauses.
- Pause is never gated by sign-in, the advisory or anything else.
- A second tab of the same profile shows "Machine is controlled in another
  tab", with **Pause request** and **Stop job request** buttons. A delivered
  request shows "Delivered to \<board id\>". An unacknowledged one shows
  **STOP NOT DELIVERED** (use your E-stop). When the controlling tab closes,
  the observer shows W29.
- Phase 1 has no Resume (`~`), no Stop job (^D) and no Reset (^X). Under
  ORPHANED_MOTION, Disconnect is not offered either (owner decision OD-4,
  open). To release the port, unplug the USB or close the tab.

### 5.8 Banners

- **W3 (LOST)**: red, with an alarm tone, when the link is gone (USB pulled,
  transport error). Nothing is written after it. Acknowledge it, then
  reconnect. The board is then UNKNOWN and is probed again from
  `{sr:null}`.
- **W4 (STALE)**: amber, "No status from the machine for N s", after 2 s of
  unexpected silence. It clears when the board answers.
- **FAULT, then UNKNOWN**: shown when the board resets mid-session (a bare
  `sr` banner). **Acknowledge fault** completes only after two reads of
  `hold` 0 and `qr` 32. The board is then probed again.
- **W6**: shown if you close the tab while connected and reopen it. It
  replaces NOT CONNECTED.

## 6. Exactly what the app will and will not send

**Will send**, and nothing else:

1. `{sr:null}`, always the first line of every connection (H49: it makes a
   G-code fragment left in the board's buffer fail to parse).
2. Allowlisted JSON GETs (`{"<token>":null}`):
   - probe: `fb fv hp id hv`, `fbs`, `spep prbp fstk os`, `spph`;
   - classification: `stat hold vel qr ex`;
   - DRO: `coor unit ofs hom`, and `mpo` every 500 ms;
   - settings: the group tokens the dialect's read allowlist admits, out of
     `sys`, `1`..`4`, `x y z a b c`, `p1`, `g54`..`g59`, `g28`, `g30`.
3. ENQ (`0x05`), on edge-next only, at most one outstanding, never before a
   rev-2/3 footer has been seen. The idle liveness check is one ENQ per
   second, answered by `{"ack":true}`. On 440.21 the liveness check is a
   `{"stat":null}` GET instead.
4. `!` (feedhold), from Pause, Escape or a stop request from another tab.

**Will never send** in Phase 1: G-code of any kind, any setting write
(`$xvm=...` or `{"xvm":1000}`), `~` (resume), `0x18` (^X, reset), `0x04`
(^D, queue flush), `%`, or anything not on the read allowlist. The model
tests check this over 10,000 random sessions. HIL-1.8 checks it on the
real board.

## 7. Transcripts

Every session keeps a wire transcript of its last connection: every byte
written and every chunk received, with times. It is JSONL, one
`{"t": <ms since open>, "dir": "tx"|"rx", "hex": "..."}` per line.
`recordingFromJsonl` + `ReplayTransport` in `@synthetos/testkit` replays it
byte for byte.

Today there is no button to save it (blocker 3). Until there is:

- keep the Saleae capture of RX for each HIL item, which is the independent
  record anyway;
- run the items through the bench runner (section 8.1). Its `record.json`
  holds every item's pass/fail and notes.

Once the button lands, save one transcript per HIL item next to the run's
`record.json`. A transcript over 8 MiB is refused rather than cut.

## 8. The HIL-1.x checklist

A signed HIL record for the Phase 1 release must be taken on the **staging**
artifact (SAFETY HIL-6.4), not on the bench build. Run through the list on
the bench build first, then sign it on staging. For every item, keep the
Saleae capture and the transcript, and check the transcript rule: first line
`{sr:null}`, then only allowlisted GETs, ENQ (EN only, never before a
rev-2/3 footer) and `!`.

### 8.1 With the bench runner

```sh
cd apps/cli
node src/main.ts bench --port /dev/cu.usbserial-XXXX \
  --hil-dir <your edge-next checkout>/tests/hil \
  --url http://localhost:8793/            # or https://staging.run.synthetos.com/
```

The runner takes the EN-HIL board lock and snapshots the settings. It then
opens Chrome, steps through the BENCH rows of README.md (answer pass, fail,
skip or quit for each), restores the settings and writes `record.json`. It
exits 3 if the lock is held, 2 under `CI` or for a URL that is not staging
or localhost, and 1 if an item failed or you quit early. Items that need a
second program on the board must be done outside the runner (policy.md,
"Items that need a second program on the board").

The refusal paths were checked at `42c24a2`: `CI=1` refuses, and
`--url https://run.synthetos.com/` refuses.

### 8.2 Checklist

Tick each one, and write the date, the board and the firmware (`fb`,
commit) next to it.

- [ ] **HIL-1.1 Connect and identify EN.** Idle EN board (fb 450.01). Pass:
  the transcript is `{sr:null}`, the probe GETs, `stat hold vel qr ex`,
  then only allowlisted GETs, ENQ and `!` (from Pause); classification
  `tinyg-en`, full; the probe answers are saved to
  `test-fixtures/probe/<build>.txt` (B-PROBE-1; no hardware names or paths;
  replace the board `id` value with `0X0000-XXX`, see section 9).
  Fail: any other byte, or a different classification.
- [ ] **HIL-1.2 Stock 440.21 (and 449.01 if available).** Pass: 440.21 shows
  `tinyg-440` READ_ONLY with W25; 449.01 shows `tinyg-449-stock` READ_ONLY;
  no G-code and no `0x05` in either transcript; EN with `$ex=2` (set with
  another sender) shows READ_ONLY, reason flow control. Fail: anything else.
- [ ] **HIL-1.3 C1 per session.** Pass: the first Connect of the day shows the
  full C1; Disconnect and Connect the same day shows the short form; the next
  calendar day shows the full form again. On staging, signed out of Access:
  Connect is refused with the sign-in text. Fail: C1 skipped, or the wrong
  form.
- [ ] **HIL-1.4 Two boards.** Pass: with two machines saved with the same
  board id, nothing is auto-selected and you have to pick; a machine bound
  to the other board is refused. Fail: any automatic choice.
- [ ] **HIL-1.5 Pull USB, reset, silence.** Pass: idle for 5 minutes with no
  STALE (EN: one ENQ and one `{"ack":true}` per second; 440.21: one
  `{"stat":null}`); pulling USB gives LOST, W3 and the tone, with nothing
  written after; reconnecting gives UNKNOWN with first line `{sr:null}`;
  pressing reset mid-session gives FAULT then UNKNOWN; holding the board in
  reset (or cutting its TX) for 3 s gives STALE with W4, which clears when it
  answers. Fail: a missing banner, a missing tone, or a write after LOST.
- [ ] **HIL-1.6 Connect during another tool's buffered job.** Run a slow job
  from another sender, then connect run. Pass: ORPHANED_MOTION; no writes
  except what Pause sends; the state is shown correctly. Fail: any other
  write.
- [ ] **HIL-1.7 Stop request with the controlling tab frozen.** Tab A is
  connected. Open tab B (same profile). In tab A's DevTools console run
  `const e=Date.now()+5000;while(Date.now()<e){}`, then press **Pause
  request** in tab B. Pass: `!` on RX (Saleae) while tab A is frozen, and
  tab B shows "Delivered to \<board id\>". Fail: no `!` until tab A thaws.
- [ ] **HIL-1.8 Allowlist soak.** Leave the settings read and status polling
  running for 10 minutes. Pass: the transcript contains no denied token.
  Keep the B-MD-1 evidence separately. Fail: any denied token.
- [ ] **HIL-1.9 Feedhold during a slow move.** Start a slow move from the
  EN-HIL harness (outside the runner). Press Escape, and separately the
  Pause button. Pass: `!` at once; PAUSE REQUESTED, then W30 once a report
  shows the hold. Record the keydown-to-`!` latency from the Saleae. Fail:
  no hold, or "STOPPED" shown.
- [ ] **HIL-1.10 Orphaned motion.** From the EN-HIL harness, start a slow job
  with M3 and hold it with a full planner and an RX backlog. Kill the browser
  tab, then reconnect. Pass: ORPHANED_MOTION with W32; only stop-class
  controls offered (in Phase 1: Pause); `~` never written (Saleae). The SAFETY
  text's "Stop job ends with the LED off" part waits for Phase 2 (^D). Fail:
  Resume offered, or `~` on the wire.
- [ ] **HIL-1.11 Tabs and port exclusivity (B-EXCL-1).** With the port open in
  Chrome, try to open it from Edge, a second Chrome profile and CNCjs, on
  Windows, macOS and Linux. Record whether each open is refused. Then close
  the controlling tab with the task manager: the observer shows W29. Pause
  the machine worker in DevTools: a stop request from the observer shows STOP
  NOT DELIVERED. Pass: everything recorded, W29 and STOP NOT DELIVERED seen.
- [ ] **HIL-1.12 Partial-line splice (B-SPLICE-1).** With a second program,
  leave `G0 X1` (the start of `G0 X100`) in the board's RX buffer, and
  separately a partial `$xvm=1`. Close that program, then connect run. Pass:
  the transcript starts with `{sr:null}`; the board reports an error for
  the spliced line; no step pulses (Saleae on the step lines); `xvm`
  unchanged. Do it on 440.21 both in text mode and in JSON mode (JSON is its
  default; any `{...}` line from the other program leaves it there), because
  in JSON mode 440.21 runs a G-code fragment wrapped as `{"gc":"..."}` and cuts
  it at the first double quote. Fail: any motion, or a changed setting.

The other Phase 1 exit tasks are B-ID-1 (USB VID/PID read from the board,
BENCH-P101-1), B-SIG-1, T2.1, B-POL-1 (policy.md), B-PROBE-1, B-MD-1,
B-EXCL-1 and B-SPLICE-1. README.md lists the BENCH-P1xx rows that feed
each one.

## 9. Reporting problems

For anything wrong (a byte you did not expect, a missing banner, a wrong
classification, a crash), collect:

- the HIL item or BENCH row ID, and what you expected and what you saw;
- the commit (the version chip shows it, for example `42c24a2c75b9`), and
  whether this was the bench build or staging;
- the board's `fb`, firmware commit and dialect as the app showed them;
- the transcript (once the button exists), the Saleae capture, and the
  runner's `record.json` if you used it;
- a screenshot of the state band and banners.

Open an issue in the run repository with these. The repository is public:
leave out USB serial numbers, device paths, computer names and anything from
the private hardware repository. The board's `id` (the answer to the `id`
GET, also in the `probe:` note and any `{"r":{"id":...}}` line) is a unique
per-chip identifier: replace its value with the placeholder `0X0000-XXX`
everywhere before posting. The transcript stores bytes as hex, so the id is
in it in hex too: do not attach a raw transcript to a public issue; attach
the session log with the id replaced, and offer the transcript privately. Describe the board by its firmware build
only. **If the machine moved when it should not have, or a byte outside
section 6 reached the board, stop all bench work until it is understood.**

## 10. The D41 decision you need to confirm

D41 is **proposed, not decided** (`docs/ops/owner-decisions.md`, OD-3).
Confirm it, or reject it, and record your answer in `DECISIONS.md` in
synthetos.com. This repository does not edit that file. The proposal:

1. The D1 sign-in gate is pluggable, with exactly three identity
   providers: the run session (later; the only one production accepts),
   the verified Cloudflare Access identity (staging), and a
   **localhost-only bench identity** ("whoever sits at this computer") that
   exists only in the bench build.
2. The **bench build** (`pnpm build:bench`) is the release build with one
   module swapped. `pnpm bench:check` proves that nothing else differs. It
   runs only on localhost, served by the loopback bench server, and is
   **never deployed**. Every staging and production scan, and CI policy,
   refuses it.
3. **Web Serial** is granted (`serial=(self)`) on staging and by the bench
   server only. **Production stays at `serial=()`** until Phase 6.

What to weigh: the bench build is a second artifact (signed HIL records are
still taken on staging); the bench identity has the same trust as the bench
itself; and the production deploy job now stops at its scan on every push,
by design. If you reject it, the bench build is removed in one change, and
staging and production are unaffected.

Two related decisions are open in the same file. **Blocker 2** (the
main-thread port chooser gate change) needs your review before anyone can
connect from the page. **OD-4** decides whether Disconnect is offered under
ORPHANED_MOTION in Phase 1. Today it is not, and section 5.7 tells you to
unplug instead.
