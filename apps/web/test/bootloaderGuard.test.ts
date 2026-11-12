import { expect, it, vi } from 'vitest';
import type { Transport } from '@synthetos/machine';
import { PHASE_1_RELEASE } from '@synthetos/safety';
import { VirtualClock } from '@synthetos/testkit';
import { MachineWorkerHost } from '../src/machine-worker/host.ts';
import { memoryBootloaderMarks } from '../src/machine-worker/bootloaderMark.ts';
const port = { usbVendorId: 1027, usbProductId: 24597, grantIndex: 0 };
const mark = { nonce: 'one', port, boardId: 'A', recovery: {} };
const platform = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130' };
const request = { v: 3, kind: 'open', port, boardId: null, previousSessionEnded: false };
function wire(): Transport {
  return { info: () => ({ kind: 'sim', ...port }), open: vi.fn(async () => undefined), close: vi.fn(async () => undefined), writeLine: vi.fn(async () => undefined), onDisconnect: () => undefined, readable: { async *[Symbol.asyncIterator]() { /* no board */ } } };
}
it('storage failure refuses normal connection before any port open or byte', async () => {
  const transport = wire(); const marks = memoryBootloaderMarks();
  marks.find = async () => { throw new Error('blocked storage'); };
  const host = new MachineWorkerHost({ kind: 'fake', request: async () => transport }, new VirtualClock(), platform, null, PHASE_1_RELEASE, marks);
  expect(await host.handle(request)).toMatchObject({ ok: false });
  expect(transport.open).not.toHaveBeenCalled(); expect(transport.writeLine).not.toHaveBeenCalled();
});
it.each(['before open', 'after open'])('a mark created by another tab %s closes the normal-open race', async when => {
  const transport = wire(); const marks = memoryBootloaderMarks();
  const original = marks.find; let reads = 0;
  marks.find = async (p, id) => {
    if (++reads === (when === 'before open' ? 2 : 3)) await marks.put(mark);
    return original(p, id);
  };
  const host = new MachineWorkerHost({ kind: 'fake', request: async () => transport }, new VirtualClock(), platform, null, PHASE_1_RELEASE, marks);
  expect(await host.handle(request)).toMatchObject({ ok: false });
  expect(transport.writeLine).not.toHaveBeenCalled();
  if (when === 'after open') expect(transport.close).toHaveBeenCalled();
  else expect(transport.open).not.toHaveBeenCalled();
});
it('Close cancels an unopened connection while the transport lookup is pending', async () => {
  const transport = wire(); let resolve!: (t: Transport) => void;
  const host = new MachineWorkerHost({ kind: 'fake', request: () => new Promise<Transport>(r => { resolve = r; }) }, new VirtualClock(), platform, null, PHASE_1_RELEASE, memoryBootloaderMarks());
  const opening = host.handle(request);
  await host.handle({ v: 3, kind: 'close' }); resolve(transport);
  expect(await opening).toMatchObject({ ok: false });
  expect(transport.open).not.toHaveBeenCalled(); expect(transport.writeLine).not.toHaveBeenCalled();
});
