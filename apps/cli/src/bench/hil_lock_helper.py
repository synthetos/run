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
  released
  error <message>     exit 4
stdin commands, one per line: "restore", "release". End of input releases:
if the runner dies, the lock is released (flock goes with the process too).
Everything tinyg_hil prints goes to stderr, so it never mixes with the protocol.
"""
import argparse
import contextlib
import os
import pathlib
import sys
import traceback

PREFIX = "@@bench "


def say(out, *words):
    out.write(PREFIX + " ".join(str(w) for w in words) + "\n")
    out.flush()


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
        with contextlib.redirect_stdout(sys.stderr):
            hil.main(["snapshot", "--port", args.port, "--out", str(outdir)])
        snaps = sorted(outdir.glob("*.json"))
        if len(snaps) != 1:
            raise RuntimeError(f"expected one snapshot in {outdir}, found {len(snaps)}")
        snapshot = snaps[0]
        say(out, "snapshot", snapshot)
        for line in sys.stdin:
            command = line.strip()
            if command == "restore":
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
