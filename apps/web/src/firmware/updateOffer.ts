/**
 * "Firmware update available" (owner, 2026-11-09): after a connect, when the GitHub release list (the one Board →
 * Firmware shows) names a newer approved release for this board's hardware, the page offers it once.
 * Unapproved/below-minimum TinyG boards instead get an update-needed offer for the newest listed release.
 *
 * Only the validated list counts: never an unsigned or custom build. It is never offered while anything
 * moves or may move (a job, a hold, homing, a jog, an alarm, an update in progress), never over another machine
 * message, and never over the Job view's Run step while a job is loaded there: it waits until that is over.
 *
 * Pure. The page decides what "Not now" and "Don't show again" remember (offerMemory.ts).
 */
import { releasesForHardware, supportsFirmware, type FirmwareRelease, type FirmwareReleases } from '@synthetos/protocol';
import { firmwareNeeded, neededOfferAtRest } from './updateNeeded.ts';
import type { SnapshotMessage } from '../machine-worker/rpc.ts';

type Snapshot = SnapshotMessage['snapshot'];

export interface OfferInput {
  readonly snapshot: Snapshot | null;
  /** An update is in progress (the flash view is not done or failed). */
  readonly flashing: boolean;
  /** This site exposes the firmware update flow. */
  readonly flasher: boolean;
  /** The verified GitHub release list, or null while it is loading or when it could not be verified. */
  readonly releases: FirmwareReleases | null;
  /** The Job view's Run step is showing. */
  readonly onRunStep: boolean;
  /** A file is open in the Job view (it goes to the board to be checked, and can be started). */
  readonly fileOpen: boolean;
  /** Another machine message is up that is not an overlay (W29, a released lock): the offer waits behind it. */
  readonly messageUp: boolean;
  /** The available offer is already on screen: a passing STALE overlay (late status reports on a busy computer) does not take it down. */
  readonly showing?: boolean;
}

export interface UpdateOffer {
  readonly kind: 'available' | 'needed';
  readonly epoch: number;
  readonly boardId: string;
  readonly current: number;
  readonly release: FirmwareRelease;
}

/** Bases at rest: anything else (a job, a hold, homing, a jog, an alarm, a stop) waits. */
const AT_REST: ReadonlySet<string> = new Set(['IDLE_UNHOMED', 'IDLE_HOMED', 'CONNECTED_UNKNOWN']);
/** Job phases that are over: a job in any other phase keeps the Run step busy. */
const JOB_OVER: ReadonlySet<string> = new Set(['done', 'stopped', 'failed', 'blocked']);

/** A build number as the hub writes it: 451 → "451.00". */
export function fbText(fb: number): string {
  return fb.toFixed(2);
}

const hundredths = (fb: number): number => Math.round(fb * 100);

/** A number the board may report as text ("8", "450.02"), or null. */
export function numberOf(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** The board is at rest: a resting base, nothing moving, and no job under way (the offer's own quiet-moment test). */
export function boardAtRest(s: Snapshot): boolean {
  const jobOn = s.job !== null && !JOB_OVER.has(s.job.phase) && s.job.phase !== 'ready';
  return AT_REST.has(s.base) && s.motion === null && !jobOn;
}

/** A listed release at a quiet moment: newest for an update-needed board, newer for an approved board. */
export function updateOffer(input: OfferInput): UpdateOffer | null {
  const s = input.snapshot;
  if (s === null || input.releases === null || !input.flasher || input.flashing || input.messageUp) return null;
  const classification = s.classification;
  if (classification === null || !['tinyg-en', 'tinyg-440', 'tinyg-449-stock'].includes(classification.dialectId ?? '') || classification.reason === 'flowControl') return null;
  const jobOn = s.job !== null && !JOB_OVER.has(s.job.phase);
  // A job in progress waits; so does the Run step with a file open or a job loaded (a start may be under way).
  if ((jobOn && s.job?.phase !== 'ready') || (input.onRunStep && (input.fileOpen || jobOn))) return null;
  const id = s.identity?.id;
  const hv = numberOf(s.identity?.hv);
  const fb = numberOf(s.identity?.fb);
  if (typeof id !== 'string' || id === '' || hv === null || fb === null) return null;
  const needed = firmwareNeeded(s, input.releases, hv, fb);
  const overlays = s.overlays.filter(o => !(needed && o === 'READ_ONLY') && !(input.showing === true && !needed && o === 'STALE'));
  if (!AT_REST.has(s.base) || s.motion !== null || overlays.length > 0 || (needed && !neededOfferAtRest(s))) return null;
  if (!needed && classification.mode !== 'full') return null;
  const release = newestRelease(input.releases, hv, fb, needed);
  if (release === null) return null;
  return { kind: needed ? 'needed' : 'available', epoch: s.epoch, boardId: id, current: fb, release };
}

/** What an offer says, without the moment it may be shown: the setup wizard shows these facts even when it is not. */
export type OfferFacts = Pick<UpdateOffer, 'kind' | 'current' | 'release'>;

/** The newest listed, supported release for this hardware: any for an update-needed board, newer ones otherwise. */
export function newestRelease(releases: FirmwareReleases, hv: number, fb: number, needed: boolean): FirmwareRelease | null {
  const candidates = (releasesForHardware(releases, hv)?.releases ?? []).filter(r => r.unavailable === undefined && (r.simulatorOnly || supportsFirmware(r.dialect, r.fb)) && (needed || hundredths(r.fb) > hundredths(fb)));
  return candidates.length === 0 ? null : candidates.reduce((a, b) => (hundredths(b.fb) > hundredths(a.fb) ? b : a));
}

/** Where the board stands against the list, whatever it is doing: null until its hardware and build are read. */
export type FirmwareStanding = OfferFacts | { readonly kind: 'current'; readonly fb: number } | { readonly kind: 'unlisted'; readonly hv: number };

/**
 * The same rules as `updateOffer` (firmwareNeeded, newestRelease) without its "only at a quiet moment" checks: a
 * board on a build the offer withholds right now is still behind, never current (owner, 2026-11-18, picture 146).
 */
export function firmwareStanding(s: Snapshot, releases: FirmwareReleases): FirmwareStanding | null {
  const hv = numberOf(s.identity?.hv);
  const fb = numberOf(s.identity?.fb);
  if (hv === null || fb === null) return null;
  if (releasesForHardware(releases, hv) === null) return { kind: 'unlisted', hv };
  const needed = firmwareNeeded(s, releases, hv, fb);
  const release = newestRelease(releases, hv, fb, needed);
  if (release === null) return needed ? { kind: 'unlisted', hv } : { kind: 'current', fb };
  return { kind: needed ? 'needed' : 'available', current: fb, release };
}

/** Plain display text; the update flow still performs its own checks. */
export function offerText(offer: OfferFacts): string {
  if (offer.kind === 'needed') return `Run can't control firmware ${fbText(offer.current)}. Install ${fbText(offer.release.fb)}, the newest release Run supports.`;
  return `This board runs ${fbText(offer.current)}. ${fbText(offer.release.fb)} is released.`;
}
