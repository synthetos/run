/**
 * Line validation for `Transport.writeLine` (ROADMAP P0-12; OLD ROADMAP
 * P0-12 "writeLine rejects anything that is not a single \n-terminated line
 * or a realtime byte group"; SAFETY H2, H2b; PN §4, §7.4, §9.1).
 *
 * This is the last check before bytes leave the host, and it knows nothing
 * about dialects, G-code or JSON: those are the sanitiser's and the
 * session's job. It only guarantees the shape every dialect needs, so that a
 * bug upstream can never turn one write into a split line, two lines, a
 * stray realtime command or a flow-control byte:
 *
 * A **line** is 2..`maxLineBytes` bytes (`MAX_WRITE_LINE_BYTES` unless the
 * session has tightened it to its dialect's `writeLineCapFor`):
 * - it ends in exactly one LF (0x0A), and LF appears nowhere else;
 * - CR (0x0D) appears nowhere: TinyG ends a line on CR too, so a CR inside
 *   would make one write two lines;
 * - every other byte is printable ASCII 0x20..0x7E or TAB. That rules out
 *   every realtime control byte (^D, ENQ, ^X), XON/XOFF (never sent on any
 *   dialect, PN §7.4) and anything at or above 0x7F;
 * - it contains none of `!`, `~`, `%`. TinyG traps them anywhere in the
 *   stream, even inside a comment, and on edge-next a mid-line `%` makes the
 *   line malformed (SAFETY H2). They are only ever sent as realtime groups;
 * - it is not blank: at least one byte other than space or TAB.
 *
 * A **realtime group** is 1..`MAX_REALTIME_GROUP_BYTES` bytes, each one of
 * the realtime bytes some dialect defines (`!` `~` `%` ^X ^D ENQ), with no
 * line ending. Whether a session may send a given byte to a given dialect
 * (T-S24a/b) is decided above the Transport, by dialect data and the
 * allow-matrix.
 */
import { BYTE, DIALECTS, type Dialect, type RealtimeBytes } from '@synthetos/protocol';

/**
 * Longest line a session on `dialect` may write, LF included: the larger of
 * the dialect's job line cap and its JSON line limit, plus the LF. Data, not
 * a TinyG constant (RUN_PLAN §5.1 rule 5): 255 on the TinyG dialects
 * (JSON_INPUT_STRING_MAX 254, PN §4; EN json_parser.h:39), 512 on g2core.
 */
export function writeLineCapFor(dialect: Dialect): number {
  return Math.max(dialect.limits.maxLineBytes, dialect.limits.maxJsonLineBytes) + 1;
}

/**
 * Longest line the Transport accepts before a dialect is known: the largest
 * `writeLineCapFor` over every dialect, so no dialect's legitimate line is
 * refused mid-job. Once the session has classified the board it tightens its
 * `GuardedTransport` to that dialect's cap. Dialect job limits are tighter
 * still (120 B on TinyG, PN §7.4) and are enforced by the sanitiser.
 */
export const MAX_WRITE_LINE_BYTES: number = Math.max(...DIALECTS.map(writeLineCapFor));

/** Longest realtime group, for example `!` followed by `%` in a single write. */
export const MAX_REALTIME_GROUP_BYTES = 4;

const LF = 0x0a;
const CR = 0x0d;
const TAB = 0x09;
const SPACE = 0x20;

/** The command bytes in `Dialect.realtime` (the other members are facts about them). */
const REALTIME_KEYS = ['feedhold', 'resume', 'flush', 'reset', 'kill', 'enq'] as const satisfies readonly (keyof RealtimeBytes)[];

/** Every realtime byte any dialect defines. Derived from dialect data, never typed in here. */
export const REALTIME_BYTES: ReadonlySet<number> = (() => {
  const set = new Set<number>();
  for (const d of DIALECTS) {
    for (const key of REALTIME_KEYS) {
      const entry = d.realtime[key];
      if (entry !== undefined) set.add(entry.byte);
    }
  }
  // XON/XOFF are flow control, never a command the host sends (PN §7.4, §9.1).
  set.delete(BYTE.XON);
  set.delete(BYTE.XOFF);
  return Object.freeze(set);
})();

/** Bytes TinyG traps anywhere in the stream; inside a line they are a surprise hold, resume or flush. */
const TRAPPED_IN_LINE: ReadonlySet<number> = new Set([BYTE.FEEDHOLD, BYTE.RESUME, BYTE.FLUSH]);

export type WriteShape = { readonly kind: 'line' } | { readonly kind: 'realtime' };

export type WriteRejectionReason =
  | 'empty'
  | 'too-long'
  | 'no-line-end'
  | 'embedded-lf'
  | 'cr'
  | 'control-byte'
  | 'non-ascii'
  | 'realtime-in-line'
  | 'blank-line'
  | 'realtime-group-too-long';

export interface WriteRejection {
  readonly kind: 'rejected';
  readonly reason: WriteRejectionReason;
  /** Offset of the offending byte, when there is one. */
  readonly at?: number;
}

/** Classify one write against a line cap (LF included). Pure: never throws, never looks at anything but the bytes. */
export function classifyWrite(bytes: Uint8Array, maxLineBytes: number = MAX_WRITE_LINE_BYTES): WriteShape | WriteRejection {
  if (bytes.length === 0) return { kind: 'rejected', reason: 'empty' };
  const last = bytes[bytes.length - 1];
  if (last !== LF) return classifyRealtime(bytes);
  return classifyLine(bytes, Math.min(maxLineBytes, MAX_WRITE_LINE_BYTES));
}

function classifyRealtime(bytes: Uint8Array): WriteShape | WriteRejection {
  if (bytes.every((b) => REALTIME_BYTES.has(b))) {
    if (bytes.length > MAX_REALTIME_GROUP_BYTES) return { kind: 'rejected', reason: 'realtime-group-too-long' };
    return { kind: 'realtime' };
  }
  // Not a realtime group, so it was meant as a line: report its first bad byte, else the missing LF.
  for (let i = 0; i < bytes.length; i++) {
    const rejection = rejectLineByte(bytes, i);
    if (rejection !== undefined) return rejection;
  }
  return { kind: 'rejected', reason: 'no-line-end' };
}

function classifyLine(bytes: Uint8Array, maxLineBytes: number): WriteShape | WriteRejection {
  if (bytes.length > maxLineBytes) return { kind: 'rejected', reason: 'too-long' };
  let visible = false;
  for (let i = 0; i < bytes.length - 1; i++) {
    const rejection = rejectLineByte(bytes, i);
    if (rejection !== undefined) return rejection;
    const b = bytes[i] as number;
    if (b !== SPACE && b !== TAB) visible = true;
  }
  if (!visible) return { kind: 'rejected', reason: 'blank-line' };
  return { kind: 'line' };
}

/** Why byte `i` may not appear in the body of a line, or undefined if it may. */
function rejectLineByte(bytes: Uint8Array, i: number): WriteRejection | undefined {
  const b = bytes[i] as number;
  if (b === LF) return { kind: 'rejected', reason: 'embedded-lf', at: i };
  if (b === CR) return { kind: 'rejected', reason: 'cr', at: i };
  if (b >= 0x7f) return { kind: 'rejected', reason: 'non-ascii', at: i };
  if (b < SPACE && b !== TAB) return { kind: 'rejected', reason: 'control-byte', at: i };
  if (TRAPPED_IN_LINE.has(b)) return { kind: 'rejected', reason: 'realtime-in-line', at: i };
  return undefined;
}
