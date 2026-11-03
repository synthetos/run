/**
 * The firmware update, page side (SAFETY §4.8 as amended 2026-11-03;
 * WORKSPACE_FEATURES "Firmware update"). The machine worker decides and does
 * every step on the machine path (machine-worker/flashService.ts); this module
 * orders the page's part and keeps the records:
 *
 * 1. The settings backup, token by token (live/backup.ts), stored on this
 *    computer as "before update" and kept as the post-flash baseline. A board
 *    whose firmware cannot be read that way (no read allowlist) is flashed
 *    with the raw EEPROM read as its only settings copy, and the page says so.
 * 2. The pending-restore record (`flashRestorePending/<board>`, device-safety)
 *    BEFORE the flash starts, so a reload or a crash forces the settings check
 *    on the next connect (H81).
 * 3. The worker's `flashBackups`: the firmware image backup (the whole
 *    application section as HEX, with fb/fv and SHA-256) and the raw EEPROM,
 *    stored before the worker writes anything; then `backupsSaved`.
 * 4. After the reconnect: the installed-image record, the settings read
 *    (the readout), `compare`; a required restore through the normal settings
 *    write path; `compare` again; the switch check (reads of the input states
 *    while the user presses each switch); the pending record is cleared only
 *    when the worker's lock is clear.
 */
import { X192A3, parseIntelHex, sha256Hex } from '@synthetos/flasher';
import { planSettingsWrite, type PlannedChange, type SettingValue } from '@synthetos/schema';
import type { BackupFile } from '../live/backup.ts';
import type { DeviceSafetyStore } from '../live/deviceSafety.ts';
import type { FlashBackupsMessage, FlashSourceRequest } from '../machine-worker/flashService.ts';
import type { FlashCommand, SnapshotMessage } from '../machine-worker/rpc.ts';
import {
  installedKey,
  pendingKey,
  recordId,
  settingsRecord,
  toBase64,
  trustKey,
  type BackupRepository,
  type FirmwareBackupRecord,
  type InstalledRecord,
  type PendingRestore,
  type TrustRecord,
} from './store.ts';

export type UpdaterStep =
  | { readonly kind: 'idle' }
  | { readonly kind: 'preparing'; readonly what: string }
  | { readonly kind: 'flashing' }
  | { readonly kind: 'failed'; readonly message: string };

export interface UpdateRequest {
  readonly source: FlashSourceRequest;
  readonly hex: string;
  /** Shown in the records (a release's file, a backup's date, the custom file's name). */
  readonly name: string;
}

