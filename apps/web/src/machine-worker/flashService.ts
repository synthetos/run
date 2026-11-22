import { FlashEntryTrace, flashTranscriptReport } from './flashEntryTrace.ts';
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
 *    Recovery first looks at the port (entryLinks.ts): a bootloader that
 *    answers is used, a firmware that answers goes in through `{"boot":1}`;
 *    only a silent board gets the countdown, while the person presses Reset
 *    (or switches the board's power off and on) and run sends ESC and S.
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
  planFlash,
  runFlash,
  type FlashAuthorization,
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
import { entryLogDiagnosis } from './flashDiagnosis.ts';
import { boardFacts, bootloaderView, endsWritten, startsWritten } from './flashViewFacts.ts';
import { SESSION_SETTLE_MS, openFlashLink, recoveryEntry, sessionSettled, type EntryDeps } from './entryLinks.ts';
import { avr109Check, firmwareAnswers, settleProbedMark } from './markProbe.ts';
import { BackupsWait, type FlashBackupsMessage } from './backupsWait.ts';

export { BACKUP_SAVE_MS, type FlashBackupsMessage } from './backupsWait.ts';
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
  readonly #saved: BackupsWait;
  #cancelled = false;
  #running = false;
  #waitingLink: BootloaderLink | null = null;
  #keepaliveTimer: number | null = null;
  #keepalive: Promise<void> = Promise.resolve();
  #post: (PostFlashView & { readonly baseline: Readonly<Record<string, number | string>> }) | null = null;
  #seen: SeenInputs = new Map();
  /** Ends a wait now (Cancel, Disconnect): Connect's banner wait, or recovery's wait for the bootloader. */
  #stopWait: (() => void) | null = null;
  /** Settles when the guarded Connect or the run in progress has ended (Disconnect waits for it). */
  #settled: Promise<unknown> = Promise.resolve();
  /** A marked board whose firmware answered Connect's probe: the board id the session reads decides its mark. */
  #probed: BootloaderMark | null = null;
  #installed = new Map<string, { sha256: string; fb: number | null }>();
  /** The bootloader link's bytes for the last run, from the moment it asked for the bootloader. */
  #transcript: EventLog | null = null;
  #entryTrace: FlashEntryTrace | null = null;

  constructor(deps: FlashServiceDeps) {
    this.#d = deps;
    this.#saved = new BackupsWait(deps.clock, deps.postBackups);
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
  flashTranscript(): { readonly jsonl: string; readonly events: number; readonly entryJson: string | null } | null {
    return flashTranscriptReport(this.#transcript, this.#entryTrace);
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
    this.#settled = this.#run(id, b.recovery);
    return { ok: true };
  }

  /** The page stored the backups: `sha256` is the image backup's, as the page stored it. */
  backupsSaved(sha256: string): FlashReply {
    const refused = this.#saved.confirm(sha256);
    return refused === null ? { ok: true } : fail(refused);
  }

  /**
   * Disconnect: 'free' when the flash service does not hold the port. While Run only waits (for a banner, or for the
   * bootloader in recovery) the wait ends first ('stopped'): the port and the lock are released and the mark stays.
   * 'busy' while an update runs that is not just waiting (it is never stopped there).
   */
  async freeForDisconnect(): Promise<'free' | 'stopped' | 'busy'> {
    if (!this.#running) return 'free';
    if (this.#stopWait === null) return 'busy';
    this.#stopWait();
    await this.#settled;
    return 'stopped';
  }

  /** Cancel: a wait at any time (the mark stays); an update only before the first page is written. */
  cancel(): FlashReply {
    if (this.#stopWait !== null) {
      this.#stopWait();
      return { ok: true };
    }
    if (!this.#running) return fail('Nothing to cancel.');
    if (this.#view?.wrote === true) return fail('Writing has started: it cannot be cancelled. Let it finish.');
    this.#cancelled = true;
    this.#saved.drop(new Error('cancelled'));
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
    this.#settleProbe(s);
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

  /**
   * After a Connect whose firmware answered the probe: once the session read the board id, the mark clears when it
   * is that board's; another board keeps it and the view becomes the note about the marked board (as for a banner).
   */
  #settleProbe(s: SessionSnapshot): void {
    const mark = this.#probed;
    if (mark === null || s.base === 'NOT_CONNECTED' || s.identity === null) return;
    this.#probed = null;
    void settleProbedMark(this.#d.marks, mark, s.identity.id).then(
      (cleared) => {
        this.#view = viewAfterBanner(this.#view, mark, cleared);
        this.#begin = null;
        this.#d.onChange();
      },
      () => this.#set({ message: 'Run could not clear the board safety record. Connect again to retry.' }),
    );
  }

  /**
   * Every connection checks ESC/S before normal traffic. A marked board then gets the one line end (markProbe.ts):
   * a firmware that answers is connected; otherwise only a live banner proves it.
   */
  async guardConnect(port: PortSelector, inner: Transport, boardId?: string): Promise<Transport | string> {
    if (this.#running) return 'A firmware update is using the port.';
    let link: BootloaderLink | null = null;
    let marked = false;
    this.#running = true;
    this.#probed = null;
    let settle = (): void => undefined;
    this.#settled = new Promise<void>((resolve) => { settle = resolve; });
    try {
      const mark = await this.#d.marks.find(port, boardId);
      marked = mark !== null;
      if (mark !== null) this.#restoreMark(mark, port);
      await this.closeBootloader();
      this.#transcript = new EventLog(this.#d.clock.now());
      this.#entryTrace = null;
      link = new BootloaderLink(mark === null ? checkedTransport(port, inner, this.#d.marks, boardId) : inner, this.#d.clock, X192A3, this.#transcript);
      await link.openProbe(mark === null || mark.kind === 'detected');
      if (await avr109Check(link, marked)) {
        const found = await this.#foundBootloader(link, mark, port, boardId);
        link = null;
        return found;
      }
      if (mark === null) {
        if (await this.#d.marks.find(port, boardId)) throw new Error('The board was quarantined during the pre-check.');
        return await link.finishOrdinaryPrecheck();
      }
      if (await firmwareAnswers(link)) {
        // The firmware runs (markProbe.ts). The board id the session reads settles the mark (#onSnapshot).
        this.#probed = mark;
        return link.applicationTransport();
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
      settle();
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
    this.#entryTrace = new FlashEntryTrace(id, recovery);
    try {
      const mark: BootloaderMark = { nonce: crypto.randomUUID(), port, boardId: this.#board?.id ?? null, recovery: { begin, view: this.#view }, wrote: startsWritten(recovery, this.#view) };
      await this.#d.marks.put(mark);
      this.#set({ marked: true });
      const entry = await this.#entryLink(id, auth, port, recovery);
      if (typeof entry === 'string') {
        this.#finish(id, { phase: 'failed', message: withAdvice(entry), recoveryOffered: true });
        return;
      }
      link = entry.link;
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
            await this.#saved.save(id, this.#board, backups);
            await this.#d.marks.put({ ...mark, wrote: true });
            this.#set({ wrote: true });
          },
          cancelled: () => this.#cancelled,
          beforeFirstWrite: () => this.#set({ wrote: true }),
        },
        { entryMs: entry.viaBoot ? 10_000 : 4000 },
      );
      if (!outcome.ok) {
        await link.close();
        link = null;
        const message = outcome.code === 'no-entry' ? `${outcome.message}. ${entryLogDiagnosis(this.#transcript)}` : outcome.message;
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

  #finish(id: number, patch: Partial<FlashView>): void {
    if (this.#view?.id !== id) return;
    this.#running = false;
    this.#saved.drop();
    this.#set(patch);
  }

  /**
   * Steps 2 and 3: the board into its bootloader and the port open in bootloader role, or why not. `viaBoot`: entered
   * through `{"boot":1}` (xboot's long window). Recovery looks first (entryLinks.ts); while it only waits, Cancel and
   * Disconnect end the wait.
   */
  async #entryLink(id: number, auth: FlashAuthorization, port: PortSelector, recovery: boolean): Promise<{ readonly link: BootloaderLink; readonly viaBoot: boolean } | string> {
    const d: EntryDeps = { session: this.#d.session, source: this.#d.source, clock: this.#d.clock, transcript: this.#transcript, ...(this.#entryTrace === null ? {} : { trace: this.#entryTrace }) };
    if (recovery) {
      let held: BootloaderLink | null = null;
      this.#stopWait = () => { this.#cancelled = true; void held?.close(); };
      const found = await recoveryEntry(d, auth, port, {
        waiting: () => this.#takeBootloader(),
        firmware: async (transport) => {
          this.#stopWait = null;
          // The board to recover, read before the session connects (a connected session updates #board).
          const before = this.#board;
          const want = before?.id ?? null;
          const reply = await this.#connect(port, transport);
          await sessionSettled(this.#d.session, this.#d.clock, SESSION_SETTLE_MS);
          this.#set({ phase: 'entering', countdown: null, note: null, versionCheck: null });
          const got = this.#d.session.snapshot.identity?.id ?? null;
          if (reply.ok && (want === null || got === want)) return null;
          await this.#d.session.disconnect();
          this.#board = before;
          return reply.ok ? `This is board ${got ?? 'unknown'}, not board ${want ?? 'unknown'}. Nothing was written. Connect board ${want ?? 'unknown'} to recover it.` : reply.message;
        },
        wait: { alive: () => this.#view?.id === id && !this.#cancelled, show: (patch) => this.#set(patch), holding: (link) => { held = link; } },
      }).finally(() => { this.#stopWait = null; });
      if (found !== 'firmware') return typeof found === 'string' ? found : { link: found, viaBoot: false };
    }
    if (this.#entryTrace !== null) this.#entryTrace.viaBoot = true;
    const entered = await enterBootloader(this.#d.session);
    if (entered !== null) {
      await this.#d.session.disconnect();
      return entered;
    }
    const link = await openFlashLink(d, auth, port);
    return link === null ? 'The port could not be opened in bootloader role.' : { link, viaBoot: true };
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
