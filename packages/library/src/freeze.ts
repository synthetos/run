/**
 * Records handed out by the library are frozen all the way down, so no
 * caller can change a validated record (or the seed data) after the fact.
 */

/** Freezes a plain JSON-shaped value (objects and arrays) all the way down and returns it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * A detached, frozen copy of a JSON value. Only called on values a schema
 * has accepted (finite numbers, strings, booleans, null, arrays and plain
 * objects), for which the JSON round trip is exact.
 */
export function frozenCopy<T>(value: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T);
}
