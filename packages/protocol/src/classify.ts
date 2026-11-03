/**
 * Inbound line classification (ROADMAP P0-07; PN §2.2, §5, §6).
 *
 * `classifyLine(line)` turns one framed line into exactly one event. The
 * rules are strict on purpose: a line that could be read two ways, or that
 * has the right key with the wrong value type, is `Garbled`, never guessed.
 * The machine treats `Garbled` as an integrity fault during a job (SAFETY §3),
 * so a false `Garbled` stops a job, while a false "valid" could let a damaged
 * line steer it.
 *
 * Shapes, checked on the top-level object (first match wins):
 *
 * | Top-level keys | Event |
 * |---|---|
 * | `r` (+ `f`, `tid`) | `Banner` (shape `r-footer`) when `r` has a string `msg` and any of `fv fb hp hv id`, or (no `tid`) exactly `fv fb hp hv id` (440.21 at `jv`=1); otherwise `Response` |
 * | exactly `sr` | `Banner` (shape `bare-sr`) when `sr` has a `msg`; otherwise `StatusReport` |
 * | `qr` (+ `qi`, `qo`) | `QueueReport` |
 * | exactly `rx`, an unsigned integer up to 255 | `RxReport` (440.21, after every `%`) |
 * | exactly `er` | `Exception` |
 * | exactly `ack` with value `true` | `Ack` |
 * | exactly `hb`, an object | `Heartbeat` (edge-next runtime heartbeat, `{"rt":{"hb":N}}`) |
 * | anything else | `Garbled{unrecognized-shape}` |
 *
 * Non-JSON lines: a line that does not start with `{` is `Text`, unless it
 * contains `{` or `}`, in which case it is a damaged JSON line
 * (`Garbled{json-fragment}`). Leading and trailing spaces and tabs are
 * ignored for this test; nothing is salvaged from a damaged line.
 */
import { parseJsonObject } from './json.ts';
import type { ClassifiedLine, Footer, Garbled, GarbledReason, JsonObject, JsonValue } from './types.ts';

/** Largest transaction id the board can echo: EN parses and prints it as uint32 (@cite EN json_parser.c:140-146, :948). */
export const MAX_TID = 0xffff_ffff;

/** Keys a banner carries besides `msg` (@cite EN report.c:68-81; TG report.c:88-101). */
const BANNER_IDENTITY_KEYS = ['fv', 'fb', 'hp', 'hv', 'id'] as const;

/** Largest value an `{"rx":n}` report can carry: the free bytes of a receive buffer smaller than 256 (@cite TG xio/xio_usart.h:54). */
export const MAX_RX_REPORT = 255;

/** The message of the last boot banner (@cite EN report.c:94-96). */
export const READY_MESSAGE = 'SYSTEM READY';

/** Classify one framed line. Never throws. */
export function classifyLine(line: string): ClassifiedLine {
  const text = line.replace(/^[ \t]+|[ \t]+$/g, '');
  if (!text.startsWith('{')) {
    return /[{}]/.test(text) ? garbled('json-fragment', line) : Object.freeze({ kind: 'Text', line });
  }
  // The line starts with '{', so a successful parse is always an object.
  const parsed = parseJsonObject(text);
  if (!parsed.ok) {
    const reason: GarbledReason =
      parsed.reason === 'too-deep' ? 'too-deep' : parsed.reason === 'too-large' ? 'too-large' : 'malformed-json';
    return garbled(reason, line);
  }
  const value = parsed.value;
  const keys = Object.keys(value);

  if ('r' in value) return classifyResponse(line, value, keys);
  if (sameKeys(keys, ['sr'])) return classifyStatus(line, value);
  if ('qr' in value) return classifyQueue(line, value, keys);
  if (sameKeys(keys, ['rx'])) {
    const rx = value['rx'];
    return isUint(rx) && rx <= MAX_RX_REPORT ? Object.freeze({ kind: 'RxReport', line, rx }) : garbled('bad-value', line, value);
  }
  if (sameKeys(keys, ['er'])) return classifyException(line, value);
  if (sameKeys(keys, ['ack'])) {
    return value['ack'] === true ? Object.freeze({ kind: 'Ack', line }) : garbled('bad-value', line, value);
  }
  if (sameKeys(keys, ['hb'])) {
    const hb = value['hb'];
    return isObject(hb) ? Object.freeze({ kind: 'Heartbeat', line, hb }) : garbled('bad-value', line, value);
  }
  return garbled('unrecognized-shape', line, value);
}

