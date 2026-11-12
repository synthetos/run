import { expect, it } from 'vitest';
import { browserBootloaderMarks, memoryBootloaderMarks, type BootloaderMark } from '../src/machine-worker/bootloaderMark.ts';
const port = { usbVendorId: 1027, usbProductId: 24597, grantIndex: 0 };
const mark: BootloaderMark = { nonce: 'one', port, boardId: 'A', recovery: { image: 'same' } };
it('matches the physical USB selector despite grant reorder, or the recorded board; only matching generations clear', async () => {
  const store = memoryBootloaderMarks();
  expect(await store.find(port)).toBeNull(); await store.put(mark);
  expect(await store.find({ ...port, grantIndex: 9 })).toEqual(mark);
  const other = { ...port, usbProductId: 1 };
  expect(await store.find(other)).toBeNull(); expect(await store.find(other, 'A')).toEqual(mark);
  await store.clear({ ...mark, nonce: 'old' }); expect(await store.find(port)).toEqual(mark);
  await store.clear(mark); expect(await store.find(port)).toBeNull();
});
it('fails closed when persistent storage is unavailable', async () => {
  const store = browserBootloaderMarks(() => { throw new Error('storage unavailable'); });
  await expect(store.find(port)).rejects.toThrow('storage unavailable');
  await expect(store.put(mark)).rejects.toThrow('storage unavailable');
});

it('does not overwrite another board with the same USB identity', async () => {
  const store = memoryBootloaderMarks(); await store.put(mark);
  const second = { ...mark, nonce: 'two', boardId: 'B' }; await store.put(second); await store.clear(second);
  expect(await store.find(port)).toEqual(mark);
});
