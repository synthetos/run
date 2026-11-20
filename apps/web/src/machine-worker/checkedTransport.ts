/** The unmarked Connect's port, rechecked for a mark around its open (flashService.ts guardConnect). */
import type { PortSelector, Transport } from '@synthetos/machine';
import type { BootloaderMarks } from './bootloaderMark.ts';
import { BOOTLOADER_ADVICE } from './bootloaderAdvice.ts';

/**
 * `inner`, whose open refuses when a mark appeared: rechecked after acquiring the exclusive physical port, because
 * another tab may have flashed since the port was prepared.
 */
export function checkedTransport(port: PortSelector, inner: Transport, marks: BootloaderMarks, boardId?: string): Transport {
  return {
    info: () => inner.info(), readable: inner.readable, close: () => inner.close(),
    onDisconnect: callback => inner.onDisconnect(callback), writeLine: bytes => inner.writeLine(bytes),
    open: async options => {
      if (await marks.find(port, boardId)) throw new Error(BOOTLOADER_ADVICE);
      await inner.open(options);
      try {
        if (await marks.find(port, boardId)) throw new Error(BOOTLOADER_ADVICE);
      } catch (error) {
        await inner.close();
        throw error;
      }
    },
  };
}
