/**
 * Whether settings may be edited (made pending) at all, and the one notice a
 * read-only board gets (Board settings spec §5.3). Tightening only: a board
 * classified READ_ONLY, or whose dialect file is describe-only, refuses edits
 * here, so the pending store, Restore and the controls are all refused at the
 * source. Writing still needs the full gate (`settingsWriteBlocked`) and the
 * session's own checks.
 */
import { settingsDefsFor } from '@synthetos/schema';
import { UPDATE_FIXES } from '../../firmware/updateNeeded.ts';
import { fbText, newestRelease, numberOf } from '../../firmware/updateOffer.ts';
import { draftStore } from '../boardFacts.ts';
import type { LiveView } from '../model.ts';
import { SETTINGS_WRITES_UNAVAILABLE } from './pending.ts';

/** Whether a key is ever editable on a dialect (reviewed write entry, not forbidden). */
export { writableKey } from './pending.ts';

type Message = NonNullable<LiveView['message']>;

export const READING_BOARD = 'Reading the board…';
export const APPLY_RUNNING = 'Wait for the settings write to finish.';

function firmwareText(m: Message): string {
  const fb = numberOf(m.snapshot.identity?.fb);
  return fb === null ? 'this firmware' : `firmware ${fbText(fb)}`;
}

/** The board is classified read-only, is not fully approved, or its dialect file is describe-only. */
function readOnlyBoard(m: Message, readDialect: string | null): boolean {
  const s = m.snapshot;
  if (s.overlays.includes('READ_ONLY') || s.classification?.mode !== 'full') return true;
  const dialect = readDialect ?? s.classification.dialectId;
  return dialect !== null && settingsDefsFor(dialect, numberOf(s.identity?.fb) ?? undefined)?.mode === 'readOnly';
}

/**
 * Why settings cannot be made pending now, or null, from the last snapshot and the settings read: the one gate for
 * the controls and for every path that stages pending changes (Restore).
 */
export function editBlockedFor(m: Message | null, settings: Readonly<Record<string, unknown>>, readDialect: string | null): string | null {
  if (m === null || m.snapshot.base === 'NOT_CONNECTED') return 'Connect a board to change its settings.';
  if (m.settingsWrites !== true) return SETTINGS_WRITES_UNAVAILABLE;
  // Not classified yet: neutral and still locked, never "can't change" before the board is known (review finding 8).
  if (m.snapshot.classification === null) return READING_BOARD;
  if (readOnlyBoard(m, readDialect)) return `Run can't change settings on ${firmwareText(m)}.`;
  if (Object.keys(settings).length === 0) return 'Wait for the settings read to finish.';
  return null;
}

/** Apply is backing up or writing: verified keys leave the pending store when it ends (live/mount.ts). */
export function applyRunning(view: LiveView | null): boolean {
  return view?.apply.kind === 'backingUp' || view?.apply.kind === 'writing';
}

/** Why settings cannot be made pending now, or null. While Apply runs nothing is edited (review finding 9). */
export function editBlocked(view: LiveView | null): string | null {
  if (view === null) return editBlockedFor(null, {}, null);
  return editBlockedFor(view.message, view.readout.settings, view.readout.dialectId) ?? (applyRunning(view) ? APPLY_RUNNING : null);
}

function updateTarget(view: LiveView, m: Message): string | null {
  const releases = view.firmware?.releases;
  const hv = numberOf(m.snapshot.identity?.hv);
  const fb = numberOf(m.snapshot.identity?.fb);
  if (releases === undefined || !releases.ok || hv === null || fb === null) return null;
  const r = newestRelease(releases.list, hv, fb, true);
  return r === null ? null : fbText(r.fb);
}

/**
 * The pending changes the tabs plan with: none on a board Run can't change, so Inputs, Axes and Motors describe that
 * board as it is while leftover changes wait for Discard (review finding 4).
 */
export function plannedDrafts(view: LiveView | null): Readonly<Record<string, number>> {
  return readOnlyNotice(view) === null ? draftStore.value.value : {};
}

/** The one notice above the Board tabs when Run may not change settings here, or null. */
export function readOnlyNotice(view: LiveView | null): { readonly text: string; readonly update: boolean } | null {
  const m = view?.message ?? null;
  if (view === null || m === null || m.snapshot.base === 'NOT_CONNECTED') return null;
  if (m.settingsWrites !== true) return { text: 'Changing settings is not turned on here.', update: false };
  if (m.snapshot.classification === null || !readOnlyBoard(m, view.readout.dialectId)) return null;
  const head = `Run can't change settings on ${firmwareText(m)}. You can see every setting and back them up.`;
  if (!updateHelps(m)) return { text: head, update: false };
  const target = updateTarget(view, m);
  return { text: `${head} ${target === null ? 'Update the firmware to change them here.' : `Update to ${target} to change them here.`}`, update: true };
}

/** A listed TinyG release fixes it: stock 449, an unapproved TinyG build, or 440 (describe-only here). */
function updateHelps(m: Message): boolean {
  const c = m.snapshot.classification;
  return c !== null && (UPDATE_FIXES.includes(c.reason) || c.dialectId === 'tinyg-440');
}
