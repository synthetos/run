/**
 * A small JSON parser for controller output: strict JSON plus TinyG's relaxed
 * syntax, with hard limits, and it never throws (ROADMAP P0-07).
 *
 * Why not `JSON.parse`: TinyG prints relaxed JSON (bare keys) when `js=0`,
 * and exception and queue reports pass through `json_relax()` on edge-next
 * (@cite EN json_parser.c:938-967, report.c:156 and :774; TG report.c:60-61,
 * json_parser.c:376-380). `JSON.parse` would also accept input
 * of any size and nesting, and it throws.
 *
 * Accepted input:
 * - one value: object, array, string, number, `true`, `false`, `null`;
 * - object keys quoted (JSON strings) or bare (`[A-Za-z0-9_]+`, the token
 *   characters TinyG uses, @cite EN json_parser.c:101-104);
 * - the bare literals `t`, `f` and `n` that TinyG accepts for true, false and
 *   null (@cite EN json_parser.c:312-321, report.c:172-186);
 * - spaces and tabs between tokens.
 *
 * Refused input (each is a typed error, never an exception):
 * - anything over `maxChars` characters or nested deeper than `maxDepth`
 *   (each capped at `JSON_HARD_LIMITS`, so no caller limit can make it throw);
 * - a key repeated in one object with a different value, or with an object
 *   or array value (which value would the board have meant?). A key repeated
 *   with the same scalar value is accepted: TinyG 0.97 really prints
 *   `{"r":{"c":{..,"tn":-1,..,"tn":-1,..}},..}` for a group read (forum
 *   fixture `z-axis-problem`);
 * - `nan`, `inf`, a number that overflows to Infinity, leading zeros, `+1`,
 *   `.5` or `1.`: a value that is not a finite JSON number never reaches the
 *   machine model;
 * - raw control characters inside strings, unknown escapes, trailing data.
 *
 * Objects are created with a null prototype and frozen, so a key such as
 * `__proto__` or `constructor` is plain data and parsed output is immutable.
 */
import type { JsonArray, JsonObject, JsonValue } from './types.ts';

export interface JsonLimits {
  /** Longest accepted input, in UTF-16 code units. */
  readonly maxChars: number;
  /** Deepest accepted nesting of objects and arrays (the outermost is 1). */
  readonly maxDepth: number;
}

/**
 * Default limits. A firmware line is at most 512 bytes (@cite EN controller.h:32,
 * `OUTPUT_BUFFER_LEN`), so the framer's 4 KB line cap is already generous;
 * the parser enforces its own cap so it is safe on any caller's input.
 * Real output nests three levels (`{"r":{"sr":{...}}}`).
 */
export const DEFAULT_JSON_LIMITS: JsonLimits = Object.freeze({ maxChars: 4096, maxDepth: 16 });

/**
 * Hard ceilings on any caller's limits. The parser recurses once per nesting
 * level, so a caller's `maxDepth` must not reach the engine's stack limit
 * (`'['.repeat(4096)` with `maxDepth: 10000` overflowed it); and `maxChars`
 * bounds the work for one input. A caller can ask for smaller limits, never
 * larger ones. A limit that is NaN or negative refuses every input.
 */
export const JSON_HARD_LIMITS: JsonLimits = Object.freeze({ maxChars: 65536, maxDepth: 64 });

function capLimit(requested: number, hard: number): number {
  if (typeof requested !== 'number' || Number.isNaN(requested) || requested < 0) return -1;
  return Math.min(Math.floor(requested), hard);
}

export type JsonErrorReason =
  | 'too-large'
  | 'too-deep'
  | 'syntax'
  | 'duplicate-key'
  | 'non-finite-number';

export type JsonParseResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly reason: JsonErrorReason; readonly offset: number };

/** Marks a failed sub-parse; the reason and offset are recorded in the state. */
const FAIL: unique symbol = Symbol('fail');
type Parsed = JsonValue | typeof FAIL;

interface State {
  readonly text: string;
  readonly maxDepth: number;
  pos: number;
  depth: number;
  reason: JsonErrorReason;
  errorAt: number;
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const BARE_WORD = /[A-Za-z0-9_]+/y;
const HEX4 = /[0-9A-Fa-f]{4}/y;

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
});

/** Parse `text` as one strict-or-relaxed JSON value. Never throws. */
export function parseJson(text: string, limits: JsonLimits = DEFAULT_JSON_LIMITS): JsonParseResult {
  // A non-object `limits` (null from untyped JS) refuses every input rather than throwing.
  const given: Partial<JsonLimits> = typeof limits === 'object' && limits !== null ? limits : {};
  const maxChars = capLimit(given.maxChars as number, JSON_HARD_LIMITS.maxChars);
  const maxDepth = capLimit(given.maxDepth as number, JSON_HARD_LIMITS.maxDepth);
  if (maxChars < 0 || text.length > maxChars) return { ok: false, reason: 'too-large', offset: Math.max(0, maxChars) };
  if (maxDepth < 0) return { ok: false, reason: 'too-deep', offset: 0 };
  const s: State = { text, maxDepth, pos: 0, depth: 0, reason: 'syntax', errorAt: 0 };
  skipSpace(s);
  const value = parseValue(s);
  if (value === FAIL) return { ok: false, reason: s.reason, offset: s.errorAt };
  skipSpace(s);
  if (s.pos !== text.length) return { ok: false, reason: 'syntax', offset: s.pos };
  return { ok: true, value };
}

export type JsonObjectParseResult =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly reason: JsonErrorReason | 'not-object'; readonly offset: number };

