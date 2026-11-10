/**
 * "Firmware update available" (owner, 2026-11-09): after a connect, when the signed release list (the one Board →
 * Firmware shows) names a newer approved release for this board's hardware, the page offers it once.
 *
 * Only the verified, signed list counts: never an unsigned or custom build. It is never offered while anything
 * moves or may move (a job, a hold, homing, a jog, an alarm, an update in progress), never over another machine
 * message, and never over the Job view's Run step while a job is loaded there: it waits until that is over.
 *
 * Pure. The page decides what "Not now" and "Don't show again" remember (offerMemory.ts).
 */
import { releasesForHardware, type FirmwareRelease, type FirmwareReleases } from '@synthetos/protocol';
import type { SnapshotMessage } from '../machine-worker/rpc.ts';

type Snapshot = SnapshotMessage['snapshot'];

export interface OfferInput {
  readonly snapshot: Snapshot | null;
  /** An update is in progress (the flash view is not done or failed). */
  readonly flashing: boolean;
  /** The verified signed release list, or null while it is loading or when it could not be verified. */
  readonly releases: FirmwareReleases | null;
  /** The Job view's Run step is showing. */
  readonly onRunStep: boolean;
  /** A file is open in the Job view (it goes to the board to be checked, and can be started). */
  readonly fileOpen: boolean;
  /** Another machine message is up that is not an overlay (W29, a released lock): the offer waits behind it. */
  readonly messageUp: boolean;
  /** The offer is already on screen: a passing STALE overlay (late status reports on a busy computer) does not take it down. */
  readonly showing?: boolean;
}

export interface UpdateOffer {
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

function numberOf(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** The newest approved release newer than what the board runs, when it is a good moment to say so; else null. */
export function updateOffer(input: OfferInput): UpdateOffer | null {
  const s = input.snapshot;
  if (s === null || input.releases === null || input.flashing || input.messageUp) return null;
  const overlays = input.showing === true ? s.overlays.filter((o) => o !== 'STALE') : s.overlays;
  if (!AT_REST.has(s.base) || s.motion !== null || overlays.length > 0) return null;
  const jobOn = s.job !== null && !JOB_OVER.has(s.job.phase);
  // A job in progress waits; so does the Run step with a file open or a job loaded (a start may be under way).
  if ((jobOn && s.job?.phase !== 'ready') || (input.onRunStep && (input.fileOpen || jobOn))) return null;
  const id = s.identity?.id;
  const hv = numberOf(s.identity?.hv);
  const fb = numberOf(s.identity?.fb);
  if (typeof id !== 'string' || id === '' || hv === null || fb === null) return null;
  const newer = (releasesForHardware(input.releases, hv)?.releases ?? []).filter((r) => hundredths(r.fb) > hundredths(fb));
  if (newer.length === 0) return null;
  const release = newer.reduce((a, b) => (hundredths(b.fb) > hundredths(a.fb) ? b : a));
  return { boardId: id, current: fb, release };
}

/** The modal's body: "This board runs 450.02. 451.00 is released." */
export function offerText(offer: UpdateOffer): string {
  return `This board runs ${fbText(offer.current)}. ${fbText(offer.release.fb)} is released.`;
}
