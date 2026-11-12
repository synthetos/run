/** Display-only checks for the update-needed offer; never grants control or permission to flash. */
import { belowMinimum, dialectById, mapStat, type FirmwareReleases } from '@synthetos/protocol';
import type { SnapshotMessage } from '../machine-worker/rpc.ts';
type Snapshot = SnapshotMessage['snapshot'];

export function firmwareNeeded(s: Snapshot, releases: FirmwareReleases, hv: number, fb: number): boolean {
  return belowMinimum(releases, hv, fb).below ||
    (s.classification?.mode === 'readOnly' && ['en-not-approved', 'tg440-not-approved', 'stock-449'].includes(s.classification.reason));
}

/** A read-only session can stay CONNECTED_UNKNOWN even when the controller is alarmed. */
export function neededOfferAtRest(s: Snapshot): boolean {
  const dialect = s.classification?.dialectId == null ? null : dialectById(s.classification.dialectId);
  if (dialect == null || s.live.stat === undefined) return false;
  const state = mapStat(dialect, s.live.stat);
  return (state === 'idle' || state === 'end') && s.live.vel === 0 &&
    s.live.qr === dialect.limits.plannerBlocks && (s.live.hold === undefined || s.live.hold === 0);
}
