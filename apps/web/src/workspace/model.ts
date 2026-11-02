/**
 * The workspace's document-lifetime session model (WORKSPACE_SPEC
 * "Architecture": one session owner sits above the views).
 *
 * The workspace entry creates one model before hydration and hands it to the
 * shell. LIVE entry (live/mount.ts) owns the machine worker subscription, the
 * Connect flow and the reads, and publishes what the views show through the
 * model's signals. Views only read the signals and call the actions; a view
 * switch never creates, closes or re-subscribes anything.
 *
 * The page sees the session only as the worker sends it (T-S39: no page
 * module imports @synthetos/machine), so every type here comes through the
 * worker RPC.
 */
import { signal, type Signal } from '@preact/signals';
import type { BoardSettings } from '@synthetos/schema';
import type { AdvisoryCheck } from '../live/advisoryGate.ts';
import type { ConsoleAnswer } from '../live/consoleRead.ts';
import type { EntryState } from '../live/liveEntry.ts';
import type { ReadoutPhase } from '../live/readout.ts';
import type { AxisModeView } from '../machine-ui/AxisModes.ts';
import type { TranscriptStatus } from '../machine-ui/TranscriptSave.ts';
import type { MotionCommand, SnapshotMessage } from '../machine-worker/rpc.ts';

/** One live sample for the Live job tab, taken from a status report the window received. */
export interface LiveSample {
  /** Window time (ms, `performance.now()`). */
  readonly t: number;
  readonly line: number | null;
  readonly feed: number | null;
  readonly vel: number | null;
  readonly qr: number | null;
  readonly stat: number | null;
}

/** The settings backup (Board view), read token group by token group. */
export type BackupStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading'; readonly done: number; readonly of: number; readonly token: string }
  | { readonly kind: 'saved'; readonly name: string; readonly answered: number; readonly unanswered: number }
  | { readonly kind: 'failed'; readonly message: string };

export interface LiveView {
  readonly entry: EntryState;
  readonly advisoryBlocked: AdvisoryCheck | null;
  /** The last snapshot message from the worker, or null before the first one. */
  readonly message: SnapshotMessage | null;
  /** `performance.now()` when `message` arrived. */
  readonly receivedAt: number;
  /** `performance.now()` of the last redraw tick (ages count on between snapshots). */
  readonly now: number;
  /** `Date.now()` when this STALE was first seen, or null. */
  readonly staleSince: number | null;
  readonly readout: { readonly dialectId: string | null; readonly phase: ReadoutPhase; readonly settings: BoardSettings };
  readonly axisModes: AxisModeView | null;
  readonly transcript: TranscriptStatus;
  readonly backup: BackupStatus;
  /** Status-report samples of the last 60 s of this link, oldest first. */
  readonly samples: readonly LiveSample[];
  /** Why the last Disconnect was refused (the worker's allow-matrix words), or null. */
  readonly disconnectRefused: string | null;
}

export interface LiveActions {
  readonly connect: () => void;
  readonly confirm: (ticked: readonly boolean[]) => void;
  readonly cancel: () => void;
  readonly disconnect: () => void;
  readonly saveTranscript: () => void;
  readonly keepBoardSettings: () => void;
  readonly backup: () => void;
  /** The current link's wire transcript as JSONL, for the Console tab (it only reads). */
  readonly transcriptText: () => Promise<string | null>;
  /**
   * Phase 2 (SAFETY §4.5b): one motion command to the worker. Resolves with the refusal reason, or null when
   * the session accepted it. The session decides; the page never assumes it moved.
   */
  readonly motion?: (command: MotionCommand) => Promise<string | null>;
  /** The Console command line's one read: an allowlisted GET through the worker's read path (live/consoleRead.ts). */
  readonly consoleRead: (token: string) => Promise<ConsoleAnswer>;
}

export const INITIAL_LIVE_VIEW: LiveView = Object.freeze({
  entry: Object.freeze({ step: 'idle' as const }),
  advisoryBlocked: null,
  message: null,
  receivedAt: 0,
  now: 0,
  staleSince: null,
  readout: Object.freeze({ dialectId: null, phase: Object.freeze({ kind: 'idle' as const }), settings: Object.freeze({}) }),
  axisModes: null,
  transcript: Object.freeze({ kind: 'idle' as const }),
  backup: Object.freeze({ kind: 'idle' as const }),
  samples: Object.freeze([]),
  disconnectRefused: null,
});

export interface WorkspaceModel {
  readonly live: Signal<LiveView>;
  readonly actions: Signal<LiveActions | null>;
}

export function createWorkspaceModel(): WorkspaceModel {
  return { live: signal(INITIAL_LIVE_VIEW), actions: signal(null) };
}

/** The session snapshot of a live view, or null. */
export function snapshotOf(view: LiveView): SnapshotMessage['snapshot'] | null {
  return view.message?.snapshot ?? null;
}

/**
 * True when Disconnect applies: the worker has a port open or opening (any base state but
 * NOT_CONNECTED), or LIVE entry finished. Shown in the machine strip in every view.
 */
export function portOpen(view: LiveView): boolean {
  return connected(view) || view.entry.step === 'live';
}

/** True when a port is open (any base state but NOT_CONNECTED). */
export function connected(view: LiveView): boolean {
  const s = snapshotOf(view);
  return s !== null && s.base !== 'NOT_CONNECTED';
}
