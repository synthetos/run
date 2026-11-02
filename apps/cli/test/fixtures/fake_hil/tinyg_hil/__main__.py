"""Records each call in $FAKE_HIL_CALLS (one line each) and acts like tinyg_hil's main() for snapshot/restore."""
import json
import os
import pathlib
import sys

from .lock import BoardLock


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    lock = BoardLock(argv[argv.index("--port") + 1]).acquire("fake " + argv[0], wait=0)
    with open(os.environ["FAKE_HIL_CALLS"], "a") as f:
        f.write(" ".join(argv) + "\n")
    print("board: fake")
    if argv[0] == "snapshot":
        if os.environ.get("FAKE_HIL_FAIL") == "snapshot":
            raise RuntimeError("no answer from the board")
        out = pathlib.Path(argv[argv.index("--out") + 1])
        out.mkdir(parents=True, exist_ok=True)
        (out / "FAKE-450.01-20261101T000000Z.json").write_text(json.dumps({"values": {"1ma": 0}}) + "\n")
    elif argv[0] == "restore":
        if os.environ.get("FAKE_HIL_FAIL") == "restore":
            raise RuntimeError("restore refused")
    lock.release()
