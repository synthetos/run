/**
 * One firmware flash, from the bootloader entry to the exit (SAFETY §4.8 as
 * amended 2026-11-03, H79-H88).
 *
 * Steps, in order; each reports progress:
 * 1. `enter`: ESC and `S` until xboot answers (the 60 s window after
 *    `{"boot":1}`, or the 4.8 s window in recovery).
 * 2. `identify`: program id, version, chip signature (the part check: the
 *    image is for the x192a3, and so is the chip), block size.
 * 3. `backup`: the raw EEPROM (2 KB) and the whole application section
 *    (192 KB, the firmware image backup). Then `backupsReady` is called with
 *    both, and NOTHING is written until it resolves: the page stores them
 *    (and the settings backup taken before the bootloader) first. The link
 *    is kept awake meanwhile. If it rejects, the run leaves the bootloader
 *    untouched in command mode: no exit is sent without a verified write.
 * 4. `write`: the stub page 0, then pages N..1 that differ (plan.ts).
 * 5. `verify`: every page read back and compared; a page that differs is
 *    written again (at most twice), then read back again.
 * 6. `final`: the real page 0, read back.
 * 7. `crc`: xboot's CRC of the whole section must equal the image's.
 * 8. `exit`: `E`; the board starts the new firmware.
 *
 * A lost or damaged reply is retried after a resync (client.ts), at most
 * `retries` times per step and `maxResyncs` times per run; a write is
 * idempotent (xboot erases the page first), a read is repeated. A refusal
 * (`?`), the wrong chip or bootloader, or a link that closed ends the run at
 * once. Cancel is honoured only before step 4.
 *
 * The run never sends `e` (avr109.ts) and never addresses the boot section
 * (plan.ts, FrameGuard).
 */
import { XbootClient, XbootError, sleep, type Identity } from './client.ts';
import { crc16 } from './crc16.ts';
import type { FlashPlan, PageWrite } from './plan.ts';

export type FlashPhase = 'enter' | 'identify' | 'backup' | 'saving' | 'write' | 'verify' | 'final' | 'crc' | 'exit' | 'done' | 'failed';

export interface FlashProgress {
  readonly phase: FlashPhase;
  /** Bytes (backup, verify) or pages (write) done in this phase. */
  readonly done: number;
  readonly of: number;
  readonly note?: string;
}

export interface FlashBackups {
  readonly eeprom: Uint8Array;
  /** The whole application section as read from the board. */
  readonly flash: Uint8Array;
  readonly crc: number;
}

export interface FlashHooks {
  readonly onProgress: (progress: FlashProgress) => void;
  /** The backups were read; resolve once they are stored. Nothing is written before. */
  readonly backupsReady: (backups: FlashBackups) => Promise<void>;
  /** True when the user cancelled (honoured only before the first write). */
  readonly cancelled?: () => boolean;
  /** Called right before the first page is written (the point of no return). */
  readonly beforeFirstWrite?: () => void;
}

export interface FlashOptions {
  /** How long to try to enter the bootloader. */
  readonly entryMs: number;
  readonly retries?: number;
  readonly maxResyncs?: number;
}

export type FlashOutcome =
  | {
      readonly ok: true;
      readonly identity: Identity;
      readonly written: number;
      readonly unchanged: number;
      readonly resyncs: number;
      readonly crc: number;
    }
  | {
      readonly ok: false;
      readonly phase: FlashPhase;
      readonly code: XbootError['code'] | 'cancelled' | 'backup-not-saved' | 'verify-failed' | 'crc-mismatch';
      readonly message: string;
      /** True once any page was written: the board may hold no complete application. */
      readonly wrote: boolean;
      readonly backups: FlashBackups | null;
    };

class Cancelled extends Error {}
class BackupNotSaved extends Error {}

