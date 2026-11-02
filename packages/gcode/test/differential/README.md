# Differential corpus (ROADMAP TB-02, RUN_PLAN §8.3)

`differential.test.ts` runs run's sanitiser and interpreter (`tinyg-en`, the
dialect with standard G18 arcs and G10 L20, which is what gsim models) over
every file in `corpus/` and compares the position after each sent line, and
the box of the whole path, with what EN-HIL's reference path simulator
`tests/hil/tinyg_hil/gsim.py` says (`gsim-expected.json`).

- `corpus/` holds small files from TinyG `gcode_samples/` at edge-next
  `6ec70652` (unchanged since `ead63997`, where they were taken; spaces in names replaced by `_`, `_untested/` dropped) and
  three files from `test-fixtures/cam/` (`cam-*`). Bytes are exact
  (`.gitattributes` marks the directory `-text`).
- `gsim-expected.json` is generated, never edited. gsim.py itself is not
  vendored: extract it read-only from the pinned commit and run the script:

  ```sh
  mkdir -p /tmp/gsim
  git -C <TinyG> show 6ec70652:tests/hil/tinyg_hil/gsim.py > /tmp/gsim/gsim.py
  python3 -I gsim_expected.py /tmp/gsim > gsim-expected.json
  ```

- `triage.json` records every disagreement and why. The test fails on a new
  disagreement and on a triaged one that went away, so each change is
  looked at and triaged as a bug in run or in gsim.
