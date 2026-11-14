import { expect, it, vi } from 'vitest';
import { confirmFirmwareRestore } from '../src/update/restoreConfirmation.ts';
import { memoryDeviceSafety } from '../src/live/deviceSafety.ts';
import { previousSessionEnded } from '../src/live/liveMarker.ts';
it('commits the workspace UNKNOWN marker before confirming a firmware restore', async () => {
  const store = memoryDeviceSafety();
  expect(await previousSessionEnded(store, false)).toBe(false);
  expect(await confirmFirmwareRestore(store, async () => {
    expect(await previousSessionEnded(store, false)).toBe(true);
    return null;
  })).toBeNull();
});
it('does not confirm if the durable marker cannot be saved', async () => {
  const store = memoryDeviceSafety();
  vi.spyOn(store, 'set').mockRejectedValue(new Error('storage unavailable'));
  const confirm = vi.fn(async () => null);
  await expect(confirmFirmwareRestore(store, confirm)).rejects.toThrow('storage unavailable');
  expect(confirm).not.toHaveBeenCalled();
});
