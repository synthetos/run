# Bench guide: the localhost bench build

P1-00 (owner decision D41, proposed: `docs/ops/owner-decisions.md` OD-3).
This page grows with Phase 1: each task adds what it needs checked on the
real bench. The HIL checklist proper (HIL-1.x, `SAFETY.md` §9) and the
bench runner come with P1-08.

## What the bench build is

- The release web app with one module swapped: the build-channel seam
  (`apps/web/src/channel/channel.ts` becomes `bench.ts`). `pnpm bench:check`
  proves that nothing else differs, so what you see is the release code.
- It runs only on `http://localhost` (or `127.0.0.1`), served by the
  loopback bench server, which sends the production headers with
  `Permissions-Policy: serial=(self)`. The page shows "bench build,
  localhost only" on the version chip and `[bench]` in the tab title.
- It is never deployed. CI never builds it; every staging and production
  scan refuses its marker; ci-policy refuses any workflow line that
  mentions it.

## Running it

The owner's step-by-step guide, with the current blockers, is [GUIDE.md](GUIDE.md).

From the repository root (Node 22, pnpm through Corepack; run `corepack enable pnpm`
once, because the scripts call `pnpm` by name):

```sh
corepack pnpm build          # the release build, apps/web/dist
corepack pnpm build:bench    # the bench build, apps/web/dist-bench
corepack pnpm bench:check    # bench scan + "only the build-channel chunk differs"
corepack pnpm bench:serve    # http://localhost:8793/ (127.0.0.1 only)
```

Open http://localhost:8793/ in Chrome or Edge. Stop the server with Ctrl-C.
`--port <n>` picks another port. The server refuses to start on anything
but a clean bench build, and answers only `localhost:<port>` and
`127.0.0.1:<port>` as Host.

`corepack pnpm e2e:bench` runs the bench Playwright suite (local only): the
page loads and marks itself, every response carries the serial-granted
headers, and the browser allows Web Serial in the page and in
`machine.worker` (and nothing else).

Use one Chrome profile for the bench. The Web Serial grant is per origin
(`http://localhost:8793` is its own origin, separate from staging).

## Bench checks for P1-00 (owner, on the bench computer)

Each needs the physical bench and cannot be signed by the implementer.

