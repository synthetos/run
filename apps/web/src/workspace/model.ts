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
import type { FirmwareRelease, FirmwareReleases } from '@synthetos/protocol';
import type { UpdaterStep } from '../firmware/updater.ts';
import type { FirmwareBackupRecord, InstalledRecord, SettingsBackupRecord, TrustRecord } from '../firmware/store.ts';
import type { BoardSettings } from '@synthetos/schema';
import type { AdvisoryCheck } from '../live/advisoryGate.ts';
import type { ConsoleAnswer } from '../live/consoleRead.ts';
import type { EntryState } from '../live/liveEntry.ts';
import type { ApplyState } from '../live/settingsApply.ts';
import type { PlannedChange } from '@synthetos/schema';
import type { ReadoutPhase } from '../live/readout.ts';
import type { AxisModeView } from '../machine-ui/AxisModes.ts';
import type { TranscriptStatus } from '../machine-ui/TranscriptSave.ts';
import type { JobCommand, MotionCommand, SnapshotMessage } from '../machine-worker/rpc.ts';

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
  /** Applying pending settings changes (SAFETY §4.6, amendment 2026-11-02). */
  readonly apply: ApplyState;
  /** Why the last Disconnect was refused (the worker's allow-matrix words), or null. */
  readonly disconnectRefused: string | null;
  /** The Firmware and Backups tabs (SAFETY §4.8 as amended 2026-11-03 and 2026-11-09): absent before the page loads its records. */
  readonly firmware?: FirmwareHubView;
}

/** What the Firmware and Backups tabs show (firmware/hub.ts builds it). */
export interface FirmwareHubView {
  /** The release list this page verified for its own environment. */
  readonly releases: { readonly ok: true; readonly list: FirmwareReleases } | { readonly ok: false; readonly reason: string };
  readonly step: UpdaterStep;
  readonly settings: readonly Omit<SettingsBackupRecord, 'file'>[];
  readonly firmware: readonly Omit<FirmwareBackupRecord, 'hex' | 'eeprom'>[];
  readonly trust: readonly TrustRecord[];
  /** The image this browser last flashed onto the connected board, or null. */
  readonly installed: InstalledRecord | null;
  /** The switch check's reads are running. */
  readonly pollingSwitches: boolean;
  /** The last message from a firmware action (a refusal, a result), or null. */
  readonly notice: { readonly kind: 'ok' | 'error'; readonly text: string } | null;
  /** A comparison of a stored settings backup with the board, when one was asked for. */
  readonly compare: { readonly id: string; readonly changes: number; readonly same: number; readonly skipped: number; readonly keys: readonly string[] } | null;
  /** A release image being fetched from the site's own origin (OD-10), or null. */
  readonly download: FirmwareDownload | null;
}

/** The progress of a release image's download, then its check against the signed entry. */
export interface FirmwareDownload {
  readonly file: string;
  readonly phase: 'fetching' | 'checking' | 'ready' | 'failed';
  readonly received: number;
  readonly total: number | null;
  /** Why it failed, for the panel. */
  readonly message: string | null;
}

/** A release image the page fetched (or the user chose) and checked against the signed entry: what the C6 question is asked about. */
export interface ReleaseImage {
  readonly release: FirmwareRelease;
  /** The exact text, whose SHA-256 and size equal the entry's. */
  readonly hex: string;
  readonly from: 'site' | 'local';
}

/** The firmware actions (each resolves with a refusal or null). */
export interface FirmwareActions {
  /**
   * Fetch a listed image from this site's own origin (the Worker's proxy for a GitHub release, OD-10) and check it
   * against the signed entry (SHA-256 and size); progress is in the hub view's `download`. Resolves with the checked
   * image, or with why not (then the panel offers the local-copy fallback).
   */
  readonly downloadRelease: (release: FirmwareRelease) => Promise<{ readonly ok: true; readonly image: ReleaseImage } | { readonly ok: false; readonly message: string }>;
  /** A local copy the user chose: checked the same way, never flashed when it differs from the entry. */
  readonly checkLocalCopy: (release: FirmwareRelease, text: string) => Promise<{ readonly ok: true; readonly image: ReleaseImage } | { readonly ok: false; readonly message: string }>;
  /** Start the update with a checked image (after C6). The flash path itself is unchanged: the worker checks everything again. */
  readonly updateRelease: (image: ReleaseImage) => Promise<string | null>;
  readonly putBack: (id: string) => Promise<string | null>;
  readonly flashCustom: (name: string, text: string) => Promise<string | null>;
  readonly recover: () => Promise<string | null>;
  readonly cancel: () => Promise<string | null>;
  readonly reconnect: () => Promise<string | null>;
  readonly startFirmware: () => Promise<string | null>;
  readonly bootloaderHardware: (hv: number) => Promise<string | null>;
  readonly dismiss: () => Promise<void>;
  readonly restore: () => Promise<string | null>;
  readonly startSwitchCheck: () => void;
  readonly finishSwitchCheck: () => Promise<string | null>;
  readonly backupNow: () => Promise<string | null>;
  readonly exportSettings: (id: string) => Promise<void>;
  readonly importSettings: (text: string) => Promise<string | null>;
  readonly deleteSettings: (id: string) => Promise<void>;
  readonly compareSettings: (id: string) => Promise<string | null>;
  readonly stageSettings: (id: string) => Promise<string | null>;
  readonly downloadFirmware: (id: string) => Promise<void>;
  readonly deleteFirmware: (id: string) => Promise<void>;
  readonly trust: (boardId: string) => Promise<string | null>;
  readonly revoke: (boardId: string, sha256: string) => Promise<void>;
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
  /** Backs up, then writes the changes one at a time with read-backs (live/settingsApply.ts). */
  readonly applySettings: (changes: readonly PlannedChange[]) => void;
  /** Writes the backed-up values back for what the last apply changed. */
  readonly revertSettings: () => void;
  /** Clears a finished apply result. */
  readonly clearApply: () => void;
  /**
   * Phase 2 (SAFETY §4.5b): one motion command to the worker. Resolves with the refusal reason, or null when
   * the session accepted it. The session decides; the page never assumes it moved.
   */
  readonly motion?: (command: MotionCommand) => Promise<string | null>;
  /**
   * Phase 3 (SAFETY §4.4a): one job command to the worker. Resolves with the refusal reason, or null when the session
   * accepted it. Absent without a worker.
   */
  readonly job?: (command: JobCommand) => Promise<string | null>;
  /** The Console command line's one read: an allowlisted GET through the worker's read path (live/consoleRead.ts). */
  readonly consoleRead: (token: string) => Promise<ConsoleAnswer>;
  /** The Firmware and Backups tabs (SAFETY §4.8 as amended 2026-11-03 and 2026-11-09). Absent without a worker. */
  readonly firmware?: FirmwareActions;
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
  apply: Object.freeze({ kind: 'idle' as const }),
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
