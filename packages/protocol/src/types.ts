/**
 * Inbound event types: what the controller sent, after framing and
 * classification (ROADMAP P0-07, RUN_PLAN §5.5, PN §2.2, §5, §6).
 *
 * Every event is immutable. Classification never interprets machine state
 * (stat values, status codes, footer field 3): that is dialect data (P0-08)
 * and machine policy. It only says what kind of line arrived and extracts
 * its parts, refusing anything ambiguous as `Garbled`.
 */

/** A parsed JSON value. Objects have a null prototype and are frozen. */
export type JsonValue = null | boolean | number | string | JsonArray | JsonObject;
export type JsonArray = readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * A response footer (PN §5.2).
 *
 * | rev | build | shape | field3 |
 * |---|---|---|---|
 * | 1 | TG 440.21, g2core | `[1,status,n,checksum]` (TG) or `[1,status,n]` (g2) | bytes consumed by the line, + 1 |
 * | 2 | EN / stock 449, `rxm=0` | `[2,status,n]` | bytes read since the previous reply (EN after E164) or the line length |
 * | 3 | EN / stock 449, `rxm=1` | `[3,status,n]` | free line headers, not bytes |
 *
 * What field3 means is decided by the dialect and the flow engine, never here.
 */
export interface Footer {
  readonly rev: 1 | 2 | 3;
  /** Status code of the line (0 = OK). Its meaning is dialect data. */
  readonly status: number;
  readonly field3: number;
  /**
   * Revision 1 with four fields only: the checksum the board computed over
   * the line up to its last comma. A mismatch makes the line `Garbled`.
   */
  readonly checksum?: number;
  /** The footer array exactly as received. */
  readonly raw: readonly number[];
}

/** `{"r":{...},"f":[...]}`: the board's answer to one line. */
export interface Response {
  readonly kind: 'Response';
  readonly line: string;
  /** The body of `r`, without a nested `f` (TG `fd=1`). */
  readonly r: JsonObject;
  readonly footer: Footer;
  /** `top` is the normal form; `nested` is TG with `fd=1` (PN §5.1). */
  readonly footerPlacement: 'top' | 'nested';
  /** The top-level transaction id, when the board echoed one (EN only, PN §5.3). */
  readonly tid?: number;
}

/** An unsolicited `{"sr":{...}}` status report (PN §6.1). */
export interface StatusReport {
  readonly kind: 'StatusReport';
  readonly line: string;
  readonly sr: JsonObject;
}

/** `{"qr":n}` or `{"qr":n,"qi":a,"qo":b}` (PN §6.2). */
export interface QueueReport {
  readonly kind: 'QueueReport';
  readonly line: string;
  readonly qr: number;
  readonly qi?: number;
  readonly qo?: number;
}

/**
 * `{"rx":n}`: free bytes in the USB receive buffer. 440.21 prints it
 * unsolicited after every queue flush (`%`), whatever the verbosity, `js`
 * or `qv` (@cite TG canonical_machine.c:1302-1303 `rx_request_rx_report()`
 * in `cm_queue_flush`; report.c:541-548 `rx_report_callback`). EN never
 * requests one. It is informational: it does not answer a line.
 */
export interface RxReport {
  readonly kind: 'RxReport';
  readonly line: string;
  readonly rx: number;
}

/** `{"er":{"fb":..,"st":n,"msg":"..."}}`, strict or relaxed (PN §5.5). */
export interface Exception {
  readonly kind: 'Exception';
  readonly line: string;
  readonly st: number;
  readonly msg: string;
  readonly fb?: number;
  readonly er: JsonObject;
}

/**
 * A startup banner: the board has (re)booted (PN §2.2; SAFETY H19).
 * - `r-footer`: TG and g2core, `{"r":{"fv",..,"msg":".."},"f":[..]}`.
 * - `bare-sr`: EN and stock edge-0.97, `{"sr":{"fv",..,"msg":".."}}` with no footer.
 *
 * Boot prints up to three of these ("Initializing configs ...", "Loading
 * configs from EEPROM", "SYSTEM READY"); `ready` is true only for the last.
 * Every one of them means the board reset.
 *
 * 440.21 at `jv`=1 drops `msg` from its banner (the verbosity filter applies
 * once the machine is READY, @cite TG json_parser.c:490-511), so its reset
 * arrives as an `r` with exactly `fv fb hp hv id`: a banner with `msg` ''
 * and `ready` null (unknown). At `jv`=0 it prints no banner at all.
 */
