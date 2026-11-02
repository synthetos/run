# CAM corpus (ROADMAP P0-10, SAFETY T-S2)

Small G-code files, each built around one case the sanitiser must handle
(SAFETY §4.7). `packages/safety/test/sanitize-corpus.test.ts` states the
expected outcome of every file on `tinyg-en` and `tinyg-440`.

The bytes are exact and must not be normalised: `04-embedded-ctrl-x.nc`
holds a raw 0x18 and `11-crlf.nc` uses CRLF line endings
(`.gitattributes` marks the directory `-text`).

`12-g18-arc.nc` is the EN-HIL fixture of
`tests/hil/tests/bugs/test_e029_g18_arc_direction.py:45` at edge-next
ead63997 (unchanged at the current pin `97321391`): on EN the arc dips to Z-0.5; on 440.21 it runs the other way
(E029), so the TG dialect blocks it.
