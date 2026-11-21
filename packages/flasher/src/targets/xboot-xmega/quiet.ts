/**
 * Line discipline for AVR109: the host knows which command a reply belongs
 * to only by counting bytes, so the line must hold nothing but the reply it
 * is waiting for.
 *
 * - `assertQuiet`, before every command: any byte already waiting was sent
 *   at nobody's request (a late reply, a reply to a garbled byte, a
 *   duplicate). It is a hard stop (`desync`) and the command is not sent.
 * - `drainUntilQuiet`, after the bootloader entry: entry sends ESC and `S`
 *   until one `XBoot++` comes back, so replies to earlier tries can still be
 *   on their way (late through the USB bridge), and a garbled ESC is
 *   answered `?`. They are dropped until the line has been silent for
 *   `quietMs`. Whatever was still due was sent before the reply the entry
 *   read, so it follows within one link latency (an FTDI latency timer of
 *   16 ms plus the browser's delivery); `quietMs` is many times that. The
 *   drain gives up after `maxMs` of continuous noise: xboot's watchdog
 *   (WDT_PER_1KCLK, about 1 s from an inaccurate 1 kHz oscillator) runs from
 *   the last byte it read, so `maxMs + quietMs` stays well under it.
 */
import { LinkTimeout, type ByteLink, type FlasherClock } from '../../core/link.ts';
import { XbootError, hex, toXbootError } from './errors.ts';

/** Throws `desync`, naming the bytes, when anything is waiting on the line. */
export function assertQuiet(link: ByteLink, before: string): void {
  const waiting = link.discardInput();
  if (waiting.length === 0) return;
  throw new XbootError('desync', `xboot sent ${waiting.length} byte(s) nobody asked for before ${before} (${hex(waiting.subarray(0, 16))}): the replies are out of step, so nothing more is sent`);
}

/** Drops input until the line has been silent for `quietMs`; `desync` when it is still busy after `maxMs`. Returns the bytes dropped. */
export async function drainUntilQuiet(link: ByteLink, clock: FlasherClock, quietMs: number, maxMs: number): Promise<number> {
  const start = clock.now();
  let dropped = 0;
  for (;;) {
    dropped += link.discardInput().length;
    if (clock.now() - start >= maxMs) throw new XbootError('desync', `the line did not go quiet within ${maxMs} ms of the bootloader entry (${dropped} bytes): nothing more is sent`);
    try {
      dropped += (await link.read(1, quietMs)).length;
    } catch (error) {
      if (error instanceof LinkTimeout) return dropped;
      throw toXbootError(error);
    }
  }
}
