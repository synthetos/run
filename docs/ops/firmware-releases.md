# Firmware releases and the update panel

SAFETY §4.8 as amended 2026-11-03, H79-H89; `packages/protocol/src/firmwareReleases.ts`.

The Board view's Firmware tab lists the firmware a board may be updated to.
The list is a signed data file, `firmware/releases.json`, verified like the
approved-builds manifest and the safety advisory: one entry per environment,
each an Ed25519 signature over `synthetos-run firmware-releases v1\n` plus the
payload, by a key in `packages/protocol/src/releaseKeys.ts` authorised for that
environment. The machine worker verifies its own bundled copy before every
flash and never trusts the page's.

## What an entry says

Per hardware version (`hv`):

- `minimumFb`: boards of this hardware below it are locked to read-only (jobs,
  jog and settings writes) until they are updated: the old-firmware gate. They
  can still connect, be identified, viewed and backed up, and the Board view
  opens on the Update panel.
- `releases`, each with `fb`, `fv`, `dialect`, `part` (`x192a3`), `file` (the
  `.hex` name), `sha256` and `size` of the exact `.hex` bytes, `date`,
  `changelog`, `recommended` (at most one per hardware) and, for test images
  only, `simulatorOnly`. A GitHub-released image also names `repo`
  (`synthetos/TinyG` or `synthetos/tg-xboot`, the reviewed list
  `FIRMWARE_RELEASE_REPOSITORIES`) and `tag` (the release tag; `file` is the
  asset name in that release). The release page is
  `https://github.com/<repo>/releases/tag/<tag>`; the list carries no URL
  because it is bundled into the page and the bundle scan admits no foreign
  origin literal there.

On staging a listed release also counts as an approved build for its hardware
version (the release list is a signed approval for that environment), so a
board updated from the list is not left read-only. A `simulatorOnly` release
approves and flashes only the test kit's simulated board, never a real port.

## Signing

Edit `firmware/releases.unsigned.json`, then:

```sh
corepack pnpm sign:releases --key /path/outside/the/repo/key.pkcs8.pem --kid <kid>
```

- **Staging** is signed with the owner's bench key
  (`--key /Users/ril3y/.synthetos-release-bench/bench.pkcs8.pem --kid owner-bench-2026-11-02`),
  which is authorised for staging only.
- The same command regenerates `workers/run/src/firmwareAssets.ts`: the
  GitHub-released entries (environment, repository, tag, asset, SHA-256, size)
  as a plain data module, because the Worker may import nothing outside its
  own directory (tools/gates/src/build/worker.ts). The gate test holds that
  file equal to what the committed signed file renders, so an edited list
  that was not re-signed fails CI.
- **Production stays empty**: the file has no production entry, so production
  offers no firmware. It gets one only when the owner signs it with the offline
  release key (docs/ops/release-key.md), after the image passed D5. The
  flasher switch (`packages/safety/src/flasherPhase.ts`) is also off for
  production, pinned by a test.

`tools/gates/test/firmware-releases.test.ts` checks that the signed file
decodes to the unsigned one, that production has no entry, that every
`.hex` the repository holds matches the SHA-256 and size its entry names, and
that the Worker's generated asset list and repository allowlist match the
list and `packages/protocol`.

## Fetching the images (OD-10, built 2026-11-03)

Official images are GitHub Release assets, and a browser cannot fetch them
(see "Where the images come from"). The page fetches every listed image from
its **own origin**, at the path `releasePath` in `packages/protocol` derives:

- **GitHub-released** (`repo` and `tag` set):
  `/firmware/<owner>/<name>/<tag>/<file>`. On staging the run Worker's
  firmware proxy (`workers/run/src/firmwareProxy.ts`) answers it: only a
  repository in the allowlist and an asset name matching
  `^[A-Za-z0-9._-]+\.(hex|txt)$|^SHA256SUMS$` are routed at all; only a tag
  and asset the generated list names for the Worker's environment is fetched
  (`https://github.com/<repo>/releases/download/<tag>/<asset>`, server-side,
  capped at 2 MiB); the body is served only when its SHA-256 and size equal
  the list's and, for a `.hex`, the release's `SHA256SUMS` names that hash
  too. A verified body is cached under its hash (the Cache API) and served
  `text/plain` with `cache-control: public, max-age=31536000, immutable` and
  the Worker's security headers. A mismatch or anything unlisted is a 404 with
  no detail; GitHub down is a 502. The Worker is never trusted for safety: the
  page hashes the bytes again against the signed entry before C6 is asked,
  and the machine worker again before it parses anything. In production only
  `/api/*` and `/auth/*` run the Worker first, so there the path is an asset
  404: production lists no firmware and its flasher is off.
