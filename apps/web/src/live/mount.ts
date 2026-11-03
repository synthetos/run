/**
 * Wires LIVE entry into the workspace page (ROADMAP P1-05). Called by the
 * workspace entry after hydration with the build channel and the machine
 * worker. Everything here is UI/auth layer: the worker gets only `prepare`,
 * `open`, `close`, `subscribe`, `read`, `drift` and `transcript`, and never
 * learns about identity or the advisory.
 *
 * Stage 1 workspace: this module is the document-lifetime session owner.
 * It publishes what the views show through the workspace model's signals
 * (workspace/model.ts) instead of rendering into containers, so switching
 * views never re-creates the subscription, the Connect flow or the reads.
 */
import type { Signal } from '@preact/signals';
import { environmentForOrigin } from '@synthetos/protocol';
import { fetchIdentity, fetchSafetyAdvisory } from '../cloud/live.ts';
import { mountFirmware } from './firmwareHub.ts';
import { activeTrust } from '../firmware/store.ts';
import type { FlashBackupsPost } from '../machine-worker/rpc.ts';
import type { BuildChannel } from '../channel/channel.ts';
import { AlarmTone } from '../machine-ui/alarm.ts';
import { axisModeView } from '../machine-ui/AxisModes.ts';
import { EMPTY_AXIS_MODE_SESSION, type AxisModeSession } from '@synthetos/safety';
import { lagAt } from '../machine-ui/Dro.ts';
import { transcriptFileName, type TranscriptStatus } from '../machine-ui/TranscriptSave.ts';
import { downloadTranscript } from './transcriptDownload.ts';
import type { LiveMarkerView } from '../preview/PreviewPanel.ts';
import { callMachineWorker } from '../machine-worker/client.ts';
import { RPC_VERSION, type FlashCommand, type JobCommand, type MachineReply, type MachineRequest, type MotionCommand, type SnapshotMessage } from '../machine-worker/rpc.ts';
import { AdvisoryPoller, checkAdvisory, type AdvisoryCheck, type AdvisoryDeps } from './advisoryGate.ts';
import { accessProvider, AuthGate, providersFor } from './authGate.ts';
import { memoryDeviceSafety, openDeviceSafety, type DeviceSafetyStore } from './deviceSafety.ts';
import { leaveFullscreen } from './fullscreen.ts';
import { LiveEntry } from './liveEntry.ts';
import { windowChooser } from './portChooser.ts';
import { LiveReadout } from './readout.ts';
import { backupFileName, SettingsBackup, type BackupFile } from './backup.ts';
import { SettingsApplier, type ApplyState } from './settingsApply.ts';
import type { PlannedChange } from '@synthetos/schema';
import { clearDraft, setDraft } from '../workspace/boardFacts.ts';
import { lineModeRecord, pendingLineMode } from '../workspace/jobUi.ts';
import { ConsoleReader } from './consoleRead.ts';
import type { BackupStatus, LiveSample, WorkspaceModel } from '../workspace/model.ts';
import { cleanDisconnect, installLiveLifecycle, previousSessionEnded } from './liveMarker.ts';
import type { StopControls } from './stopControls.ts';

/**
 * The `open` request for the port the window chose. `previousSessionEnded` is the W6 state (a reload
 * or discard ended a LIVE session), so the worker starts this connect in UNKNOWN (SAFETY §3).
 */
export function openRequest(
  port: Extract<MachineRequest, { kind: 'open' }>['port'],
  previousSessionEnded: boolean,
  trusted: Extract<MachineRequest, { kind: 'open' }>['trusted'] = [],
): Extract<MachineRequest, { kind: 'open' }> {
  // SAFETY H87: the custom builds the user trusted, each for one board, only while this browser's record says the
  // board still runs that image (firmware/store.ts activeTrust). The worker restricts each to its board id.
  return { v: RPC_VERSION, kind: 'open', port, boardId: null, previousSessionEnded, ...(trusted === undefined || trusted.length === 0 ? {} : { trusted }) };
}

