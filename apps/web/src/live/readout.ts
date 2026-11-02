/**
 * The connect-time read and the drift check, window side (ROADMAP P1-07;
 * RUN_PLAN §7.2 connect flow steps 4-8; SAFETY §3 READING → NEEDS_REVIEW).
 *
 * Once per link, when a classified board reaches CONNECTED_UNKNOWN, this
 * asks the worker to read the DRO tokens (`coor`, `unit`, `ofs`, `hom`)
 * and every allowlisted settings group. Every read goes through the
 * worker's `read`, so the session's allow-matrix and read allowlist decide
 * each token again; this module cannot write anything.
 *
 * When every group has answered it computes `deviceHash` and compares it
 * with this computer's reference for the board (`device-safety`, keyed by
 * dialect and board id; facts are bound to the same hash, SAFETY H33):
 *
 * - no reference yet: the read becomes the reference (nothing to compare);
 * - same hash: no drift;
 * - different hash: drift. The worker is told (`drift`, NEEDS_REVIEW) and
 *   the view shows the key-level diff. The default resolution, "Keep the
 *   board's settings", only replaces the reference: it writes nothing to
 *   the machine (RUN_PLAN §7.2 step 7, C23). Nothing is applied
 *   automatically (S §4.10 rule 4).
 */
import { boardSettingsFrom, deviceHash, settingsDrift, settingsReadGroups, type BoardSettings, type DriftResult, type GroupAnswer } from '@synthetos/schema';
import type { WorkerStatus } from '../machine-worker/rpc.ts';
import type { DeviceSafetyStore } from './deviceSafety.ts';

type SessionSnapshot = WorkerStatus['session'];

/** DRO reads besides the settings groups (the `g5x` offsets are settings groups). */
export const DRO_TOKENS: readonly string[] = Object.freeze(['coor', 'unit', 'ofs', 'hom']);

export interface SettingsReference {
  readonly deviceHash: string;
  readonly settings: BoardSettings;
  /** ISO time the reference was taken. */
  readonly at: string;
}

export type ReadoutPhase =
  /** No classified board, or the dialect has no settings allowlist. */
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading' }
  /** The worker refused the read, or some groups answered with an error. */
  | { readonly kind: 'incomplete'; readonly message: string }
  | { readonly kind: 'noBoardId'; readonly hash: string }
  | { readonly kind: 'recorded'; readonly hash: string }
  | { readonly kind: 'match'; readonly hash: string; readonly reference: SettingsReference }
  | { readonly kind: 'drift'; readonly hash: string; readonly reference: SettingsReference; readonly result: DriftResult; readonly accepted: boolean };

export interface ReadoutDeps {
  readonly read: (tokens: readonly string[]) => Promise<{ readonly ok: boolean; readonly message?: string }>;
  readonly drift: (epoch: number) => Promise<unknown>;
  readonly store: DeviceSafetyStore;
  readonly now: () => Date;
  readonly onChange: () => void;
}

export function referenceKey(dialectId: string, boardId: string): string {
  return `settings-reference/${dialectId}/${boardId}`;
}

function isReference(v: unknown): v is SettingsReference {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r['deviceHash'] === 'string' && typeof r['settings'] === 'object' && r['settings'] !== null && typeof r['at'] === 'string';
}

export class LiveReadout {
  readonly #deps: ReadoutDeps;
  #phase: ReadoutPhase = { kind: 'idle' };
  #epoch = -1;
  #dialectId: string | null = null;
  #boardId: string | null = null;
  #settings: BoardSettings = {};
  #checking = false;
  /** Set by `reread`: the group answers seen before it (a fresh read must differ), and that the result becomes the reference. */
  #rereadFrom: Readonly<Record<string, number>> | null = null;
  #lastSnapshot: SessionSnapshot | null = null;

  constructor(deps: ReadoutDeps) {
    this.#deps = deps;
  }

  get phase(): ReadoutPhase {
    return this.#phase;
  }

  /** The settings of the last complete read (empty until one completes). */
  get settings(): BoardSettings {
    return this.#settings;
  }

  get dialectId(): string | null {
    return this.#dialectId;
  }

