/**
 * What a site-wide "Update firmware" does (owner 169-170, 2026-11-19): it reaches the update itself, Board → Firmware
 * → Update with the recommended release's flow started, as that release row's own button does. The flow fetches and
 * checks the image, then C6 asks; nothing is written before C6 and its ticks. `updateStart` is null whenever that
 * could not start now (no updater on this site, the release list not loaded, C6, an image download, an update or its
 * settings check already showing, or the row's own reasons), so a button that would do nothing is not drawn.
 */
import type { FirmwareRelease } from '@synthetos/protocol';
import { confirmsOpen } from '../firmware/FlashViews.ts';
import { firmwareStanding } from '../firmware/updateOffer.ts';
import { openFirmwareUpdate, startFirmwareUpdate, viewRequest } from './boardNavigation.ts';
import type { LiveView } from './model.ts';
import { flashBlocked } from './views/FirmwareViews.ts';

/** An update or its settings check owns the Update part (views/board/firmwareTabs.ts uses the same rule). */
export function updateBusy(view: LiveView | null): boolean {
  const m = view?.message ?? null;
  const flash = m?.flash ?? null;
  const post = m?.postFlash ?? null;
  return (flash !== null && flash.phase !== 'done' && flash.phase !== 'failed') || (post !== null && post.phase !== 'clear');
}

function downloading(view: LiveView): boolean {
  const phase = view.firmware?.download?.phase;
  return phase === 'fetching' || phase === 'checking';
}

/** Nothing else owns the Update part now: no C6, no update or settings check, no download, nothing blocking a flash. */
function freeNow(view: LiveView): boolean {
  return confirmsOpen.value === 0 && !updateBusy(view) && !downloading(view) && flashBlocked(view) === null;
}

/** The release a site-wide Update firmware starts, or null when nothing can act right now. */
export function updateStart(view: LiveView | null): FirmwareRelease | null {
  const m = view?.message ?? null;
  const releases = view?.firmware?.releases ?? null;
  if (view === null || m === null || m.flasher !== true || releases === null || !releases.ok || !freeNow(view)) return null;
  const standing = firmwareStanding(m.snapshot, releases.list);
  return standing !== null && (standing.kind === 'needed' || standing.kind === 'available') ? standing.release : null;
}

/** The Position card's, the Run step's and the wizard's Update firmware: start it when it can, else open the page. */
export function goToUpdate(view: LiveView | null): void {
  const release = updateStart(view);
  if (release !== null) return startFirmwareUpdate(release.file);
  openFirmwareUpdate();
  viewRequest.value = 'board';
}
