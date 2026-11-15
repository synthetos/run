/** Resolve public release metadata without granting machine-control support. */
import { releasesForHardware, type FirmwareReleases } from '@synthetos/protocol';
import type { FlashSource } from '@synthetos/flasher';
export type FlashSourceRequest =
  | { readonly kind: 'release'; readonly hv: number; readonly fb: number; readonly file: string }
  | { readonly kind: 'backup'; readonly boardId: string; readonly fb: number | null }
  | { readonly kind: 'custom'; readonly name: string; readonly confirmed: boolean };

export async function resolveFlashSource(req: FlashSourceRequest, load: () => Promise<FirmwareReleases | null>): Promise<FlashSource | null> {
  if (req.kind === 'release') {
    const hw = releasesForHardware(await load(), req.hv);
    const release = hw?.releases.find(r => r.file === req.file && r.fb === req.fb && r.unavailable === undefined);
    return release === undefined ? null : { kind: 'release', release };
  }
  if (req.kind === 'backup') return { kind: 'backup', boardId: req.boardId, fb: req.fb };
  return { kind: 'custom', confirmed: req.confirmed === true, name: req.name };
}
export function flashSourceLabel(source: FlashSource): string {
  if (source.kind === 'release') return `${source.release.fb.toFixed(2)} (${source.release.simulatorOnly ? 'simulated image' : 'GitHub release'})`;
  if (source.kind === 'backup') return `the firmware backup${source.fb === null ? '' : ` (${source.fb.toFixed(2)})`}`;
  return `${source.name} (unsigned custom firmware)`;
}
