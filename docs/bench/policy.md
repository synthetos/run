# Bench Chrome policy and the bench runner

ROADMAP P1-08. Bench task **B-POL-1** (PROTOCOL_NOTES §B; SAFETY §9). This page is for the
bench computer only. Nothing here goes on an operator's computer, and CI never runs it.

## `SerialAllowUsbDevicesForUrls` (B-POL-1)

Chrome and Edge have an enterprise policy that grants a site Web Serial access to listed USB
devices with no port chooser. On the bench it lets the runner reach the board without a chooser
click. Scope it to **one origin and one device**:

- origin: `https://staging.run.synthetos.com` only. Never `https://run.synthetos.com`, never a
  wildcard. Production sends `Permissions-Policy: serial=()`, so a grant there would do nothing
  anyway; leaving it out means a mistake in the headers can't combine with the policy.
- device: the TinyG v8 USB serial chip, FTDI FT230X, vendor `0x0403` (1027), product `0x6015`
  (24597). This is the `usb` entry of every TinyG dialect in `packages/protocol/src/dialects/`.
  The value is still marked UNVERIFIED on real boards (B-ID-1): read `getInfo()` from the bench
  board (BENCH-P101-1) before you rely on it.

The policy value (JSON, the same on every platform):

```json
[
  {
    "devices": [{ "vendor_id": 1027, "product_id": 24597 }],
    "urls": ["https://staging.run.synthetos.com"]
  }
]
```

Where to set it:

| Platform | Where | Status |
|---|---|---|
| Linux (Chrome) | `/etc/opt/chrome/policies/managed/run-bench.json` containing `{"SerialAllowUsbDevicesForUrls": <value above>}` | documented by Chrome |
| Windows (Chrome) | `HKLM\Software\Policies\Google\Chrome\SerialAllowUsbDevicesForUrls` (REG_SZ holding the JSON value) | documented by Chrome |
| Windows (Edge) | `HKLM\Software\Policies\Microsoft\Edge\SerialAllowUsbDevicesForUrls` | documented by Microsoft |
| macOS (Chrome) | a configuration profile for `com.google.Chrome` with key `SerialAllowUsbDevicesForUrls` (an array of dictionaries, as above), installed as a managed profile. A plain `defaults write` sets a user preference, which Chrome may not treat as a managed policy. | **UNVERIFIED (B-POL-1)** |

Check it took effect: open `chrome://policy` in the bench profile. The policy must show status OK,
source "Platform" (or "Cloud"), and the value above. Then on staging, `navigator.serial.getPorts()`
in the DevTools console lists the board with no chooser. On the localhost bench build it must
**not** be listed until you grant it by hand (the policy names staging only).

Remove the policy when the computer stops being a bench computer.

The runner works without the policy. You then pick the port once in the chooser, and the persistent
profile keeps that grant.

## The bench runner (`run-cli bench`)

```sh
cd apps/cli
node src/main.ts bench --port /dev/cu.usbserial-XXXX --hil-dir <edge-next checkout>/tests/hil \
  [--url https://staging.run.synthetos.com/ | --url http://localhost:8793/] [--only BENCH-P102]
```

What it does, in order (RUN_PLAN §8.6):

1. Refuses when `CI` is set: HIL never runs in cloud CI.
2. Takes the EN-HIL board lock (`tinyg_hil.lock.BoardLock`, an flock on
   `/tmp/tinyg-hil-<port name>.lock`) **without waiting**. If pytest, a flash or another runner
   holds it, the runner prints who holds it and exits 3. At that point nothing has been sent to
   the board.
3. Runs `python -m tinyg_hil snapshot` inside that lock. The settings snapshot goes into the run
   directory. Note: tinyg_hil's snapshot sends `G21` and reads every persisted setting. That is
   the EN-HIL tool talking to the board, not run.
4. Opens Google Chrome (headed, through Playwright) with a persistent profile
   (`~/.run-bench/chrome-profile`) at the page under test. Only staging or the localhost bench
   build is accepted. A signed HIL record is always taken on the staging artifact (SAFETY HIL-6.4).
5. Steps through the BENCH rows of `docs/bench/README.md`, one item at a time: pass, fail (with
   a note), skip (with a note) or quit.
6. Closes Chrome, which releases the port. Then restores the snapshot (`python -m tinyg_hil
   restore`, inside the same lock) and releases the lock. It does this however the run ended:
   quit, Ctrl-C, a failed item, or Chrome failing to start. If the restore fails, the runner
   prints the command to restore by hand and exits 4.
7. Writes `record.json` (items, notes, snapshot path, restore result) to the run directory
   (`~/.run-bench/runs/<time>` unless `--out` is given).

The lock is held by a small Python process (`apps/cli/src/bench/hil_lock_helper.py`) that runs in
the EN-HIL directory and uses EN-HIL's own lock class. If the runner dies, the helper sees its
input close and releases the lock. If the helper dies, the flock goes with it.

`--python` sets the Python command. The default is `uv run python`, as in the EN-HIL README.

Exit codes: 0 every item passed or was skipped, 1 an item failed or the run was stopped before
the last item (quit, Ctrl-C), 2 refused (CI, a URL that is
not staging or localhost, bad options), 3 the board lock is held, 4 an error (snapshot, browser,
restore).

### Items that need a second program on the board

Some items start a move from the EN-HIL harness, or need another sender on the same port
(BENCH-P102-4, -6, P103-4, -5, P106-2, -3). The harness takes the same board lock, so it can't
run while the runner holds it. Run those items outside the runner. Use `--only` for the rest,
and record the outside items by hand in the HIL record.

### Transcripts

Every session keeps a wire transcript of its last connection: every byte written and every chunk
received, with times. It is the `{t, dir, hex}` JSONL format, one object per line, `t` in ms
since the port opened. The machine worker returns it for the `transcript` request (RPC v3).
`recordingFromJsonl` + `ReplayTransport` in `@synthetos/testkit` replays it byte for byte. A
transcript past its 8 MiB bound is refused rather than cut, because a partial transcript would
not replay. The page's **Save transcript** button downloads it as
`run-transcript-<UTC date and time>.jsonl`. It holds the board's unique hardware id (as hex):
keep it private with the HIL record, never commit it or attach it to a public issue.
