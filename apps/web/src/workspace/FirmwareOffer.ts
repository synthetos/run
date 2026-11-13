import { DialogWrap } from './dialogs/DialogWrap.ts';
/**
 * The "Firmware update available" modal (owner, 2026-11-09; firmware/updateOffer.ts decides when). Go to update
 * opens Board → Firmware on that release (nothing is downloaded or flashed from here: the hub asks C6 as always);
 * For an approved board, Not now hides it for this page and "Don't show again" remembers board/version.
 * Update-needed boards get Not now for this connection only, without a persistent dismissal.
 * Centred below the machine strip like every confirmation (OD-16): Pause and Stop job stay uncovered.
 */
import { h, type ComponentChild } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { offerText, fbText, updateOffer } from '../firmware/updateOffer.ts';
import { dismissOffer, offerDismissed } from '../firmware/offerMemory.ts';
import { boardTab, releaseRequest, viewRequest } from './boardNavigation.ts';
import { jobStep } from './jobWorkflow.ts';
import { currentFile } from './fileBridge.ts';
import type { WorkspaceModel } from './model.ts';
import type { TabRole } from '../live/tabStop.ts';
import { belowStrip, focusOnMount } from './ui.ts';

export interface FirmwareOfferProps {
  readonly model: WorkspaceModel | null;
  /** This tab's observer role and LIVE state: W29 (a released lock) is a machine message the offer waits behind. */
  readonly role: TabRole | null;
  readonly live: boolean;
}

export function FirmwareOffer({ model, role, live }: FirmwareOfferProps): ComponentChild {
  const view = model?.live.value ?? null;
  const message = view?.message ?? null;
  const hub = view?.firmware ?? null;
  const flash = message?.flash ?? null;
  const [later, setLater] = useState<readonly string[]>([]);
  const [, setDismissedNow] = useState(0);
  // Once shown, a passing STALE overlay does not unmount it (it flickered on a loaded computer, and a press could miss it).
  const showing = useRef(false);
  const offer = updateOffer({
    showing: showing.current,
    flasher: message?.flasher === true,
    snapshot: message?.snapshot ?? null,
    flashing: flash !== null && flash.phase !== 'done' && flash.phase !== 'failed',
    releases: hub !== null && hub.releases.ok ? hub.releases.list : null,
    onRunStep: jobStep.value === 'run',
    fileOpen: currentFile.value !== null,
    messageUp: role !== null && !live && role.released.length > 0,
  });
  if (offer === null) {
    showing.current = false;
    return null;
  }
  const version = fbText(offer.release.fb);
  const key = offer.kind === 'needed' ? `needed#${offer.epoch}#${offer.boardId}` : `${offer.boardId}:${version}`;
  if (later.includes(key) || (offer.kind === 'available' && offerDismissed(offer.boardId, version))) {
    showing.current = false;
    return null;
  }
  showing.current = true;
  const close = (): void => setLater((l) => [...l, key]);
  return h(
    DialogWrap,
    { class: 'dialog-wrap confirm-modal', role: 'presentation', setup: belowStrip, onDismiss: close },
    h(
      'div',
      { class: 'dialog motion-confirm firmware-offer', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'firmware-offer-title', 'data-region': 'firmware-offer' },
      h('h2', { id: 'firmware-offer-title', class: 'firmware-offer-title' }, offer.kind === 'needed' ? 'Firmware update needed' : 'Firmware update available'),
      h('p', { 'data-firmware-offer': 'text' }, offerText(offer)),
      h(
        'div',
        { class: 'motion-confirm-actions' },
        offer.kind === 'needed' ? null : h(
          'button',
          {
            type: 'button',
            class: 'small quiet-link',
            'data-action': 'firmware-offer-never',
            onClick: () => {
              dismissOffer(offer.boardId, version);
              close();
              setDismissedNow((n) => n + 1);
            },
          },
          'Don’t show again for this version',
        ),
        h('button', { type: 'button', class: 'small', 'data-action': 'firmware-offer-later', ref: focusOnMount, onClick: close }, 'Not now'),
        h(
          'button',
          {
            type: 'button',
            class: 'small primary',
            'data-action': 'firmware-offer-go',
            onClick: () => {
              close();
              boardTab.value = 'firmware';
              releaseRequest.value = offer.release.file;
              viewRequest.value = 'board';
            },
          },
          'Go to update',
        ),
      ),
    ),
  );
}
