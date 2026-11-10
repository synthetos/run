# @synthetos/flasher

The browser firmware updater (SAFETY §4.8, H79–H89). Zero runtime npm dependencies, no network.

## Layout

| Path | What it is |
|---|---|
| `src/core/link.ts` | The byte link a target talks over (`ByteLink`, `ByteBuffer`, timeouts). The machine package's bootloader link is the only implementation over a real port. |
| `src/core/sha256.ts` | SHA-256 of an image as downloaded, before it is parsed. |
| `src/core/updater.ts` | The `Updater` interface every target implements: `prepare`, `detect`, `write`, `verify`, `restore`. |
| `src/targets/xboot-xmega/` | TinyG v8: xboot (AVR109 block mode) on the ATxmega192A3. The part, the Intel HEX reader, the page plan, the closed command set and frame guard, the client, the flash run, and `updater.ts`, the adapter. |
| `src/targets/index.ts` | The target table, keyed by board family (`UPDATER_TARGETS`, `updaterFor`). |
| `src/authorize.ts`, `src/bootloaderCapability.ts` | The gate in front of every target: only an authorized image for this board mints the one-use capability that lets the transport open a bootloader port. The mint is importable by flasher source only (dependency-cruiser rule `bootloader-capability-mint-is-flasher-only`). |

The package entry (`src/index.ts`) exports everything the app uses; the web app and the machine package import only the entry and `@synthetos/flasher/bootloader-capability`.

## Adding `samba-sam3x` (g2core on the Arduino Due)

g2core boards (the SAM3X8E on a Due, and boards like it) update through Atmel's SAM-BA ROM bootloader, not xboot. Adding them is a new target, not a change to xboot's:

1. **Board family.** Add `'g2-sam3x'` to `BoardFamily` in `src/core/updater.ts`.
2. **Folder.** Create `src/targets/samba-sam3x/` with, at least:
   - `part.ts`: the SAM3X8E's flash map (two 256 KB banks of 256-byte pages from 0x80000), and which region the application owns;
   - `image.ts`: a strict reader for the release format g2core ships (a raw `.bin` placed at 0x80000), refusing anything it does not fully understand, as `ihex.ts` does;
   - `samba.ts`: SAM-BA's command set as a closed type (`N#`, `V#`, `W`/`w` word access, `S`/`R` for data, `G` to run), encoded by one function, with a frame guard that refuses anything outside the application region and the flash controller registers the plan needs. Like xboot's `e`, nothing that erases the whole chip or sets lock bits is representable;
   - `client.ts`, `flashRun.ts`: entry, identify (`V#` and the chip id register), backup, page writes through the EEFC, verify, and the GPNVM boot-from-flash bit set last, so an interrupted write leaves the board in SAM-BA (the same rule as xboot's stub page 0);
   - `updater.ts`: the adapter implementing `Updater`.
3. **Table.** Add the row to `UPDATER_TARGETS` in `src/targets/index.ts`.
4. **Entry into the bootloader.** On the Due's native USB port, opening at 1200 baud and dropping DTR erases GPNVM1 and resets the chip into SAM-BA. That open is refused by the machine transport unless it carries a `BootloaderCapability` (T-S16), so the touch stays behind the same gate: `authorize.ts` grows the g2 part and the signed-release check for g2 images; nothing else may mint.
5. **Tests.** A fake SAM-BA in `packages/testkit` (as `xboot` is), the command-set and guard tests (no erase-all, nothing outside the application), a plan-order test (GPNVM last), and an interrupted-flash test.
6. **Safety.** New hazards in SAFETY.md for the Due (the 1200-baud touch, GPNVM) and an owner decision before any phase switch turns it on.
