/**
 * Firmware & Backups on the page (SAFETY §4.8 as amended 2026-11-03): wires
 * the records (firmware/store.ts), the page side of an update
 * (firmware/updater.ts) and the signed release list into the workspace model.
 * Everything that reaches the board goes through the machine worker
 * (`flash`, `read`, `settingWrite` requests); this module never touches a port.
 */
import { sha256Hex } from '@synthetos/flasher';
import { releasePath, verifyFirmwareReleases, type FirmwareRelease } from '@synthetos/protocol';
import { restoreChanges, settingsReadGroups, type PlannedChange, type SettingValue } from '@synthetos/schema';
import firmwareReleasesFile from '../../../../firmware/releases.json';
import { fetchFirmwareImage } from '../cloud/live.ts';
import { FirmwareUpdater } from '../firmware/updater.ts';
import { installedKey, memoryRepository, openRepository, parseBackupImport, settingsRecord, trustRecords, type BackupRepository, type InstalledRecord } from '../firmware/store.ts';
import { approvalEnvironment } from '../machine-worker/approval.ts';
import type { FlashBackupsPost, FlashCommand, SnapshotMessage } from '../machine-worker/rpc.ts';
import type { FirmwareActions, FirmwareDownload, FirmwareHubView, ReleaseImage } from '../workspace/model.ts';
import { setDraft } from '../workspace/boardFacts.ts';
import type { BackupFile } from './backup.ts';
import type { DeviceSafetyStore } from './deviceSafety.ts';
import { downloadTranscript } from './transcriptDownload.ts';

export interface FirmwareHubDeps {
  readonly store: DeviceSafetyStore;
  readonly flash: (command: FlashCommand) => Promise<string | null>;
  readonly read: (tokens: readonly string[]) => Promise<unknown>;
  /** The full settings backup through the read path (live/backup.ts). */
  readonly runBackup: () => Promise<BackupFile>;
  readonly boardSettings: () => Readonly<Record<string, SettingValue>>;
  readonly stageRestore: (changes: readonly PlannedChange[]) => void;
  readonly reread: () => void;
  readonly onChange: () => void;
}

export interface FirmwareHub {
  readonly view: () => FirmwareHubView;
  readonly actions: FirmwareActions;
  readonly updater: FirmwareUpdater;
  onSnapshot(m: SnapshotMessage, readoutDone: boolean, readoutSeq: number): void;
  onBackups(post: FlashBackupsPost): void;
  /** A backup the page took itself (on demand, before an apply): stored with its trigger. */
  record(file: BackupFile, trigger: 'manual' | 'before-apply'): Promise<void>;
}