function classifyResponse(line: string, o: JsonObject, keys: readonly string[]): ClassifiedLine {
  if (!keys.every((k) => k === 'r' || k === 'f' || k === 'tid')) return garbled('unrecognized-shape', line, o);
  const r = o['r'];
  if (!isObject(r)) return garbled('bad-value', line, o);

  // The footer is a peer of r, or nested inside r on TG with fd=1 (PN §5.1). Never both.
  const top = o['f'];
  const nested = r['f'];
  if ((top === undefined) === (nested === undefined)) return garbled('bad-footer', line, o);
  const placement = top === undefined ? 'nested' : 'top';
  const footer = parseFooter(top ?? nested);
  if (footer === undefined) return garbled('bad-footer', line, o);
  if (footer.checksum !== undefined && footer.checksum !== checksum440(line)) {
    return garbled('checksum-mismatch', line, o);
  }

  let tid: number | undefined;
  if ('tid' in o) {
    const t = o['tid'];
    if (!isUint(t) || t > MAX_TID) return garbled('bad-tid', line, o);
    tid = t;
  }

  const body = placement === 'nested' ? without(r, 'f') : r;
  if (isBanner(body)) {
    // A boot banner never answers a request, so it never carries a tid.
    if (tid !== undefined) return garbled('unrecognized-shape', line, o);
    return banner(line, 'r-footer', body, footer);
  }
  return Object.freeze({
    kind: 'Response',
    line,
    r: body,
    footer,
    footerPlacement: placement,
    ...(tid === undefined ? {} : { tid }),
  });
}

function classifyStatus(line: string, o: JsonObject): ClassifiedLine {
  const sr = o['sr'];
  if (!isObject(sr)) return garbled('bad-value', line, o);
  // Generous on purpose: missing a reset is the dangerous error (SAFETY H19),
  // so any sr with a msg is a banner. Status reports never carry msg.
  if ('msg' in sr) return banner(line, 'bare-sr', sr, undefined);
  return Object.freeze({ kind: 'StatusReport', line, sr });
}

function classifyQueue(line: string, o: JsonObject, keys: readonly string[]): ClassifiedLine {
  if (!keys.every((k) => k === 'qr' || k === 'qi' || k === 'qo')) return garbled('unrecognized-shape', line, o);
  const { qr, qi, qo } = o;
  if (!isUint(qr) || (qi !== undefined && !isUint(qi)) || (qo !== undefined && !isUint(qo))) {
    return garbled('bad-value', line, o);
  }
  return Object.freeze({
    kind: 'QueueReport',
    line,
    qr,
    ...(qi === undefined ? {} : { qi }),
    ...(qo === undefined ? {} : { qo }),
  });
}

function classifyException(line: string, o: JsonObject): ClassifiedLine {
  const er = o['er'];
  if (!isObject(er)) return garbled('bad-value', line, o);
  const { st, msg, fb } = er;
  if (!isUint(st) || (msg !== undefined && typeof msg !== 'string') || (fb !== undefined && typeof fb !== 'number')) {
    return garbled('bad-value', line, o);
  }
  return Object.freeze({
    kind: 'Exception',
    line,
    st,
    msg: msg ?? '',
    er,
    ...(fb === undefined ? {} : { fb }),
  });
}

