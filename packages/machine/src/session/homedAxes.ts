/**
 * Which axes this connection saw homed by a homing cycle (independent review 2026-11-08, S2; OD-23, OD-24).
 *
 * The board's `home` is 1 once the axes with homing switches are homed, and after a G28.3 (set machine position by
 * hand) as well; on edge-next a machine without an X switch reports `home` 1 after a Y and Z homing. So "the position
 * is known" is decided per axis: an axis counts only when a homing cycle this connection sent named it and the
 * read-back after it says that axis homed (`hom`), and until a G28.3 sets it by hand. The list lives in the session's
 * notices, which end with the link. It is also emptied when the board may have lost its homing within the
 * connection (re-review 2026-11-09, S1): a FAULT (and the reset behind it), a shutdown or panic (edge-next's
 * cm_shutdown unhomes every axis), or a read of `home` that shows 0; a read of `hom` drops each axis it shows at 0.
 *
 * Pure functions over the reducer's transition.
 */
import type { JogAxis, SessionState } from './types.ts';

interface NoticeTx {
  s: SessionState;
  set(patch: Partial<SessionState>): void;
}

function homReads(s: SessionState): Readonly<Record<string, unknown>> {
  const v = s.values['hom'];
  return v !== undefined && v.status === 0 && typeof v.value === 'object' && v.value !== null ? (v.value as Readonly<Record<string, unknown>>) : {};
}

/** A homing cycle of `axes` ended and its read-back is in: the axes it says homed are known from now on. */
export function noteHomed(t: NoticeTx, axes: readonly JogAxis[]): void {
  const hom = homReads(t.s);
  const now = new Set(t.s.notices.homedAxes ?? []);
  for (const a of axes) if (hom[a] === 1) now.add(a);
  t.set({ notices: { ...t.s.notices, homedAxes: [...now] } });
}

/** A G28.3 set `axes` here by hand: they are no longer known from a homing. */
export function noteSetByHand(t: NoticeTx, axes: readonly JogAxis[]): void {
  const now = (t.s.notices.homedAxes ?? []).filter((a) => !axes.includes(a));
  t.set({ notices: { ...t.s.notices, homedAxes: now } });
}

/** The board may have lost its homing (a FAULT, a reset, a shutdown or panic): no axis is known from a homing now. */
export function forgetHomed(t: NoticeTx): void {
  if ((t.s.notices.homedAxes ?? []).length > 0) t.set({ notices: { ...t.s.notices, homedAxes: [] } });
}

/** A read of `home` or `hom` was answered: a `home` of 0 forgets every axis, a `hom` forgets each axis it shows at 0. */
export function noteHomingRead(t: NoticeTx, token: string, status: number, value: unknown): void {
  if (status !== 0) return;
  if (token === 'home' && value === 0) forgetHomed(t);
  if (token !== 'hom' || typeof value !== 'object' || value === null) return;
  const hom = value as Readonly<Record<string, unknown>>;
  const now = t.s.notices.homedAxes ?? [];
  const kept = now.filter((a) => hom[a] !== 0);
  if (kept.length !== now.length) t.set({ notices: { ...t.s.notices, homedAxes: kept } });
}

/** True when `axis` was homed by a cycle this connection saw, the board still reports `home` 1 and that axis homed, and nothing since says otherwise. */
export function axisHomedHere(s: SessionState, axis: string): boolean {
  const a = axis.toLowerCase() as JogAxis;
  return s.live.home === 1 && (s.notices.homedAxes ?? []).includes(a) && homReads(s)[a] === 1 && !s.overlays.includes('UNKNOWN');
}