export async function mountFirmware(deps: FirmwareHubDeps): Promise<FirmwareHub> {
  let repo: BackupRepository;
  try {
    repo = await openRepository(globalThis.indexedDB);
  } catch {
    repo = memoryRepository();
  }
  const environment = approvalEnvironment(location.origin);
  const verdict = await verifyFirmwareReleases(firmwareReleasesFile as unknown, { environment, now: new Date() }).catch(() => null);
  const releases: FirmwareHubView['releases'] = verdict !== null && verdict.ok ? { ok: true, list: verdict.releases } : { ok: false, reason: verdict === null ? 'it could not be read' : verdict.rejection };
  let message: SnapshotMessage | null = null;
  let settings: FirmwareHubView['settings'] = [];
  let firmware: FirmwareHubView['firmware'] = [];
  let trust: FirmwareHubView['trust'] = [];
  let installed: InstalledRecord | null = null;
  let notice: FirmwareHubView['notice'] = null;
  let compare: FirmwareHubView['compare'] = null;
  let download: FirmwareDownload | null = null;
  let loadedRevision = -1;
  let installedFor: string | null = null;

  const updater = new FirmwareUpdater({
    flash: deps.flash,
    settingsBackup: async () => {
      const dialect = message?.snapshot.classification?.dialectId ?? null;
      if (dialect === null || settingsReadGroups(dialect).length === 0) return null;
      return deps.runBackup();
    },
    repo,
    store: deps.store,
    now: () => new Date(),
    onChange: () => {
      void reload();
      deps.onChange();
    },
    reread: deps.reread,
    boardSettings: deps.boardSettings,
    stageRestore: deps.stageRestore,
    readInputs: () => deps.read(['in']),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  });

  async function reload(): Promise<void> {
    const boardId = typeof message?.snapshot.identity?.id === 'string' ? message.snapshot.identity.id : null;
    if (loadedRevision === updater.revision && installedFor === boardId) return;
    loadedRevision = updater.revision;
    installedFor = boardId;
    settings = (await repo.listSettings()).map(({ file: _f, ...rest }) => rest);
    firmware = (await repo.listFirmware()).map(({ hex: _h, eeprom: _e, ...rest }) => rest);
    trust = await trustRecords(deps.store);
    installed = boardId === null ? null : (((await deps.store.get(installedKey(boardId))) as InstalledRecord | undefined) ?? null);
    deps.onChange();
  }

  const say = (kind: 'ok' | 'error', text: string): void => {
    notice = { kind, text };
    deps.onChange();
  };
  const changed = (): void => {
    updater.revision++;
    void reload();
  };

  const setDownload = (d: FirmwareDownload | null): void => {
    download = d;
    deps.onChange();
  };

  /**
   * The page's own check of an image against its signed entry (SAFETY H22, H79): the exact bytes must hash to the
   * entry's SHA-256 at the entry's size. The machine worker checks again before it parses anything (authorizeFlash).
   */
  async function checkedImage(release: FirmwareRelease, bytes: Uint8Array, from: ReleaseImage['from']): Promise<{ readonly ok: true; readonly image: ReleaseImage } | { readonly ok: false; readonly message: string }> {
    if (bytes.byteLength !== release.size) return { ok: false, message: `The file is ${bytes.byteLength} bytes, not the ${release.size} the signed release list names for ${release.file}. Nothing was flashed.` };
    const sha256 = await sha256Hex(bytes);
    if (sha256 !== release.sha256) return { ok: false, message: `The file's SHA-256 is not the one the signed release list names for ${release.file}. It may be damaged or altered; nothing was flashed.` };
    return { ok: true, image: { release, hex: new TextDecoder().decode(bytes), from } };
  }

  const localCopyHint = (release: FirmwareRelease): string => `Use a local copy: choose ${release.file}; Run checks it against the signed SHA-256.`;

  const actions: FirmwareActions = {
    downloadRelease: async (release) => {
      if (download !== null && download.phase === 'fetching') return { ok: false, message: 'A download is already running.' };
      const path = releasePath(release);
      setDownload({ file: release.file, phase: 'fetching', received: 0, total: release.size, message: null });
      const fetched = await fetchFirmwareImage(path, release.size, (p) => setDownload({ file: release.file, phase: 'fetching', received: p.received, total: p.total ?? release.size, message: null }));
      if (!fetched.ok) {
        const message = fetched.reason === 'not-served' ? `${release.file} is not served by this site${release.repo === null ? '' : ' (GitHub Releases did not answer, or the file there is not the listed one)'}. ${localCopyHint(release)}` : fetched.reason === 'too-large' ? `The download is longer than the ${release.size} bytes the signed release list names for ${release.file}; nothing was flashed. ${localCopyHint(release)}` : `The download failed. Check the connection and try again, or ${localCopyHint(release).replace(/^Use/, 'use')}`;
        setDownload({ file: release.file, phase: 'failed', received: 0, total: release.size, message });
        return { ok: false, message };
      }
      setDownload({ file: release.file, phase: 'checking', received: fetched.bytes.byteLength, total: release.size, message: null });
      const checked = await checkedImage(release, fetched.bytes, 'site');
      setDownload({ file: release.file, phase: checked.ok ? 'ready' : 'failed', received: fetched.bytes.byteLength, total: release.size, message: checked.ok ? null : `${checked.message} ${localCopyHint(release)}` });
      return checked.ok ? checked : { ok: false, message: `${checked.message} ${localCopyHint(release)}` };
    },
    checkLocalCopy: async (release, text) => {
      const checked = await checkedImage(release, new TextEncoder().encode(text), 'local');
      setDownload(checked.ok ? null : { file: release.file, phase: 'failed', received: 0, total: release.size, message: checked.message });
      return checked;
    },
    updateRelease: async (image) => {
      const { release } = image;
      // Checked again right here: the image given to the worker is the one that was checked, whatever the panel held.
      const checked = await checkedImage(release, new TextEncoder().encode(image.hex), image.from);
      if (!checked.ok) return checked.message;
      setDownload(null);
      return updater.start({ source: { kind: 'release', hv: release.hv, fb: release.fb, file: release.file }, hex: image.hex, name: release.file });
    },
    putBack: async (id) => {
      const record = (await repo.listFirmware()).find((f) => f.id === id);
      if (record === undefined || record.boardId === null) return 'That firmware backup is not on this computer.';
      return updater.start({ source: { kind: 'backup', boardId: record.boardId, fb: record.fb }, hex: record.hex, name: `firmware backup ${record.takenAt}` });
    },
    flashCustom: (name, text) => updater.start({ source: { kind: 'custom', name, confirmed: true }, hex: text, name }),
    recover: () => updater.recover(),
    cancel: () => updater.cancel(),
    reconnect: () => deps.flash({ op: 'reconnect' }),
    dismiss: () => updater.dismiss(),
    restore: () => updater.restore(),
    startSwitchCheck: () => updater.startSwitchCheck(),
    finishSwitchCheck: () => updater.finishSwitchCheck(),
    backupNow: async () => {
      try {
        await record(await deps.runBackup(), 'manual');
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    exportSettings: async (id) => {
      const r = (await repo.listSettings()).find((x) => x.id === id);
      if (r === undefined) return;
      downloadTranscript(document, `${JSON.stringify(r.file, null, 2)}\n`, `synthetos-settings-${(r.boardId ?? 'no-board-id').replace(/[^A-Za-z0-9_-]+/g, '-')}-${r.takenAt.slice(0, 19).replace(/:/g, '')}.json`, 'application/json');
    },
    importSettings: async (text) => {
      const file = parseBackupImport(text);
      if (file === null) return 'This is not a Run settings backup.';
      await repo.putSettings(settingsRecord(file, 'import'));
      changed();
      say('ok', `Imported the backup of board ${file.board.id ?? 'unknown'} taken ${file.takenAt}.`);
      return null;
    },
    deleteSettings: async (id) => {
      await repo.deleteSettings(id);
      changed();
    },
    compareSettings: async (id) => {
      const r = (await repo.listSettings()).find((x) => x.id === id);
      const dialect = message?.snapshot.classification?.dialectId ?? null;
      if (r === undefined) return 'That backup is not on this computer.';
      if (dialect === null) return 'Connect the board to compare.';
      const result = restoreChanges(dialect, r.file.tokens, deps.boardSettings());
      compare = { id, changes: result.changes.length, same: result.same, skipped: result.skipped.length, keys: result.changes.map((c) => c.key) };
      deps.onChange();
      return null;
    },
    stageSettings: async (id) => {
      const r = (await repo.listSettings()).find((x) => x.id === id);
      const dialect = message?.snapshot.classification?.dialectId ?? null;
      if (r === undefined) return 'That backup is not on this computer.';
      if (dialect === null) return 'Connect the board first.';
      if (r.file.board.dialect !== dialect) return `This backup is from ${r.file.board.dialect}, not ${dialect}.`;
      const result = restoreChanges(dialect, r.file.tokens, deps.boardSettings());
      for (const c of result.changes) setDraft(c.key, c.value);
      say('ok', `${result.changes.length} settings are now pending changes; review them in Pending changes, then Apply.`);
      return null;
    },
    downloadFirmware: async (id) => {
      const r = (await repo.listFirmware()).find((f) => f.id === id);
      if (r === undefined) return;
      downloadTranscript(document, r.hex, `synthetos-firmware-${(r.boardId ?? 'no-board-id').replace(/[^A-Za-z0-9_-]+/g, '-')}-${typeof r.fb === 'number' ? r.fb.toFixed(2) : 'unknown'}-${r.takenAt.slice(0, 19).replace(/:/g, '')}.hex`, 'text/plain');
    },
    deleteFirmware: async (id) => {
      await repo.deleteFirmware(id);
      changed();
    },
    trust: async (boardId) => {
      const r = await updater.trustInstalled(boardId);
      if (r === null) say('ok', 'Trusted on this board. Disconnect and connect again for it to take effect.');
      return r;
    },
    revoke: async (boardId, sha256) => {
      await updater.revokeTrust(boardId, sha256);
      say('ok', 'Trust revoked. The board is read-only from the next connect.');
    },
  };

  async function record(file: BackupFile, trigger: 'manual' | 'before-apply'): Promise<void> {
    await repo.putSettings(settingsRecord(file, trigger));
    changed();
  }

  void reload();
  return {
    updater,
    actions,
    record,
    view: () => ({ releases, step: updater.step, settings, firmware, trust, installed, pollingSwitches: updater.pollingSwitches, notice, compare, download }),
    onSnapshot(m, readoutDone, readoutSeq) {
      const before = message?.snapshot.identity?.id;
      message = m;
      updater.onSnapshot(m, readoutDone, String(readoutSeq));
      if (m.snapshot.identity?.id !== before || updater.revision !== loadedRevision) void reload();
    },
    onBackups(post) {
      void updater.onBackups(post.backups).then(() => changed());
    },
  };
}
