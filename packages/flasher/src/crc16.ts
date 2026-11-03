/**
 * xboot's CRC (XB src/xboot.c:1269-1290 `crc16_block`): avr-libc's
 * `_crc16_update` (polynomial 0xA001, reflected 0x8005) from 0, over every
 * byte of a section, erased bytes included. `h` `A` answers it for the whole
 * application section, high byte first (XB src/xboot.c:591-626).
 */
export function crc16Update(crc: number, byte: number): number {
  let c = (crc ^ byte) & 0xffff;
  for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
  return c;
}

export function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) crc = crc16Update(crc, b);
  return crc;
}