/**
 * Prepare without opening; confirm original window objects; open only the held worker port. `confirm`
 * also refuses if any port connected or disconnected since the choice (the chooser's event guard,
 * docs/safety/PORT_SELECTION.md); LIVE entry releases that guard on every exit (liveEntry.ts).
 */
export async function openConfirmedPort(
  call: (request: MachineRequest) => Promise<MachineReply>,
  port: Extract<MachineRequest, { kind: 'open' }>['port'],
  confirm: (() => Promise<boolean>) | undefined,
  previousSessionEnded: boolean,
  trusted: Extract<MachineRequest, { kind: 'open' }>['trusted'] = [],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (confirm === undefined) return { ok: false, message: 'Choose the port again to confirm its selection.' };
  try {
    const prepared = await call({ v: RPC_VERSION, kind: 'prepare', port });
    if (!prepared.ok) return { ok: false, message: prepared.message };
    if (prepared.kind !== 'prepare' || !(await confirm())) return { ok: false, message: 'The granted ports changed. Choose the port again.' };
    const reply = await call({ ...openRequest(port, previousSessionEnded, trusted), preparation: prepared.preparation });
    return reply.ok ? { ok: true } : { ok: false, message: reply.message };
  } catch {
    return { ok: false, message: 'The port selection could not be confirmed. Choose the port again.' };
  }
}

export interface MountOptions {
  readonly channel: BuildChannel;
  readonly appSha: string;
  readonly worker: Worker | null;
  /** The workspace model the views read (workspace/model.ts). */
  readonly model: WorkspaceModel;
  readonly previousSession: Signal<boolean>;
  /** P1-06: told when this tab enters or leaves LIVE, and given each snapshot (W30, PAUSE REQUESTED). */
  readonly stopControls: StopControls;
  /** P1-07: the live position marker the G-code preview draws (machine position from reports, minus the read offsets). */
  readonly marker: Signal<LiveMarkerView | null>;
}

/** How often the window re-renders the DRO's age and lag badge between snapshots. */
export const DRO_TICK_MS = 250;
/** How much status-report history the Live job tab keeps. */
export const SAMPLE_WINDOW_MS = 60_000;

