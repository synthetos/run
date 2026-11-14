/** Document-lifetime owner of the open update flow. All machine I/O stays in its dedicated worker. */
import { signal } from '@preact/signals';
import type { PlannedChange, SettingValue } from '@synthetos/schema';
import { callMachineWorker } from '../machine-worker/call.ts';
import { RPC_VERSION, type MachineRequest, type SnapshotMessage, type FlashBackupsPost, type FlashCommand } from '../machine-worker/rpc.ts';
import { mountFirmware, type FirmwareHub } from '../live/firmwareHub.ts';
import { openDeviceSafety, memoryDeviceSafety } from '../live/deviceSafety.ts';
import { SettingsBackup, backupFileName, type BackupFile } from '../live/backup.ts';
import { SettingsApplier, type ApplyState } from '../live/settingsApply.ts';
import { LiveReadout } from '../live/readout.ts';
import { windowChooser } from '../live/portChooser.ts';
import { openConfirmedPort } from '../live/openPort.ts';
import { downloadTranscript } from '../live/transcriptDownload.ts';
import type { FirmwareHubView } from '../workspace/model.ts';

export interface UpdateState {
  readonly message: SnapshotMessage | null;
  readonly hub: FirmwareHubView | null;
  readonly error: string | null;
  readonly connecting: boolean;
  readonly backup: { readonly file: BackupFile | null } | null;
  readonly changes: readonly PlannedChange[];
  readonly checklistBackup: BackupFile | null;
  readonly apply: ApplyState;
  readonly mainsConfirmed: boolean;
}
export const initialUpdateState = (): UpdateState => ({ message: null, hub: null, error: null, connecting: false, backup: null, checklistBackup: null, changes: [], apply: { kind: 'idle' }, mainsConfirmed: false });

