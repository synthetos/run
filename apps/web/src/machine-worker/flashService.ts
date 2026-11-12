/**
 * The firmware update in `machine.worker` (SAFETY §4.8 as amended 2026-11-03,
 * H79-H88; WORKSPACE_FEATURES "Firmware update").
 *
 * The page asks; this service decides and does. In order:
 * 1. **Authorize** (packages/flasher authorize.ts): the `.hex` text the page
 *    passes is hashed and parsed here. A signed release is looked up in the
 *    release list THIS WORKER verified (bundled, never the page's copy) and
 *    must be for the board's hardware version; an image for the simulated
 *    board is refused unless the port is the test kit's (`source.kind`
 *    `fake`); a firmware backup only goes back on its own board; custom
 *    firmware needs the user's explicit confirmation. The page must have
 *    saved the settings backup first.
 * 2. **Enter the bootloader** through the machine session's `flash` intent:
 *    the idle gate, `{"boot":1}`, the session closes its link.
 *    Recovery (a board with no application) skips this: the user unplugs and
 *    replugs USB while run sends ESC (a countdown).
 * 3. **Open the same port in bootloader role**, once the session's link has
 *    closed: the transport source is asked for the port the user confirmed at
 *    Connect (the same selector; never a new choice) and `BootloaderLink`
 *    opens it with a capability from the authorization. Everything that link
 *    writes and receives goes into the flash transcript (`flashTranscript`),
 *    and a bootloader that never answers is reported with what came back.
 * 4. **Flash** (packages/flasher flashRun.ts): backups (raw EEPROM, the whole
 *    application section) are posted to the page, and nothing is written
 *    until the page answers that it stored them (`backupsSaved`, with the
 *    image backup's SHA-256 as this worker computed it); then the stub page,
 *    the pages, the read-back, page 0, the CRC and the exit.
 * 5. **Reconnect** the session on the same port and check the version.
 * 6. **The post-flash lock** (H81, H82): jobs, jog and settings writes stay
 *    locked for that board until the live settings match the backup taken
 *    before the update (a restore, through the normal settings writes, is the
 *    only write allowed meanwhile, and only to the backup's values) and, when
 *    the update changed switch or homing settings, the switch check passed:
 *    every configured limit switch input was seen open and closed by this
 *    worker's own reads.
 *
 * Two tabs cannot flash at once: only the tab whose worker holds the port
 * can, and a flash in progress refuses a second (H88).
 */
import { BootloaderLink, EventLog, sessionSettings, type MachineSession, type PortSelector, type SessionClock, type SessionSnapshot, type Transport, type TransportSource } from '@synthetos/machine';
import {
  X192A3,
  XbootClient,
  authorizeFlash,
  crc16,
  planFlash,
  recoverEntry,
  runFlash,
  sha256Hex,
  toIntelHex,
  type FlashAuthorization,
  type FlashBackups,
  type FlashOutcome,
  type FlashSource,
} from '@synthetos/flasher';
import { releasesForHardware, type FirmwareReleases } from '@synthetos/protocol';
import { categoryOf, restoreChanges, type SettingValue } from '@synthetos/schema';
import type { BootloaderMark, BootloaderMarks } from './bootloaderMark.ts';
import { entryDiagnosis } from './flashDiagnosis.ts';

/** How long the page has to store the backups before the run gives up (nothing written). */
export const BACKUP_SAVE_MS = 60_000;
/** The recovery countdown: unplug and replug within this time. */
export const RECOVERY_MS = 45_000;
/** Maximum silent wait for a fresh firmware-ready banner after verified exit. */
export const FIRMWARE_BANNER_MS = 10_000;
export const BOOTLOADER_ADVICE = 'The board may still be in its bootloader. Sending normal commands now could damage it. Unplug USB and power, plug them back in, then try Connect or recovery.';
/** Longest `.hex` text the page may pass. */
export const MAX_HEX_TEXT = 2 * 1024 * 1024;

export type FlashSourceRequest =
  | { readonly kind: 'release'; readonly hv: number; readonly fb: number; readonly file: string }
  | { readonly kind: 'backup'; readonly boardId: string; readonly fb: number | null }
  | { readonly kind: 'custom'; readonly name: string; readonly confirmed: boolean };

