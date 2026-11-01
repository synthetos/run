/**
 * Streaming line framer for controller output (ROADMAP P0-07, PN §7.1).
 *
 * Bytes arrive from the serial port in arbitrary chunks. The framer turns
 * them into events, in stream order:
 * - `FlowSignal` for every XON (0x11) and XOFF (0x13) byte, wherever it
 *   appears, even inside a line. The bytes are removed, so they never appear
 *   inside an emitted line. Web Serial has no XON/XOFF support and OS flow
 *   control is off, so these bytes arrive in the data (PN §3.2). TinyG sends
 *   XOFF when its RX buffer fills and XON when it drains (@cite EN xio.h:425-426,
 *   xio_usart.h:68-69).
 * - `Line` for every non-empty line. CR, LF, CRLF and LFCR all end a line,
 *   and empty lines are dropped, so a CRLF never produces a blank line and
 *   the split point between chunks never matters.
 * - `Garbled{reason:'overlong'}` as soon as a line passes `MAX_LINE_BYTES`
 *   without a line end. The rest of that line, up to the next CR or LF, is
 *   discarded, so memory stays bounded however long the line is.
 * - `Garbled{reason:'invalid-utf8'}` for a line that is not valid UTF-8.
 *
 * UTF-8 safety: bytes are split at CR and LF only, which never occur inside
 * a multi-byte UTF-8 sequence, and each complete line is decoded once with a
 * fatal decoder. A character split across chunks is therefore decoded
 * exactly as if it had arrived whole.
 *
 * The output is a pure function of the byte sequence: any re-chunking of the
 * same bytes yields the same events (fast-check property in the tests).
 * A partial line at the end of the input is held until its line end arrives.
 */
import type { FlowSignal, Garbled } from './types.ts';

/** Longest accepted line, in bytes, excluding the line end (ROADMAP P0-07: 4 KB). */
export const MAX_LINE_BYTES = 4096;

export const XON = 0x11;
export const XOFF = 0x13;
const LF = 0x0a;
const CR = 0x0d;

/** A complete, valid UTF-8 line, without its line end and without XON/XOFF bytes. */
export interface FramedLine {
  readonly kind: 'Line';
  readonly line: string;
}

export type FrameEvent = FramedLine | FlowSignal | Garbled;

export interface Framer {
  /** Feed the next chunk of bytes; returns the events it completes, in order. */
  push(chunk: Uint8Array): FrameEvent[];
}

const XON_EVENT: FlowSignal = Object.freeze({ kind: 'FlowSignal', signal: 'xon' });
const XOFF_EVENT: FlowSignal = Object.freeze({ kind: 'FlowSignal', signal: 'xoff' });

/** Create a framer. Each serial connection gets its own. */
export function createFramer(): Framer {
  const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const lossy = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  const buf = new Uint8Array(MAX_LINE_BYTES);
  let len = 0;
  let discarding = false;

  function decode(bytes: Uint8Array): FramedLine | Garbled {
    try {
      return Object.freeze({ kind: 'Line', line: strict.decode(bytes) });
    } catch {
      return Object.freeze({ kind: 'Garbled', reason: 'invalid-utf8', line: lossy.decode(bytes) });
    }
  }

  return {
    push(chunk: Uint8Array): FrameEvent[] {
      const events: FrameEvent[] = [];
      for (const b of chunk) {
        if (b === XON) {
          events.push(XON_EVENT);
        } else if (b === XOFF) {
          events.push(XOFF_EVENT);
        } else if (b === LF || b === CR) {
          if (len > 0) events.push(decode(buf.slice(0, len)));
          len = 0;
          discarding = false;
        } else if (discarding) {
          // Rest of an overlong line: already reported.
        } else if (len === MAX_LINE_BYTES) {
          events.push(
            Object.freeze({ kind: 'Garbled', reason: 'overlong', line: lossy.decode(buf.slice(0, len)) }),
          );
          len = 0;
          discarding = true;
        } else {
          buf[len++] = b;
        }
      }
      return events;
    },
  };
}