/** Run the flash described by `plan`. Never throws. */
export async function runFlash(client: XbootClient, plan: FlashPlan, hooks: FlashHooks, options: FlashOptions): Promise<FlashOutcome> {
  const part = plan.part;
  const retries = options.retries ?? 3;
  const maxResyncs = options.maxResyncs ?? 8;
  let resyncs = 0;
  let phase: FlashPhase = 'enter';
  let wrote = false;
  let backups: FlashBackups | null = null;
  let identity: Identity | null = null;
  const progress = (p: FlashProgress): void => {
    phase = p.phase;
    hooks.onProgress(p);
  };

  const asError = (error: unknown): XbootError => (error instanceof XbootError ? error : new XbootError('unexpected', String(error)));
  const retryable = (e: XbootError): boolean => e.code === 'timeout' || e.code === 'unexpected';

  /** Run `step`, resyncing and retrying on a lost or damaged reply. */
  const attempt = async <T>(step: () => Promise<T>): Promise<T> => {
    for (let tryNo = 0; ; tryNo++) {
      try {
        return await step();
      } catch (error) {
        const e = asError(error);
        if (!retryable(e) || tryNo >= retries) throw e;
        // Resync until the bootloader answers again (each try counts against the run's limit).
        for (;;) {
          if (resyncs >= maxResyncs) throw e;
          resyncs++;
          hooks.onProgress({ phase, done: 0, of: 0, note: `no answer (${e.message}); waiting for the bootloader to restart, then trying again` });
          try {
            await client.resync();
            // A board that reset during the write phase runs the stub: it is back in the bootloader.
            identity = await client.identify();
            break;
          } catch (again) {
            const a = asError(again);
            if (!retryable(a) && a.code !== 'no-entry') throw a;
          }
        }
      }
    }
  };

  try {
    progress({ phase: 'enter', done: 0, of: 1 });
    await client.enter(options.entryMs);
    progress({ phase: 'identify', done: 0, of: 1 });
    identity = await attempt(() => client.identify());

    progress({ phase: 'backup', done: 0, of: part.eepromBytes + part.appBytes });
    const eeprom = await attempt(() => client.readEeprom(0, part.eepromBytes));
    const flash = await attempt(() => client.readFlash(0, part.appBytes, (done) => hooks.onProgress({ phase: 'backup', done: part.eepromBytes + done, of: part.eepromBytes + part.appBytes })));
    backups = Object.freeze({ eeprom, flash, crc: crc16(flash) });
    if (hooks.cancelled?.() === true) throw new Cancelled();
    progress({ phase: 'saving', done: 0, of: 1 });
    try {
      await client.keepAlive(hooks.backupsReady(backups));
    } catch (error) {
      if (error instanceof XbootError) throw error;
      throw new BackupNotSaved(error instanceof Error ? error.message : String(error));
    }
    if (hooks.cancelled?.() === true) throw new Cancelled();

    // The point of no return: from here the board may hold no complete application until `final`.
    const pages: PageWrite[] = [plan.stub, ...plan.body];
    hooks.beforeFirstWrite?.();
    wrote = true;
    for (const [i, p] of pages.entries()) {
      progress({ phase: 'write', done: i, of: pages.length + 1 });
      await attempt(() => client.writePage(p.byteAddress, p.data));
    }

    // Verify everything but the real page 0, which the stub stands in for.
    const expected = (index: number): Uint8Array => (index === 0 ? plan.stub.data : plan.target.subarray(index * part.pageBytes, (index + 1) * part.pageBytes));
    const total = part.appBytes / part.pageBytes;
    let bad = await verifyPages(client, attempt, part.pageBytes, [...Array(total).keys()], expected, (done) => hooks.onProgress({ phase: 'verify', done, of: total }));
    for (let round = 0; bad.length > 0 && round < 2; round++) {
      hooks.onProgress({ phase: 'verify', done: total - bad.length, of: total, note: `${bad.length} page(s) read back differently; writing them again` });
      for (const index of bad) await attempt(() => client.writePage(index * part.pageBytes, expected(index)));
      bad = await verifyPages(client, attempt, part.pageBytes, bad, expected, () => undefined);
    }
    if (bad.length > 0) {
      return { ok: false, phase: 'verify', code: 'verify-failed', message: `${bad.length} page(s) still read back differently after rewriting (first at 0x${((bad[0] as number) * part.pageBytes).toString(16)}). The board stays in the bootloader; try again.`, wrote, backups };
    }

    progress({ phase: 'final', done: pages.length, of: pages.length + 1 });
    await attempt(() => client.writePage(plan.final.byteAddress, plan.final.data));
    let finalBad = await verifyPages(client, attempt, part.pageBytes, [0], (i) => (i === 0 ? plan.final.data : expected(i)), () => undefined);
    if (finalBad.length > 0) {
      await attempt(() => client.writePage(plan.final.byteAddress, plan.final.data));
      finalBad = await verifyPages(client, attempt, part.pageBytes, [0], () => plan.final.data, () => undefined);
      if (finalBad.length > 0) return { ok: false, phase: 'final', code: 'verify-failed', message: 'Page 0 reads back differently after writing it twice.', wrote, backups };
    }

    progress({ phase: 'crc', done: 0, of: 1 });
    const want = crc16(plan.target);
    const got = await attempt(() => client.crcApplication());
    if (got !== want) {
      return { ok: false, phase: 'crc', code: 'crc-mismatch', message: `The bootloader's checksum of the application (0x${got.toString(16)}) is not the image's (0x${want.toString(16)}).`, wrote, backups };
    }

    progress({ phase: 'exit', done: 0, of: 1 });
    await client.exit(); // After exit, stay silent: a lost ACK must not provoke resync traffic.
    progress({ phase: 'done', done: 1, of: 1 });
    return { ok: true, identity: identity as Identity, written: pages.length + 1, unchanged: plan.unchanged.length, resyncs, crc: want };
  } catch (error) {
    if (error instanceof Cancelled || error instanceof BackupNotSaved) {
      // A failed/interrupted attempt stays in the bootloader; only a verified image may exit.
      const cancelled = error instanceof Cancelled;
      hooks.onProgress({ phase: 'failed', done: 0, of: 0 });
      return {
        ok: false,
        phase,
        code: cancelled ? 'cancelled' : 'backup-not-saved',
        message: cancelled ? 'Cancelled before anything was written. The board may still be in its bootloader.' : `The backups could not be saved (${error.message}), so nothing was written. The board may still be in its bootloader.`,
        wrote: false,
        backups,
      };
    }
    const e = error instanceof XbootError ? error : new XbootError('unexpected', String(error));
    hooks.onProgress({ phase: 'failed', done: 0, of: 0, note: e.message });
    return { ok: false, phase, code: e.code, message: e.message, wrote, backups };
  }
}

