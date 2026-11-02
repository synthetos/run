/**
 * Redaction for problem reports (REPORT_A_PROBLEM §4, §6). It runs before the
 * preview, so the preview shows exactly what would be posted.
 *
 * A board's `id` is unique to its chip and identifies the board (and so its
 * owner) for life. Every copy of it is replaced with `0X0000-XXX`, as in
 * B-PROBE-1: the exact id the session read, any JSON `"id"` value, and
 * anything shaped like a TinyG id (`2X4D54-KRT`), in case a transcript holds
 * one the session never parsed.
 */

export const REDACTED_ID = '0X0000-XXX';

/** TinyG's id shape: two characters, four digits, a dash, three characters. */
const ID_SHAPE = /\b[0-9A-Z]{2}[0-9A-F]{4}-[0-9A-Z]{3}\b/g;
/** A JSON `"id"` member with a string value (`{"r":{"id":"…"}}`). */
const JSON_ID = /("id"\s*:\s*)"(?:[^"\\]|\\.)*"/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `text` with every known id, every JSON `"id"` value and every id-shaped word replaced. */
export function redactText(text: string, ids: readonly (string | null | undefined)[] = []): string {
  let out = text;
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (trimmed.length < 3 || trimmed === REDACTED_ID) continue;
    out = out.replace(new RegExp(escapeRegExp(trimmed), 'g'), REDACTED_ID);
  }
  out = out.replace(JSON_ID, `$1"${REDACTED_ID}"`);
  return out.replace(ID_SHAPE, REDACTED_ID);
}

/** A value with every string inside it redacted (objects and arrays copied). */
export function redactValue(value: unknown, ids: readonly (string | null | undefined)[] = []): unknown {
  if (typeof value === 'string') return redactText(value, ids);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, ids));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === 'id' && typeof v === 'string' ? REDACTED_ID : redactValue(v, ids);
    return out;
  }
  return value;
}
