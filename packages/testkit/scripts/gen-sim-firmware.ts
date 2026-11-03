/**
 * DEV ONLY. Writes the simulated firmware images (simFirmware.ts SIM_IMAGES)
 * to firmware/sim/*.hex for the fake-serial suite. They are not firmware: no
 * real board can run them, and the signed release list marks them
 * `simulatorOnly` for hardware version 99, which no real TinyG reports
 * (docs/ops/firmware-releases.md). test/xboot-files.test.ts fails when the
 * committed files are out of date.
 *
 *   pnpm --filter @synthetos/testkit gen:sim-firmware
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIM_IMAGES, simHex, simImage, type SimImageName } from '../src/firmware/simFirmware.ts';

const dir = join(import.meta.dirname, '..', '..', '..', 'firmware', 'sim');
mkdirSync(dir, { recursive: true });
for (const name of Object.keys(SIM_IMAGES) as SimImageName[]) {
  const file = join(dir, SIM_IMAGES[name].file);
  writeFileSync(file, simHex(simImage(name)));
  process.stdout.write(`wrote ${file}\n`);
}
