/**
 * The one part run flashes: the ATxmega192A3 on TinyG v8, with the TinyG xboot
 * bootloader (XB tg-xboot @ 29d08013, conf/x192a3.mk).
 *
 * Memory map (XB src/api.h:40-72; the part's datasheet):
 * - flash 0x00000-0x31FFF: the application section 0x00000-0x2FFFF (192 KB)
 *   and the 8 KB boot section 0x30000-0x31FFF, where xboot lives;
 * - flash page 512 bytes (`b` answers `Y 0x02 0x00`, XB src/xboot.c:402-409);
 * - EEPROM 2 KB (addresses at or above 0x800 mirror; XB CLAUDE.md "EEPROM is
 *   2 KB"), page 32 bytes;
 * - signature 1E 97 44, which `s` sends last byte first: 44 97 1E
 *   (XB src/xboot.c:584-589; scripts/avr109_probe.py).
 *
 * The xboot firmware-update API stages an image in the upper half of the
 * application section (XB_APP_TEMP_START = 0x18000) and, on exit, installs it
 * when the last page of that half ends in `XBIF` and a CRC (XB
 * src/xboot.c:1292-1330). The HEX validator refuses an image carrying that
 * marker, so an exit can never start an install run did not ask for.
 */

export interface Part {
  /** avrdude's name for the part. */
  readonly name: 'x192a3';
  /** What `s` answers, in the order xboot sends it (signature byte 2, 1, 0). */
  readonly signatureReply: readonly [number, number, number];
  /** The signature as the datasheet writes it. */
  readonly signature: string;
  /** Flash page size in bytes; the block size `b` reports. */
  readonly pageBytes: number;
  /** The application section: byte addresses [0, appBytes). */
  readonly appBytes: number;
  /** First byte of the boot section (xboot). Nothing at or above it is ever written. */
  readonly bootStart: number;
  readonly bootBytes: number;
  readonly eepromBytes: number;
  /** xboot's staging area for its firmware-update API (XB_APP_TEMP_START). */
  readonly appTempStart: number;
  /** The program id `S` answers (XB src/xboot.c:567-576). */
  readonly programId: string;
  /** The version `V` answers: XBOOT_VERSION_MAJOR, MINOR (XB src/xboot.h:51-52). */
  readonly bootloaderVersion: string;
  /** UART rate of the bootloader (conf/x192a3.mk UART_BAUD_RATE), the same as TinyG's. */
  readonly baudRate: number;
}

export const X192A3: Part = Object.freeze({
  name: 'x192a3',
  signatureReply: Object.freeze([0x44, 0x97, 0x1e]) as unknown as readonly [number, number, number],
  signature: '1E 97 44',
  pageBytes: 512,
  appBytes: 0x30000,
  bootStart: 0x30000,
  bootBytes: 0x2000,
  eepromBytes: 0x800,
  appTempStart: 0x18000,
  programId: 'XBoot++',
  bootloaderVersion: '17',
  baudRate: 115200,
});

/** Parts by name. Only one today; an unknown part is refused before anything is parsed. */
export function partByName(name: unknown): Part | null {
  return name === 'x192a3' ? X192A3 : null;
}

/** Number of flash pages in the application section. */
export function appPages(part: Part): number {
  return part.appBytes / part.pageBytes;
}
