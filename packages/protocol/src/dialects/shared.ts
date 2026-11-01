/**
 * Building blocks shared by the dialect data files (ROADMAP P0-08).
 *
 * Everything a dialect exports is frozen all the way down, so no consumer can
 * change a stat table or a stop sequence at runtime. `ReadonlyMap` is only a
 * compile-time promise, so status tables use `frozenMap`, which has no
 * mutating methods at all.
 */
import type { DialectPolls, StatEntry, StatusEntry, StopSequence } from './types.ts';

/** ASCII bytes run may write (PN §9.1). */
export const BYTE = Object.freeze({
  /** `!` feedhold. */
  FEEDHOLD: 0x21,
  /** `~` resume / cycle start. */
  RESUME: 0x7e,
  /** `%` queue flush. */
  FLUSH: 0x25,
  /** ^X reset. */
  RESET: 0x18,
  /** ^D job kill. */
  KILL: 0x04,
  /** ENQ. */
  ENQ: 0x05,
  /** XON / XOFF: never sent by the host on any dialect (PN §9.1). */
  XON: 0x11,
  XOFF: 0x13,
});

/** Polled-read cadence, identical on every dialect (SAFETY §4.2, RUN_PLAN §5.5). */
export const POLLS: DialectPolls = Object.freeze({ stopVerifyMs: 250, mpoRunMs: 500, heldMs: 1000 });

/** Longest job line run sends on TinyG (PN §7.4). */
export const TINYG_MAX_LINE_BYTES = 120;

/**
 * Freeze a plain data value and everything reachable from it. Only arrays
 * and plain objects are walked (dialect data holds nothing else besides
 * `frozenMap`, which is already immutable).
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

/** An immutable map: the ReadonlyMap interface over a private Map, with no way to change it. */
class FrozenMap<K, V> implements ReadonlyMap<K, V> {
  readonly #map: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#map = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#map.size;
  }

  get(key: K): V | undefined {
    return this.#map.get(key);
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
    for (const [key, value] of this.#map) callback(value, key, this);
  }

  entries(): MapIterator<[K, V]> {
    return this.#map.entries();
  }

  keys(): MapIterator<K> {
    return this.#map.keys();
  }

  values(): MapIterator<V> {
    return this.#map.values();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#map.entries();
  }
}

/** A frozen status table from `[code, name, class]` rows. Duplicate codes are a data bug and throw at load. */
export function statusTable(rows: readonly (readonly [number, string, StatusEntry['statusClass']])[]): ReadonlyMap<number, StatusEntry> {
  const entries: [number, StatusEntry][] = [];
  for (const [code, name, statusClass] of rows) {
    if (entries.some(([c]) => c === code)) throw new Error(`duplicate status code ${code} in a dialect table`);
    entries.push([code, Object.freeze({ name, statusClass })]);
  }
  return new FrozenMap(entries);
}

/** `stat` values 0..10, the same on every TinyG and g2core build (PN §8). Classes differ only at 2. */
export function statCore(alarmClass: 'softAlarm' | 'alarm'): StatEntry[] {
  return [
    { name: 'INITIALIZING', machineClass: 'initializing' },
    { name: 'READY', machineClass: 'idle' },
    { name: 'ALARM', machineClass: alarmClass },
    // Program stop is NOT idle while a job is active (PN §8, SAFETY H21).
    { name: 'PROGRAM_STOP', machineClass: 'programStop' },
    { name: 'PROGRAM_END', machineClass: 'end' },
    { name: 'RUN', machineClass: 'running' },
    { name: 'HOLD', machineClass: 'held' },
    { name: 'PROBE', machineClass: 'probing' },
    { name: 'CYCLE', machineClass: 'running' },
    { name: 'HOMING', machineClass: 'homing' },
    { name: 'JOG', machineClass: 'jogging' },
  ];
}

/**
 * Stop job for a READ_ONLY session (SAFETY §4.4): only `!` is available, and
 * the UI says "Use your E-stop or the controller's own stop". Nothing else is
 * ever sent to an unclassified or read-only build: no ^D, no `%`, no M-codes.
 */
export const READ_ONLY_STOP_JOB: StopSequence = deepFreeze({
  steps: [
    { kind: 'awaitInFlightWrite' },
    { kind: 'stopFeeding' },
    { kind: 'writeRealtime', byte: BYTE.FEEDHOLD },
    { kind: 'adviseEstop' },
    { kind: 'done', spindle: 'unknown' },
  ],
  onTimeout: 'faultW12',
});
