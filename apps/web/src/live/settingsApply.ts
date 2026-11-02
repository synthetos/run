/**
 * Apply pending settings changes (SAFETY §4.6, H50-H54, amendment
 * 2026-11-02; WORKSPACE_FEATURES "Restore (PW)").
 *
 * The window side of a settings write. The machine worker's session decides
 * every single write again (the settings release, the allow-matrix, the
 * schema, the idle gate it reads right before each write, the write gate);
 * this module only orders them and reports:
 *
 * 1. **Backup first, always.** The whole settings backup (live/backup.ts) is
 *    read and saved before the first write: kept on this computer
 *    (`device-safety`) and offered as a download. If it cannot be completed,
 *    nothing is written.
 * 2. **One change at a time.** Each change is sent as one `settingWrite`
 *    request; the next is sent only after the session reports the previous
 *    one done (gate read, write answered, read-back compared). Communication
 *    settings go last and `jv` very last (schema `orderWrites`).
 * 3. **Stop at the first failure.** Anything but `verified` stops the run.
 *    The steps already written (and the one that failed, which may have been
 *    stored) can be reverted: the backed-up values are written back through
 *    the same path, one at a time, with read-backs. A run that succeeded can
 *    be reverted the same way (undo).
 *
 * Restore from a backup file uses the same path (schema `restoreChanges`
 * maps it by token name and skips identity, read-only and forbidden keys).
 */
import { orderWrites, type PlannedChange, type SettingValue } from '@synthetos/schema';
import type { WorkerStatus } from '../machine-worker/rpc.ts';
import type { BackupFile } from './backup.ts';

type SessionSnapshot = WorkerStatus['session'];
type SettingWrite = NonNullable<SessionSnapshot['settingWrite']>;

/** How long one write (gate reads, the write, the read-back) may take before the run stops. */
export const SETTING_WRITE_TIMEOUT_MS = 10_000;

export type StepStatus = 'pending' | 'writing' | 'verified' | 'failed' | 'notRun';

export interface ApplyStep {
  readonly key: string;
  readonly label: string;
  readonly from: SettingValue | null;
  readonly to: number;
  readonly words: string;
  readonly status: StepStatus;
  /** The session's outcome for this write, when it ran. */
  readonly outcome?: SettingWrite['outcome'];
  readonly detail?: string;
}

export type ApplyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'backingUp'; readonly done: number; readonly of: number }
  | { readonly kind: 'writing'; readonly steps: readonly ApplyStep[]; readonly backupName: string; readonly mode: 'apply' | 'revert' }
  | { readonly kind: 'done'; readonly steps: readonly ApplyStep[]; readonly backupName: string; readonly mode: 'apply' | 'revert' }
  | { readonly kind: 'failed'; readonly steps: readonly ApplyStep[]; readonly backupName: string | null; readonly mode: 'apply' | 'revert'; readonly message: string; readonly revertable: boolean };

export interface ApplyDeps {
  /** The worker's `settingWrite`. */
  readonly writeSetting: (key: string, value: number) => Promise<{ readonly ok: true; readonly id: number } | { readonly ok: false; readonly message: string }>;
  /** Reads the full backup (live/backup.ts). Throws when it cannot. */
  readonly backup: (onProgress: (done: number, of: number) => void) => Promise<BackupFile>;
  /** Keeps the backup on this computer and offers it as a download; returns the file name. */
  readonly saveBackup: (file: BackupFile) => Promise<string>;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly onChange: (state: ApplyState) => void;
}

/** A failed or unverified outcome means the board may now hold something else: stop. */
function outcomeWords(w: SettingWrite): string {
  switch (w.outcome) {
    case 'verified':
      return 'written and read back';
    case 'mismatch':
      return w.detail ?? 'written, but the read-back does not match';
    case 'rejected':
      return w.detail ?? 'the board refused it';
    case 'refused':
      return w.detail ?? 'not written';
    case 'unconfirmed':
      return w.detail ?? 'no answer from the board';
    case 'interrupted':
      return w.detail ?? 'interrupted';
    default:
      return 'not finished';
  }
}

export class SettingsApplier {
  readonly #deps: ApplyDeps;
  #snapshot: SessionSnapshot | null = null;
  readonly #waiters = new Set<() => void>();
  #state: ApplyState = { kind: 'idle' };
  #backup: BackupFile | null = null;
  #backupName: string | null = null;

  constructor(deps: ApplyDeps) {
    this.#deps = deps;
  }

  get state(): ApplyState {
    return this.#state;
  }

  get running(): boolean {
    return this.#state.kind === 'backingUp' || this.#state.kind === 'writing';
  }

  /** The backup taken before the last apply (the revert source), or null. */
  get backupFile(): BackupFile | null {
    return this.#backup;
  }

