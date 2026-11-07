/**
 * Probe Z (SAFETY §4.5c, H90): what the page reads of the session's probe view. The one place that finds
 * `ProbeSnapshot` on the snapshot, so a renamed field is a one-line change. The session decides every command
 * again; this only keeps the card honest about what it will allow.
 */
import type { ProbeBlock, ProbeSnapshot } from '@synthetos/machine';
import type { LiveView } from '../model.ts';

/** How far `Lift Z` raises the tool after a probe, mm (the ordinary jog, on the owner's press only). */
export const LIFT_MM = 5;

export interface ProbeView {
  /** Why Probe Z cannot run now, or null. */
  readonly block: ProbeBlock | null;
  /** The session's probe view, or null before it publishes one. */
  readonly probe: ProbeSnapshot | null;
  /** The board's id, for the last plate thickness used on it. */
  readonly boardId: string | null;
}

function isProbeSnapshot(v: unknown): v is ProbeSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['step'] === 'string' && typeof o['touch'] === 'object' && o['touch'] !== null && typeof o['plateOut'] === 'boolean';
}

/** The probe view on the snapshot, or null. `probe` is also the identification progress, told apart by shape. */
export function probeSnapshotOf(snapshot: unknown): ProbeSnapshot | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const o = snapshot as Record<string, unknown>;
  for (const key of ['probeZ', 'probe']) if (isProbeSnapshot(o[key])) return o[key];
  return null;
}

export function probeView(view: LiveView | null): ProbeView {
  const message = view?.message ?? null;
  const s = message?.snapshot ?? null;
  if (message === null || s === null || s.base === 'NOT_CONNECTED') return Object.freeze({ block: 'notConnected', probe: null, boardId: null });
  const boardId = s.identity?.id ?? null;
  const probe = probeSnapshotOf(s);
  // Until the session publishes its probe view, or without the motion release, nothing can probe.
  if (probe === null || message.motion !== true) return Object.freeze({ block: 'motionOff', probe, boardId });
  return Object.freeze({ block: probe.block, probe, boardId });
}
