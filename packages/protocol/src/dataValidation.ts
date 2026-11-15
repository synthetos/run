/** Strict data readers shared by deployed advisory and release metadata. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * An RFC 3339 UTC timestamp `YYYY-MM-DDTHH:MM:SSZ`, as milliseconds. It must
 * name a real instant exactly: `Date.parse` normalises 2026-02-31 to March 3
 * and 24:00:00 to the next day, so the parsed instant must print back as the
 * same text (P0-08 review).
 */
export function parseTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString() === `${value.slice(0, -1)}.000Z` ? ms : undefined;
}

/**
 * The clock as milliseconds, or undefined unless `now` is a genuine Date
 * holding a finite time. `Date.prototype.getTime` throws for anything that is
 * not a Date (whatever its own `getTime` says), and an Invalid Date gives NaN,
 * which would make both window comparisons false and fail open.
 */
export function clockMs(now: unknown): number | undefined {
  try {
    const ms = Date.prototype.getTime.call(now);
    return Number.isFinite(ms) ? ms : undefined;
  } catch {
    return undefined;
  }
}

export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((k) => allowed.includes(k));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
