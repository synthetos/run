/**
 * "Back up settings" (Board view, WORKSPACE_FEATURES "Settings backup (P1,
 * read-only)").
 *
 * A backup is a JSON file of the board's settings, read token group by token
 * group through the machine worker's `read` request: the session decides
 * every token again against the dialect's read allowlist (SAFETY H37), and
 * every request is a GET. One request is sent at a time, and the next waits
 * for the board's answer to the one before.
 *
 * Phase 1 sends nothing but `{sr:null}`, the probe GETs and reads (ROADMAP
 * Phase 1), so the backup does NOT send G21 first: it records the units the
 * board reported (`unit`) and says the values are in those units. Groups the
 * allowlist does not admit are not asked for; groups that do not answer are
 * listed as unanswered. Nothing here can write to the board.
 */
import { boardSettingsFrom, settingsReadGroups, type GroupAnswer } from '@synthetos/schema';
import type { WorkerStatus } from '../machine-worker/rpc.ts';

type SessionSnapshot = WorkerStatus['session'];
type ReadValue = SessionSnapshot['values'][string];

export const BACKUP_FORMAT = 'synthetos-run-settings-backup';
export const BACKUP_FORMAT_VERSION = 1;
/** How long one token may take to answer before it is recorded as unanswered. */
export const BACKUP_TOKEN_TIMEOUT_MS = 5000;
/** Read before the settings groups: the units and the active coordinate system. */
export const BACKUP_CONTEXT_TOKENS: readonly string[] = Object.freeze(['unit', 'coor']);

export interface BackupFile {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: typeof BACKUP_FORMAT_VERSION;
  readonly takenAt: string;
  readonly reason: 'manual';
  readonly board: {
    readonly id: string | null;
    readonly dialect: string;
    readonly fb: number | null;
    readonly fv: number | null;
    readonly hp: number | string | null;
    readonly hv: number | string | null;
    readonly fbs: string | null;
  };
  readonly units: { readonly unit: number | null; readonly label: 'mm' | 'in' | 'unknown'; readonly g21Sent: false; readonly note: string };
  readonly method: string;
  /** Each group's answer exactly as the board sent it. */
  readonly groups: Readonly<Record<string, unknown>>;
  /** The same values flattened to token names (`xvm`, `1ma`, ...). */
  readonly tokens: Readonly<Record<string, number | string>>;
  readonly unanswered: readonly { readonly token: string; readonly reason: string }[];
}

export interface BackupProgress {
  readonly done: number;
  readonly of: number;
  readonly token: string;
}

export interface BackupDeps {
  /** The worker's `read` for one token. */
  readonly read: (tokens: readonly string[]) => Promise<{ readonly ok: boolean; readonly message?: string }>;
  readonly now: () => Date;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly onProgress: (progress: BackupProgress) => void;
}

/** A file name from the board id and the date: `synthetos-settings-<id>-<YYYY-MM-DD>.json`. */
export function backupFileName(boardId: string | null, at: Date): string {
  const id = (boardId ?? 'no-board-id').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'no-board-id';
  return `synthetos-settings-${id}-${at.toISOString().slice(0, 10)}.json`;
}

/** Why the backup cannot run on this snapshot, or null when it can. */
export function backupBlocked(s: SessionSnapshot | null): string | null {
  if (s === null || s.base === 'NOT_CONNECTED') return 'Connect a board to back up its settings.';
  if (s.overlays.includes('LOST')) return 'The connection was lost. Reconnect to back up the settings.';
  if (s.base !== 'CONNECTED_UNKNOWN') return 'Wait until the board is identified and read.';
  const dialect = s.classification?.dialectId ?? null;
  if (dialect === null) return 'This board was not identified as a supported dialect, so its settings cannot be read.';
  if (settingsReadGroups(dialect).length === 0) return 'This firmware has no reviewed read allowlist yet, so its settings cannot be read.';
  return null;
}

export class SettingsBackup {
  #snapshot: SessionSnapshot | null = null;
  readonly #waiters = new Set<() => void>();
  #running = false;

  get running(): boolean {
    return this.#running;
  }

