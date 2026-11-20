import { resolveFlashSource, flashSourceLabel, type FlashSourceRequest } from './flashSource.ts';
/**
 * The firmware update in `machine.worker` (SAFETY §4.8 as amended 2026-11-03,
 * H79-H88; WORKSPACE_FEATURES "Firmware update").
 *
 * The page asks; this service decides and does. In order:
 * 1. **Authorize** (packages/flasher authorize.ts): the `.hex` text the page
 *    passes is hashed and parsed here. A GitHub release is looked up in the
 *    release metadata THIS WORKER validated (see firmware-sources.md) and
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
import { bootloaderHardwareVersions } from '../firmware/bootloaderHardware.ts';
import { BootloaderLink, EventLog, LinkDeadline, sessionSettings, type SessionExecutor, type PortSelector, type SessionClock, type SessionSnapshot, type Transport, type TransportSource } from '@synthetos/machine';
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
} from '@synthetos/flasher';
import { type FirmwareReleases } from '@synthetos/protocol';
import { categoryOf, restoreChanges, type SettingValue } from '@synthetos/schema';
import type { BootloaderMark, BootloaderMarks } from './bootloaderMark.ts';
import { listenForBanner, type BannerWaitView } from './bannerWait.ts';
import { BOOTLOADER_ADVICE, PORT_STUCK_ADVICE, withAdvice } from './bootloaderAdvice.ts';
import { observeInputs, requiredInputs, type SeenInputs } from './switchInputs.ts';
import { bannerClears, versionCheck, versionCheckDue, viewAfterBanner } from './markedConnect.ts';
import { checkedTransport } from './checkedTransport.ts';
import { enterBootloader } from './enterBootloader.ts';
import { entryDiagnosis } from './flashDiagnosis.ts';
import { boardFacts, bootloaderView, endsWritten, startsWritten } from './flashViewFacts.ts';

/** How long the page has to store the backups before the run gives up (nothing written). */
export const BACKUP_SAVE_MS = 60_000;
/** The recovery countdown: unplug and replug within this time. */
export const RECOVERY_MS = 45_000;
/**
 * The silent wait for a fresh firmware-ready banner after the exit, and after Start firmware (Connect on a marked
 * board: BANNER_WAIT_MS in bannerWait.ts). 30 s: the first boot after an update can be slow. When the EEPROM layout
 * changed, the firmware loads its defaults and writes them before its banner (owner's 449.01 → 450.06 update ran
 * past the old 10 s). The rule stays: nothing is sent until a banner arrives; no banner in 30 s is a failure.
 */
export const FIRMWARE_BANNER_MS = 30_000;
/** Longest `.hex` text the page may pass. */
export const MAX_HEX_TEXT = 2 * 1024 * 1024;

export type { FlashSourceRequest } from './flashSource.ts';

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
  readonly bootloader?: { readonly startAllowed: boolean };
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
  /** The board carries the failed-update mark (possibly in its bootloader): only a live banner from it clears it. */
  readonly marked?: boolean;
  /** Connect on a marked board: listening for the banner (press Reset now), or the wait ran out (Try again). */
  readonly bannerWait?: BannerWaitView | null;
  /** Another board proved by its banner that it is not the marked one: the mark (kept) is this board id's. */
  readonly elsewhere?: string;
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
  readonly restoreNotes?: readonly string[];
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
  readonly session: SessionExecutor;
  readonly source: TransportSource;
  readonly clock: SessionClock;
  /** This worker's verified release list (null when none verifies for its origin). */
  readonly releases: () => Promise<FirmwareReleases | null>;
  /** The flash phase switch is on in this worker's release. */
  readonly enabled: boolean;
  /** Fixed worker role, applied to initial requests and persisted recovery images alike. */
  readonly authorizeBegin: (begin: FlashBegin) => string | null;
  readonly onChange: () => void;
  readonly postBackups: (message: FlashBackupsMessage) => void;
  /** Hands the next session connect this transport (the host's prepared-port seam). */
  readonly approveTransport: (port: PortSelector, transport: Transport) => void;
}

