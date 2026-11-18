/**
 * Step 3's state (spec §6.3 step 3): what the connected board runs against what Run supports, decided by
 * firmware/updateOffer.ts and nothing else. `needed` (below what Run controls) cannot be skipped and holds Next
 * until the offer is gone (the update ran and the board came back on a supported build). Pure.
 */
import { updateOffer, type OfferInput, type UpdateOffer } from '../firmware/updateOffer.ts';
import { connected, type LiveView } from '../workspace/model.ts';

export type FirmwareState =
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'needed'; readonly offer: UpdateOffer }
  | { readonly kind: 'available'; readonly offer: UpdateOffer }
  | { readonly kind: 'current'; readonly fb: number | null };

/** The offer's input from the live view, as FirmwareOffer.ts builds it, with the wizard standing in for "showing". */
function offerInput(view: LiveView): OfferInput {
  const message = view.message ?? null;
  const flash = message?.flash ?? null;
  const hub = view.firmware ?? null;
  return {
    snapshot: message?.snapshot ?? null,
    flashing: flash !== null && flash.phase !== 'done' && flash.phase !== 'failed',
    flasher: message?.flasher === true,
    releases: hub !== null && hub.releases.ok ? hub.releases.list : null,
    onRunStep: false,
    fileOpen: false,
    messageUp: false,
    // The wizard is already on screen: a passing STALE overlay does not flip the step.
    showing: true,
  };
}

export function firmwareState(view: LiveView | null): FirmwareState {
  if (view === null || !connected(view)) return { kind: 'disconnected' };
  const offer = updateOffer(offerInput(view));
  if (offer !== null) return { kind: offer.kind, offer };
  const fb = view.message?.snapshot.identity?.fb;
  return { kind: 'current', fb: typeof fb === 'number' ? fb : null };
}

export function firmwareGate(s: FirmwareState): { readonly skippable: boolean; readonly nextEnabled: boolean } {
  return s.kind === 'needed' ? { skippable: false, nextEnabled: false } : { skippable: true, nextEnabled: true };
}
