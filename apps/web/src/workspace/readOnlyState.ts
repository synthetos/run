/**
 * A read-only session in a few words (owner, 2026-11-18, pictures 149 and 150: "this text trails off", "another
 * text runon"): the strip's pill and text, the Position card's title and line, and the short phrase refusals use.
 * The long sentence (readOnlyWhy.ts) stays available in the card's "?". When a listed TinyG release fixes it, the
 * words say "Update required" and name the target from the verified release list. Words only: nothing here changes
 * what Run allows. Pure.
 */
import type { FirmwareReleases } from '@synthetos/protocol';
import type { SnapshotMessage } from '../machine-worker/rpc.ts';
import { UPDATE_FIXES } from '../firmware/updateNeeded.ts';
import { fbText, newestRelease, numberOf } from '../firmware/updateOffer.ts';

type Snapshot = SnapshotMessage['snapshot'];

const UPDATE = 'Update required';

/** A build or hardware number, also when the board reports it as text (review 2026-11-18). */
const num = numberOf;
const fbOf = (s: Snapshot): string => {
  const fb = num(s.identity?.fb);
  return fb === null ? 'unknown' : fbText(fb);
};
const capital = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** A listed TinyG release fixes this read-only session (stock 449, an unapproved TinyG build). */
export function updateFixes(s: Snapshot): boolean {
  return UPDATE_FIXES.includes(s.classification?.reason ?? '');
}

/** The newest supported release for this board's hardware, as "450.06", or null without the list. */
function target(s: Snapshot, releases: FirmwareReleases | null): string | null {
  const hv = num(s.identity?.hv);
  const fb = num(s.identity?.fb);
  if (releases === null || hv === null || fb === null) return null;
  const release = newestRelease(releases, hv, fb, true);
  return release === null ? null : fbText(release.fb);
}

/** The strip's pill: two words at most. */
export function readOnlyPill(s: Snapshot): string {
  if (updateFixes(s)) return UPDATE;
  switch (s.classification?.reason) {
    case 'flowControl': return 'Flow control';
    case 'g2core-unknown-build': return 'Unknown build';
    case 'probeFailed':
    case 'conflict': return 'Not identified';
    case 'g2core-read-only': return 'Read only';
    default: return 'Not approved';
  }
}

/** The state as a short phrase, lowercase and without a full stop (refusals read "Read only: <phrase>."). */
export function readOnlyPhrase(s: Snapshot): string {
  if (updateFixes(s)) return `firmware ${fbOf(s)} needs an update`;
  const ex = s.live.ex;
  switch (s.classification?.reason) {
    case 'flowControl': return ex === undefined ? 'flow control (ex) not read' : `flow control ex = ${ex} is not supported`;
    // Not "g2core boards are read only": refusals read "Read only: …", which would say it twice (review 2026-11-18).
    case 'g2core-read-only': return 'Run does not control g2core yet';
    case 'g2core-unknown-build': return `unknown g2core build ${fbOf(s)}`;
    case 'probeFailed': return 'board identity not read';
    case 'conflict': return 'firmware not identified';
    default: return `firmware ${fbOf(s)} is not approved`;
  }
}

/** The strip's text: what fits beside the pill at 1280 (at most 36 characters), never a sentence that trails off. */
export function readOnlyStrip(s: Snapshot, releases: FirmwareReleases | null): string {
  if (!updateFixes(s)) return capital(readOnlyPhrase(s));
  const to = target(s, releases);
  return to === null ? `Firmware ${fbOf(s)} · update required` : `Firmware ${fbOf(s)} → ${to}`;
}

/** The Position card's title, and its one short line when an update fixes it (other cards keep their own lines). */
export function readOnlyCard(s: Snapshot, releases: FirmwareReleases | null): { readonly title: string; readonly line: string | null } {
  if (updateFixes(s)) {
    const to = target(s, releases);
    return { title: UPDATE, line: `${fbOf(s)} is read only in Run. ${to === null ? 'Install the newest release.' : `Install ${to}.`}` };
  }
  switch (s.classification?.reason) {
    case 'flowControl': return { title: s.live.ex === undefined ? 'Flow control not read' : 'Flow control not supported', line: null };
    case 'g2core-read-only': return { title: 'g2core is read only', line: null };
    case 'g2core-unknown-build': return { title: 'Unknown g2core build', line: null };
    case 'probeFailed':
    case 'conflict': return { title: 'Board not identified', line: null };
    default: return { title: 'Firmware not approved', line: null };
  }
}