export interface UpdaterDeps {
  readonly flash: (command: FlashCommand) => Promise<string | null>;
  /** The full settings backup, or null when this firmware cannot be read token by token. Throws on failure. */
  readonly settingsBackup: () => Promise<BackupFile | null>;
  readonly repo: BackupRepository;
  readonly store: DeviceSafetyStore;
  readonly now: () => Date;
  readonly onChange: () => void;
  /** Re-read the settings (the readout) after the update or a restore. */
  readonly reread: () => void;
  /** The board's settings as last read (the readout). */
  readonly boardSettings: () => Readonly<Record<string, SettingValue>>;
  /**
   * Stage the restore as pending changes: the user reviews and applies them in the Pending changes tray, with the
   * usual C5 (typed WRITE for the switch and homing keys) and the settings write path (SAFETY §4.6).
   */
  readonly stageRestore: (changes: readonly PlannedChange[]) => void;
  /** One read of the input states (in1..in8) through the worker's read path. */
  readonly readInputs: () => Promise<unknown>;
  readonly setInterval: (fn: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

export class FirmwareUpdater {
  readonly #d: UpdaterDeps;
  #step: UpdaterStep = { kind: 'idle' };
  #message: SnapshotMessage | null = null;
  #request: UpdateRequest | null = null;
  #baseline: BackupFile | null = null;
  #savedFor = -1;
  #installedFor = -1;
  #comparedEpoch = -1;
  #comparedReadAt = '';
  #lockEpoch = -1;
  #polling: unknown = null;
  /** Bumped whenever the records change (the hub reloads its lists). */
  revision = 0;

  constructor(deps: UpdaterDeps) {
    this.#d = deps;
  }

  get step(): UpdaterStep {
    return this.#step;
  }

  get pollingSwitches(): boolean {
    return this.#polling !== null;
  }

  #set(step: UpdaterStep): void {
    this.#step = step;
    this.#d.onChange();
  }

  /** Start an update. Resolves once the worker accepted it (or with why not). */
  async start(req: UpdateRequest): Promise<string | null> {
    if (this.#step.kind === 'preparing' || this.#step.kind === 'flashing') return 'An update is already in progress.';
    const s = this.#message?.snapshot ?? null;
    if (s === null || s.base === 'NOT_CONNECTED') return this.#fail('Connect the board first.');
    const boardId = typeof s.identity?.id === 'string' ? s.identity.id : null;
    try {
      this.#set({ kind: 'preparing', what: 'Backing up every setting' });
      const file = await this.#d.settingsBackup();
      if (file !== null) await this.#d.repo.putSettings(settingsRecord(file, 'before-update'));
      this.#baseline = file;
      this.#set({ kind: 'preparing', what: 'Checking the image' });
      const parsed = parseIntelHex(req.hex, X192A3);
      if (!parsed.ok) return this.#fail(`The image was refused: ${parsed.error.message}`);
      const sha256 = await sha256Hex(req.hex);
      if (boardId !== null && file !== null) {
        const pending: PendingRestore = { boardId, baseline: file.tokens, backupId: recordId('settings', boardId, file.takenAt), at: this.#d.now().toISOString() };
        await this.#d.store.set(pendingKey(boardId), pending);
      }
      this.#request = req;
      this.#set({ kind: 'flashing' });
      const refused = await this.#d.flash({ op: 'begin', source: req.source, hex: req.hex, sha256, settingsBackup: file === null ? 'unreadable' : 'saved', baseline: file?.tokens ?? null, recovery: false });
      if (refused !== null) {
        if (boardId !== null) await this.#d.store.delete(pendingKey(boardId)).catch(() => undefined);
        return this.#fail(refused);
      }
      return null;
    } catch (e) {
      return this.#fail(e instanceof Error ? e.message : String(e));
    }
  }

  async #fail(message: string): Promise<string> {
    this.#set({ kind: 'failed', message });
    return message;
  }

  /** After a failure that left no application: the same image through the reset window. */
  async recover(): Promise<string | null> {
    this.#set({ kind: 'flashing' });
    return this.#d.flash({ op: 'recover' });
  }

  cancel(): Promise<string | null> {
    return this.#d.flash({ op: 'cancel' });
  }

  async dismiss(): Promise<void> {
    this.#stopPolling();
    await this.#d.flash({ op: 'dismiss' });
    this.#set({ kind: 'idle' });
  }

  /** The worker's backups: store them, then let it write. */
  async onBackups(b: FlashBackupsMessage): Promise<void> {
    if (b.id === this.#savedFor) return;
    this.#savedFor = b.id;
    try {
      const takenAt = this.#d.now().toISOString();
      const record: FirmwareBackupRecord = {
        id: recordId('firmware', b.boardId, takenAt),
        boardId: b.boardId,
        fb: b.fb,
        fv: b.fv,
        takenAt,
        sha256: await sha256Hex(b.hex),
        size: new TextEncoder().encode(b.hex).length,
        hex: b.hex,
        eeprom: toBase64(b.eeprom),
        crc: b.crc,
        trigger: 'before-update',
      };
      await this.#d.repo.putFirmware(record);
      this.revision++;
      await this.#d.flash({ op: 'backupsSaved', sha256: record.sha256 });
    } catch {
      // Nothing is written until the backups are saved: without the answer the worker leaves the bootloader untouched.
      await this.#d.flash({ op: 'cancel' });
    }
    this.#d.onChange();
  }

  /** Every snapshot from the worker. */
  onSnapshot(m: SnapshotMessage, readoutDone: boolean, readoutAt: string): void {
    this.#message = m;
    const s = m.snapshot;
    const flash = m.flash ?? null;
    if (this.#step.kind === 'flashing' && flash !== null && (flash.phase === 'failed' || flash.phase === 'done')) this.#set(flash.phase === 'failed' ? { kind: 'failed', message: flash.message ?? 'The update failed.' } : { kind: 'idle' });
    // The installed image, once the board answered with its new build.
    if (flash !== null && flash.phase === 'done' && flash.id !== this.#installedFor && flash.boardId !== null && this.#request !== null) {
      this.#installedFor = flash.id;
      const installed: InstalledRecord = { boardId: flash.boardId, sha256: flash.target.sha256, fb: flash.versionCheck?.reported ?? flash.target.fb, name: this.#request.name, source: flash.source, at: this.#d.now().toISOString() };
      void this.#d.store.set(installedKey(flash.boardId), installed);
      this.revision++;
    }
    // A board this browser left mid-update (a reload): re-arm the worker's lock once per link.
    const id = typeof s.identity?.id === 'string' ? s.identity.id : null;
    if (id !== null && s.epoch !== this.#lockEpoch && (m.postFlash === null || m.postFlash === undefined) && m.flasher === true) {
      this.#lockEpoch = s.epoch;
      void this.#d.store.get(pendingKey(id)).then((v) => {
        const p = v as PendingRestore | undefined;
        if (p !== undefined) void this.#d.flash({ op: 'lock', boardId: id, baseline: p.baseline });
      });
    }
    const post = m.postFlash ?? null;
    if (post === null || post.boardId !== id) {
      this.#stopPolling();
      return;
    }
    // Compare once the settings were read after the update (and again after each restore's re-read).
    if ((post.phase === 'awaitingRead' || post.phase === 'restoreRequired') && readoutDone && (s.epoch !== this.#comparedEpoch || readoutAt !== this.#comparedReadAt)) {
      this.#comparedEpoch = s.epoch;
      this.#comparedReadAt = readoutAt;
      void this.#d.flash({ op: 'compare' });
    }
    if (post.phase === 'clear') {
      this.#stopPolling();
      void this.#d.store.delete(pendingKey(post.boardId));
    }
    if (post.phase !== 'switchCheck') this.#stopPolling();
  }

  /** The required restore: the backup's values for every setting that differs, staged for the settings write path. */
  async restore(): Promise<string | null> {
    const m = this.#message;
    const post = m?.postFlash ?? null;
    const dialect = m?.snapshot.classification?.dialectId ?? null;
    if (post === null || post.phase !== 'restoreRequired' || dialect === null) return 'There is nothing to restore.';
    const pending = (await this.#d.store.get(pendingKey(post.boardId))) as PendingRestore | undefined;
    const baseline = pending?.baseline ?? this.#baseline?.tokens ?? null;
    if (baseline === null) return 'The backup taken before the update is not on this computer.';
    const proposed = post.differences.map((d) => {
      const v = baseline[d.key];
      return { key: d.key, value: typeof v === 'number' ? v : d.backup };
    });
    const plan = planSettingsWrite(dialect, proposed, this.#d.boardSettings());
    if (!plan.ok) return `The restore was refused: ${plan.refused.map((r) => r.message).join('; ')}`;
    this.#d.stageRestore(plan.changes);
    return null;
  }

  /** The switch check: read the input states every 300 ms while the user presses each switch. */
  startSwitchCheck(): void {
    if (this.#polling !== null) return;
    this.#polling = this.#d.setInterval(() => void this.#d.readInputs(), 300);
    this.#d.onChange();
  }

  async finishSwitchCheck(): Promise<string | null> {
    const refused = await this.#d.flash({ op: 'switchCheckDone' });
    if (refused === null) this.#stopPolling();
    return refused;
  }

  #stopPolling(): void {
    if (this.#polling === null) return;
    this.#d.clearInterval(this.#polling);
    this.#polling = null;
    this.#d.onChange();
  }

  // --- Trust (SAFETY H87) ----------------------------------------------------------------------------------------

  /** Trust the custom build this browser just flashed onto this board (C38). */
  async trustInstalled(boardId: string): Promise<string | null> {
    const installed = (await this.#d.store.get(installedKey(boardId))) as InstalledRecord | undefined;
    const s = this.#message?.snapshot;
    if (installed === undefined || installed.source !== 'custom') return 'Only custom firmware this browser flashed onto this board can be trusted.';
    if (s?.identity?.id !== boardId || typeof s.identity.fb !== 'number') return 'Connect the board first.';
    const dialect = s.classification?.dialectId;
    if (dialect !== 'tinyg-en' && dialect !== 'tinyg-440') return 'This build was not identified as TinyG firmware, so it cannot be trusted.';
    const record: TrustRecord = { boardId, sha256: installed.sha256, dialect, fb: s.identity.fb, fbs: s.identity.fbs ?? null, name: installed.name, trustedAt: this.#d.now().toISOString() };
    await this.#d.store.set(trustKey(boardId, installed.sha256), record);
    this.revision++;
    this.#d.onChange();
    return null;
  }

  async revokeTrust(boardId: string, sha256: string): Promise<void> {
    await this.#d.store.delete(trustKey(boardId, sha256));
    this.revision++;
    this.#d.onChange();
  }
}