export interface Banner {
  readonly kind: 'Banner';
  readonly line: string;
  readonly shape: 'r-footer' | 'bare-sr';
  readonly msg: string;
  /** True for SYSTEM READY, false for an earlier boot message, null when the banner carried no `msg`. */
  readonly ready: boolean | null;
  readonly fv?: number;
  readonly fb?: number;
  /** A number on TinyG, a string on g2core (OLD-PN §2.2). */
  readonly hp?: number | string;
  readonly hv?: number | string;
  readonly id?: string;
  /** g2core build hash (OLD-PN §2.2); proposed for EN (PN §2.5). */
  readonly fbs?: string;
  /** Every field of the banner object as received. */
  readonly fields: JsonObject;
  /** The footer of an `r-footer` banner. */
  readonly footer?: Footer;
}

/**
 * `{"hb":{"stat":..,"hold":..,"up":..,"qt":..}}`: an edge-next runtime heartbeat line (EN runtime.c), printed every
 * `hb` seconds (1..60) after `{"rt":{"hb":N}}` while the link and the machine are quiet; `up` is seconds since
 * power-up. It has no `r` and no footer and answers nothing:
 * it is proof of life only. `stat` and `hold` are what the board reported, kept for display.
 */
export interface Heartbeat {
  readonly kind: 'Heartbeat';
  readonly line: string;
  readonly hb: JsonObject;
}

/** `{"ack":true}`: the answer to ENQ (PN §5.6). */
export interface Ack {
  readonly kind: 'Ack';
  readonly line: string;
}

/** A line that is not JSON and carries no JSON fragment: text-mode output, prompts. */
export interface Text {
  readonly kind: 'Text';
  readonly line: string;
}

export type GarbledReason =
  /** Longer than `MAX_LINE_BYTES` before a line end; the rest of the line is dropped. */
  | 'overlong'
  /** Not valid UTF-8. `line` is a lossy decoding, for display only. */
  | 'invalid-utf8'
  /** Starts with `{` but is not one valid (relaxed) JSON object. */
  | 'malformed-json'
  /** Valid JSON but nested deeper than the parser allows. */
  | 'too-deep'
  /** Valid JSON but longer than the parser allows. */
  | 'too-large'
  /** Does not start with `{` but contains `{` or `}`: a damaged or spliced JSON line. */
  | 'json-fragment'
  /** A JSON object of no known shape (including the `prb`, `jog` and `job` reports, not classified yet). */
  | 'unrecognized-shape'
  /**
   * A response with no footer, or a footer that is not a valid revision 1, 2
   * or 3 array, or (after `checkFooterForDialect`) a footer whose checksum
   * presence does not match the dialect.
   */
  | 'bad-footer'
  /** A revision-1 footer whose checksum does not match the line. */
  | 'checksum-mismatch'
  /** A top-level `tid` that is not an unsigned 32-bit integer. */
  | 'bad-tid'
  /** A known top-level key whose value has the wrong type (for example `{"qr":"x"}`). */
  | 'bad-value';

/**
 * A line that cannot be trusted. The machine treats it as an integrity
 * fault while a job runs (SAFETY §3 FAULT, "a garbled frame").
 */
export interface Garbled {
  readonly kind: 'Garbled';
  readonly reason: GarbledReason;
  /** The line as received (lossy for `invalid-utf8`; the first 4096 bytes for `overlong`). */
  readonly line: string;
  /** The parsed value, when the line was valid JSON. */
  readonly value?: JsonValue;
}

/** XON (0x11) or XOFF (0x13) from the board, removed from the byte stream (PN §7.1). */
export interface FlowSignal {
  readonly kind: 'FlowSignal';
  readonly signal: 'xon' | 'xoff';
}

/** A classified line (everything except flow signals). */
export type ClassifiedLine = Response | StatusReport | QueueReport | RxReport | Exception | Banner | Ack | Heartbeat | Text | Garbled;

/** Everything the inbound decoder emits, in stream order. */
export type Inbound = ClassifiedLine | FlowSignal;
