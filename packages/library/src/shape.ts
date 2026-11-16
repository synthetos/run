/** The small shape guards the record readers share. Pure. */

export const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A bed-local or stock-local point, `[x, y]`. */
export const isPoint = (v: unknown): boolean => isArray(v) && v.length === 2 && v.every(isNum);
/** A hole, `[x, y, r]`. */
export const isHole = (v: unknown): boolean => isArray(v) && v.length === 3 && v.every(isNum);
/** A SHA-256 digest in lower-case hex. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;
/** An ISO 8601 date-time string that parses to a real instant. */
export const isDateTime = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
