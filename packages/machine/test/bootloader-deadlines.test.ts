/**
 * Every call the bootloader link makes on its port has a deadline (owner report 2026-11-19: a tab stayed the
 * machine-lock holder). A wedged USB bridge can leave a write, an open or a close pending forever; the flash
 * service is busy, and holds the lock, until its awaits return. The link gives up after the deadline, fails the
 * operation, and never writes anything after a write that did not finish.
 */
import { expect, it, vi } from 'vitest';
import { X192A3 } from '@synthetos/flasher';
import { VirtualClock } from '@synthetos/testkit';
import { BOOTLOADER_CLOSE_MS, BOOTLOADER_OPEN_MS, BOOTLOADER_WRITE_MS, BootloaderLink } from '../src/bootloaderLink.ts';
import { LinkDeadline } from '../src/linkDeadline.ts';
import type { Transport } from '../src/transport.ts';

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

function port(stuck: { open?: boolean; write?: boolean; close?: boolean }): Transport & { writes: Uint8Array[]; closes: number } {
  const writes: Uint8Array[] = [];
  const t = {
    writes,
    closes: 0,
    info: () => ({ kind: 'sim' as const, usbVendorId: 0x0403, usbProductId: 0x6015 }),
    open: vi.fn(() => (stuck.open === true ? never<void>() : Promise.resolve())),
    writeLine: vi.fn((bytes: Uint8Array) => {
      writes.push(bytes);
      return stuck.write === true ? never<void>() : Promise.resolve();
    }),
    close: vi.fn(() => {
      t.closes++;
      return stuck.close === true ? never<void>() : Promise.resolve();
    }),
    onDisconnect: () => undefined,
    readable: { [Symbol.asyncIterator]: () => ({ next: () => never<IteratorResult<Uint8Array>>() }) },
  };
  return t;
}

/** Steps the virtual clock until `work` settles or `maxMs` passed; the settled value, or 'pending'. */
async function within<T>(clock: VirtualClock, work: Promise<T>, maxMs: number): Promise<{ value?: T; error?: unknown } | 'pending'> {
  let out: { value?: T; error?: unknown } | 'pending' = 'pending';
  work.then((value) => (out = { value }), (error: unknown) => (out = { error }));
  for (let t = 0; t <= maxMs && out === 'pending'; t += 50) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    clock.advance(50);
  }
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return out;
}

it('a write that never finishes fails after its deadline, and nothing is written after it', async () => {
  const clock = new VirtualClock();
  const wire = port({ write: true });
  const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe(true);
  const check = await within(clock, link.checkBootloader(), BOOTLOADER_WRITE_MS + 500);
  expect(check).not.toBe('pending');
  // A deadline, not an ordinary failure: the port is stuck and only unplugging frees it (Connect's advice says so).
  expect((check as { error?: unknown }).error).toBeInstanceOf(LinkDeadline);
  expect(wire.writes.map((b) => [...b])).toEqual([[0x1b]]);
  await expect(link.write(Uint8Array.of(0x1b))).rejects.toThrow();
  expect(wire.writes).toHaveLength(1);
});

it('close returns after its deadline even when the write in progress and the port close never finish', async () => {
  const clock = new VirtualClock();
  const wire = port({ write: true, close: true });
  const link = new BootloaderLink(wire, clock, X192A3);
  await link.openProbe(true);
  void link.write(Uint8Array.of(0x1b)).catch(() => undefined);
  const closed = await within(clock, link.close(), BOOTLOADER_WRITE_MS + BOOTLOADER_CLOSE_MS + 500);
  // False: the port did not close in time (stuck).
  expect(closed).toEqual({ value: false });
  expect(wire.closes).toBe(1);
  expect(link.closed).toBe(true);
});

it('a close that finishes in time returns true', async () => {
  const clock = new VirtualClock();
  const link = new BootloaderLink(port({}), clock, X192A3);
  await link.openProbe(true);
  expect(await within(clock, link.close(), BOOTLOADER_CLOSE_MS + 500)).toEqual({ value: true });
});

it('an open that never finishes fails after its deadline and asks the port to close', async () => {
  const clock = new VirtualClock();
  const wire = port({ open: true });
  const link = new BootloaderLink(wire, clock, X192A3);
  const opened = await within(clock, link.openProbe(true), BOOTLOADER_OPEN_MS + 500);
  expect(opened).not.toBe('pending');
  expect((opened as { error?: unknown }).error).toBeDefined();
  expect(link.closed).toBe(true);
  expect(wire.closes).toBe(1);
});
