"""Writes gsim-expected.json: what EN-HIL's reference path simulator (gsim.py) says each corpus file does.

Usage (gsim.py is never vendored; extract it read-only from the pinned TinyG commit):
    git -C <TinyG> show ead63997:tests/hil/tinyg_hil/gsim.py > /tmp/gsim/gsim.py
    python3 -I gsim_expected.py /tmp/gsim > gsim-expected.json

For every line of every file in corpus/: the machine position after it (mm, G54 offsets zero, start at 0),
and the box of the whole path. Lines are split on CR, LF or CRLF, as run's parser splits them.
"""
import json
import os
import re
import sys

sys.path.insert(0, sys.argv[1])
import gsim  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")


def r(v):
    return round(v + 0.0, 6)


out = {"gsim": {"commit": "ead639978c77601b150be7ef12774f47eed4c824", "path": "tests/hil/tinyg_hil/gsim.py",
                "blob": "3a9710bc504f3e09f9669c033a606c78bae7be41"}, "files": {}}
for name in sorted(os.listdir(CORPUS)):
    text = open(os.path.join(CORPUS, name), encoding="latin-1").read()
    lines = re.split(r"\r\n|\r|\n", text)
    m = gsim.Machine()
    positions = []
    for line in lines:
        m.block(line)
        positions.append([r(m.position[a]) for a in "XYZ"])
    pts = [p for seg in m.segments for p in seg.points]
    box = None
    if pts:
        box = {"min": [r(min(p[a] for p in pts)) for a in "XYZ"], "max": [r(max(p[a] for p in pts)) for a in "XYZ"]}
    out["files"][name] = {"positions": positions, "box": box, "errors": len(m.errors)}
json.dump(out, sys.stdout, indent=1, sort_keys=True)
sys.stdout.write("\n")
