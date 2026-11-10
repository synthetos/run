/**
 * The terminal's command history (H91): up and down through what was typed, per machine, kept in this browser.
 * No two equal lines in a row; the oldest go first past `max`. Ctrl-R searches back for a line containing the text.
 *
 * Storage can be missing or throw (a private window, blocked site data, a full quota): the history then lasts for
 * this page only. Nothing here decides what is sent: a recalled line is classified again like any typed line.
 *
 * Pure apart from the storage it is given.
 */
import type { StorageLike } from '../workspace/storage.ts';

export const HISTORY_KEY_PREFIX = 'run.term.history.';
export const HISTORY_MAX = 200;

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function load(storage: StorageLike | null, key: string): string[] {
  if (storage === null) return [];
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === 'string') : [];
  } catch {
    return [];
  }
}

function save(storage: StorageLike | null, key: string, lines: readonly string[]): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(key, JSON.stringify(lines));
    return true;
  } catch {
    return false;
  }
}

export class History {
  readonly #key: string;
  readonly #storage: StorageLike | null;
  readonly #max: number;
  #lines: string[];
  /** Where up and down are: `lines.length` is the line being typed (below the newest). */
  #cursor: number;
  /** What was being typed before the first up, given back by the last down. */
  #draft = '';
  /** False once storage refused a write: the history lasts for this page only. */
  saved: boolean;

  constructor(machineId: string, options: { readonly storage?: StorageLike | null; readonly max?: number } = {}) {
    this.#key = HISTORY_KEY_PREFIX + machineId;
    this.#storage = options.storage === undefined ? browserStorage() : options.storage;
    this.#max = options.max ?? HISTORY_MAX;
    this.#lines = load(this.#storage, this.#key).slice(-this.#max);
    this.#cursor = this.#lines.length;
    this.saved = this.#storage !== null;
  }

  get lines(): readonly string[] {
    return this.#lines;
  }

  /** A line was entered: kept unless blank or equal to the newest, and up starts again from the newest. */
  add(line: string): void {
    const text = line.trim();
    this.#cursor = this.#lines.length;
    this.#draft = '';
    if (text === '' || this.#lines.at(-1) === text) return;
    this.#lines = [...this.#lines, text].slice(-this.#max);
    this.#cursor = this.#lines.length;
    this.saved = save(this.#storage, this.#key, this.#lines);
  }

  /** The older line (Arrow Up), or `current` when there is none. `current` is kept as the draft on the first step. */
  up(current: string): string {
    if (this.#cursor === this.#lines.length) this.#draft = current;
    if (this.#cursor === 0) return this.#lines[0] ?? current;
    this.#cursor -= 1;
    return this.#lines[this.#cursor] as string;
  }

  /** The newer line (Arrow Down); past the newest, the draft that was being typed. */
  down(): string {
    if (this.#cursor >= this.#lines.length) return this.#draft;
    this.#cursor += 1;
    return this.#cursor === this.#lines.length ? this.#draft : (this.#lines[this.#cursor] as string);
  }

  /**
   * Ctrl-R: the newest line containing `query` (case-insensitive) older than index `before` (all lines when absent),
   * with its index so the next Ctrl-R can search further back; null when none matches.
   */
  search(query: string, before = this.#lines.length): { readonly line: string; readonly index: number } | null {
    const q = query.toLowerCase();
    if (q === '') return null;
    for (let i = Math.min(before, this.#lines.length) - 1; i >= 0; i--) {
      const line = this.#lines[i] as string;
      if (line.toLowerCase().includes(q)) return { line, index: i };
    }
    return null;
  }
}
