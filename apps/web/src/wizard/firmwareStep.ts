/**
 * Step 3's state (spec §6.3 step 3): what the connected board runs against what Run supports, decided by
 * firmware/updateOffer.ts and nothing else. `needed` (below what Run controls) cannot be skipped and holds Next
 * until the offer is gone (the update ran and the board came back on a supported build). `updating` covers the
 * flash itself: the session is closed while it runs, so the step keeps the flow on screen and holds Next until the
 * board is back and the offer has decided again. Pure.
 */
import { updateOffer, type OfferInput, type UpdateOffer } from '../firmware/updateOffer.ts';
import { connected, type LiveView } from '../workspace/model.ts';

export type FirmwareState =
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'updating' }
  | { readonly kind: 'needed'; readonly offer: UpdateOffer }
  | { readonly kind: 'available'; readonly offer: UpdateOffer }
  | { readonly kind: 'current'; readonly fb: number | null };

/** The offer's input from the live view, as FirmwareOffer.ts builds it, with the wizard standing in for "showing". */
function offerInput(view: LiveView): OfferInput {
  const message = view.message ?? null;
  const hub = view.firmware ?? null;
  return {
    snapshot: message?.snapshot ?? null,
    flashing: flashRunning(view),
    flasher: message?.flasher === true,
    releases: hub !== null && hub.releases.ok ? hub.releases.list : null,
    onRunStep: false,
    fileOpen: false,
    messageUp: false,
    // The wizard is already on screen: a passing STALE overlay does not flip the step.
    showing: true,
  };
}

function flashRunning(view: LiveView | null): boolean {
  const flash = view?.message?.flash ?? null;
  return flash !== null && flash !== undefined && flash.phase !== 'done' && flash.phase !== 'failed';
}

/** `updating`: "Update firmware" was pressed on this visit to the step (steps/Firmware.ts firmwareUpdating). */
export function firmwareState(view: LiveView | null, updating = false): FirmwareState {
  if (flashRunning(view)) return { kind: 'updating' };
  if (view === null || !connected(view)) return updating ? { kind: 'updating' } : { kind: 'disconnected' };
  const offer = updateOffer(offerInput(view));
  if (offer !== null) return { kind: offer.kind, offer };
  const fb = view.message?.snapshot.identity?.fb;
  return { kind: 'current', fb: typeof fb === 'number' ? fb : null };
}

export function firmwareGate(s: FirmwareState): { readonly skippable: boolean; readonly nextEnabled: boolean } {
  return s.kind === 'needed' || s.kind === 'updating' ? { skippable: false, nextEnabled: false } : { skippable: true, nextEnabled: true };
}