/** Parse `text` as one JSON object (the only top level controller output has). Never throws. */
export function parseJsonObject(text: string, limits: JsonLimits = DEFAULT_JSON_LIMITS): JsonObjectParseResult {
  const result = parseJson(text, limits);
  if (!result.ok) return result;
  const v = result.value;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, reason: 'not-object', offset: 0 };
  return { ok: true, value: v as JsonObject };
}

function fail(s: State, reason: JsonErrorReason, at: number = s.pos): typeof FAIL {
  s.reason = reason;
  s.errorAt = at;
  return FAIL;
}

function skipSpace(s: State): void {
  while (s.pos < s.text.length) {
    const c = s.text.charCodeAt(s.pos);
    if (c !== 0x20 && c !== 0x09) return;
    s.pos++;
  }
}

function parseValue(s: State): Parsed {
  const c = s.text[s.pos];
  if (c === '{') return parseObject(s);
  if (c === '[') return parseArray(s);
  if (c === '"') return parseString(s);
  if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return parseNumber(s);
  return parseLiteral(s);
}

function enter(s: State): boolean {
  s.depth++;
  return s.depth <= s.maxDepth;
}

function parseObject(s: State): Parsed {
  const start = s.pos;
  if (!enter(s)) return fail(s, 'too-deep', start);
  s.pos++; // '{'
  const out: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  skipSpace(s);
  if (s.text[s.pos] === '}') {
    s.pos++;
    s.depth--;
    return Object.freeze(out) as JsonObject;
  }
  for (;;) {
    const keyAt = s.pos;
    const key = s.text[s.pos] === '"' ? parseString(s) : parseBareKey(s);
    if (key === FAIL) return FAIL;
    skipSpace(s);
    if (s.text[s.pos] !== ':') return fail(s, 'syntax');
    s.pos++;
    skipSpace(s);
    const value = parseValue(s);
    if (value === FAIL) return FAIL;
    if (Object.hasOwn(out, key as string) && !sameScalar(out[key as string], value)) {
      return fail(s, 'duplicate-key', keyAt);
    }
    out[key as string] = value;
    skipSpace(s);
    const sep = s.text[s.pos];
    if (sep === '}') {
      s.pos++;
      s.depth--;
      return Object.freeze(out) as JsonObject;
    }
    if (sep !== ',') return fail(s, 'syntax');
    s.pos++;
    skipSpace(s);
  }
}

function parseArray(s: State): Parsed {
  const start = s.pos;
  if (!enter(s)) return fail(s, 'too-deep', start);
  s.pos++; // '['
  const out: JsonValue[] = [];
  skipSpace(s);
  if (s.text[s.pos] === ']') {
    s.pos++;
    s.depth--;
    return Object.freeze(out) as JsonArray;
  }
  for (;;) {
    const value = parseValue(s);
    if (value === FAIL) return FAIL;
    out.push(value);
    skipSpace(s);
    const sep = s.text[s.pos];
    if (sep === ']') {
      s.pos++;
      s.depth--;
      return Object.freeze(out) as JsonArray;
    }
    if (sep !== ',') return fail(s, 'syntax');
    s.pos++;
    skipSpace(s);
  }
}

function parseString(s: State): Parsed {
  s.pos++; // opening quote
  let out = '';
  let runStart = s.pos;
  while (s.pos < s.text.length) {
    const c = s.text.charCodeAt(s.pos);
    if (c === 0x22) {
      out += s.text.slice(runStart, s.pos);
      s.pos++;
      return out;
    }
    if (c < 0x20) return fail(s, 'syntax');
    if (c !== 0x5c) {
      s.pos++;
      continue;
    }
    out += s.text.slice(runStart, s.pos);
    const e = s.text[s.pos + 1];
    if (e === 'u') {
      HEX4.lastIndex = s.pos + 2;
      if (!HEX4.test(s.text)) return fail(s, 'syntax');
      out += String.fromCharCode(Number.parseInt(s.text.slice(s.pos + 2, s.pos + 6), 16));
      s.pos += 6;
    } else {
      const mapped = e === undefined ? undefined : ESCAPES[e];
      if (mapped === undefined) return fail(s, 'syntax');
      out += mapped;
      s.pos += 2;
    }
    runStart = s.pos;
  }
  return fail(s, 'syntax'); // unterminated
}

function parseBareKey(s: State): Parsed {
  BARE_WORD.lastIndex = s.pos;
  const m = BARE_WORD.exec(s.text);
  if (m === null) return fail(s, 'syntax');
  s.pos += m[0].length;
  return m[0];
}

function parseNumber(s: State): Parsed {
  NUMBER.lastIndex = s.pos;
  const m = NUMBER.exec(s.text);
  if (m === null) return fail(s, 'syntax');
  const end = s.pos + m[0].length;
  // A number must end at a delimiter: `1.` `01` `1x` are not numbers.
  const next = s.text[end];
  if (next !== undefined && /[0-9A-Za-z_.+-]/.test(next)) return fail(s, 'syntax', end);
  const value = Number(m[0]);
  if (!Number.isFinite(value)) return fail(s, 'non-finite-number');
  s.pos = end;
  return value;
}

function parseLiteral(s: State): Parsed {
  BARE_WORD.lastIndex = s.pos;
  const m = BARE_WORD.exec(s.text);
  const word = m === null ? '' : m[0];
  switch (word) {
    case 'true':
    case 't':
      s.pos += word.length;
      return true;
    case 'false':
    case 'f':
      s.pos += word.length;
      return false;
    case 'null':
    case 'n':
      s.pos += word.length;
      return null;
    default:
      return fail(s, 'syntax');
  }
}

/**
 * True when a repeated key carries the same scalar value, so nothing is
 * ambiguous. Objects and arrays are fresh instances, so they never compare
 * equal and a repeated container key is always refused.
 */
function sameScalar(a: JsonValue | undefined, b: JsonValue): boolean {
  return a === b;
}