  #set(state: ApplyState): void {
    this.#state = state;
    this.#deps.onChange(state);
  }

  /** Clears a finished result. */
  reset(): void {
    if (this.running) return;
    this.#set({ kind: 'idle' });
  }

  onSnapshot(s: SessionSnapshot): void {
    this.#snapshot = s;
    for (const w of [...this.#waiters]) w();
  }

  /** Waits for the session to report write `id` done, the link to change, or the timeout. */
  #result(id: number, epoch: number): Promise<SettingWrite | 'timeout' | 'link'> {
    return new Promise((resolve) => {
      let timer: unknown = null;
      const check = (): void => {
        const s = this.#snapshot;
        let out: SettingWrite | 'link' | null = null;
        if (s === null || s.epoch !== epoch || s.base === 'NOT_CONNECTED' || s.overlays.includes('LOST')) out = 'link';
        else if (s.settingWrite !== null && s.settingWrite.id === id && s.settingWrite.phase === 'done') out = s.settingWrite;
        if (out === null) return;
        this.#waiters.delete(check);
        this.#deps.clearTimeout(timer);
        resolve(out);
      };
      timer = this.#deps.setTimeout(() => {
        this.#waiters.delete(check);
        resolve('timeout');
      }, SETTING_WRITE_TIMEOUT_MS);
      this.#waiters.add(check);
      check();
    });
  }

  /**
   * Backs up, then writes `changes` one at a time (communication settings last). Resolves when the run
   * ends; the outcome is in `state`.
   */
  async apply(changes: readonly PlannedChange[]): Promise<ApplyState> {
    if (this.running) return this.#state;
    const start = this.#snapshot;
    if (start === null || changes.length === 0) return this.#state;
    this.#set({ kind: 'backingUp', done: 0, of: 1 });
    let file: BackupFile;
    let name: string;
    try {
      file = await this.#deps.backup((done, of) => this.#set({ kind: 'backingUp', done, of }));
      if (file.unanswered.length > 0) throw new Error(`${file.unanswered.length} settings groups did not answer (${file.unanswered.map((u) => u.token).join(', ')})`);
      name = await this.#deps.saveBackup(file);
    } catch (e) {
      this.#set({ kind: 'failed', steps: [], backupName: null, mode: 'apply', message: `Nothing was written: the backup could not be completed. ${e instanceof Error ? e.message : String(e)}`, revertable: false });
      return this.#state;
    }
    this.#backup = file;
    this.#backupName = name;
    const steps: ApplyStep[] = orderWrites(changes).map((c) => ({ key: c.key, label: c.label, from: c.from, to: c.to, words: c.words, status: 'pending' }));
    return this.#run(steps, 'apply', start.epoch);
  }

  /**
   * Writes the backed-up values back for every step of the last apply that was written or may have been
   * (verified, mismatched, unconfirmed or interrupted), through the same path.
   */
  async revert(): Promise<ApplyState> {
    const last = this.#state;
    const file = this.#backup;
    const start = this.#snapshot;
    if (this.running || file === null || start === null || (last.kind !== 'failed' && last.kind !== 'done') || last.mode !== 'apply') return this.#state;
    // A refused write never reached the board. A rejected one may still have changed the RAM value
    // (edge-next sets it before the save is refused, EN-SETTINGS-GATE), so it is written back too.
    const touched = last.steps.filter((s) => s.status === 'verified' || (s.status === 'failed' && s.outcome !== 'refused'));
    const steps: ApplyStep[] = [];
    for (const s of touched) {
      const old = file.tokens[s.key];
      if (typeof old !== 'number') continue;
      steps.push({ key: s.key, label: s.label, from: s.to, to: old, words: `${s.to} → ${old} (from the backup)`, status: 'pending' });
    }
    if (steps.length === 0) {
      this.#set({ kind: 'failed', steps: [], backupName: this.#backupName, mode: 'revert', message: 'Nothing to revert: no setting was changed.', revertable: false });
      return this.#state;
    }
    return this.#run(orderWrites(steps), 'revert', start.epoch);
  }

  async #run(initial: readonly ApplyStep[], mode: 'apply' | 'revert', epoch: number): Promise<ApplyState> {
    const steps = [...initial];
    const backupName = this.#backupName ?? '';
    const update = (i: number, patch: Partial<ApplyStep>): void => {
      steps[i] = { ...(steps[i] as ApplyStep), ...patch };
    };
    this.#set({ kind: 'writing', steps: [...steps], backupName, mode });
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as ApplyStep;
      update(i, { status: 'writing' });
      this.#set({ kind: 'writing', steps: [...steps], backupName, mode });
      const reply = await this.#deps.writeSetting(step.key, step.to).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
      if (!reply.ok) {
        update(i, { status: 'failed', outcome: 'refused', detail: reply.message });
        return this.#fail(steps, i, mode, `${step.label}: ${reply.message}`);
      }
      const result = await this.#result(reply.id, epoch);
      if (result === 'link') {
        update(i, { status: 'failed', outcome: 'interrupted', detail: 'The connection changed.' });
        return this.#fail(steps, i, mode, `${step.label}: the connection changed during the write. Reconnect and check the board's settings.`);
      }
      if (result === 'timeout') {
        update(i, { status: 'failed', outcome: 'unconfirmed', detail: `No result within ${SETTING_WRITE_TIMEOUT_MS / 1000} s.` });
        return this.#fail(steps, i, mode, `${step.label}: no result within ${SETTING_WRITE_TIMEOUT_MS / 1000} s.`);
      }
      if (result.outcome !== 'verified') {
        update(i, { status: 'failed', outcome: result.outcome, detail: outcomeWords(result) });
        return this.#fail(steps, i, mode, `${step.label}: ${outcomeWords(result)}`);
      }
      update(i, { status: 'verified', outcome: 'verified', detail: outcomeWords(result) });
      this.#set({ kind: 'writing', steps: [...steps], backupName, mode });
    }
    this.#set({ kind: 'done', steps: [...steps], backupName, mode });
    return this.#state;
  }

  #fail(steps: ApplyStep[], at: number, mode: 'apply' | 'revert', message: string): ApplyState {
    for (let j = at + 1; j < steps.length; j++) steps[j] = { ...(steps[j] as ApplyStep), status: 'notRun' };
    const failed = steps[at] as ApplyStep;
    const mayHaveChanged = steps.some((s) => s.status === 'verified') || failed.outcome !== 'refused';
    this.#set({ kind: 'failed', steps: [...steps], backupName: this.#backupName, mode, message: `Stopped at the first problem. ${message}`, revertable: mode === 'apply' && this.#backup !== null && mayHaveChanged });
    return this.#state;
  }
}
