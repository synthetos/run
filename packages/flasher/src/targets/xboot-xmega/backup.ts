/**
 * The backups a flash takes before it writes anything: the raw EEPROM and
 * the whole application section, each checked before it is trusted.
 *
 * A reply shifted by one stale byte reads as plausible data (a block of
 * 512 bytes is 512 bytes whichever command they answer), so a backup is
 * proved, not assumed:
 * - the EEPROM is read twice and both reads must agree byte for byte;
 * - the application section's CRC-16 must equal xboot's own CRC of the
 *   section (`h` `A`, computed on the chip from flash, not from the link).
 * A backup that fails either check is a `desync`: the run stops before the
 * first write, and the backup is never handed on.
 */
import type { XbootClient } from './client.ts';
import { crc16 } from './crc16.ts';
import { XbootError } from './errors.ts';

export interface Backups {
  readonly eeprom: Uint8Array;
  /** The whole application section as read from the board. */
  readonly flash: Uint8Array;
  readonly crc: number;
}

type Attempt = <T>(step: () => Promise<T>) => Promise<T>;

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Read and prove both backups. `onBytes` reports the bytes read so far (EEPROM first, then flash). */
export async function readBackups(client: XbootClient, attempt: Attempt, onBytes: (done: number) => void): Promise<Backups> {
  const part = client.part;
  const eeprom = await attempt(() => client.readEeprom(0, part.eepromBytes));
  const again = await attempt(() => client.readEeprom(0, part.eepromBytes));
  if (!same(eeprom, again)) throw new XbootError('desync', 'the EEPROM read back differently the second time, so the settings backup is not trusted. Nothing was written.');
  onBytes(part.eepromBytes);
  const flash = await attempt(() => client.readFlash(0, part.appBytes, (done) => onBytes(part.eepromBytes + done)));
  const crc = crc16(flash);
  const onChip = await attempt(() => client.crcApplication());
  if (onChip !== crc) {
    throw new XbootError('desync', `the firmware backup's checksum (0x${crc.toString(16)}) is not the bootloader's (0x${onChip.toString(16)}), so the backup is not trusted. Nothing was written.`);
  }
  return Object.freeze({ eeprom, flash, crc });
}
