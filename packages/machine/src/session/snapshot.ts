/**
 * What the UI sees of a session (ROADMAP P1-02; OLD-TP §4.2 `snapshot`):
 * a plain, frozen, structured-clone-safe object derived from the reducer's
 * state, posted from `machine.worker` to the window.
 *
 * Strings that came from the serial port (`identity.id`, `fault.detail`,
 * `classification.detail`) are data, never markup: the UI renders them with
 * `textContent` after bidi sanitising (SAFETY T-S85). They are also capped
 * here so a misbehaving board cannot post megabytes.
 */
import { OVERLAYS, type Overlay } from '@synthetos/safety';
import { PROBE_STEPS, type FooterRev } from '@synthetos/protocol';
import type { TransportInfo } from '../transport.ts';
import type { ClassificationInfo, FaultInfo, Identity, LinkWindow, LiveState, ReadValue, ReportChange, SessionBase, SessionNotices, SessionState, SettingWriteState } from './types.ts';

/** Longest string from the board a snapshot carries. */
export const SNAPSHOT_STRING_MAX = 200;

export interface SessionSnapshot {
  readonly base: SessionBase;
  /** Active overlays, highest precedence first. */
  readonly overlays: readonly Overlay[];
  /** The overlay the state band shows (FAULT > LOST > ORPHANED_MOTION > UNKNOWN > STALE > READ_ONLY > NEEDS_REVIEW). */
  readonly primaryOverlay: Overlay | null;
  readonly epoch: number;
  /** The open port's identity (USB vendor and product id), or null. */
  readonly port: TransportInfo | null;
  /** Probe progress while IDENTIFYING: answered GETs out of all, and the banner shape seen. */
  readonly probe: { readonly answered: number; readonly of: number; readonly banner: 'r-footer' | 'bare-sr' | 'none'; readonly restarts: number } | null;
  readonly identity: Identity | null;
  readonly classification: ClassificationInfo | null;
  readonly footerRev: FooterRev | null;
  readonly live: LiveState;
  readonly values: Readonly<Record<string, ReadValue>>;
  readonly fault: FaultInfo | null;
  /** An `ackFault` is verifying (polled `hold` and `qr`). */
  readonly ackVerifying: boolean;
  readonly blocked: { readonly expected: string; readonly reported: string | null } | null;
  readonly notices: SessionNotices;
  /** The board has said XOFF: reads wait, `!` does not. */
  readonly xoff: boolean;
  readonly lastAckAt: number | null;
  /** STALE: how long the link had been silent when STALE was entered (W4 counts on from it). */
  readonly stale: { readonly silentForMs: number } | null;
  readonly sent: { readonly lines: number; readonly realtime: number };
  /** The current or last settings write (SAFETY §4.6, amendment 2026-11-02), or null. */
  readonly settingWrite: SettingWriteState | null;
  /**
   * Phase 2 (SAFETY §4.5b): the motion in progress, or null. `hold` is true for a press-and-hold jog;
   * `held` once a Pause of it is confirmed by polled reads (Resume is offered then).
   */
  readonly motion: { readonly op: 'jog' | 'goToZero' | 'home' | 'change' | 'stop'; readonly phase: string; readonly hold: boolean; readonly held: boolean; readonly stopping: boolean } | null;
  /**
   * The connect-time read and status-report configuration (amendment 2026-11-02, H64): its phase, the heartbeat in
   * force, and every reporting setting run changed (and saved) on this board (W35, W36).
   */
  readonly reports: { readonly phase: string; readonly heartbeatMs: number | null; readonly changes: readonly ReportChange[]; readonly detail: string | null };
  /** The liveness window: the page shows freshness, and "No reports from the board", against it. */
  readonly link: LinkWindow;
}

function cap(s: string): string {
  return s.length > SNAPSHOT_STRING_MAX ? `${s.slice(0, SNAPSHOT_STRING_MAX)}…` : s;
}

function capIdentity(identity: Identity | null): Identity | null {
  if (identity === null) return null;
  return {
    ...identity,
    ...(identity.id === undefined ? {} : { id: cap(identity.id) }),
    ...(typeof identity.hp === 'string' ? { hp: cap(identity.hp) } : {}),
    ...(typeof identity.hv === 'string' ? { hv: cap(identity.hv) } : {}),
    ...(identity.fbs === undefined ? {} : { fbs: cap(identity.fbs) }),
  };
}

export function snapshotOf(state: SessionState): SessionSnapshot {
  const overlays = OVERLAYS.filter((o) => state.overlays.includes(o));
  const probe = state.probe;
  return deepFreeze({
    base: state.base,
    overlays,
    primaryOverlay: overlays[0] ?? null,
    epoch: state.epoch,
    port: state.portInfo,
    probe:
      probe === null || state.base !== 'IDENTIFYING'
        ? null
        : { answered: probe.answers.length + (probe.next > 0 ? 1 : 0), of: PROBE_STEPS.length, banner: probe.banner?.shape ?? 'none', restarts: probe.restarts },
    identity: capIdentity(state.identity),
    classification: state.classification === null ? null : { ...state.classification, detail: cap(state.classification.detail) },
    footerRev: state.footerRev ?? null,
    live: state.live,
    values: state.values,
    fault: state.fault === null ? null : { ...state.fault, detail: cap(state.fault.detail) },
    ackVerifying: state.ackVerify !== null,
    blocked: state.blocked === null ? null : { expected: cap(state.blocked.expected), reported: state.blocked.reported === null ? null : cap(state.blocked.reported) },
    notices: state.notices,
    xoff: state.xoff,
    lastAckAt: state.lastAckAt ?? null,
    stale: state.stale === null || !overlays.includes('STALE') ? null : { silentForMs: state.stale.silentForMs },
    sent: state.sent,
    settingWrite: state.settingWrite,
    motion:
      state.motion === null
        ? null
        : {
            op: state.motion.op,
            phase: state.motion.phase,
            hold: state.motion.jog !== null && state.motion.jog.remainingMm === null,
            held: state.motion.phase === 'held',
            stopping: state.motion.phase === 'hold' || state.motion.phase === 'flush' || state.motion.reason === 'stopJob',
          },
    reports: { phase: state.reports.phase, heartbeatMs: state.reports.heartbeatMs, changes: state.reports.changes, detail: state.reports.detail === null ? null : cap(state.reports.detail) },
    link: state.link,
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}