async function verifyPages(
  client: XbootClient,
  attempt: <T>(step: () => Promise<T>) => Promise<T>,
  pageBytes: number,
  pages: readonly number[],
  expected: (index: number) => Uint8Array,
  onDone: (done: number) => void,
): Promise<number[]> {
  const bad: number[] = [];
  for (const [i, index] of pages.entries()) {
    const got = await attempt(() => client.readFlash(index * pageBytes, pageBytes));
    const want = expected(index);
    if (!got.every((b, k) => b === want[k])) bad.push(index);
    onDone(i + 1);
  }
  return bad;
}

/**
 * Recovery entry (SAFETY H80): the board has no running application, so
 * `{"boot":1}` cannot be sent. The user unplugs and replugs USB (or presses
 * reset) while run sends ESC and `S` repeatedly; xboot then waits about 4.8 s
 * for ESC (XB src/xboot.c:236-246). Resolves once xboot answers, or rejects
 * with `no-entry` after `deadlineMs`. `onTick` reports the seconds left.
 */
export async function recoverEntry(client: XbootClient, clockNow: () => number, deadlineMs: number, onTick: (secondsLeft: number) => void, pause: (ms: number) => Promise<void>): Promise<void> {
  const start = clockNow();
  let lastTick = -1;
  while (clockNow() - start < deadlineMs) {
    const left = Math.max(0, Math.ceil((deadlineMs - (clockNow() - start)) / 1000));
    if (left !== lastTick) {
      lastTick = left;
      onTick(left);
    }
    try {
      await client.enter(Math.min(1000, deadlineMs - (clockNow() - start)));
      return;
    } catch (error) {
      if (error instanceof XbootError && error.code === 'closed') throw error;
    }
    await pause(10);
  }
  throw new XbootError('no-entry', 'The bootloader did not answer. Unplug the USB cable and plug it back in, then try again.');
}

export { sleep };