export interface FlashBegin {
  readonly source: FlashSourceRequest;
  readonly hex: string;
  readonly sha256: string;
  /** `saved`: the token-by-token settings backup is stored; `unreadable`: this firmware cannot be read that way. */
  readonly settingsBackup: 'saved' | 'unreadable';
  /** The settings backup's tokens: the post-flash baseline (null when unreadable). */
  readonly baseline: Readonly<Record<string, number | string>> | null;
  /** Recovery: the board has no application; enter through the reset window instead of `{"boot":1}`. */
  readonly recovery: boolean;
}

export type FlashPhaseView =
  | 'authorizing'
  | 'entering'
  | 'recovery'
  | 'enter'
  | 'identify'
  | 'backup'
  | 'saving'
  | 'write'
  | 'verify'
  | 'final'
  | 'crc'
  | 'exit'
  | 'reconnecting'
  | 'done'
  | 'failed';

export interface FlashView {
  readonly id: number;
  readonly phase: FlashPhaseView;
  readonly done: number;
  readonly of: number;
  readonly note: string | null;
  readonly source: FlashSourceRequest['kind'];
  readonly target: { readonly fb: number | null; readonly label: string; readonly sha256: string };
  readonly boardId: string | null;
  /**
   * The board as the session last read it before the update (id, hardware version, firmware build and version). The
   * session closes for the bootloader, so the page shows this while the update runs, not "not connected".
   */
  readonly board: { readonly id: string | null; readonly hv: number | null; readonly fb: number | null; readonly fv: number | null } | null;
  /** Seconds left in the recovery countdown. */
  readonly countdown: number | null;
  /** Set once any page was written: the board may hold no complete application until the run completes. */
  readonly wrote: boolean;
  readonly message: string | null;
  /** True after a failure that left no application: recovery is offered. */
  readonly recoveryOffered: boolean;
  /** After the reconnect: what the board reports against what was flashed. */
  readonly versionCheck: { readonly expected: number | null; readonly reported: number | null; readonly ok: boolean } | null;
  readonly result: { readonly written: number; readonly unchanged: number; readonly resyncs: number; readonly crc: number } | null;
}

export type PostFlashPhase = 'awaitingRead' | 'restoreRequired' | 'switchCheck' | 'clear';

export interface PostFlashView {
  readonly boardId: string;
  readonly phase: PostFlashPhase;
  /** Settings that differ from the backup taken before the update. */
  readonly differences: readonly { readonly key: string; readonly backup: number; readonly board: SettingValue | null }[];
  /** The update changed switch or homing settings (W45). */
  readonly switchesChanged: boolean;
  /** Inputs the switch check needs (1..8) and the states this worker read for each. */
  readonly inputs: readonly { readonly input: number; readonly label: string; readonly seenOpen: boolean; readonly seenClosed: boolean }[];
  readonly baselineKeys: number;
}

/** The backups the page must store before anything is written. Posted once per run. */
export interface FlashBackupsMessage {
  readonly id: number;
  readonly boardId: string | null;
  readonly fb: number | null;
  readonly fv: number | null;
  readonly eeprom: Uint8Array;
  /** The whole application section as Intel HEX (the firmware image backup). */
  readonly hex: string;
  readonly sha256: string;
  readonly crc: number;
}

export interface FlashServiceDeps {
  readonly marks: BootloaderMarks;
  readonly session: MachineSession;
  readonly source: TransportSource;
  readonly clock: SessionClock;
  /** This worker's verified release list (null when none verifies for its origin). */
  readonly releases: () => Promise<FirmwareReleases | null>;
  /** The flash phase switch is on in this worker's release. */
  readonly enabled: boolean;
  readonly onChange: () => void;
  readonly postBackups: (message: FlashBackupsMessage) => void;
  /** Hands the next session connect this transport (the host's prepared-port seam). */
  readonly approveTransport: (port: PortSelector, transport: Transport) => void;
}

export type FlashReply = { readonly ok: true } | { readonly ok: false; readonly message: string };

const AXIS_INPUTS: readonly { readonly axis: string; readonly min: number; readonly max: number }[] = [
  { axis: 'x', min: 1, max: 2 },
  { axis: 'y', min: 3, max: 4 },
  { axis: 'z', min: 5, max: 6 },
  { axis: 'a', min: 7, max: 8 },
];

function fail(message: string): FlashReply {
  return { ok: false, message };
}

