# Third-party notices

## cncjs gcode-parser 2.2.0 (MIT)

`packages/gcode/src/parser.ts` is forked from `parseLine` and its comment
stripper in cncjs `gcode-parser` (https://github.com/cncjs/gcode-parser).

```
The MIT License (MIT)

Copyright (c) 2015-present Cheton Wu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## IBM Plex fonts (OFL-1.1)

Copyright © 2017 IBM Corp. with Reserved Font Name "Plex". Licensed under the
SIL Open Font License, Version 1.1.

The web app self-hosts IBM's own Latin-1 subsets of IBM Plex Sans, IBM Plex
Sans Condensed and IBM Plex Mono, copied unmodified from the official npm
packages `@ibm/plex-sans@1.1.0`, `@ibm/plex-sans-condensed@2.0.0` and
`@ibm/plex-mono@2.5.0`:

- the font files: `apps/web/src/fonts/ibm-plex/*.woff2` (each file, its
  package and its SHA-256 are listed in `apps/web/src/fonts/ibm-plex/README.md`);
- the licence text: `apps/web/src/fonts/ibm-plex/OFL.txt`, also served with
  the site at `/licenses/IBM-Plex-OFL.txt` (`apps/web/public/licenses/IBM-Plex-OFL.txt`).

The fonts stay under the OFL-1.1; run's AGPL-3.0 licence does not apply to them.

## TinyG (GPL-2.0)

TinyG is © Alden S. Hart, Jr. / Synthetos, licensed under the GNU General
Public License version 2 (https://github.com/synthetos/TinyG). run does not
include the firmware in what it deploys; the Worker serves release images
from GitHub Releases. These parts of run are copied or derived from its source
or its repository:

- **A release image, for the tests.** `firmware/tinyg-440.21.hex` is the
  asset `tinyg-440.21.hex` of synthetos/TinyG release `440.21` (334,978
  bytes, SHA-256 `c2c1693e82f0ed88…`, the hash in `firmware/releases.json`),
  kept so the hash gate, the bench and the fake-serial suite can run without
  GitHub. It is TinyG firmware under GPL-2.0, unmodified; the deployed site
  never serves this copy (`docs/ops/firmware-releases.md`).

- **Vendored tables.** `vendor/tinyg-hil-tables/` (token and status-code
  tables, with their message text) and `vendor/tinyg-board-facts/` (board
  facts: hardware platforms, versions, port bindings) are generated from
  synthetos/TinyG at the commits pinned in `vendor/firmware-pins.json`
  (edge-next `93a723b8`, master `d0418390` for 440.21, edge-0.97 `c5024186`
  for 449.01). `vendor/tinyg-hil-tables/SOURCES.json` records each file's
  source commit, how it was produced and its SHA-256. Code generated from
  these tables (the dialect status and settings tables in
  `packages/protocol`, the board definitions in `packages/schema/boards/`)
  keeps its `file:line` citations into TinyG.
- **Test firmware model.** `packages/testkit/src/firmware/` is a model of
  TinyG's observable behaviour, written from that source (with citations) so
  that run's tests can exercise a simulated board. It is test tooling, not
  firmware.
- **Logo images.** `apps/web/public/brand/edge-next/tinyg-edge-next-2026.png`
  and `tinyg-edge-next-2026-icon.png` are copied from synthetos/TinyG
  `docs/images/` at edge-next commit `e08d8d9c` (provenance:
  `apps/web/brand/edge-next/SOURCE.md`).

The owner's position on the licensing of these generated tables is recorded in
OD-7 (`docs/ops/owner-decisions.md`).