export class UpdateController {
  readonly state = signal<UpdateState>(initialUpdateState());
  hub: FirmwareHub | null = null;
  readonly #worker: Worker;
  readonly #backup = new SettingsBackup();
  #readout!: LiveReadout;
  #applier!: SettingsApplier;
  #backupAnswer: ((continueUpdate: boolean) => void) | null = null;
  #readSeq = 0;
  #lastPhase: unknown;
  constructor(worker: Worker) { this.#worker = worker; }
  patch(patch: Partial<UpdateState>): void { this.state.value = { ...this.state.value, ...patch }; }
  call(request: MachineRequest) { return callMachineWorker(this.#worker, request); }
  async read(tokens: readonly string[]) {
    const r = await this.call({ v: RPC_VERSION, kind: 'read', tokens });
    return r.ok ? { ok: true as const } : { ok: false as const, message: r.message };
  }
  async flash(command: FlashCommand): Promise<string | null> {
    const r = await this.call({ v: RPC_VERSION, kind: 'flash', command });
    return r.ok ? null : r.message;
  }
  #changed = (): void => {
    this.patch({ hub: this.hub?.view() ?? null });
  };
  async init(): Promise<void> {
    // A persistent store is required here: interrupted updates must survive closing the page.
    const store = await openDeviceSafety(indexedDB);
    this.#readout = new LiveReadout({ read: tokens => this.read(tokens), drift: async () => undefined, resolveDrift: async () => undefined, store: memoryDeviceSafety(), now: () => new Date(), onChange: () => {
      if (this.#readout !== undefined && this.#lastPhase !== this.#readout.phase) {
        this.#lastPhase = this.#readout.phase;
        this.#readSeq++;
        this.#notifyHub();
      }
      this.#changed();
    } });
    this.hub = await mountFirmware({ store, requirePersistent: true, flash: c => this.flash(c), read: t => this.read(t), runBackup: () => this.runBackup(), confirmBackup: file => new Promise(resolve => {
      this.#backupAnswer = resolve; this.patch({ backup: { file } });
    }), boardSettings: () => this.#readout.settings, stageRestore: changes => this.patch({ changes }), reread: () => this.#readout.reread(), onChange: this.#changed });
    this.#applier = new SettingsApplier({ writeSetting: async (key, value) => {
      const r = await this.call({ v: RPC_VERSION, kind: 'settingWrite', key, value });
      return r.ok && r.kind === 'settingWrite' ? { ok: true, id: r.id } : { ok: false, message: r.ok ? 'No write result.' : r.message };
    }, backup: () => this.runBackup(), saveBackup: async file => { await this.hub!.record(file, 'before-apply'); return backupFileName(file.board.id, new Date(file.takenAt)); }, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>), onChange: apply => this.patch({ apply }) });
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<SnapshotMessage | FlashBackupsPost>) => {
      const post = event.data;
      if (post.kind === 'flashBackups') { this.hub?.onBackups(post); return; }
      if (post.kind !== 'snapshot') return;
      const prior = this.state.value.message;
      if (prior !== null && (prior.snapshot.epoch !== post.snapshot.epoch || post.snapshot.base === 'NOT_CONNECTED' || post.snapshot.overlays.includes('LOST'))) {
        this.answerBackup(false);
        this.patch({ changes: [], checklistBackup: null });
      }
      this.patch({ message: post, ...(prior?.postFlash?.boardId !== post.postFlash?.boardId ? { mainsConfirmed: false } : {}) });
      this.#backup.onSnapshot(post.snapshot);
      this.#applier.onSnapshot(post.snapshot);
      this.#readout.onSnapshot(post.snapshot);
      this.#notifyHub();
      this.#changed();
    };
    this.#worker.postMessage({ v: RPC_VERSION, kind: 'subscribe' }, [channel.port2]);
    this.#changed();
  }
  #notifyHub(): void {
    const m = this.state.value.message;
    const phase = this.#readout.phase.kind;
    if (m !== null) this.hub?.onSnapshot(m, phase === 'recorded' || phase === 'match' || phase === 'drift' || phase === 'noBoardId', this.#readSeq);
  }
  runBackup(): Promise<BackupFile> {
    return this.#backup.run({ read: t => this.read(t), now: () => new Date(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>), onProgress: () => this.#changed() });
  }
  async connect(): Promise<void> {
    const choice = windowChooser(); // Keep the chooser in the click's user gesture.
    this.patch({ connecting: true, error: null });
    const picked = await choice;
    try {
      if (!picked.ok) { this.patch({ error: picked.message }); return; }
      const result = await openConfirmedPort(r => this.call(r), picked.port, picked.confirm, false);
      if (!result.ok) this.patch({ error: result.message });
    } finally {
      if (picked.ok) picked.release?.();
      this.patch({ connecting: false });
    }
  }
  async disconnect(): Promise<void> {
    this.answerBackup(false);
    const r = await this.call({ v: RPC_VERSION, kind: 'close' });
    if (!r.ok) this.patch({ error: r.message });
  }
  answerBackup(proceed: boolean): void {
    const answer = this.#backupAnswer; this.#backupAnswer = null;
    this.patch({ backup: null }); answer?.(proceed);
  }
  downloadBackup(file?: BackupFile): void {
    const f = file ?? this.state.value.backup?.file;
    if (f) downloadTranscript(document, JSON.stringify(f, null, 2), backupFileName(f.board.id, new Date(f.takenAt)), 'application/json');
  }
  async prepareChecklist(): Promise<void> {
    if (this.state.value.message?.flash?.bootloader !== undefined) return;
    const epoch = this.state.value.message?.snapshot.epoch;
    const file = await this.runBackup();
    if (file.unanswered.length > 0) throw new Error('Some settings did not answer. Reconnect and complete the backup before updating.');
    await this.hub!.record(file, 'manual');
    if (this.state.value.message?.snapshot.epoch !== epoch) throw new Error('The connection changed. Choose the release again.');
    this.patch({ checklistBackup: file });
  }
  async applyRestore(): Promise<void> {
    const changes = this.state.value.changes;
    this.patch({ changes: [] });
    const result = await this.#applier.apply(changes);
    if (result.kind === 'done') this.#readout.reread();
  }
  async action(run: () => Promise<string | null>): Promise<void> {
    try { this.patch({ error: await run() }); } catch (e) { this.patch({ error: e instanceof Error ? e.message : String(e) }); }
  }
  get settings(): Readonly<Record<string, SettingValue>> { return this.#readout.settings; }
}
