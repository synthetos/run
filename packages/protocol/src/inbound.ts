/**
 * The inbound decoder: framer plus classifier (ROADMAP P0-07).
 *
 * One decoder per serial connection. Feed it every chunk the port delivers;
 * it returns the completed events in stream order. It holds no other state,
 * so a reconnect starts with a new decoder and no left-over partial line.
 */
import { classifyLine } from './classify.ts';
import { createFramer } from './frame.ts';
import type { Inbound } from './types.ts';

export interface InboundDecoder {
  /** Feed the next chunk of bytes; returns the events it completes, in order. Never throws. */
  push(chunk: Uint8Array): Inbound[];
}

export function createInboundDecoder(): InboundDecoder {
  const framer = createFramer();
  return {
    push(chunk: Uint8Array): Inbound[] {
      return framer.push(chunk).map((e) => (e.kind === 'Line' ? classifyLine(e.line) : e));
    },
  };
}

/**
 * Decode a whole byte stream given as chunks (tests, transcripts, replay).
 *
 * Events are appended one at a time: spreading a chunk's events into
 * `push(...)` passes one argument per event, and a large chunk (one event per
 * XON/XOFF byte) exceeds the engine's argument limit and throws RangeError.
 */
export function decodeInbound(chunks: Iterable<Uint8Array>): Inbound[] {
  const decoder = createInboundDecoder();
  const out: Inbound[] = [];
  for (const chunk of chunks) {
    for (const event of decoder.push(chunk)) out.push(event);
  }
  return out;
}
