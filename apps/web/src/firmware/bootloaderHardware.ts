import type { FirmwareReleases } from '@synthetos/protocol';

/** Only real hardware in the verified signed list may be chosen without a live board identity. */
export function bootloaderHardwareVersions(list: FirmwareReleases | null): readonly number[] {
  return list?.boards.filter(board => board.hv !== 99 && board.releases.some(release => !release.simulatorOnly)).map(board => board.hv) ?? [];
}