export class FlashService {
  readonly #d: FlashServiceDeps;
  #id = 0;
  #view: FlashView | null = null;
  #auth: FlashAuthorization | null = null;
  #begin: FlashBegin | null = null;
  #port: PortSelector | null = null;
  #board: { id: string | null; hv: number | null; fb: number | null; fv: number | null } | null = null;
  #saved: { resolve: () => void; reject: (e: Error) => void; sha256: string } | null = null;
  #cancelled = false;
  #running = false;
  #post: (PostFlashView & { readonly baseline: Readonly<Record<string, number | string>> }) | null = null;
  #seen = new Map<number, { open: boolean; closed: boolean }>();
  #installed = new Map<string, { sha256: string; fb: number | null }>();
  /** The bootloader link's bytes for the last run, from the moment it asked for the bootloader. */
  #transcript: EventLog | null = null;

  constructor(deps: FlashServiceDeps) {
    this.#d = deps;
    deps.session.subscribe((s) => this.#onSnapshot(s));
  }

  get view(): FlashView | null {
    return this.#view;
  }

  get busy(): boolean {
    return this.#running;
  }

  /** The post-flash lock for the connected board, if any. */
  get postFlash(): PostFlashView | null {
    if (this.#post === null) return null;
    const { baseline: _b, ...view } = this.#post;
    return view;
  }

  /**
   * The last run's flash transcript (`{t, dir, hex}` JSONL, `t` in ms since the run asked for the bootloader): every
   * byte the bootloader link wrote and received. Null before the first run or when it passed its bound.
   */
  flashTranscript(): { readonly jsonl: string; readonly events: number } | null {
    const log = this.#transcript;
    if (log === null || log.truncated) return null;
    return Object.freeze({ jsonl: log.toJsonl(), events: log.events().length });
  }

  /** The image this worker last flashed onto each board (the trust check reads it). */
  installed(boardId: string): { sha256: string; fb: number | null } | null {
    return this.#installed.get(boardId) ?? null;
  }

  /**
   * The lock decision for a request while a post-flash lock is active on the connected board: null when it may go
   * on, else why not. Stops are never locked (the host never routes them here).
   */
  lockReason(kind: 'motion' | 'job' | 'setting', setting?: { readonly key: string; readonly value: number }): string | null {
    if (this.#running) return 'A firmware update is in progress.';
    const p = this.#post;
    const id = this.#d.session.snapshot.identity?.id ?? null;
    if (p === null || p.phase === 'clear' || p.boardId !== id) return null;
    if (kind === 'setting' && p.phase === 'restoreRequired' && setting !== undefined) {
      const want = p.differences.find((d) => d.key === setting.key);
      if (want !== undefined && want.backup === setting.value) return null;
      return `Only the restore of your settings is written now (${setting.key} is not one of them, or not its backed-up value).`;
    }
    if (p.phase === 'switchCheck') return 'Check your limit switches. The update changed the switch settings.';
    if (p.phase === 'restoreRequired') return 'Restore your settings first: the update changed them.';
    return 'Run is reading the settings after the update.';
  }

  /** The page remembers a lock for this board (a reload after a flash): re-arm it. */
  restoreLock(boardId: string, baseline: Readonly<Record<string, number | string>>): void {
    if (this.#post !== null && this.#post.boardId === boardId) return;
    this.#post = { boardId, phase: 'awaitingRead', differences: [], switchesChanged: false, inputs: [], baselineKeys: Object.keys(baseline).length, baseline };
    this.#d.onChange();
  }

  async begin(b: FlashBegin): Promise<FlashReply> {
    if (!this.#d.enabled) return fail('Firmware updates are not available on this site.');
    if (this.#running) return fail('A firmware update is already running.');
    if (typeof b.hex !== 'string' || b.hex.length === 0 || b.hex.length > MAX_HEX_TEXT) return fail('The image is empty or too large.');
    const s = this.#d.session.snapshot;
    let port: PortSelector | null;
    let board: { id: string | null; hv: number | null; fb: number | null; fv: number | null } | null;
    if (b.recovery) {
      port = this.#port;
      board = this.#board;
      if (port === null || board === null) return fail('Recovery needs the port this page used for the board: connect to it first.');
      if (s.base !== 'NOT_CONNECTED') return fail('Disconnect before recovery.');
    } else {
      if (s.base === 'NOT_CONNECTED' || s.portSelector === null) return fail('Connect the board first.');
      port = s.portSelector;
      board = boardFacts(s);
    }
    let source: FlashSource;
    const req = b.source;
    if (req.kind === 'release') {
      const releases = await this.#d.releases();
      const hw = releasesForHardware(releases, req.hv);
      const release = hw?.releases.find((r) => r.file === req.file && r.fb === req.fb);
      if (release === undefined) return fail('That release is not in the signed release list this site verified.');
      source = { kind: 'release', release };
    } else if (req.kind === 'backup') {
      source = { kind: 'backup', boardId: req.boardId, fb: req.fb };
    } else {
      source = { kind: 'custom', confirmed: req.confirmed === true, name: req.name };
    }
    const auth = await authorizeFlash({
      source,
      hexText: b.hex,
      sha256: b.sha256,
      board: { id: board.id, hv: board.hv, fb: board.fb },
      part: X192A3,
      settingsBackup: b.settingsBackup,
      simulatedPort: this.#d.source.kind === 'fake',
    });
    if (!auth.ok) return fail(auth.message);
    this.#auth?.finish();
    this.#auth = auth.authorization;
    this.#begin = b;
    this.#port = port;
    this.#board = board;
    this.#cancelled = false;
    this.#running = true;
    const id = ++this.#id;
    const fb = source.kind === 'release' ? source.release.fb : source.kind === 'backup' ? source.fb : null;
    const label = source.kind === 'release' ? `${source.release.fb.toFixed(2)} (signed release)` : source.kind === 'backup' ? `the firmware backup${source.fb === null ? '' : ` (${source.fb.toFixed(2)})`}` : `${source.name} (unsigned custom firmware)`;
    this.#view = {
      id,
      phase: b.recovery ? 'recovery' : 'entering',
      done: 0,
      of: 0,
      note: null,
      source: source.kind,
      target: { fb, label, sha256: auth.authorization.sha256 },
      boardId: board.id,
      board: Object.freeze({ ...board }),
      countdown: null,
      wrote: false,
      message: null,
      recoveryOffered: false,
      versionCheck: null,
      result: null,
    };
    this.#d.onChange();
    void this.#run(id, b.recovery);
    return { ok: true };
  }

  /** The page stored the backups: `sha256` is the image backup's, as the page stored it. */
  backupsSaved(sha256: string): FlashReply {
    const w = this.#saved;
    if (w === null) return fail('No backups are waiting to be saved.');
    if (sha256 !== w.sha256) {
      w.reject(new Error('the stored image backup is not the one read from the board'));
      this.#saved = null;
      return fail('The stored image backup does not match what was read from the board.');
    }
    this.#saved = null;
    w.resolve();
    return { ok: true };
  }

  /** Cancel: honoured only before the first page is written. */
  cancel(): FlashReply {
    if (!this.#running) return fail('Nothing to cancel.');
    if (this.#view?.wrote === true) return fail('Writing has started: it cannot be cancelled. Let it finish.');
    this.#cancelled = true;
    this.#saved?.reject(new Error('cancelled'));
    this.#saved = null;
    return { ok: true };
  }

  /** After a failure that left no application: try again through the reset window with the same image. */
  async recover(): Promise<FlashReply> {
    const b = this.#begin;
    if (b === null || this.#running) return fail('Nothing to recover.');
    return this.begin({ ...b, recovery: true });
  }

  /** Reconnect the session after the update (again, when the first try found the board still booting). */
  async reconnect(): Promise<FlashReply> {
    const port = this.#port;
    if (port === null) return fail('No port to reconnect to.');
    if (this.#d.session.snapshot.base !== 'NOT_CONNECTED') return fail('Already connected.');
    return this.#connect(port);
  }

  /** The page read the settings after the update: compare them with the backup. */
  compare(): FlashReply {
    const p = this.#post;
    const s = this.#d.session.snapshot;
    if (p === null) return fail('No update to check.');
    if (s.identity?.id !== p.boardId) return fail('This is not the board that was updated.');
    const dialect = s.classification?.dialectId ?? null;
    if (dialect === null) return fail('The board was not identified after the update, so its settings cannot be compared.');
    const board = sessionSettings(dialect, s.values);
    const diff = restoreChanges(dialect, p.baseline, board);
    const differences = diff.changes.map((c) => ({ key: c.key, backup: c.value, board: board[c.key] ?? null }));
    const switchesChanged = p.switchesChanged || differences.some((d) => categoryOf(d.key) === 'switch' || categoryOf(d.key) === 'homing');
    let phase: PostFlashPhase;
    if (differences.length > 0) phase = 'restoreRequired';
    else if (switchesChanged) phase = 'switchCheck';
    else phase = 'clear';
    const inputs = phase === 'switchCheck' ? this.#requiredInputs(board) : [];
    if (phase === 'switchCheck' && p.phase !== 'switchCheck') this.#seen.clear();
    this.#post = { ...p, phase, differences, switchesChanged, inputs };
    this.#refreshInputs();
    this.#d.onChange();
    return { ok: true };
  }

  /** The user says every switch was pressed: allowed only when this worker saw each one open and closed. */
  switchCheckDone(): FlashReply {
    const p = this.#post;
    if (p === null || p.phase !== 'switchCheck') return fail('There is no switch check to finish.');
    const missing = p.inputs.filter((i) => !(i.seenOpen && i.seenClosed));
    if (missing.length > 0) return fail(`Not seen changing yet: ${missing.map((m) => m.label).join(', ')}. Press and release each one.`);
    this.#post = { ...p, phase: 'clear' };
    this.#d.onChange();
    return { ok: true };
  }

  dismiss(): FlashReply {
    if (this.#running) return fail('The update is still running.');
    this.#view = null;
    if (this.#post?.phase === 'clear') this.#post = null;
    this.#d.onChange();
    return { ok: true };
  }

  // --- internals -------------------------------------------------------------

  #set(patch: Partial<FlashView>): void {
    if (this.#view === null) return;
    this.#view = { ...this.#view, ...patch };
    this.#d.onChange();
  }

  #requiredInputs(board: Readonly<Record<string, SettingValue>>): PostFlashView['inputs'] {
    const out: { input: number; label: string; seenOpen: boolean; seenClosed: boolean }[] = [];
    for (const a of AXIS_INPUTS) {
      if (typeof board[`${a.axis}sn`] === 'number' && board[`${a.axis}sn`] !== 0) out.push({ input: a.min, label: `${a.axis.toUpperCase()} min (input ${a.min})`, seenOpen: false, seenClosed: false });
      if (typeof board[`${a.axis}sx`] === 'number' && board[`${a.axis}sx`] !== 0) out.push({ input: a.max, label: `${a.axis.toUpperCase()} max (input ${a.max})`, seenOpen: false, seenClosed: false });
    }
    return out;
  }

  #refreshInputs(): void {
    const p = this.#post;
    if (p === null || p.phase !== 'switchCheck') return;
    const inputs = p.inputs.map((i) => {
      const seen = this.#seen.get(i.input);
      return { ...i, seenOpen: seen?.open === true, seenClosed: seen?.closed === true };
    });
    this.#post = { ...p, inputs };
  }

  #onSnapshot(s: SessionSnapshot): void {
    if (s.base !== 'NOT_CONNECTED' && s.portSelector !== null && s.identity !== null) {
      this.#port = s.portSelector;
      this.#board = boardFacts(s);
    }
    const p = this.#post;
    if (p === null || p.phase !== 'switchCheck' || s.identity?.id !== p.boardId) return;
    let changed = false;
    for (const i of p.inputs) {
      // A single read (`in5`) or the group (`in`, answered as {"1":0,...,"8":0}).
      const single = s.values[`in${i.input}`];
      const group = s.values['in'];
      const groupValue = group !== undefined && group.status === 0 && typeof group.value === 'object' && group.value !== null && !Array.isArray(group.value) ? (group.value as Record<string, unknown>)[String(i.input)] : undefined;
      const value = typeof groupValue === 'number' ? groupValue : single !== undefined && single.status === 0 && typeof single.value === 'number' ? single.value : undefined;
      if (value === undefined) continue;
      const seen = this.#seen.get(i.input) ?? { open: false, closed: false };
      const next = { open: seen.open || value === 0, closed: seen.closed || value === 1 };
      if (next.open !== seen.open || next.closed !== seen.closed) {
        this.#seen.set(i.input, next);
        changed = true;
      }
    }
    if (changed) {
      this.#refreshInputs();
      this.#d.onChange();
    }
  }

  /** Quarantined ports never reach MachineSession until this live port supplies a firmware banner. */
  async guardConnect(port: PortSelector, inner: Transport, boardId?: string): Promise<Transport | string> {
    if (this.#running) return 'A firmware update is using the port.';
    let link: BootloaderLink | null = null;
    try {
      const mark = await this.#d.marks.find(port, boardId);
      if (mark === null) return this.#checkedTransport(port, inner, boardId);
      const saved = mark.recovery as { begin: FlashBegin; view: FlashView };
      this.#port = port;
      this.#begin = saved.begin;
      this.#board = saved.view.board;
      this.#view = { ...saved.view, id: ++this.#id, phase: 'failed', recoveryOffered: false, message: BOOTLOADER_ADVICE };
      this.#d.onChange();
      this.#running = true;
      this.#transcript = new EventLog(this.#d.clock.now());
      link = new BootloaderLink(inner, this.#d.clock, X192A3, this.#transcript);
      await link.openProbe();
      let signature = '';
      try {
        await link.write(Uint8Array.of(0x1b));
        await link.write(Uint8Array.of(0x53));
        signature = new TextDecoder().decode(await link.read(7, 500));
      } catch { /* A banner may arrive before S; no more bootloader writes then. */ }
      if (signature === 'XBoot++') {
        this.#set({ recoveryOffered: true, message: 'The board is in its bootloader. Try the update again. Do not unplug it during the update.' });
        await link.close();
        return this.#view.message as string;
      }
      if (await link.waitForFirmwareBanner(FIRMWARE_BANNER_MS)) return await this.#handoff(link, mark);
      await link.close();
      return BOOTLOADER_ADVICE;
    } catch {
      await link?.close();
      return 'Run could not verify that this board is safe to connect. ' + BOOTLOADER_ADVICE;
    } finally { this.#running = false; this.#d.onChange(); }
  }

  #checkedTransport(port: PortSelector, inner: Transport, boardId?: string): Transport {
    return {
      info: () => inner.info(), readable: inner.readable, close: () => inner.close(),
      onDisconnect: callback => inner.onDisconnect(callback), writeLine: bytes => inner.writeLine(bytes),
      open: async options => {
        // Recheck after acquiring the exclusive physical port: another tab may have flashed since prepare.
        if (await this.#d.marks.find(port, boardId)) throw new Error(BOOTLOADER_ADVICE);
        await inner.open(options);
        try { if (await this.#d.marks.find(port, boardId)) throw new Error(BOOTLOADER_ADVICE); }
        catch (error) { await inner.close(); throw error; }
      },
    };
  }

  async #handoff(link: BootloaderLink, mark: BootloaderMark): Promise<Transport> {
    // A banner from a different board never clears the recorded board's quarantine.
    if (mark.boardId === null || link.firmwareBanner?.id === mark.boardId) await this.#d.marks.clear(mark);
    return link.applicationTransport();
  }

  async #run(id: number, recovery: boolean): Promise<void> {
    const auth = this.#auth as FlashAuthorization;
    const begin = this.#begin as FlashBegin;
    const port = this.#port as PortSelector;
    let link: BootloaderLink | null = null;
    this.#transcript = new EventLog(this.#d.clock.now());
    try {
      const mark: BootloaderMark = { nonce: crypto.randomUUID(), port, boardId: this.#board?.id ?? null, recovery: { begin, view: this.#view } };
      await this.#d.marks.put(mark);
      if (!recovery) {
        const entered = await this.#enterBootloader();
        if (entered !== null) {
          await this.#d.session.disconnect();
          this.#finish(id, { phase: 'failed', message: entered + ' ' + BOOTLOADER_ADVICE, recoveryOffered: true });
          return;
        }
      }
      link = recovery ? await this.#recoveryLink(id, auth, port) : await this.#openLink(auth, port);
      if (link === null) {
        this.#finish(id, { phase: 'failed', message: (recovery ? `The bootloader did not answer. ${this.#diagnosis()}` : 'The port could not be opened in bootloader role.') + ' ' + BOOTLOADER_ADVICE, recoveryOffered: true });
        return;
      }
      const client = new XbootClient(link, this.#d.clock, X192A3);
      const plan = planFlash(auth.image, null);
      const outcome: FlashOutcome = await runFlash(
        client,
        plan,
        {
          onProgress: (p) => {
            if (p.phase === 'exit') link?.armFirmwareBanner();
            this.#set({ phase: p.phase === 'failed' ? 'failed' : p.phase === 'done' ? 'exit' : p.phase, done: p.done, of: p.of, note: p.note ?? null });
          },
          backupsReady: (backups) => this.#saveBackups(id, backups),
          cancelled: () => this.#cancelled,
          beforeFirstWrite: () => this.#set({ wrote: true }),
        },
        { entryMs: recovery ? 4000 : 10_000 },
      );
      if (!outcome.ok) {
        await link.close();
        link = null;
        const message = outcome.code === 'no-entry' ? `${outcome.message}. ${this.#diagnosis()}` : outcome.message;
        this.#finish(id, { phase: 'failed', message: message + ' ' + BOOTLOADER_ADVICE, recoveryOffered: true, wrote: outcome.wrote });
        return;
      }
      auth.finish();
      if (this.#board?.id !== null && this.#board?.id !== undefined) this.#installed.set(this.#board.id, { sha256: auth.sha256, fb: this.#view?.target.fb ?? null });
      if (this.#board?.id !== null && this.#board?.id !== undefined && begin.baseline !== null) {
        this.#post = { boardId: this.#board.id, phase: 'awaitingRead', differences: [], switchesChanged: false, inputs: [], baselineKeys: Object.keys(begin.baseline).length, baseline: begin.baseline };
      }
      this.#set({ phase: 'reconnecting', result: { written: outcome.written, unchanged: outcome.unchanged, resyncs: outcome.resyncs, crc: outcome.crc } });
      if (!(await link.waitForFirmwareBanner(FIRMWARE_BANNER_MS))) {
        await link.close();
        this.#finish(id, { phase: 'failed', message: BOOTLOADER_ADVICE, recoveryOffered: true });
        return;
      }
      const transport = await this.#handoff(link, mark);
      link = null;
      this.#running = false;
      const r = await this.#connect(port, transport);
      this.#set({ phase: 'done', message: r.ok ? null : r.message });
    } catch (error) {
      await link?.close().catch(() => undefined);
      this.#finish(id, { phase: 'failed', message: (error instanceof Error ? error.message : String(error)) + ' ' + BOOTLOADER_ADVICE, recoveryOffered: true });
    }
  }

  /** What came back on the bootloader link (flashDiagnosis.ts). */
  #diagnosis(): string {
    return entryDiagnosis(this.#transcript?.events() ?? []);
  }

  #finish(id: number, patch: Partial<FlashView>): void {
    if (this.#view?.id !== id) return;
    this.#running = false;
    this.#saved = null;
    this.#set(patch);
  }

  /** The session's `flash` intent, then wait until its link closed (or it refused). Null on success, else why. */
  #enterBootloader(): Promise<string | null> {
    const session = this.#d.session;
    const decision = session.request({ intent: 'flash' });
    if (!decision.allowed) return Promise.resolve(`${decision.reason} ${decision.remedy}`);
    return new Promise((resolve) => {
      const check = (s: SessionSnapshot): boolean => {
        if (s.notices.bootloaderEntered !== undefined && s.base === 'NOT_CONNECTED') {
          resolve(null);
          return true;
        }
        if (s.notices.bootRefused !== undefined) {
          resolve(`The board was not put into its bootloader: ${s.notices.bootRefused}.`);
          return true;
        }
        if (s.overlays.includes('LOST') || s.overlays.includes('FAULT')) {
          resolve('The connection was lost before the board entered its bootloader.');
          return true;
        }
        return false;
      };
      if (check(session.snapshot)) return;
      const unsubscribe = session.subscribe((s) => {
        if (check(s)) unsubscribe();
      });
    });
  }

  async #openLink(auth: FlashAuthorization, port: PortSelector): Promise<BootloaderLink | null> {
    // The FTDI bridge stays on the bus while the board resets: the same port, asked for by the same selector, once the
    // session's link has closed it (a port that is still closing cannot be opened again).
    await this.#d.session.portReleased();
    await sleep(this.#d.clock, 300);
    const inner = await this.#d.source.request(port).catch(() => null);
    if (inner === null) return null;
    const link = new BootloaderLink(inner, this.#d.clock, X192A3, this.#transcript);
    const token = auth.capability();
    if (token === null) return null;
    await link.open(token);
    return link;
  }

  /** Recovery: keep the port open and send ESC until the bootloader answers; reopen it after the user replugs. */
  async #recoveryLink(id: number, auth: FlashAuthorization, port: PortSelector): Promise<BootloaderLink | null> {
    const clock = this.#d.clock;
    const start = clock.now();
    while (clock.now() - start < RECOVERY_MS && this.#view?.id === id && !this.#cancelled) {
      const left = RECOVERY_MS - (clock.now() - start);
      let link: BootloaderLink | null = null;
      try {
        link = await this.#openLink(auth, port);
      } catch {
        link = null;
      }
      if (link === null) {
        this.#set({ countdown: Math.ceil(left / 1000), note: 'Waiting for the board to come back on USB…' });
        await sleep(clock, 500);
        continue;
      }
      const client = new XbootClient(link, clock, X192A3);
      try {
        await recoverEntry(client, () => clock.now(), left, (seconds) => this.#set({ countdown: seconds }), (ms) => sleep(clock, ms));
        this.#set({ countdown: null, note: 'The bootloader answered.' });
        return link;
      } catch {
        await link.close().catch(() => undefined);
        await sleep(clock, 300);
      }
    }
    return null;
  }

  async #saveBackups(id: number, backups: FlashBackups): Promise<void> {
    const hex = toIntelHex(backups.flash, X192A3);
    const sha256 = await sha256Hex(hex);
    const board = this.#board;
    const message: FlashBackupsMessage = { id, boardId: board?.id ?? null, fb: board?.fb ?? null, fv: board?.fv ?? null, eeprom: backups.eeprom, hex, sha256, crc: crc16(backups.flash) };
    return new Promise<void>((resolve, reject) => {
      const timer = this.#d.clock.setTimeout(() => {
        if (this.#saved?.sha256 !== sha256) return;
        this.#saved = null;
        reject(new Error('the page did not confirm that it stored the backups'));
      }, BACKUP_SAVE_MS);
      this.#saved = {
        sha256,
        resolve: () => {
          this.#d.clock.clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          this.#d.clock.clearTimeout(timer);
          reject(e);
        },
      };
      this.#d.postBackups(message);
    });
  }

  async #connect(port: PortSelector, verified?: Transport): Promise<FlashReply> {
    const raw = verified ?? await this.#d.source.request(port).catch(() => null);
    if (raw === null) return fail('The port is not available: is the board plugged in?');
    const inner = verified ?? await this.guardConnect(port, raw);
    if (typeof inner === 'string') return fail(inner);
    this.#d.approveTransport(port, inner);
    const outcome = await this.#d.session.connect(port, { unknown: true });
    if (!outcome.ok) return fail(outcome.code === 'denied' ? outcome.decision.reason : outcome.reason);
    // The version check, once the board identified itself.
    const view = this.#view;
    await new Promise<void>((resolve) => {
      const check = (s: SessionSnapshot): boolean => s.classification !== null || s.base === 'NOT_CONNECTED' || s.overlays.includes('LOST');
      if (check(this.#d.session.snapshot)) {
        resolve();
        return;
      }
      const unsubscribe = this.#d.session.subscribe((s) => {
        if (check(s)) {
          unsubscribe();
          resolve();
        }
      });
    });
    const reported = this.#d.session.snapshot.identity?.fb ?? null;
    if (view !== null) {
      const expected = view.target.fb;
      this.#set({ versionCheck: { expected, reported, ok: expected === null ? reported !== null : reported !== null && Math.round(reported * 100) === Math.round(expected * 100) } });
    }
    return { ok: true };
  }
}

function boardFacts(s: SessionSnapshot): { id: string | null; hv: number | null; fb: number | null; fv: number | null } {
  const id = s.identity;
  return {
    id: typeof id?.id === 'string' && id.id.length > 0 ? id.id : null,
    hv: typeof id?.hv === 'number' ? id.hv : null,
    fb: typeof id?.fb === 'number' ? id.fb : null,
    fv: typeof id?.fv === 'number' ? id.fv : null,
  };
}

function sleep(clock: SessionClock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}
