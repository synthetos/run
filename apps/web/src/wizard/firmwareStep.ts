/**
 * Step 3's state (spec §6.3 step 3): where the connected board stands against the verified release list
 * (firmware/updateOffer.ts firmwareStanding, the same rules as the offer), and whether the in-place update can run
 * now (updateOffer). `current` only when the list is loaded and names nothing newer for this hardware (owner,
 * 2026-11-18, picture 146: a withheld offer is not "current"). `needed` (below what Run controls) cannot be skipped
 * and holds Next, except on a site with no updater, where Skip stays. `updating` covers the flash itself: the
 * session is closed while it runs, so the step keeps the flow on screen and holds Next until the board is back.
 * Pure.
 */
import { boardAtRest, firmwareStanding, updateOffer, type OfferFacts, type OfferInput, type UpdateOffer } from '../firmware/updateOffer.ts';
import { connected, type LiveView } from '../workspace/model.ts';

/**
 * Why a newer release cannot be installed from the wizard right now, each with a line that is true for it (review
 * 2026-11-18: "not idle" only when the board is not at rest; anything else the offer waits on reads neutrally).
 */
export type HeldReason = 'no-updater' | 'flow-control' | 'unidentified' | 'busy' | 'read-only' | 'other';

export const HELD_TEXT: Readonly<Record<HeldReason, string>> = Object.freeze({
  'no-updater': 'Firmware updates are not available on this site.',
  'flow-control': 'Set ex to 1 (XON/XOFF) with another program, then connect again.',
  // The step's "Update firmware" button opens Board → Firmware for these (owner 168), so the text only says why.
  unidentified: 'Run could not identify this firmware.',
  busy: 'The machine is not idle. Update it once it is.',
  'read-only': 'This connection is read-only. Update it once the machine is idle.',
  other: '',
});

/** A newer (or required) release: the facts, the offer when it can run now, otherwise why not. */
interface Behind<K extends OfferFacts['kind']> { readonly kind: K; readonly facts: OfferFacts; readonly offer: UpdateOffer | null; readonly held: HeldReason | null }

export type FirmwareState =
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'updating' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'list-failed' }
  | { readonly kind: 'unlisted'; readonly hv: number | string }
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

/** The actual reason the offer is withheld, most specific first. */
function heldReason(view: LiveView, kind: OfferFacts['kind']): HeldReason {
  const message = view.message;
  if (message?.flasher !== true) return 'no-updater';
  const c = message.snapshot.classification;
  if (c?.reason === 'flowControl') return 'flow-control';
  if (c === null || c.dialectId === null) return 'unidentified';
  if (!boardAtRest(message.snapshot)) return 'busy';
  return kind === 'available' && c.mode !== 'full' ? 'read-only' : 'other';
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
  // The offer is up: the update runs here, and the step waits for it. Withheld for any reason: Skip stays, so the
  // person is never trapped on the step (review 2026-11-18). Skipping grants no control: the session and the
  // worker's old-firmware lock still refuse motion on a board below what Run controls.
  return { skippable: s.held !== null, nextEnabled: false };
}
