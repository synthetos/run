/**
 * Immutable collections for schema data. A safety decision that reads these
 * (the read allowlist, the forbidden-write rules, the settings schema) must
 * not be changeable at runtime by any caller, including through a cast.
 */

/** The ReadonlyMap interface over a private Map, with no way to change it. */
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
    return this.#map[Symbol.iterator]();
  }
}

/** The ReadonlySet interface over a private Set, with no way to change it. */
class FrozenSet<T> implements ReadonlySet<T> {
  readonly #set: Set<T>;

  constructor(values: Iterable<T>) {
    this.#set = new Set(values);
    Object.freeze(this);
  }

  get size(): number {
    return this.#set.size;
  }

  has(value: T): boolean {
    return this.#set.has(value);
  }

  forEach(callback: (value: T, value2: T, set: ReadonlySet<T>) => void): void {
    for (const value of this.#set) callback(value, value, this);
  }

  entries(): SetIterator<[T, T]> {
    return this.#set.entries();
  }

  keys(): SetIterator<T> {
    return this.#set.keys();
  }

  values(): SetIterator<T> {
    return this.#set.values();
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.#set[Symbol.iterator]();
  }
}

export function frozenMap<K, V>(entries: Iterable<readonly [K, V]>): ReadonlyMap<K, V> {
  return new FrozenMap(entries);
}

export function frozenSet<T>(values: Iterable<T>): ReadonlySet<T> {
  return new FrozenSet(values);
}

/**
 * Freezes a plain JSON-shaped value (objects and arrays) all the way down and
 * returns it. Used for schema data and for profiles handed out by the
 * profile reader, so no caller can change them after validation.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
