/**
 * Step 3's state (spec §6.3 step 3): where the connected board stands against the verified release list
 * (firmware/updateOffer.ts firmwareStanding, the same rules as the offer), and whether the in-place update can run
 * now (updateOffer). `current` only when the list is loaded and names nothing newer for this hardware (owner,
 * 2026-11-18, picture 146: a withheld offer is not "current"). `needed` (below what Run controls) cannot be skipped
 * and holds Next, except on a site with no updater, where Skip stays. `updating` covers the flash itself: the
 * session is closed while it runs, so the step keeps the flow on screen and holds Next until the board is back.
 * Pure.
 */
import { firmwareStanding, updateOffer, type OfferFacts, type OfferInput, type UpdateOffer } from '../firmware/updateOffer.ts';
import { connected, type LiveView } from '../workspace/model.ts';

/** Why a newer release cannot be installed from the wizard right now. */
export type HeldReason = 'no-updater' | 'busy' | 'read-only';

export const HELD_TEXT: Readonly<Record<HeldReason, string>> = Object.freeze({
  'no-updater': 'Firmware updates are not available on this site.',
  busy: 'The machine is not idle. Update from Board → Firmware once it is.',
  'read-only': 'This connection is read-only. Update from Board → Firmware once the machine is idle.',
});

/** A newer (or required) release: the facts, the offer when it can run now, otherwise why not. */
interface Behind<K extends OfferFacts['kind']> { readonly kind: K; readonly facts: OfferFacts; readonly offer: UpdateOffer | null; readonly held: HeldReason | null }

export type FirmwareState =
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'updating' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'list-failed' }
  | { readonly kind: 'unlisted'; readonly hv: number }
  | Behind<'needed'>
  | Behind<'available'>
  | { readonly kind: 'current'; readonly fb: number };

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

function heldReason(view: LiveView, kind: OfferFacts['kind']): HeldReason {
  if (view.message?.flasher !== true) return 'no-updater';
  return kind === 'available' && view.message.snapshot.classification?.mode !== 'full' ? 'read-only' : 'busy';
}

/** A connected board: the list decides where it stands; the offer decides whether the update can run now. */
function connectedState(view: LiveView): FirmwareState {
  const releases = view.firmware?.releases ?? null;
  if (releases === null) return { kind: 'checking' };
  if (!releases.ok) return { kind: 'list-failed' };
  const snapshot = view.message?.snapshot ?? null;
  const standing = snapshot === null ? null : firmwareStanding(snapshot, releases.list);
  if (standing === null) return { kind: 'checking' };
  if (standing.kind === 'current' || standing.kind === 'unlisted') return standing;
  const offer = updateOffer(offerInput(view));
  const held = offer === null ? heldReason(view, standing.kind) : null;
  return standing.kind === 'needed' ? { kind: 'needed', facts: offer ?? standing, offer, held } : { kind: 'available', facts: offer ?? standing, offer, held };
}

/** `updating`: "Update firmware" was pressed on this visit to the step (steps/Firmware.ts firmwareUpdating). */
export function firmwareState(view: LiveView | null, updating = false): FirmwareState {
  if (flashRunning(view)) return { kind: 'updating' };
  if (view === null || !connected(view)) return updating ? { kind: 'updating' } : { kind: 'disconnected' };
  return connectedState(view);
}

export function firmwareGate(s: FirmwareState): { readonly skippable: boolean; readonly nextEnabled: boolean } {
  if (s.kind === 'updating') return { skippable: false, nextEnabled: false };
  if (s.kind !== 'needed') return { skippable: true, nextEnabled: true };
  // A site with no updater can never clear `needed`: Skip stays so the person is not trapped on the step.
  return { skippable: s.held === 'no-updater', nextEnabled: false };
}