| ID | Check | When |
|---|---|---|
| BENCH-P100-1 | With `pnpm bench:serve` running, open http://localhost:8793/ in the bench Chrome profile: the version chip ends in "bench build, localhost only", the title starts with `[bench]`, and DevTools shows `Permissions-Policy: serial=(self), ...` on the document. | now |
| BENCH-P100-2 | Open http://<this computer's LAN address>:8793/ from another device: no answer (the server listens on 127.0.0.1 only). | now |
| BENCH-P100-3 | With a TinyG plugged in: the port picker opens from the bench origin, and from staging (behind Access); a production tab (https://run.synthetos.com) cannot open it (`serial=()`). | after the window's port chooser lands (P1-02/P1-03; P1-01 added the transport only) |
| BENCH-P101-1 | With a TinyG granted to the bench origin and opened through the app: the worker's `open` reply reports `{kind:'serial', usbVendorId:0x0403, usbProductId:0x6015}` (the recorded `getInfo()`); Chrome's `chrome://device-log` shows one open of that device; a Saleae on the board's RX line shows no byte written by the open itself. | after the window's port chooser lands |
| BENCH-P101-2 | Unplug the board's USB while the port is open: the session shows LOST and the port is released; after acknowledging it the worker is idle; plug it back in and the same granted port is found again by its grant index and identity, and the new session starts with UNKNOWN. | after the window's port chooser lands |
| BENCH-P102-1 (HIL-1.1 part) | Connect an edge-next board (fb 450.01, `ead63997`) that is idle: the worker's session log and a Saleae on the board's RX line show `{sr:null}` first, then the probe GETs (`fb fv hp id hv fbs spep prbp fstk os spph`) and `stat hold vel qr ex`, and nothing else; the snapshot shows `tinyg-en`, READ_ONLY on the bench (no approved builds in the worker until P1-03), CONNECTED_UNKNOWN. Record the probe answers (B-PROBE-1). | after the window's port chooser lands |
| BENCH-P102-2 (HIL-1.2 part) | The same with stock 440.21 (and stock 449.01 if available): `tinyg-440` (or `tinyg-449-stock`) READ_ONLY; no G-code, no 0x05, in the transcript. | after the window's port chooser lands |
| BENCH-P102-3 (HIL-1.5 part) | Press the board's reset button while connected: the banner gives FAULT then UNKNOWN; Acknowledge fault completes only after two reads of `hold` 0 and `qr` 32, then the board is probed again from `{sr:null}`. | after the window's port chooser lands |
| BENCH-P102-4 (HIL-1.6 part) | Connect while another sender runs a slow buffered job (or holds it): ORPHANED_MOTION; only Pause is offered and works (`!` on the wire, the hold confirmed by a report); nothing else is written. Note: in Phase 1 Disconnect is not offered under ORPHANED_MOTION (its exits are Stop job and Reset controller, which Phase 1 does not have): unplug the board or close the tab to release the port. | after the window's port chooser lands |
| BENCH-P102-5 | Power the board up after pressing Connect (it boots while it is probed): the session waits for SYSTEM READY, probes again from `{sr:null}` and classifies it; no FAULT. | after the window's port chooser lands |
| BENCH-P102-6 (HIL-1.9 part) | Pause during a slow move started from the EN-HIL harness: `!` is written at once, the hold shows in the next report; record the latency. | after the window's port chooser lands |
| BENCH-P103-1 (HIL-1.1, B-PROBE-1) | Connect EN (fb 450.01), stock 440.21 and, if available, stock 449.01, each idle: save the session log (the `probe:` note holds every answer and footer) to `test-fixtures/probe/<build>.txt`; check the transcript is `{sr:null}`, the probe GETs, `stat hold vel qr ex` and nothing else. | after the window's port chooser lands |
| BENCH-P103-2 (HIL-1.2) | 449.01 → `tinyg-449-stock` READ_ONLY; 440.21 → `tinyg-440` READ_ONLY with W25 and the upgrade offer; no G-code in either transcript. Set `$ex=2` on the EN board with another sender, reconnect: READ_ONLY, reason flow control. | after the window's port chooser lands |
| BENCH-P103-3 (HIL-1.4) | Two boards, two machines with the same board id: nothing is auto-selected; a machine bound to the other board is refused. | after the Connect UI |
| BENCH-P103-4 (HIL-1.10) | Start a slow job with M3 from the EN-HIL harness, hold it with a full planner and an RX backlog, kill the tab, reconnect: ORPHANED_MOTION with W32; only Pause/Stop job offered; `~` never written (Saleae). | after the window's port chooser lands |
| BENCH-P103-5 (HIL-1.12, B-SPLICE-1) | With a second program leave `G0 X1` (of `G0 X100`) and, separately, a partial `$xvm=1` in the RX ring, close it, connect run: the transcript starts with `{sr:null}` (bare key, no quote); the board reports an error; no motion on the step lines; `xvm` unchanged. Repeat on 440.21 in JSON mode (its default; send `{"fb":null}` first so the board is in JSON mode), where a G-code fragment is run wrapped as `{"gc":"..."}` and cut at the first double quote: still an error and no motion. Also confirm on EN that a clean `{sr:null}` answers the status report. | after the window's port chooser lands |
| BENCH-P104-1 (HIL-1.5) | Connect EN and 440.21, idle: no STALE over 5 minutes (EN transcript shows one ENQ and one `{"ack":true}` per second; 440.21 one `{"stat":null}`). Pull USB: LOST, W3 and the alarm tone; nothing written after. Reconnect: UNKNOWN, first line `{sr:null}`. Press reset mid-session: the bare-`sr` banner gives FAULT then UNKNOWN. Hold the board in reset (or cut its TX) for 3 s: STALE with W4, cleared when it answers. | after the Connect UI |
| BENCH-P105-1 (HIL-1.3) | On staging signed in through Access (or the bench build on localhost): Connect shows the full C1; accept; Disconnect; Connect again the same day: the short form. Next calendar day: the full form. Signed out of Access: Connect is refused with the sign-in text. Close the tab while connected and reopen: W6 replaces NOT CONNECTED. | after the port chooser (OD-3) and a signed advisory |
| BENCH-P106-1 (HIL-1.7) | Board LIVE in tab A; open tab B (same profile); in tab A's DevTools console run `const e=Date.now()+5000;while(Date.now()<e){}`; in tab B press Pause request: `!` appears in the transcript (Saleae on RX) while tab A is frozen, and tab B shows "Delivered to <board id>". | after the window's port chooser lands |
| BENCH-P106-2 (HIL-1.9) | Start a slow move from the EN-HIL harness, then press Escape (and separately the W2 button) in the LIVE tab: `!` at once, PAUSE REQUESTED then W30 with W10 once a report shows the hold; record keydown-to-`!` latency on the Saleae. | after the window's port chooser lands |
| BENCH-P106-3 (HIL-1.11, B-EXCL-1) | With the port open in Chrome, try Edge, a second Chrome profile and CNCjs on Windows, macOS and Linux; record whether each open is refused. Close the controlling tab with the task manager: the observer tab shows W29. Freeze the machine worker (DevTools, pause in the worker): a stop request from the observer shows STOP NOT DELIVERED — use your E-stop. | after the window's port chooser lands |
| BENCH-P100-5 | Read-only session with an axis in inhibited mode (`am=2`) away from 0, or of unknown mode: the axis-mode facts are shown, not hidden (`axisModeFacts`, row 35). | after P1-07 renders them |
| BENCH-P100-4 | After the first staging deploy: the staging document carries `serial=(self)`, and `run.synthetos.com` still `serial=()` (docs/LEAD_ACTIONS.md, "Phase 1, from P1-00"). | after the staging deploy |

The SAFETY §9 HIL-1.x items and the bench tasks B-ID-1, B-SIG-1, T2.1,
B-POL-1, B-PROBE-1, B-MD-1, B-EXCL-1 and B-SPLICE-1 are the Phase 1 exit
(ROADMAP "Phase 1: Bench read-only"); a signed HIL record is always taken
on the staging artifact (SAFETY HIL-6.4), never on the bench build.

## Bench runner and transcripts (P1-08)

`docs/bench/policy.md` covers the bench runner (`run-cli bench`), the
`SerialAllowUsbDevicesForUrls` policy (B-POL-1) and the wire transcript.
The page has no "save transcript" button yet: the worker's `transcript`
request returns it, and the UI control is still to come.

| ID | Check | When |
|---|---|---|
| BENCH-P108-1 (B-POL-1) | Set the policy from policy.md on the bench computer: `chrome://policy` shows it OK with the staging origin and 1027/24597; staging lists the board in `navigator.serial.getPorts()` with no chooser; the localhost bench origin does not. Record the platform (macOS is UNVERIFIED). | now |
| BENCH-P108-2 | Hold the board with EN-HIL (`uv run python -m tinyg_hil info --port P` in a loop, or a pytest run), start `run-cli bench` on the same port: it exits 3 naming the holder, and no browser opens. Then run it with the board free and quit at the first item: Chrome closes, the restore runs, `/tmp/tinyg-hil-<port>.lock` is free, `record.json` says `restored`. | now |
| BENCH-P108-3 | Save a real bench transcript (EN idle connect, then Pause) and replay it with `recordingFromJsonl` + `ReplayTransport` against a fresh session: no divergence. Commit no hardware names or paths with it. | after the save-transcript control |
