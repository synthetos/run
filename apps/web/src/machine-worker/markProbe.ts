/**
 * A marked board whose firmware may be running (owner report 2026-11-21, TinyG v8 3Y2462-WWR at 449.01).
 *
 * A board marked "may be in its bootloader" gets only the AVR109 check first (ESC, then S, no line end). A running
 * TinyG stays silent to that: it waits for a line end. Run used to treat that silence as "maybe the bootloader" for
 * ever, so it never sent the line end or `{"boot":1}` that would have reached the board (a deadlock).
 *
 * So after a silent AVR109 check, Run sends exactly one line end (0x0A), and only that:
 * - xboot in command mode: 0x0A is no AVR109 command. xboot answers `?` and does nothing (XB tg-xboot e607778
 *   src/xboot.c:816-829; the command letters are in src/protocol.h:42-91, none is 0x0A; `@` and `#` exist only in I2C
 *   builds). It is never `e` (erase), `l` (lock bits), `D`/`B…E` (EEPROM) or a flash write. The hardened xboot counts
 *   it as one stray byte, below its limit of 2 (conf/x192a3.mk:85); reaching the limit would only reset the board
 *   into the entry window.
 * - xboot in its entry window: only ESC enters; every other byte is read and dropped (src/xboot.c:287-297 with
 *   ENTER_UART_NEED_SYNC = yes, conf/x192a3.mk:26).
 * - The firmware: it ends the line `ESC S` already in its buffer and answers it (an error reply in JSON mode, the
 *   `tinyg [mm]` prompt in text mode). That answer proves the firmware runs (packages/machine applicationAnswer.ts).
 * The firmware session's "?" plus a line end was considered: after `ESC S` the firmware sees `ESC S ?` (no status
 * request), and `?` would switch a TinyG to text mode. The line end alone proves as much and changes nothing.
 *
 * Proven: the board id the session then reads decides the mark, as a banner's id does (markedConnect.ts
 * `bannerClears`). Not proven: the existing AVR109-only behaviour stands (listen for the banner; press Reset).
 */
import type { BootloaderLink } from '@synthetos/machine';
import type { BootloaderMark, BootloaderMarks } from './bootloaderMark.ts';
import { bannerClears } from './markedConnect.ts';

/**
 * The AVR109 check's wait on a marked board. xboot answers S at once: 7 bytes take 0.6 ms at 115200 baud, and the
 * FTDI bridge's 16 ms latency timer and USB scheduling add a few tens of ms. 1 s is many times that, so silence is
 * a real answer; and it is short, because a person may be waiting at Connect.
 */
export const MARKED_CHECK_MS = 1000;

/**
 * The wait for the firmware's answer to the line end. TinyG answers a line within a few ms (one main-loop pass); the
 * same USB delays apply. 1 s again: plenty of margin, and silence then keeps the existing behaviour.
 */
export const APP_PROBE_MS = 1000;

/** The AVR109 check (MARKED_CHECK_MS on a marked board, the link's default otherwise): true when xboot answered. */
export function avr109Check(link: BootloaderLink, marked: boolean): Promise<boolean> {
  return marked ? link.checkBootloader(MARKED_CHECK_MS) : link.checkBootloader();
}

/** After a silent AVR109 check: the one line end. True when the firmware answered (it runs). */
export function firmwareAnswers(link: BootloaderLink): Promise<boolean> {
  return link.probeApplication(APP_PROBE_MS);
}

/** The firmware answered and the session read board id `id`: clear the mark when it is that board's (true). */
export async function settleProbedMark(marks: BootloaderMarks, mark: BootloaderMark, id: string | undefined): Promise<boolean> {
  const cleared = bannerClears(mark, id === undefined ? null : { id });
  if (cleared) await marks.clear(mark);
  return cleared;
}
