/**
 * Pending settings changes (SAFETY §4.6, amendment 2026-11-02): the edits a
 * user made in the Board and Machines views, kept in this browser (the
 * `board-draft.v1` store), compared with the board, and the gate that decides
 * whether the settings controls are enabled.
 *
 * The controls are enabled only when the settings-write phase switch is on
 * in this worker (bench and staging), the board is approved (not READ_ONLY),
 * no overlay but NEEDS_REVIEW is active, the board is identified and read,
 * and it reports itself idle with nothing moving or held. The machine
 * session checks all of this again, with fresh polled reads, before every
 * single write: this gate only keeps the controls honest.
 */
import { isForbiddenKey, planSettingsWrite, settingsSchemaFor, type SettingsPlan } from '@synthetos/schema';
import { connected, type LiveView } from '../model.ts';
import { draftStore } from '../boardFacts.ts';

/** True when `key` can be edited on this dialect: a reviewed overlay entry and not a forbidden write. */
export function writableKey(key: string, dialect: string | null): boolean {
  if (dialect === null) return false;
  try {
    const schema = settingsSchemaFor(dialect);
    if (schema.mode !== 'writable' || isForbiddenKey(schema.forbidden, key)) return false;
    return schema.settings.get(key)?.overlay !== undefined;
  } catch {
    return false;
  }
}

const OVERLAY_WORDS: Readonly<Record<string, string>> = {
  FAULT: 'A fault is latched. Settings stay locked until it is cleared.',
  LOST: 'The connection was lost. Reconnect to change settings.',
  ORPHANED_MOTION: 'The board has motion left from a previous session. Stop it first; settings stay locked.',
  UNKNOWN: 'The last session ended without a clean disconnect, so the machine state is not trusted. Settings stay locked for this connection; disconnect and connect again.',
  STALE: 'The board has stopped answering. Settings stay locked until it answers again.',
};

/** Why the settings controls are disabled now, in plain words, or null when they may be used. */
export function settingsWriteBlocked(view: LiveView | null): string | null {
  const m = view?.message ?? null;
  if (view === null || m === null || !connected(view)) return 'Connect a board to change its settings.';
  if (m.settingsWrites !== true) return 'Changing settings is not turned on in this build. Production stays read-only for now.';
  const s = m.snapshot;
  for (const o of ['LOST', 'FAULT', 'ORPHANED_MOTION', 'UNKNOWN', 'STALE'] as const) if (s.overlays.includes(o)) return OVERLAY_WORDS[o] as string;
  if (s.classification === null || s.base === 'IDENTIFYING' || s.base === 'READING') return 'Wait until the board is identified and read.';
  if (s.base === 'BLOCKED') return 'This board is not the machine you selected.';
  if (s.overlays.includes('READ_ONLY') || s.classification.mode !== 'full') return 'This board is read-only here: its firmware build is not approved for changes.';
  if (s.base !== 'CONNECTED_UNKNOWN') return 'Settings are changed only while the machine is idle.';
  const cls = s.live.machineClass;
  if (cls !== undefined && cls !== 'idle' && cls !== 'end') return `The machine is ${cls}. Settings are changed only while it is idle.`;
  if (s.live.vel !== undefined && s.live.vel !== 0) return 'The machine is moving. Settings are changed only while it is idle.';
  if (s.live.hold !== undefined && s.live.hold !== 0) return 'The machine is holding. Settings are changed only while it is idle.';
  if (view.readout.phase.kind === 'reading') return 'Wait for the settings read to finish.';
  if (Object.keys(view.readout.settings).length === 0) return 'Wait for the settings read to finish.';
  return null;
}

/** The pending changes as a screened, ordered plan against the board's last read. */
export function pendingPlan(view: LiveView | null): SettingsPlan | null {
  const dialect = view?.readout.dialectId ?? null;
  const drafts = draftStore.value.value;
  if (dialect === null || Object.keys(drafts).length === 0) return null;
  return planSettingsWrite(
    dialect,
    Object.entries(drafts).map(([key, value]) => ({ key, value })),
    view?.readout.settings ?? {},
  );
}