  /** Feed every snapshot from the worker. */
  onSnapshot(s: SessionSnapshot): void {
    this.#snapshot = s;
    for (const w of [...this.#waiters]) w();
  }

  /** Waits until `token` has a value newer than `before` (or the link changes), or times out. */
  #answer(token: string, before: ReadValue | undefined, epoch: number, deps: BackupDeps): Promise<ReadValue | 'timeout' | 'link'> {
    return new Promise((resolve) => {
      let timer: unknown = null;
      const check = (): void => {
        const s = this.#snapshot;
        let result: ReadValue | 'link' | null = null;
        if (s === null || s.epoch !== epoch || s.base === 'NOT_CONNECTED' || s.overlays.includes('LOST')) result = 'link';
        else {
          const v = s.values[token];
          if (v !== undefined && (before === undefined || v.at !== before.at)) result = v;
        }
        if (result === null) return;
        this.#waiters.delete(check);
        deps.clearTimeout(timer);
        resolve(result);
      };
      timer = deps.setTimeout(() => {
        this.#waiters.delete(check);
        resolve('timeout');
      }, BACKUP_TOKEN_TIMEOUT_MS);
      this.#waiters.add(check);
      // The answer may already be in the last snapshot (it can arrive before the read's reply).
      check();
    });
  }

  /** Reads every allowlisted group, one at a time, and returns the backup file. */
  async run(deps: BackupDeps): Promise<BackupFile> {
    const start = this.#snapshot;
    const blocked = backupBlocked(start);
    if (blocked !== null || start === null) throw new Error(blocked ?? 'Connect a board first.');
    if (this.#running) throw new Error('A backup is already being read.');
    this.#running = true;
    try {
      const dialect = start.classification?.dialectId as string;
      const groups = settingsReadGroups(dialect).map((g) => g.token);
      const tokens = [...BACKUP_CONTEXT_TOKENS, ...groups];
      const answers: Record<string, GroupAnswer> = {};
      const unanswered: { token: string; reason: string }[] = [];
      for (const [i, token] of tokens.entries()) {
        deps.onProgress({ done: i, of: tokens.length, token });
        const before = this.#snapshot?.values[token];
        const reply = await deps.read([token]).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
        if (!reply.ok) {
          unanswered.push({ token, reason: reply.message ?? 'The worker refused the read.' });
          continue;
        }
        const answer = await this.#answer(token, before, start.epoch, deps);
        if (answer === 'link') throw new Error('The connection changed while the backup was being read. Nothing was saved.');
        if (answer === 'timeout') {
          unanswered.push({ token, reason: `No answer within ${BACKUP_TOKEN_TIMEOUT_MS / 1000} s.` });
          continue;
        }
        if (answer.status !== 0) {
          unanswered.push({ token, reason: `The board answered with status ${answer.status}.` });
          continue;
        }
        answers[token] = { value: answer.value, status: answer.status };
      }
      deps.onProgress({ done: tokens.length, of: tokens.length, token: '' });
      const unit = typeof answers['unit']?.value === 'number' ? answers['unit'].value : null;
      const identity = this.#snapshot?.identity ?? start.identity;
      const flat = boardSettingsFrom(dialect, answers);
      const groupValues: Record<string, unknown> = {};
      for (const g of groups) if (answers[g] !== undefined) groupValues[g] = answers[g].value;
      const file: BackupFile = {
        format: BACKUP_FORMAT,
        version: BACKUP_FORMAT_VERSION,
        takenAt: deps.now().toISOString(),
        reason: 'manual',
        board: {
          id: typeof identity?.id === 'string' && identity.id.length > 0 ? identity.id : null,
          dialect,
          fb: identity?.fb ?? null,
          fv: identity?.fv ?? null,
          hp: identity?.hp ?? null,
          hv: identity?.hv ?? null,
          fbs: identity?.fbs ?? null,
        },
        units: {
          unit,
          label: unit === 1 ? 'mm' : unit === 0 ? 'in' : 'unknown',
          g21Sent: false,
          note: 'Phase 1 is read-only and sends no G21, so lengths are in the units the board reported when this backup was read.',
        },
        method: 'Read only: one GET per settings group through the session read allowlist, each sent after the previous answer. The board was not changed.',
        groups: groupValues,
        tokens: flat.settings,
        unanswered,
      };
      return Object.freeze(file);
    } finally {
      this.#running = false;
    }
  }
}