export async function mountLiveEntry(options: MountOptions): Promise<LiveEntry> {
  let store: DeviceSafetyStore;
  try {
    store = await openDeviceSafety(globalThis.indexedDB);
  } catch {
    store = memoryDeviceSafety();
  }
  options.previousSession.value = await previousSessionEnded(store, (document as Document & { readonly wasDiscarded?: boolean }).wasDiscarded === true);

  const environment = options.channel.kind === 'bench' ? 'staging' : environmentForOrigin(location.origin);
  const auth = new AuthGate(providersFor(options.channel, environment, accessProvider(() => fetchIdentity())));
  const advisoryDeps: AdvisoryDeps = { fetchAdvisory: () => fetchSafetyAdvisory(), store, environment, appSha: options.appSha, now: () => new Date() };
  let advisoryBlocked: AdvisoryCheck | null = null;
  const poller = new AdvisoryPoller(
    advisoryDeps,
    { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) },
    (blocked) => {
      advisoryBlocked = blocked;
      publish();
    },
  );
  const alarm = new AlarmTone(typeof AudioContext === 'function' ? () => new AudioContext() : null);
  const worker = options.worker;

  const entry = new LiveEntry({
    auth,
    checkAdvisory: () => checkAdvisory(advisoryDeps),
    store,
    now: () => new Date(),
    // OD-3 (approved 2026-11-02): the browser's port chooser, from the C1 confirm click (the user
    // gesture), only after sign-in (in the bench build, the localhost bench identity), the advisory and
    // C1 have passed. Its PortSelector goes to the machine worker's `open`, which finds the same granted
    // port or refuses. Pause, Escape and the stop requests never pass through here.
    choosePort: () => windowChooser(),
    open: async (port, confirm) => {
      if (worker === null) return { ok: false, message: 'The machine worker is not running in this browser.' };
      const trusted = (await activeTrust(store).catch(() => [])).map((t) => ({ boardId: t.boardId, sha256: t.sha256, dialect: t.dialect, fb: t.fb, fbs: t.fbs, name: t.name }));
      return openConfirmedPort((request) => callMachineWorker(worker, request), port, confirm, options.previousSession.value, trusted);
    },
    leaveFullscreen: () => leaveFullscreen(document),
    unlockAlarm: () => alarm.unlock(),
    onLive: () => {
      options.previousSession.value = false;
      poller.start();
    },
  });

  installLiveLifecycle({ addEventListener: (type, listener) => addEventListener(type, listener) }, document, store, () => entry.state.step === 'live', () => new Date());

  let staleSince: number | null = null;
  let droMessage: SnapshotMessage | null = null;
  let droReceivedAt = 0;
  let samples: LiveSample[] = [];
  let sampleEpoch = -1;
  const unavailable = { ok: false as const, message: 'The machine worker is not running in this browser.' };
  // Firmware & Backups, set up below once the records are open (null until then, and when IndexedDB fails).
  let firmwareHub: Awaited<ReturnType<typeof mountFirmware>> | null = null;
  const read = (tokens: readonly string[]) => (worker === null ? Promise.resolve(unavailable) : callMachineWorker(worker, { v: RPC_VERSION, kind: 'read', tokens }));
  // P1-07: the connect-time settings read and the drift check. Reads go through the worker's `read`; nothing here writes.
  const readout = new LiveReadout({
    read,
    drift: (epoch) => (worker === null ? Promise.resolve() : callMachineWorker(worker, { v: RPC_VERSION, kind: 'drift', epoch })),
    store,
    now: () => new Date(),
    onChange: () => publish(),
  });
  // Board view: "Back up settings", one allowlisted GET at a time (live/backup.ts).
  const backup = new SettingsBackup();
  // The Console command line: one allowlisted read at a time (live/consoleRead.ts).
  const consoleReader = new ConsoleReader();
  let backupStatus: BackupStatus = { kind: 'idle' };
  let transcriptStatus: TranscriptStatus = { kind: 'idle' };
  let disconnectRefused: string | null = null;

  // Settings writes (SAFETY §4.6, amendment 2026-11-02): backup first, then one write at a time through the worker.
  let applyState: ApplyState = { kind: 'idle' };
  const applier = new SettingsApplier({
    writeSetting: async (key, value) => {
      if (worker === null) return unavailable;
      const reply = await callMachineWorker(worker, { v: RPC_VERSION, kind: 'settingWrite', key, value });
      if (reply.ok && reply.kind === 'settingWrite') return { ok: true as const, id: reply.id };
      return { ok: false as const, message: reply.ok ? 'unexpected reply' : reply.message };
    },
    backup: (onProgress) =>
      backup.run({
        read,
        now: () => new Date(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        onProgress: (p) => onProgress(p.done, p.of),
      }),
    saveBackup: async (file: BackupFile) => {
      const name = backupFileName(file.board.id, new Date(file.takenAt)).replace(/\.json$/, `-before-write-${file.takenAt.slice(11, 19).replace(/:/g, '')}.json`);
      // Kept on this computer (device-safety) and offered as a download: the revert source and the user's copy.
      await store.set(`settings-backup/${file.board.dialect}/${file.board.id ?? 'no-board-id'}/${file.takenAt}`, file).catch(() => undefined);
      // Firmware & Backups: every automatic backup before an apply is listed with its trigger.
      await firmwareHub?.record(file, 'before-apply').catch(() => undefined);
      downloadTranscript(document, `${JSON.stringify(file, null, 2)}\n`, name, 'application/json');
      return name;
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    onChange: (state) => {
      applyState = state;
      if (state.kind === 'done' || state.kind === 'failed') {
        // Verified changes are on the board now: drop them from the pending tray, and read the settings again.
        if (state.mode === 'apply') clearDraft(state.steps.filter((x) => x.status === 'verified').map((x) => x.key));
        if (state.steps.some((x) => x.status !== 'pending' && x.status !== 'notRun')) readout.reread();
      }
      publish();
    },
  });

  // P1-08: "Save transcript" asks the worker for the last connection's transcript (it only reads) and downloads it.
  async function saveTranscript(): Promise<void> {
    if (worker === null || transcriptStatus.kind === 'saving') return;
    transcriptStatus = { kind: 'saving' };
    publish();
    const reply = await callMachineWorker(worker, { v: RPC_VERSION, kind: 'transcript' }).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
    if (!reply.ok || reply.kind !== 'transcript') {
      transcriptStatus = { kind: 'failed', message: reply.ok ? 'unexpected reply' : reply.message };
    } else {
      const name = transcriptFileName(new Date());
      downloadTranscript(document, reply.jsonl, name);
      transcriptStatus = { kind: 'saved', name, events: reply.events };
    }
    publish();
  }

  async function transcriptText(): Promise<string | null> {
    if (worker === null) return null;
    const reply = await callMachineWorker(worker, { v: RPC_VERSION, kind: 'transcript' }).catch(() => null);
    return reply !== null && reply.ok && reply.kind === 'transcript' ? reply.jsonl : null;
  }

  async function runBackup(): Promise<void> {
    if (backup.running) return;
    if (readout.phase.kind === 'reading') {
      // The Board's settings read owns the read path right now; say so rather than do nothing.
      backupStatus = { kind: 'failed', message: "the board's settings are still being read; try again when that finishes" };
      publish();
      return;
    }
    backupStatus = { kind: 'reading', done: 0, of: 1, token: '' };
    publish();
    try {
      const file = await backup.run({
        read,
        now: () => new Date(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        onProgress: (p) => {
          backupStatus = { kind: 'reading', ...p };
          publish();
        },
      });
      const name = backupFileName(file.board.id, new Date(file.takenAt));
      downloadTranscript(document, `${JSON.stringify(file, null, 2)}\n`, name, 'application/json');
      await firmwareHub?.record(file, 'manual').catch(() => undefined);
      backupStatus = { kind: 'saved', name, answered: Object.keys(file.groups).length, unanswered: file.unanswered.length };
    } catch (e) {
      backupStatus = { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
    }
    publish();
  }

  // Firmware & Backups (SAFETY §4.8 as amended 2026-11-03): the records, the update's page side, the release list.
  const callFlash = async (command: FlashCommand): Promise<string | null> => {
    if (worker === null) return unavailable.message;
    const reply = await callMachineWorker(worker, { v: RPC_VERSION, kind: 'flash', command }).catch(() => null);
    if (reply === null) return 'The machine worker did not answer.';
    return reply.ok ? null : reply.message;
  };
  let readoutSeq = 0;
  let readoutKind = '';
  firmwareHub = await mountFirmware({
    store,
    flash: callFlash,
    read,
    runBackup: () =>
      backup.run({
        read,
        now: () => new Date(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        onProgress: (p) => {
          backupStatus = { kind: 'reading', ...p };
          publish();
        },
      }).then((file) => {
        backupStatus = { kind: 'idle' };
        return file;
      }),
    boardSettings: () => readout.settings,
    stageRestore: (changes) => {
      for (const c of changes) setDraft(c.key, c.to);
    },
    reread: () => readout.reread(),
    onChange: () => publish(),
  }).catch(() => null);

  setInterval(() => {
    if (droMessage !== null && droMessage.dro.machineSource.ageMs !== null) {
      updateMarker();
      publish();
    }
  }, DRO_TICK_MS);

  function updateMarker(): void {
    const m = droMessage?.dro.marker ?? null;
    if (droMessage === null || m === null) {
      options.marker.value = null;
      return;
    }
    const ageMs = m.ageMs + (performance.now() - droReceivedAt);
    options.marker.value = { x: m.x, y: m.y, z: m.z, ageMs, lag: lagAt(ageMs, droMessage.snapshot.overlays.includes('STALE'), droMessage.lag) };
  }

  function sample(message: SnapshotMessage, at: number): void {
    const s = message.snapshot;
    if (s.epoch !== sampleEpoch) {
      sampleEpoch = s.epoch;
      samples = [];
    }
    if (s.base === 'NOT_CONNECTED') return;
    const live = s.live;
    const next: LiveSample = { t: at, line: live.line ?? null, feed: live.feed ?? null, vel: live.vel ?? null, qr: live.qr ?? null, stat: live.stat ?? null };
    const last = samples.at(-1);
    if (last !== undefined && last.line === next.line && last.feed === next.feed && last.vel === next.vel && last.qr === next.qr && last.stat === next.stat && at - last.t < 1000) return;
    samples = [...samples.filter((x) => at - x.t <= SAMPLE_WINDOW_MS), next];
  }

  // Phase 3 (H77): this browser's record that Run changed a board's line mode and has not put it back. The worker is
  // told once per link, as soon as the board is identified; the session's own state is recorded as it changes
  // (device-safety, never synced). With no pending record the board's rxm is left exactly as found.
  let rxmEpoch = -1;
  let rxmSaved: string | null = null;
  function syncLineMode(message: SnapshotMessage): void {
    const s = message.snapshot;
    const id = s.identity?.id;
    if (worker === null || message.jobs !== true || id === undefined || s.classification?.mode !== 'full') return;
    const key = `rxm/${id}`;
    if (s.epoch !== rxmEpoch) {
      rxmEpoch = s.epoch;
      rxmSaved = null;
      void store.get(key).then(
        (v) => {
          void callMachineWorker(worker, { v: RPC_VERSION, kind: 'job', command: { op: 'lineModeMemory', epoch: s.epoch, remembered: pendingLineMode(v) } });
        },
        () => undefined,
      );
    }
    // Only once the worker has the record: an early snapshot (nothing decided yet) must not overwrite it.
    if (!s.rxm.memoryKnown) return;
    const record = lineModeRecord(s.rxm);
    const text = record === null ? null : `${key}=${record.from}/${record.pending}`;
    if (record !== null && rxmSaved !== text) {
      rxmSaved = text;
      void store.set(key, record).catch(() => undefined);
    }
  }

  if (worker !== null) {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent) => {
      const message = event.data as SnapshotMessage | FlashBackupsPost | { kind?: unknown };
      if (message.kind === 'flashBackups') {
        firmwareHub?.onBackups(message as FlashBackupsPost);
        return;
      }
      if (message.kind !== 'snapshot') return;
      droMessage = message as SnapshotMessage;
      droReceivedAt = performance.now();
      const snapshot = droMessage.snapshot;
      readout.onSnapshot(snapshot);
      backup.onSnapshot(snapshot);
      applier.onSnapshot(snapshot);
      consoleReader.onSnapshot(snapshot);
      sample(droMessage, droReceivedAt);
      syncLineMode(droMessage);
      updateMarker();
      staleSince = snapshot.overlays.includes('STALE') ? (staleSince ?? Date.now()) : null;
      if (snapshot.base === 'NOT_CONNECTED') disconnectRefused = null;
      alarm.sync(snapshot);
      options.stopControls.setSnapshot(snapshot);
      const kind = readout.phase.kind;
      if (kind !== readoutKind) {
        readoutKind = kind;
        if (kind !== 'reading' && kind !== 'idle') readoutSeq++;
      }
      firmwareHub?.onSnapshot(droMessage, kind !== 'reading' && kind !== 'idle', readoutSeq);
      publish();
    };
    worker.postMessage({ v: RPC_VERSION, kind: 'subscribe' }, [channel.port2]);
  }

  async function disconnect(): Promise<void> {
    // Only a close the worker confirmed removes the marker (W6) and leaves LIVE. A refusal is shown in
    // the allow matrix's own words next to Disconnect, never swallowed.
    let refused: string | null = null;
    const closed = await cleanDisconnect(
      async () => {
        if (worker === null) return { ok: true };
        const reply = await callMachineWorker(worker, { v: RPC_VERSION, kind: 'close' });
        if (!reply.ok) refused = reply.decision === undefined ? `Disconnect failed: ${reply.message}` : `${reply.decision.reason} ${reply.decision.remedy}`;
        return reply;
      },
      store,
      () => {
        poller.stop();
        advisoryBlocked = null;
        entry.reset();
      },
    );
    disconnectRefused = closed ? null : (refused ?? 'Disconnect failed.');
    publish();
  }

  // Row 35 / BENCH-P100-5: the axes that read inhibited on this link (reset per link epoch).
  let axisEpoch = -1;
  let axisSession: AxisModeSession = EMPTY_AXIS_MODE_SESSION;
  function axisModes(message: SnapshotMessage): ReturnType<typeof axisModeView> {
    if (message.snapshot.epoch !== axisEpoch) {
      axisEpoch = message.snapshot.epoch;
      axisSession = EMPTY_AXIS_MODE_SESSION;
    }
    const view = axisModeView({
      dialectId: message.snapshot.classification?.dialectId ?? null,
      reading: readout.phase.kind === 'reading',
      settings: readout.settings,
      machine: message.dro.axes,
      session: axisSession,
    });
    if (view.kind === 'facts') axisSession = view.session;
    return view;
  }

  function publish(): void {
    const connected = droMessage !== null && droMessage.snapshot.base !== 'NOT_CONNECTED';
    options.model.live.value = Object.freeze({
      entry: entry.state,
      advisoryBlocked,
      message: droMessage,
      receivedAt: droReceivedAt,
      now: performance.now(),
      staleSince,
      readout: { dialectId: readout.dialectId, phase: readout.phase, settings: readout.settings },
      axisModes: connected ? axisModes(droMessage as SnapshotMessage) : null,
      transcript: transcriptStatus,
      backup: backupStatus,
      samples,
      apply: applyState,
      disconnectRefused,
      ...(firmwareHub === null ? {} : { firmware: firmwareHub.view() }),
    });
  }

  options.model.actions.value = Object.freeze({
    connect: () => void entry.begin(),
    confirm: (ticked: readonly boolean[]) => void entry.confirm(ticked),
    cancel: () => entry.reset(),
    disconnect: () => void disconnect(),
    saveTranscript: () => void saveTranscript(),
    keepBoardSettings: () => void readout.keepBoardSettings().catch(() => undefined),
    backup: () => void runBackup(),
    transcriptText,
    applySettings: (changes: readonly PlannedChange[]) => void applier.apply(changes),
    revertSettings: () => void applier.revert(),
    clearApply: () => applier.reset(),
    motion: async (command: MotionCommand) => {
      if (worker === null) return unavailable.message;
      const reply = await callMachineWorker(worker, { v: RPC_VERSION, kind: 'motion', command }).catch(() => null);
      if (reply === null) return 'The machine worker did not answer.';
      return reply.ok ? null : reply.message;
    },
    job: async (command: JobCommand) => {
      if (worker === null) return unavailable.message;
      const reply = await callMachineWorker(worker, { v: RPC_VERSION, kind: 'job', command }).catch(() => null);
      if (reply === null) return 'The machine worker did not answer.';
      return reply.ok ? null : reply.message;
    },
    ...(firmwareHub === null || worker === null ? {} : { firmware: firmwareHub.actions }),
    consoleRead: (token: string) =>
      consoleReader.read(token, {
        snapshot: () => droMessage?.snapshot ?? null,
        read,
        transcript: transcriptText,
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      }),
  });

  entry.subscribe(() => {
    options.stopControls.setLive(entry.state.step === 'live');
    publish();
  });
  publish();
  return entry;
}