export type FlashReply = { readonly ok: true } | { readonly ok: false; readonly message: string };

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
  #waitingLink: BootloaderLink | null = null;
  #keepaliveTimer: number | null = null;
  #keepalive: Promise<void> = Promise.resolve();
  #post: (PostFlashView & { readonly baseline: Readonly<Record<string, number | string>> }) | null = null;
  #seen: SeenInputs = new Map();
  /** Ends Connect's banner wait now (Cancel), while it listens. */
  #stopWait: (() => void) | null = null;
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
    const refused = this.#d.authorizeBegin(b);
    if (refused !== null) return fail(refused);
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
    const source = await resolveFlashSource(b.source, () => this.#d.releases());
    if (source === null) return fail('That release is not in the GitHub release list this site validated.');
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
    const label = flashSourceLabel(source);
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
      wrote: startsWritten(b.recovery, this.#view),
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

  /** Cancel: Connect's banner wait at any time (the mark stays); an update only before the first page is written. */
  cancel(): FlashReply {
    if (this.#stopWait !== null) {
      this.#stopWait();
      return { ok: true };
    }
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
    const diff = restoreChanges(dialect, p.baseline, board, s.identity?.fb);
    const differences = diff.changes.map((c) => ({ key: c.key, backup: c.value, board: board[c.key] ?? null }));
    const switchesChanged = p.switchesChanged || differences.some((d) => categoryOf(d.key) === 'switch' || categoryOf(d.key) === 'homing');
    let phase: PostFlashPhase;
    if (differences.length > 0) phase = 'restoreRequired';
    else if (switchesChanged) phase = 'switchCheck';
    else phase = 'clear';
    const inputs = phase === 'switchCheck' ? requiredInputs(board) : [];
    if (phase === 'switchCheck' && p.phase !== 'switchCheck') this.#seen.clear();
    this.#post = { ...p, phase, differences, switchesChanged, inputs, restoreNotes: [...new Set(diff.skipped.filter(skip => skip.reason.startsWith('Not on 450.05:')).map(skip => skip.reason))] };
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
    void this.closeBootloader();
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
    // After a marked Connect whose update may have written: what the board reports, once it identified.
    const check = versionCheckDue(this.#view, s);
    if (check !== null) this.#set({ versionCheck: check });
    const p = this.#post;
    if (p === null || p.phase !== 'switchCheck' || s.identity?.id !== p.boardId) return;
    if (observeInputs(p.inputs, s.values, this.#seen)) {
      this.#refreshInputs();
      this.#d.onChange();
    }
  }

  /** Every connection checks ESC/S before normal traffic. Failed-flash records still require a live banner. */
  async guardConnect(port: PortSelector, inner: Transport, boardId?: string): Promise<Transport | string> {
    if (this.#running) return 'A firmware update is using the port.';
    let link: BootloaderLink | null = null;
    let marked = false;
    this.#running = true;
    try {
      const mark = await this.#d.marks.find(port, boardId);
      marked = mark !== null;
      if (mark !== null) this.#restoreMark(mark, port);
      await this.closeBootloader();
      this.#transcript = new EventLog(this.#d.clock.now());
      link = new BootloaderLink(mark === null ? checkedTransport(port, inner, this.#d.marks, boardId) : inner, this.#d.clock, X192A3, this.#transcript);
      await link.openProbe(mark === null || mark.kind === 'detected');
      if (await link.checkBootloader()) {
        const found = await this.#foundBootloader(link, mark, port, boardId);
        link = null;
        return found;
      }
      if (mark === null) {
        if (await this.#d.marks.find(port, boardId)) throw new Error('The board was quarantined during the pre-check.');
        return await link.finishOrdinaryPrecheck();
      }
      const stop = new Promise<void>((resolve) => { this.#stopWait = resolve; });
      const outcome = await listenForBanner(link, this.#d.clock, (bannerWait) => this.#set({ bannerWait }), stop);
      this.#stopWait = null;
      if (outcome === 'heard') {
        // Firmware runs on this port. The board's own banner clears its mark; another board's keeps it (a note).
        const cleared = bannerClears(mark, link.firmwareBanner);
        const ready = await this.#handoff(link, mark, true);
        this.#view = viewAfterBanner(this.#view, mark, cleared);
        this.#begin = null;
        return ready;
      }
      return this.#refusal(await link.close(), marked, outcome === 'cancelled' ? 'Connect was cancelled. The board keeps its mark.' : BOOTLOADER_ADVICE);
    } catch (error) {
      const portOk = (await link?.close()) !== false && !(error instanceof LinkDeadline);
      return this.#refusal(portOk, marked, withAdvice(`Run could not verify that this board is safe to connect: ${error instanceof Error ? error.message : String(error)}.`));
    } finally {
      this.#stopWait = null;
      this.#running = false;
      this.#d.onChange();
    }
  }

  /** The AVR109 check found xboot: an unmarked board gets a 'detected' mark (Run wrote nothing); keep the port open. */
  async #foundBootloader(link: BootloaderLink, known: BootloaderMark | null, port: PortSelector, boardId?: string): Promise<string> {
    let mark = known;
    if (mark === null) {
      this.#port = port;
      this.#board = null;
      this.#begin = null;
      this.#view = bootloaderView(++this.#id, true);
      mark = { nonce: crypto.randomUUID(), kind: 'detected', port, boardId: boardId ?? null, recovery: { begin: null, view: this.#view }, wrote: false };
      await this.#d.marks.put(mark);
    }
    this.#set({ recoveryOffered: this.#begin !== null, bootloader: { startAllowed: mark.kind === 'detected' }, message: 'The board is in its bootloader.' });
    this.#retainBootloader(link);
    return 'The board is in its bootloader.';
  }

  /**
   * Connect's refusal once it closed the port. A port call that passed its deadline (`portOk` false) leaves the port
   * stuck: only unplugging USB frees it, so that is the advice, on a marked board's view too.
   */
  #refusal(portOk: boolean, marked: boolean, otherwise: string): string {
    if (portOk) return otherwise;
    if (marked) this.#set({ message: PORT_STUCK_ADVICE });
    return PORT_STUCK_ADVICE;
  }

  #retainBootloader(link: BootloaderLink): void {
    this.#waitingLink = link;
    const schedule = (): void => {
      this.#keepaliveTimer = this.#d.clock.setTimeout(() => {
        this.#keepaliveTimer = null;
        this.#keepalive = (async () => {
          try { if (!(await link.checkBootloader())) throw new Error('The bootloader stopped answering.'); }
          catch { if (this.#waitingLink === link) { this.#waitingLink = null; this.#set({ message: BOOTLOADER_ADVICE }); } await link.close(); }
          if (this.#waitingLink === link) schedule();
        })();
      }, 250);
    };
    schedule();
  }

  async #takeBootloader(): Promise<BootloaderLink | null> {
    const link = this.#waitingLink;
    this.#waitingLink = null;
    if (this.#keepaliveTimer !== null) this.#d.clock.clearTimeout(this.#keepaliveTimer);
    this.#keepaliveTimer = null;
    await this.#keepalive;
    return link !== null && !link.closed ? link : null;
  }

  async closeBootloader(): Promise<void> { await (await this.#takeBootloader())?.close(); }

  #restoreMark(mark: BootloaderMark, port: PortSelector): void {
    const saved = mark.recovery as { begin: FlashBegin | null; view: FlashView };
    this.#port = port;
    this.#begin = saved.begin !== null && this.#d.authorizeBegin(saved.begin) === null ? saved.begin : null;
    this.#board = saved.view.board;
    // No message: the mark note says how the mark clears, and Connect's dialog says what to do (said once).
    const { elsewhere: _elsewhere, ...view } = saved.view;
    this.#view = { ...view, id: ++this.#id, phase: 'failed', recoveryOffered: this.#begin !== null, bootloader: { startAllowed: mark.kind === 'detected' }, message: null, marked: true, bannerWait: null, wrote: mark.wrote !== false };
    this.#d.onChange();
  }

  /** Hardware is a user confirmation from the printed board version, never inferred from an AVR signature. */
  async bootloaderHardware(hv: number): Promise<FlashReply> {
    if (!this.#d.enabled || this.#running || this.#port === null || this.#view?.bootloader === undefined || this.#begin !== null) return fail('No unidentified bootloader is waiting for an image.');
    try {
      const versions = bootloaderHardwareVersions(await this.#d.releases());
      if (!versions.includes(hv)) return fail('There is no signed image for that hardware version.');
      const mark = await this.#d.marks.find(this.#port);
      if (mark === null) return fail('Connect to the bootloader first.');
      const board = { id: null, hv, fb: null, fv: null };
      await this.#d.marks.put({ ...mark, recovery: { begin: null, view: { ...this.#view, board } } });
      this.#board = board;
      this.#set({ board });
      return { ok: true };
    } catch { return fail('Run could not save the board safety record.'); }
  }

  /** User-click only. Failed-flash marks can never reach E. Persist quarantine before asking unknown firmware to start. */
  async startFirmware(): Promise<FlashReply> {
    const port = this.#port;
    if (port === null || this.#running || this.#d.session.snapshot.base !== 'NOT_CONNECTED') return fail('No bootloader is waiting to start.');
    this.#running = true;
    let link: BootloaderLink | null = null;
    try {
      let mark = await this.#d.marks.find(port);
      if (mark?.kind !== 'detected') return fail('This board needs recovery. Starting its firmware is not allowed.');
      link = await this.#takeBootloader();
      if (link === null) {
        const inner = await this.#d.source.request(port);
        if (inner === null) return fail('The port is not available.');
        link = new BootloaderLink(inner, this.#d.clock, X192A3);
        await link.openProbe(true);
      }
      const starts = await link.checkBootloader();
      if (starts) {
        mark = { ...mark, nonce: crypto.randomUUID(), kind: 'failed' };
        await this.#d.marks.put(mark);
        this.#set({ bootloader: { startAllowed: false } });
        await link.startFirmware();
      }
      if (!(await link.waitForFirmwareBanner(FIRMWARE_BANNER_MS))) {
        mark = { ...mark, kind: 'failed' };
        await this.#d.marks.put(mark);
        this.#set({ bootloader: { startAllowed: false }, message: withAdvice('No firmware banner arrived. Update the firmware to recover this board.') });
        await link.close();
        return fail(this.#view?.message ?? BOOTLOADER_ADVICE);
      }
      const transport = await this.#handoff(link, mark, !starts);
      link = null;
      this.#running = false;
      const reply = await this.#connect(port, transport);
      if (reply.ok) this.#view = null;
      return reply;
    } catch {
      await link?.close();
      return fail(BOOTLOADER_ADVICE);
    } finally { this.#running = false; this.#d.onChange(); }
  }

  /** Hands the port to the normal session after a live banner; clears the mark only when that banner clears it. */
  async #handoff(link: BootloaderLink, mark: BootloaderMark, finishPrecheck = false): Promise<Transport> {
    if (bannerClears(mark, link.firmwareBanner)) {
      await this.#d.marks.clear(mark);
      this.#set({ marked: false });
    }
    return finishPrecheck ? link.finishReadyPrecheck() : link.applicationTransport();
  }

  async #run(id: number, recovery: boolean): Promise<void> {
    const auth = this.#auth as FlashAuthorization;
    const begin = this.#begin as FlashBegin;
    const port = this.#port as PortSelector;
    let link: BootloaderLink | null = null;
    this.#transcript = new EventLog(this.#d.clock.now());
    try {
      const mark: BootloaderMark = { nonce: crypto.randomUUID(), port, boardId: this.#board?.id ?? null, recovery: { begin, view: this.#view }, wrote: startsWritten(recovery, this.#view) };
      await this.#d.marks.put(mark);
      this.#set({ marked: true });
      if (!recovery) {
        const entered = await enterBootloader(this.#d.session);
        if (entered !== null) {
          await this.#d.session.disconnect();
          this.#finish(id, { phase: 'failed', message: withAdvice(entered), recoveryOffered: true });
          return;
        }
      }
      link = recovery ? await this.#recoveryLink(id, auth, port) : await this.#openLink(auth, port);
      if (link === null) {
        this.#finish(id, { phase: 'failed', message: withAdvice(recovery ? `The bootloader did not answer. ${this.#diagnosis()}` : 'The port could not be opened in bootloader role.'), recoveryOffered: true });
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
          // The last step before the first page: the mark says the flash was written (a restored card reads it).
          // The last step before the first page: the mark, then the view, say the flash was written. From here a
          // cancel is refused, so the view and the mark agree (a restored card reads the mark).
          backupsReady: async (backups) => {
            await this.#saveBackups(id, backups);
            await this.#d.marks.put({ ...mark, wrote: true });
            this.#set({ wrote: true });
          },
          cancelled: () => this.#cancelled,
          beforeFirstWrite: () => this.#set({ wrote: true }),
        },
        { entryMs: recovery ? 4000 : 10_000 },
      );
      if (!outcome.ok) {
        await link.close();
        link = null;
        const message = outcome.code === 'no-entry' ? `${outcome.message}. ${this.#diagnosis()}` : outcome.message;
        this.#finish(id, { phase: 'failed', message: withAdvice(message), recoveryOffered: true, wrote: endsWritten(outcome.wrote, this.#view) });
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
      this.#finish(id, { phase: 'failed', message: withAdvice(error instanceof Error ? error.message : String(error)), recoveryOffered: true });
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
    const waiting = await this.#takeBootloader();
    if (waiting !== null) {
      try { waiting.authorizeUpdate(auth.capability() ?? undefined); return waiting; }
      catch { await waiting.close(); }
    }
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
    if (view !== null) this.#set({ versionCheck: versionCheck(view.target.fb, this.#d.session.snapshot.identity?.fb ?? null) });
    return { ok: true };
  }
}

function sleep(clock: SessionClock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}
