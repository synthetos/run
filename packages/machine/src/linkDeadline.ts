/**
 * Deadlines for the bootloader link's calls on its port (owner report 2026-11-19). A wedged USB bridge can leave
 * a write, an open or a close pending forever. The flash service is busy, and its worker holds the machine lock,
 * until its awaits return, so each port call gives up after a deadline instead. Giving up never cancels the call
 * (there is no abort on the machine path): the port finishes it, or fails it when the cable is pulled.
 */
import { DEFAULT_TIMINGS, LinkClosed, type FlasherClock } from '@synthetos/flasher';

/**
 * One frame. The largest bootloader-role frame is a 512-byte page block, about 45 ms on the wire at 115200 baud
 * (xboot client timings). `blockWriteMs` already allows a page for transfer, erase and write together, so a frame
 * that has not even left the host by then is stuck.
 */
export const BOOTLOADER_WRITE_MS = DEFAULT_TIMINGS.blockWriteMs;

/**
 * Opening the port. It runs inside xboot's entry window, which the flash run allows 10 s (`entryMs`, the same as
 * the firmware banner wait). An open that takes longer has missed the window anyway.
 */
export const BOOTLOADER_OPEN_MS = 10_000;

/**
 * Closing the port. The close drains at most the one frame in progress, so it gets one frame's deadline. After
 * that the close goes on in the background; the link is already closed for Run.
 */
export const BOOTLOADER_CLOSE_MS = DEFAULT_TIMINGS.blockWriteMs;

/** The port's close, waited for at most `BOOTLOADER_CLOSE_MS`; it goes on in the background after that. Never rejects. */
export function closePort(port: { close(): Promise<void> }, clock: FlasherClock): Promise<void> {
  return withDeadline(port.close(), BOOTLOADER_CLOSE_MS, clock, 'closing the port').catch(() => undefined);
}

/** A port call that passed its deadline. It is a `LinkClosed`: the link is treated as gone. */
export class LinkDeadline extends LinkClosed {}

/** `work`, or a `LinkDeadline` rejection naming `what` once `ms` passed. The timer is cleared either way. */
export function withDeadline<T>(work: Promise<T>, ms: number, clock: FlasherClock, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = clock.setTimeout(() => reject(new LinkDeadline(`${what} did not finish within ${ms} ms`)), ms);
    work.then(
      (value) => {
        clock.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clock.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