- **Bench**: the localhost bench server (`pnpm bench:serve`) runs the same
  proxy code (`tools/gates/src/bench/firmware.ts`) over the signed staging
  list it verifies at start, with Node's fetch and an in-memory cache, so the
  owner can exercise the fetch against the real GitHub on this computer.
- **Simulator images** (`simulatorOnly`) come from `/firmware/sim/<file>`
  (the fake-serial suite serves them) and anything else from
  `/firmware/<file>` (a file placed in `apps/web/public/firmware/`).
- **Local copy**: when the download fails or the file is not served, the user
  chooses a local `.hex` ("Use a local copy…"). It must match the signed
  SHA-256 and size; the page checks before C6, and the worker checks again.

The Firmware tab downloads first (with progress), checks the image, then
asks C6 about the checked image; the flash path itself is unchanged.

The staging list names two builds for hardware version 8: **450.01**
(`synthetos/TinyG`, tag `450.01`, `tinyg-450.01.hex`, 434,318 bytes, SHA-256
`b83763af…`, published 2026-11-03 as an edge-next pre-release built from
`425fa92e`; the hash and size are the published `SHA256SUMS` and asset size,
passed on verbatim by the firmware maintainer's session because this
session could not reach the asset host) and **440.21** (tag `440.21`,
`tinyg-440.21.hex`, 334,978 bytes), the first CI-built release of the 440
line. Both are listed as not recommended: 450.01 is a pre-release that
450.02 and later supersede, 440.21 is older than the bench firmware. Its
`minimumFb` is 440.21 so neither listed build is below the gate. **Owner
step, later**: once the maintainer calls a 450.xx build current, mark it
recommended, raise hardware version 8's `minimumFb` to 450+ (a 440.21 board
is then locked to read-only until updated, and 440.21 should be dropped or
hidden from the list rather than offered as a downgrade), and re-sign. Each
later 450.xx release is added the same way (entry, re-sign, the Worker's
asset table regenerates).
`firmware/tinyg-440.21.hex` is the repository's copy of the listed bytes for
the tests (the hash gate, the bench and the fake-serial suite's stubbed
GitHub); the Worker serves GitHub's, never this copy.

The three releases listed for hardware version 99 are simulated images for the
fake-serial suite (`firmware/sim/`, generated by
`pnpm --filter @synthetos/testkit gen:sim-firmware`). No real TinyG reports
hardware version 99, and the worker refuses them on any real port.

## Custom firmware and trust

A user may flash their own `.hex` as unsigned custom firmware (C37, W47). The
board stays read-only afterwards unless the user trusts that exact image on
that board (C38): the trust is stored on that computer only (device-safety),
per board id and per image SHA-256, sent to the worker at Connect only while
the browser's record says the board still runs that image, and never applies
to another board, another image or production. It shows the persistent
"Custom firmware (trusted by you)" banner (W48) and can be revoked in Firmware
& Backups.

## Backups kept by the update

Before anything is written the page stores, on this computer (IndexedDB
`run-backups`): the settings backup read token by token, the raw EEPROM (2 KB)
and the whole application section as a firmware image backup (`.hex`, with
`fb`/`fv` and its SHA-256). A firmware backup can be downloaded or put back
("Put this firmware back"), on the board it was read from only, through the
same flow and checks. Cloud sync of backups comes later behind the
`BackupRepository` seam (`apps/web/src/firmware/store.ts`).

## Where the images come from (OD-10, facts from the firmware maintainer, 2026-11-03)

- **TinyG** (`synthetos/TinyG`): a GitHub Release is created only when a tag matching `[0-9]*` or `v*` is pushed; the tag is the firmware build number (for example `440.21`) and the release is marked pre-release. Assets: `tinyg-<BUILD>.hex`, `tinyg-<BUILD>.elf`, `SHA256SUMS` (sha256sum of the hex and the elf) and `size.txt`. Checksums only, no signatures. One hex per release: the firmware targets the v8 board, and the hardware version is a runtime setting, not a build variant. Example: https://github.com/synthetos/TinyG/releases/tag/440.21. Pushes to branches produce Actions artifacts only, never releases.
- **450.01 / edge-next is not published yet.** The bench build is a local build of the edge-next tip. A release needs the maintainer to push a tag such as `450.01` on edge-next.
- **tg-xboot** (`synthetos/tg-xboot`): tags `v<semver>`; assets `tg-xboot-v2.0.0.hex`, `tg-xboot-v2.0.0-boot.hex`, `.elf`, `SHA256SUMS`, `TOOLCHAIN.txt`.
- **Browsers cannot fetch these assets directly.** The download redirects to `release-assets.githubusercontent.com`, whose response carries no `Access-Control-Allow-Origin` header (checked 2026-11-03), so a cross-origin fetch from run's page fails whatever run's own policy says. run's Worker fetches the asset server-side, checks its SHA-256 against the signed list (and against the release's `SHA256SUMS`), caches it, and serves it same-origin.
