/**
 * Connect's bootloader pre-check cannot leave the flash service busy (owner report 2026-11-19). While it is busy
 * the worker holds the machine lock, refuses Connect and Disconnect, and the tab is the stuck holder. A port that
 * never finishes a write or a close, or safety storage that never answers, must end in the failed-flash state:
 * the unplug advice (and the Recovery card for a quarantined board), nothing normal sent, the port asked to close
 * and the busy flag clear.
 */
import { expect, it, vi } from 'vitest';
import type { Transport } from '@synthetos/machine';
import { PHASE_1_RELEASE } from '@synthetos/safety';
import { VirtualClock } from '@synthetos/testkit';
import { MachineWorkerHost } from '../src/machine-worker/host.ts';
import { memoryBootloaderMarks, type BootloaderMarks } from '../src/machine-worker/bootloaderMark.ts';
import { BOOTLOADER_ADVICE } from '../src/machine-worker/bootloaderAdvice.ts';

const port = { usbVendorId: 1027, usbProductId: 24597, grantIndex: 0 };
const platform = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130' };
const request = { v: 3, kind: 'open', port, boardId: null, previousSessionEnded: false };
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
/** The longest any bounded step may take, with margin: well under a minute of virtual time. */
const LIMIT_MS = 60_000;

function stuckWire(): Transport & { writes: Uint8Array[] } {
  const writes: Uint8Array[] = [];
  return {
    writes,
    info: () => ({ kind: 'sim', ...port }),
    open: vi.fn(async () => undefined),
    close: vi.fn(() => never<void>()),
    writeLine: vi.fn((bytes: Uint8Array) => {
      writes.push(bytes);
      return never<void>();
    }),
    onDisconnect: () => undefined,
    readable: { [Symbol.asyncIterator]: () => ({ next: () => never<IteratorResult<Uint8Array>>() }) },
  };
}

async function settle<T>(clock: VirtualClock, work: Promise<T>): Promise<T | 'pending'> {
  let out: T | 'pending' = 'pending';
  void work.then((value) => (out = value));
  for (let t = 0; t <= LIMIT_MS && out === 'pending'; t += 50) {
    for (let i = 0; i < 30; i++) await Promise.resolve();
    clock.advance(50);
  }
  for (let i = 0; i < 30; i++) await Promise.resolve();
  return out;
}

function host(wire: Transport, clock: VirtualClock, marks: BootloaderMarks = memoryBootloaderMarks()): MachineWorkerHost {
  return new MachineWorkerHost({ kind: 'fake', request: async () => wire }, clock, platform, null, PHASE_1_RELEASE, marks);
}

it('a pre-check write that never finishes refuses Connect with the unplug advice, clears busy and closes the port', async () => {
  const clock = new VirtualClock();
  const wire = stuckWire();
  const h = host(wire, clock);
  const reply = await settle(clock, h.handle(request));
  expect(reply).toMatchObject({ ok: false });
  expect(JSON.stringify(reply)).toContain(BOOTLOADER_ADVICE);
  expect(h.flash.busy).toBe(false);
  expect(wire.close).toHaveBeenCalled();
  // Only the ESC of the pre-check went out: no S after it, no line end, no JSON.
  expect(wire.writes.map((b) => [...b])).toEqual([[0x1b]]);
});

it('a quarantined board whose pre-check write never finishes keeps its failed-flash view with the unplug advice', async () => {
  const clock = new VirtualClock();
  const wire = stuckWire();
  const marks = memoryBootloaderMarks();
  const saved = { id: 1, phase: 'failed', done: 3, of: 10, note: null, source: 'release', target: { fb: 450.06, label: '450.06', sha256: 'x' }, boardId: 'A', board: { id: 'A', hv: 8, fb: 449.01, fv: 0.97 }, countdown: null, wrote: true, message: null, recoveryOffered: true, versionCheck: null, result: null };
  await marks.put({ nonce: 'n', kind: 'failed', port, boardId: 'A', recovery: { begin: null, view: saved } });
  const h = host(wire, clock, marks);
  expect(await settle(clock, h.handle(request))).toMatchObject({ ok: false });
  expect(h.flash.busy).toBe(false);
  expect(h.flash.view).toMatchObject({ phase: 'failed', wrote: true, message: BOOTLOADER_ADVICE });
  expect(wire.writes.map((b) => [...b])).toEqual([[0x1b]]);
});

it('safety storage that never answers refuses Connect before the port is opened, and clears busy', async () => {
  const clock = new VirtualClock();
  const wire = stuckWire();
  const marks = memoryBootloaderMarks();
  marks.find = () => never();
  const h = host(wire, clock, marks);
  expect(await settle(clock, h.handle(request))).toMatchObject({ ok: false });
  expect(h.flash.busy).toBe(false);
  expect(wire.open).not.toHaveBeenCalled();
  expect(wire.writes).toEqual([]);
});