  #set(phase: ReadoutPhase): void {
    this.#phase = phase;
    this.#deps.onChange();
  }

  /** Feed every snapshot from the worker. */
  onSnapshot(s: SessionSnapshot): void {
    this.#lastSnapshot = s;
    const dialectId = s.classification?.dialectId ?? null;
    if (s.base !== 'CONNECTED_UNKNOWN' || dialectId === null || s.overlays.includes('LOST') || settingsReadGroups(dialectId).length === 0) {
      if (s.base === 'NOT_CONNECTED' && this.#phase.kind !== 'idle') {
        this.#epoch = -1;
        this.#set({ kind: 'idle' });
      }
      return;
    }
    if (s.epoch !== this.#epoch) {
      this.#epoch = s.epoch;
      this.#dialectId = dialectId;
      this.#boardId = typeof s.identity?.id === 'string' && s.identity.id.length > 0 ? s.identity.id : null;
      this.#settings = {};
      this.#set({ kind: 'reading' });
      void this.#requestAll(dialectId);
      return;
    }
    if (this.#phase.kind === 'reading' && !this.#checking) this.#maybeComplete(s, dialectId);
  }

  async #requestAll(dialectId: string): Promise<void> {
    const epoch = this.#epoch;
    const tokens = [...DRO_TOKENS, ...settingsReadGroups(dialectId).map((g) => g.token)];
    const reply = await this.#deps.read(tokens).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    if (epoch !== this.#epoch || reply.ok) return;
    this.#set({ kind: 'incomplete', message: reply.message ?? 'The worker refused the read.' });
  }

  #maybeComplete(s: SessionSnapshot, dialectId: string): void {
    const groups = settingsReadGroups(dialectId);
    const values = s.values as Readonly<Record<string, GroupAnswer | undefined>>;
    if (!groups.every((g) => values[g.token] !== undefined)) return;
    const from = this.#rereadFrom;
    if (from !== null && !groups.every((g) => s.values[g.token]?.at !== from[g.token])) return;
    const read = boardSettingsFrom(dialectId, values);
    if (read.missing.length > 0) {
      this.#set({ kind: 'incomplete', message: `These groups did not answer: ${read.missing.join(', ')}. No drift check was made.` });
      return;
    }
    this.#checking = true;
    void this.#check(s.epoch, dialectId, read.settings).finally(() => {
      this.#checking = false;
    });
  }

  async #check(epoch: number, dialectId: string, settings: BoardSettings): Promise<void> {
    const hash = await deviceHash(dialectId, settings);
    if (epoch !== this.#epoch) return;
    this.#settings = settings;
    if (this.#rereadFrom !== null) {
      // A re-read after this browser's own settings writes: the board now holds what was written (each
      // value was read back), so the read becomes this computer's reference. Nothing is written here.
      this.#rereadFrom = null;
      if (this.#boardId !== null) {
        await this.#deps.store.set(referenceKey(dialectId, this.#boardId), { deviceHash: hash, settings, at: this.#deps.now().toISOString() } satisfies SettingsReference).catch(() => undefined);
        this.#set({ kind: 'recorded', hash });
      } else {
        this.#set({ kind: 'noBoardId', hash });
      }
      return;
    }
    const boardId = this.#boardId;
    if (boardId === null) {
      this.#set({ kind: 'noBoardId', hash });
      return;
    }
    const key = referenceKey(dialectId, boardId);
    const stored = await this.#deps.store.get(key).catch(() => undefined);
    if (epoch !== this.#epoch) return;
    if (!isReference(stored)) {
      await this.#deps.store.set(key, { deviceHash: hash, settings, at: this.#deps.now().toISOString() } satisfies SettingsReference).catch(() => undefined);
      this.#set({ kind: 'recorded', hash });
      return;
    }
    const result = settingsDrift(dialectId, { deviceHash: stored.deviceHash, settings: stored.settings }, settings, hash);
    if (!result.drift) {
      this.#set({ kind: 'match', hash, reference: stored });
      return;
    }
    await this.#deps.drift(epoch).catch(() => undefined);
    this.#set({ kind: 'drift', hash, reference: stored, result, accepted: false });
  }

  /**
   * Reads every settings group again after this browser wrote settings (SAFETY §4.6 step 8: writes
   * invalidate what was read). The fresh read becomes the reference on this computer.
   */
  reread(): void {
    const s = this.#lastSnapshot;
    const dialectId = this.#dialectId;
    if (s === null || dialectId === null || s.epoch !== this.#epoch) return;
    const before: Record<string, number> = {};
    for (const g of settingsReadGroups(dialectId)) before[g.token] = s.values[g.token]?.at ?? -1;
    this.#rereadFrom = before;
    this.#set({ kind: 'reading' });
    void this.#requestAll(dialectId);
  }

  /**
   * "Keep the board's settings": the read becomes this computer's reference.
   * Writes nothing to the machine. NEEDS_REVIEW stays until the next connect.
   */
  async keepBoardSettings(): Promise<void> {
    const phase = this.#phase;
    if (phase.kind !== 'drift' || phase.accepted || this.#dialectId === null || this.#boardId === null) return;
    const reference: SettingsReference = { deviceHash: phase.hash, settings: this.#settings, at: this.#deps.now().toISOString() };
    await this.#deps.store.set(referenceKey(this.#dialectId, this.#boardId), reference);
    this.#set({ ...phase, accepted: true });
  }
}
