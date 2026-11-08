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
import { boardModesText } from './boardModes.ts';
import { forecastStartModes, startModesText } from './jobModes.ts';
import { OVERLAYS, type Overlay } from '@synthetos/safety';
import { PROBE_STEPS, type FooterRev } from '@synthetos/protocol';
import type { TransportInfo } from '../transport.ts';
import type { PortSelector } from '../transport.ts';
import { probeView } from './probe/view.ts';
import type { ProbeSnapshot } from './probe/types.ts';
import type { ClassificationInfo, FaultInfo, Identity, JobEvent, JobPhase, JobReportSummary, JobState, LinkWindow, LiveState, ReadValue, ReportChange, RxmState, SessionBase, SessionNotices, SessionState, SettingWriteState, BootEntryState } from './types.ts';

/** What the page sees of a job (SAFETY §4.4a). The sanitised lines never leave the worker. */
export interface JobView {
  readonly id: number;
  readonly name: string;
  readonly hash: string;
  readonly bytes: number;
  readonly phase: JobPhase;
  /** Lines to send, sent, and answered. */
  readonly total: number;
  readonly sent: number;
  readonly acked: number;
  /** Free line slots in the last footer, and job lines owed an answer now. */
  readonly free: number | null;
  readonly inFlight: number;
  /** The line the controller reports executing (`line`, a host number), and its file line. */
  readonly executing: { readonly n: number; readonly line: number } | null;
  /** File lines: the last one sent, the last one answered (null before any). */
  readonly sentThrough: number | null;
  readonly ackedThrough: number | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** Modelled seconds (estimates, SAFETY §4.3): the whole job, still to run, and queued on the controller now. */
  readonly totalSeconds: number;
  readonly remainingSeconds: number;
  readonly queuedSeconds: number;
  /** An upper bound of the travel queued on the controller now, mm (W5), or null when it cannot be bounded. */
  readonly queuedBoundMm: number | null;
  readonly stop: { readonly kind: 'toolChange' | 'breakpoint' | 'barrier' | 'end'; readonly line: number } | null;
  readonly refused: { readonly line: number; readonly status: number; readonly text: string } | null;
  readonly toolChange: {
    readonly line: number;
    readonly tool: number | null;
    readonly spindle: 'off' | 'cw' | 'ccw';
    readonly speed: number | null;
    readonly mist: boolean;
    readonly flood: boolean;
    readonly restartsSpindle: boolean;
    /** The machine was moved since the job stopped (Resume returns at a safe height). */
    readonly moved: boolean;
  } | null;
  readonly message: string | null;
  readonly events: readonly JobEvent[];
  readonly breakpoints: readonly number[];
  /** Breakpoints on lines already sent: they cannot stop the job (W41). */
  readonly queuedBreakpoints: readonly number[];
  readonly report: JobReportSummary | null;
  readonly rxmFrom: number | null;
  readonly jobFlag: 0 | 1 | null;
  readonly feedLimit: JobState['feedLimit'];
  readonly faultStopAt: number | null;
  readonly stopping: boolean;
  /**
   * OD-19: the check's plain line when Start will write modes the preview assumes ("Run sets absolute mode and
   * millimetres before the first line, as the preview shows."), forecast from the board's modes as run knows them
   * now (Start decides again from its own reads), or null when it will write none.
   */
  readonly startModes: string | null;
  /** Where a stopped or failed job ended: the last line the board took then (`n` of `total`, and its file line). */
  readonly stoppedAt: { readonly n: number; readonly line: number } | null;
}

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
  /** The port the window chose (the flasher reopens exactly this one, SAFETY §4.8 as amended 2026-11-03). */
  readonly portSelector: PortSelector | null;
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
  /** The firmware update's entry into the bootloader in progress (its idle gate), or null. */
  readonly bootEntry: BootEntryState | null;
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
  /** Phase 3: the loaded or running job, or null. */
  readonly job: JobView | null;
  /** Phase 3: the line-mode setting (H77). The page remembers `restore` per board on this computer. */
  readonly rxm: Omit<RxmState, 'step' | 'footerExpect'> & { readonly busy: boolean };
  /** `rt` leaves the board answered `{"rt":null}` with (the job flag and feed-limit capabilities). */
  readonly rtLeaves: readonly string[];
  /** Probe Z (SAFETY §4.5c, H90). (`probe` above is the capability probe's progress while identifying.) */
  readonly probeZ: ProbeSnapshot;
  /**
   * OD-19: the board's units and distance mode as last read or set by run's own answered lines, never from reports
   * (boardModes.ts), and in plain words for the job card ("Absolute, mm").
   */
  readonly boardModes: SessionState['boardModes'] & { readonly text: string };
}

