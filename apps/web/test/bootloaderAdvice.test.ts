/** "The board may still be in its bootloader." is said once when a message and the advice are joined (owner report 2026-11-20). */
import { expect, it } from 'vitest';
import { BOOTLOADER_ADVICE, withAdvice } from '../src/machine-worker/bootloaderAdvice.ts';

const count = (text: string): number => text.split('may still be in its bootloader').length - 1;

it.each([
  'Cancelled before anything was written. The board may still be in its bootloader.',
  'The backups could not be saved (timeout), so nothing was written. The board may still be in its bootloader.',
  `Run could not verify that this board is safe to connect: ${BOOTLOADER_ADVICE}.`,
  'The bootloader did not answer.',
])('%s', (message) => {
  const joined = withAdvice(message);
  expect(count(joined)).toBe(1);
  expect(joined).toContain('Press Connect, then press Reset on the board when Run asks.');
});

it('a message that is only that sentence becomes the advice', () => {
  expect(withAdvice('The board may still be in its bootloader.')).toBe(BOOTLOADER_ADVICE);
});
