/** A restore acknowledgement never carries position trust into a later workspace session. */
import type { DeviceSafetyStore } from '../live/deviceSafety.ts';
import { markLive } from '../live/liveMarker.ts';

export async function confirmFirmwareRestore(store: DeviceSafetyStore, confirm: () => Promise<string | null>): Promise<string | null> {
  // Persist before acknowledging: a closed/discarded updater must still make the workspace enter UNKNOWN.
  // The updater never clears this marker; the workspace's own clean-disconnect lifecycle owns that.
  await markLive(store, new Date());
  return confirm();
}