/**
 * Footer revisions 1, 2 and 3 (PN §5.2). Every element is a non-negative
 * integer. Revision 1 has three fields on g2core (@cite OLD-PN §5, G2
 * json_parser.cpp:611-618) and four on TG, the fourth being a checksum
 * (@cite TG json_parser.c:529, :550). Revisions 2 and 3 have exactly three
 * (@cite EN json_parser.c:957, :960; controller.c:607-613).
 */
export function parseFooter(f: JsonValue | undefined): Footer | undefined {
  if (!Array.isArray(f)) return undefined;
  const raw: readonly JsonValue[] = f;
  const [rev, status, field3, checksum] = raw;
  if (rev !== 1 && rev !== 2 && rev !== 3) return undefined;
  const lengthOk = rev === 1 ? raw.length === 3 || raw.length === 4 : raw.length === 3;
  if (!lengthOk || !isUint(status) || !isUint(field3)) return undefined;
  if (checksum !== undefined && !isUint(checksum)) return undefined;
  return Object.freeze({
    rev,
    status,
    field3,
    ...(checksum === undefined ? {} : { checksum }),
    raw: raw as readonly number[],
  });
}

/**
 * The revision-1 footer checksum: h = 31·h + byte (uint32) over the line up
 * to its last comma, modulo 9999 (@cite TG util.c:255-265, json_parser.c:543-550;
 * EN-HIL `tests/hil/tinyg_hil/protocol.py` `checksum_440`, checked there on
 * lines captured from a 440.20 board).
 */
export function checksum440(line: string): number {
  const bytes = new TextEncoder().encode(line.slice(0, line.lastIndexOf(',')));
  let h = 0;
  for (const b of bytes) h = (Math.imul(31, h) + b) >>> 0;
  return h % 9999;
}

function isBanner(body: JsonObject): boolean {
  if (typeof body['msg'] === 'string') return BANNER_IDENTITY_KEYS.some((k) => k in body);
  // 440.21 at jv=1: SYSTEM READY is printed after the machine is READY, so the verbosity filter drops
  // `msg` (NV_TYPE_MESSAGE) and keeps the config values (@cite TG main.c:131-136, json_parser.c:490-511).
  // The body is then exactly fv, fb, hp, hv and id. The probe never GETs that set in one line, and no
  // host code may (one key per GET, PN §4), so no answer can take this shape.
  const keys = Object.keys(body);
  return !('msg' in body) && keys.length === BANNER_IDENTITY_KEYS.length && BANNER_IDENTITY_KEYS.every((k) => k in body);
}

function banner(line: string, shape: 'r-footer' | 'bare-sr', fields: JsonObject, footer: Footer | undefined): ClassifiedLine {
  const { msg, fv, fb, hp, hv, id, fbs } = fields;
  const text = typeof msg === 'string' ? msg : '';
  return Object.freeze({
    kind: 'Banner',
    line,
    shape,
    msg: text,
    ready: msg === undefined ? null : text === READY_MESSAGE,
    fields,
    ...(typeof fv === 'number' ? { fv } : {}),
    ...(typeof fb === 'number' ? { fb } : {}),
    ...(typeof hp === 'number' || typeof hp === 'string' ? { hp } : {}),
    ...(typeof hv === 'number' || typeof hv === 'string' ? { hv } : {}),
    ...(typeof id === 'string' ? { id } : {}),
    ...(typeof fbs === 'string' ? { fbs } : {}),
    ...(footer === undefined ? {} : { footer }),
  });
}

function garbled(reason: GarbledReason, line: string, value?: JsonValue): Garbled {
  return Object.freeze({ kind: 'Garbled', reason, line, ...(value === undefined ? {} : { value }) });
}

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isUint(v: JsonValue | undefined): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function sameKeys(keys: readonly string[], expected: readonly string[]): boolean {
  return keys.length === expected.length && expected.every((k) => keys.includes(k));
}

function without(o: JsonObject, key: string): JsonObject {
  const out: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const k of Object.keys(o)) if (k !== key) out[k] = o[k] as JsonValue;
  return Object.freeze(out);
}
