"""Bench runner helper (run apps/cli bench, ROADMAP P1-08).

Holds the EN-HIL board lock (tinyg_hil.lock.BoardLock: an flock on
/tmp/tinyg-hil-<port name>.lock) for the whole bench run, so pytest, a flash
and the browser never fight over the board. Runs `python -m tinyg_hil
snapshot` and `restore` inside that lock: the module's own main() takes the
same lock, so it is given the lock this process already holds.

Run from the EN-HIL directory (edge-next tests/hil), usually through
`uv run python`. Protocol on stdout, one line each, prefixed "@@bench ":
  busy <holder>       the lock is held by someone else; exit 3, nothing touched the board
  locked <lock path>
  snapshot <path>     after the snapshot succeeded
  restored
  refused <reason>    the restore was not run: another board is on the port, or the board is not idle
  released
  error <message>     exit 4

Both the snapshot and the restore send G21 and (restore) settings writes to the board. Before either,
the helper reads the board (identity GETs, stat, hold, vel, qr) and goes no further unless it is idle
with an empty planner; before the restore it also checks that the board's id and fb are the
snapshot's, so one board's settings are never written into another board on a reused port path.
stdin commands, one per line: "restore", "release". End of input releases:
if the runner dies, the lock is released (flock goes with the process too).
Everything tinyg_hil prints goes to stderr, so it never mixes with the protocol.
"""
import argparse
import contextlib
import json
import os
import pathlib
import sys
import traceback

PREFIX = "@@bench "


def say(out, *words):
    out.write(PREFIX + " ".join(str(w) for w in words) + "\n")
    out.flush()


RESTING_STAT = (1, 4)  # READY, PROGRAM_END


def read_board(port):
    """The board's identity and its stat/hold/vel/qr, read with GETs only. A value the board refuses is None."""
    from tinyg_hil.driver import StatusError, TinyG

    tg = TinyG(port)
    try:
        ident = dict(tg.connect())
        state = {}
        for token in ("stat", "hold", "vel", "qr"):
            try:
                state[token] = tg.get(token)
            except StatusError:
                state[token] = None
        return ident, state
    finally:
        tg.close()


def busy_reason(state, qr_empty=None):
    """Why the board is not idle with an empty planner, or None when it is."""
    stat = state.get("stat")
    if stat not in RESTING_STAT:
        return f"the board is not idle (stat {stat})"
    vel = state.get("vel")
    if not isinstance(vel, (int, float)) or vel != 0:
        return f"the board is moving or its velocity could not be read (vel {vel})"
    hold = state.get("hold")
    if hold is not None and hold != 0:
        return f"the board is in a feedhold (hold {hold})"
    if qr_empty is not None and state.get("qr") != qr_empty:
        return f"the planner is not empty (qr {state.get('qr')}, {qr_empty} when the run started)"
    return None


def restore_refusal(snapshot_identity, ident, state, qr_empty):
    """Why the snapshot must not be written to the board now, or None."""
    for key in ("id", "fb"):
        if snapshot_identity.get(key) is None or ident.get(key) != snapshot_identity.get(key):
            return f"the board on this port reports {key} {ident.get(key)!r}, but the snapshot is from {key} {snapshot_identity.get(key)!r}"
    return busy_reason(state, qr_empty)


def main(argv=None):
    p = argparse.ArgumentParser(prog="hil_lock_helper")
    p.add_argument("--port", required=True)
    p.add_argument("--out", required=True, help="empty directory for the snapshot")
    p.add_argument("--purpose", default="run bench")
    args = p.parse_args(argv)

    out = sys.stdout
    sys.path.insert(0, os.getcwd())
    from tinyg_hil.lock import BoardBusy, BoardLock
    import tinyg_hil.__main__ as hil

    lock = BoardLock(args.port)
    try:
        lock.acquire(args.purpose, wait=0)
    except BoardBusy as e:
        say(out, "busy", str(e))
        return 3
    say(out, "locked", lock.path)

    class Held:
        """The lock tinyg_hil's main() asks for: this process already holds it."""

        def __init__(self, port):
            pass

        def acquire(self, purpose, wait=0.0):
            return self

        def release(self):
            pass

    hil.BoardLock = Held
    try:
        outdir = pathlib.Path(args.out)
        outdir.mkdir(parents=True, exist_ok=True)
        if any(outdir.iterdir()):
            raise RuntimeError(f"snapshot directory is not empty: {outdir}")
        # The snapshot sends G21 first: never into another sender's job or a held board.
        _, before = read_board(args.port)
        reason = busy_reason(before)
        if reason is not None:
            raise RuntimeError(f"refusing to snapshot: {reason}")
        with contextlib.redirect_stdout(sys.stderr):
            hil.main(["snapshot", "--port", args.port, "--out", str(outdir)])
        snaps = sorted(outdir.glob("*.json"))
        if len(snaps) != 1:
            raise RuntimeError(f"expected one snapshot in {outdir}, found {len(snaps)}")
        snapshot = snaps[0]
        snapshot_identity = json.loads(snapshot.read_text()).get("identity") or {}
        # The snapshot waited for idle, so this is the planner's empty value on this board.
        _, after = read_board(args.port)
        qr_empty = after.get("qr")
        say(out, "snapshot", snapshot)
        for line in sys.stdin:
            command = line.strip()
            if command == "restore":
                ident, state = read_board(args.port)
                reason = restore_refusal(snapshot_identity, ident, state, qr_empty)
                if reason is not None:
                    say(out, "refused", reason)
                    continue
                with contextlib.redirect_stdout(sys.stderr):
                    hil.main(["restore", str(snapshot), "--port", args.port])
                say(out, "restored")
            elif command == "release":
                break
            elif command:
                raise RuntimeError(f"unknown command: {command}")
        return 0
    except Exception as e:  # noqa: BLE001 - every failure is reported on the protocol
        traceback.print_exc(file=sys.stderr)
        say(out, "error", f"{type(e).__name__}: {e}".replace("\n", " "))
        return 4
    finally:
        lock.release()
        say(out, "released")


if __name__ == "__main__":
    sys.exit(main())
