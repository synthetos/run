/**
 * Probe Z (SAFETY §4.5c, H90): what the page reads of the session's probe view (`SessionSnapshot.probeZ`; `probe` is
 * the identification progress). The session decides every command again; this only keeps the card honest about
 * what it will allow.
 */
import type { ProbeBlock, ProbeSnapshot } from '../../machine-worker/probeShared.ts';
import type { LiveView } from '../model.ts';

/** How far `Lift Z` raises the tool after a probe, mm (the ordinary jog, on the owner's press only). */
export const LIFT_MM = 5;

interface ProbeViewBase {
  /** The board's id, for the last plate thickness used on it. */
  readonly boardId: string | null;
}

/** Nothing blocks Probe Z: the session's probe view is there. Or why it can't run, with the view when there is one. */
export type ProbeView =
  | (ProbeViewBase & { readonly block: null; readonly probe: ProbeSnapshot })
  | (ProbeViewBase & { readonly block: ProbeBlock; readonly probe: ProbeSnapshot | null });

function isProbeSnapshot(v: unknown): v is ProbeSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['step'] === 'string' && typeof o['touch'] === 'object' && o['touch'] !== null && typeof o['plateOut'] === 'boolean';
}

/** The probe view on the snapshot (`probeZ`), or null until the session publishes one. */
export function probeSnapshotOf(snapshot: unknown): ProbeSnapshot | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const o = snapshot as Record<string, unknown>;
  const probeZ = o['probeZ'];
  return isProbeSnapshot(probeZ) ? probeZ : null;
}

export function probeView(view: LiveView | null): ProbeView {
  const message = view?.message ?? null;
  const s = message?.snapshot ?? null;
  if (message === null || s === null || s.base === 'NOT_CONNECTED') return Object.freeze({ block: 'notConnected', probe: null, boardId: null });
  const boardId = s.identity?.id ?? null;
  const probe = probeSnapshotOf(s);
  // Until the session publishes its probe view, or without the motion release, nothing can probe.
  if (probe === null || message.motion !== true) return Object.freeze({ block: 'motionOff', probe, boardId });
  return Object.freeze(probe.block === null ? { block: null, probe, boardId } : { block: probe.block, probe, boardId });
}
