# Vendored TinyG board facts

`EN.json` holds the board facts the board definition generator (ROADMAP TB-05a)
extracts from TinyG `edge-next` at the pinned commit in
`vendor/firmware-pins.json` (pin `EN`): the hardware platform (`hp`), every
hardware version (`hv`) the build accepts, the motor, switch and output port
bindings per version, the microstep values and the polarity tokens, each with a
`file:line` citation.

It is vendored so CI can regenerate `packages/schema/boards/tinyg/*.json`
without the firmware repository. Regenerate both with a local TinyG clone:

    TINYG_REPO=../TinyG pnpm gen:boards --extract

The extractor reads the clone with `git show <commit>:<path>` only; it never
checks out, stashes or writes the firmware working tree.
`tools/gates/test/boards-gen.test.ts` re-extracts and compares byte for byte
whenever the clone is present, and always checks that the committed
definitions equal a fresh render of this file plus the overlays in
`packages/schema/boards/overlays/`.
