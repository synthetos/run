# Vendored TinyG HIL tables

These are the token and status-code tables that the TinyG hardware-in-the-loop
harness (EN-HIL) generates from the firmware sources with
`tests/hil/tools/gen_tables.py`. They are the **single source of truth** for
run's generated status tables, settings schemas and read-allowlist coverage
(RUN_PLAN §8.2, ROADMAP P0-09). Nothing in run hand-copies a token or a status
code that these files contain.

| File | Firmware | Commit | `fb` | Used for |
|---|---|---|---|---|
| `den.json` | TinyG `edge-next` | `ead63997` | 450.01 | the `tinyg-en` dialect (primary, full support for approved builds) |
| `d440.json` | TinyG `master` (release 440.21) | `d0418390` | 440.21 | the `tinyg-440` fallback dialect |
| `d449.json` | TinyG stock `edge-0.97` | `c5024186` | 449.01 | **the read-only `tinyg-449-stock` dialect only** |

`SOURCES.json` records, for each file, the full source commit, the pin in
`vendor/firmware-pins.json` it belongs to, how it was produced and its SHA-256.

## Notes

- **`d449.json` is stock edge-0.97, not edge-next.** The harness's committed
  `d449.json` was generated from `origin/edge-0.97` @ c5024186 (its own `ref`
  and `commit` fields say so, PROTOCOL_NOTES §11). It describes boards that run
  only in READ_ONLY mode. Never use it for edge-next: that is what `den.json` is
  for.
- **`den.json` is new (D32).** The harness did not ship an edge-next table at
  the pinned commit. It was generated for P0-09 by running the harness's own
  generator against `edge-next` @ ead63997 (`git archive` snapshot; the TinyG
  working tree was not touched), twice, with byte-identical output. The
  firmware owner may later add it to the harness; when that happens, the
  harness copy must match this one byte for byte at the same commit.
- `d440.json` and `d449.json` are byte-identical copies of the harness files at
  the generator commit (`ead63997`), and both were regenerated with the same
  script at their source commits to confirm the token and status maps.
- The tables carry `group`, `type`, `precision`, the persist flag and the
  get/set function names for every cfgArray row. They do **not** carry the
  `F_CONVERT` (unit conversion) flag or the factory default: the generator does
  not emit them. run's hand overlay records `convert` for the keys it covers,
  cited to the cfgArray row. Adding both fields to `gen_tables.py` is a request
  for the firmware owner.
- The edge-next tip has moved past `ead63997` (to `1581a4e9` at the time of
  writing), but only `tests/hil/` changed; `firmware/` and the generator are
  identical, so the table is unchanged.

## On a firmware bump

1. Regenerate the table in the TinyG repository (or from a snapshot of the new
   commit) with `tests/hil/tools/gen_tables.py`.
2. Copy it here, update `SOURCES.json` (commit, fb, sha256) and
   `vendor/firmware-pins.json`.
3. Run `pnpm gen:schema` and `pnpm test`. The schema tests fail until every new
   token is classified in the dialect's read allowlist (allow or deny) and every
   allowlisted token still exists.
4. Review the whole diff. CODEOWNERS makes the owner a required reviewer.