/** Longest job message or event text a snapshot carries (the warnings they quote are longer than a board string). */
const JOB_TEXT_MAX = 600;

function capLong(s: string): string {
  return s.length > JOB_TEXT_MAX ? `${s.slice(0, JOB_TEXT_MAX)}…` : s;
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
    portSelector: state.port,
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
    bootEntry: state.bootEntry,
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
    job: state.job === null ? null : jobView(state, state.job),
    rxm: { restore: state.rxm.restore, memoryKnown: state.rxm.memoryKnown, pending: state.rxm.pending, leftAsFound: state.rxm.leftAsFound, current: state.rxm.current, changed: state.rxm.changed, detail: state.rxm.detail, busy: state.rxm.step !== null },
    rtLeaves: state.rtLeaves,
    probeZ: probeView(state),
    boardModes: { ...state.boardModes, text: boardModesText(state.boardModes) },
  });
}

function jobView(state: SessionState, job: JobState): JobView {
  const total = job.lines.length;
  const reported = state.live.line;
  const running = job.startedAt !== null;
  const exec = running && reported !== undefined && Number.isInteger(reported) && reported >= 1 && reported <= Math.max(job.next, 1) && reported <= total ? reported : null;
  const execIndex = exec === null ? Math.min(job.acked, total) : exec - 1;
  const fileLine = (i: number): number | null => (i >= 0 && i < total ? (job.lines[i] as JobState['lines'][number]).sourceLine : null);
  let inFlight = 0;
  for (const e of state.expected) if (e.purpose === 'job' && !e.late) inFlight++;
  let bound: number | null = 0;
  for (let i = execIndex; i < job.next && bound !== null; i++) {
    const m = job.lines[i]?.motion;
    if (m === null || m === undefined) continue;
    bound = m.boundMm === null ? null : bound + m.boundMm;
  }
  const secondsAt = (i: number): number => job.secondsFrom[Math.min(Math.max(i, 0), total)] ?? 0;
  const tc = job.toolChange;
  const mpo = state.live.mpo;
  const moved = tc !== null && (['x', 'y', 'z'] as const).some((a) => tc.at[a] !== undefined && (mpo[a] === undefined || Math.abs((mpo[a] as number) - (tc.at[a] as number)) > 0.01));
  const queuedLines = new Set(job.lines.slice(execIndex, job.next).map((l) => l.sourceLine));
  const active = ['running', 'draining', 'ending', 'pausing', 'paused', 'refused', 'outputsOff', 'toolChange', 'breakpoint', 'programStop', 'resuming'].includes(job.phase);
  return {
    id: job.id,
    name: cap(job.name),
    hash: job.hash,
    bytes: job.bytes,
    phase: job.phase,
    total,
    sent: job.next,
    acked: job.acked,
    free: job.free,
    inFlight,
    executing: exec === null ? null : { n: exec, line: fileLine(exec - 1) as number },
    sentThrough: job.next > 0 ? fileLine(job.next - 1) : null,
    ackedThrough: job.acked > 0 ? fileLine(job.acked - 1) : null,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    totalSeconds: secondsAt(0),
    remainingSeconds: running ? secondsAt(execIndex) : secondsAt(0),
    queuedSeconds: running ? Math.max(0, secondsAt(execIndex) - secondsAt(job.next)) : 0,
    queuedBoundMm: running ? bound : 0,
    stop: job.stop === null ? null : { kind: job.stop.kind, line: fileLine(job.stop.index) as number },
    refused: job.refused === null ? null : { line: fileLine(job.refused.index) as number, status: job.refused.status, text: cap(job.refused.text) },
    toolChange: tc === null ? null : { line: fileLine(tc.index) as number, tool: tc.tool, spindle: tc.spindle, speed: tc.speed, mist: tc.mist, flood: tc.flood, restartsSpindle: tc.restartsSpindle, moved },
    message: job.message === null ? null : capLong(job.message),
    events: job.events.map((e) => ({ ...e, text: capLong(e.text) })),
    breakpoints: job.breakpoints,
    queuedBreakpoints: active ? job.breakpoints.filter((b) => queuedLines.has(b) && b !== fileLine(job.passed ?? -1)) : [],
    report: job.report,
    rxmFrom: job.rxmFrom,
    jobFlag: job.jobFlag,
    feedLimit: job.feedLimit,
    faultStopAt: job.faultStopAt,
    stoppedAt: job.stoppedAt ?? null,
    stopping: job.stopping,
    startModes: startModesText(forecastStartModes(state, job.startModes?.needs ?? [])),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}
