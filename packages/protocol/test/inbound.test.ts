/**
 * ROADMAP P0-07 fast-check acceptance:
 * (a) re-chunking invariance: any chunking of a stream yields the same events;
 * (b) arbitrary bytes never throw, and non-JSON input yields only Garbled,
 *     Text or FlowSignal;
 * (c) XON/XOFF never appear inside emitted lines.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { XOFF, XON, createFramer } from '../src/frame.ts';
import { createInboundDecoder, decodeInbound } from '../src/inbound.ts';
import type { Inbound } from '../src/types.ts';

const enc = new TextEncoder();

/** Lines a board really sends (EN-HIL transcripts, PN examples), used to build valid streams. */
const VALID_LINES = [
  '{"r":{"stat":5},"f":[2,0,14]}',
  '{"r":{"fb":449.01},"tid":33,"f":[3,0,11]}',
  '{"r":{"fb":440.20},"f":[1,0,12,1645]}',
  '{"sr":{"posx":-0.037}}',
  '{"sr":{"fv":0.97,"fb":449.01,"hp":1,"hv":8,"id":"0BENCH-TWO","msg":"SYSTEM READY"}}',
  '{"qr":32}',
  '{qr:20,qi:3,qo:1}',
  '{"er":{"fb":449.01,"st":203,"msg":"Limit hit [$clear to reset, $lim=0 to override] - input 1"}}',
  '{er:{fb:440.21,st:204,msg:"Limit switch hit - Shutdown occurred"}}',
  '{"ack":true}',
  'tinyg [mm] ok> ',
  '{"r":{"msg":"°µé€𝄞"},"f":[3,0,11]}',
];

const lineEnd = fc.constantFrom('\n', '\r', '\r\n', '\n\r', '\n\n');
const flowByte = fc.constantFrom(XON, XOFF);

/** A stream of valid lines with arbitrary line ends and XON/XOFF bytes sprinkled in. */
const validStream = fc
  .array(fc.tuple(fc.constantFrom(...VALID_LINES), lineEnd, fc.array(fc.tuple(fc.nat(), flowByte), { maxLength: 3 })), {
    maxLength: 25,
  })
  .map((parts) => {
    const out: number[] = [];
    for (const [line, end, flows] of parts) {
      const bytes = [...enc.encode(line + end)];
      for (const [pos, b] of flows) bytes.splice(pos % (bytes.length + 1), 0, b);
      out.push(...bytes);
    }
    return Uint8Array.from(out);
  });

/** Split `bytes` at the given cut points (any positions, sorted, duplicates allowed). */
function chunk(bytes: Uint8Array, cuts: number[]): Uint8Array[] {
  const points = [...new Set(cuts.map((c) => c % (bytes.length + 1)))].sort((a, b) => a - b);
  const out: Uint8Array[] = [];
  let prev = 0;
  for (const p of [...points, bytes.length]) {
    out.push(bytes.slice(prev, p));
    prev = p;
  }
  return out;
}

describe('inbound decoder', () => {
  it('(a) yields the same events for any re-chunking of a valid stream', () => {
    fc.assert(
      fc.property(validStream, fc.array(fc.nat(), { maxLength: 40 }), (stream, cuts) => {
        const whole = decodeInbound([stream]);
        expect(decodeInbound(chunk(stream, cuts))).toEqual(whole);
        // And every valid line is recognised: nothing in a valid stream is Garbled.
        expect(whole.filter((e) => e.kind === 'Garbled')).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });

  it('(a) yields the same events for any re-chunking of arbitrary bytes too', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), fc.array(fc.nat(), { maxLength: 40 }), (bytes, cuts) => {
        expect(decodeInbound(chunk(bytes, cuts))).toEqual(decodeInbound([bytes]));
      }),
      { numRuns: 1000 },
    );
  });

  it('(a) is invariant across the 4 KB cap as well', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4000, max: 4200 }),
        fc.array(fc.nat(), { maxLength: 20 }),
        (n, cuts) => {
          const bytes = enc.encode(`${'x'.repeat(n)}\n{"qr":1}\n`);
          expect(decodeInbound(chunk(bytes, cuts))).toEqual(decodeInbound([bytes]));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('(b) never throws on arbitrary bytes, and non-JSON input yields only Garbled, Text or FlowSignal', () => {
    // Bytes that can never start a JSON line: no '{' anywhere.
    const nonJson = fc.uint8Array({ maxLength: 800 }).map((b) => b.map((x) => (x === 0x7b ? 0x20 : x)));
    fc.assert(
      fc.property(nonJson, fc.array(fc.nat(), { maxLength: 20 }), (bytes, cuts) => {
        for (const e of decodeInbound(chunk(bytes, cuts))) {
          expect(['Garbled', 'Text', 'FlowSignal']).toContain(e.kind);
        }
      }),
      { numRuns: 1000 },
    );
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 800 }), (bytes) => {
        const decoder = createInboundDecoder();
        expect(() => decoder.push(bytes)).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });

  it('(b) never throws on JSON-looking noise built from the JSON alphabet', () => {
    const alphabet = fc.constantFrom(...'{}[]":,0123456789.-eE tfnrsuqi\\\n'.split(''));
    fc.assert(
      fc.property(fc.array(alphabet, { maxLength: 300 }), (chars) => {
        const events = decodeInbound([enc.encode(chars.join(''))]);
        for (const e of events) expect(typeof e.kind).toBe('string');
      }),
      { numRuns: 2000 },
    );
  });

  it('(c) XON/XOFF never appear inside an emitted line, and each one becomes exactly one FlowSignal', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), fc.array(fc.nat(), { maxLength: 20 }), (bytes, cuts) => {
        const framer = createFramer();
        const events = chunk(bytes, cuts).flatMap((c) => framer.push(c));
        let signals = 0;
        for (const e of events) {
          if (e.kind === 'FlowSignal') signals++;
          else expect(e.line.includes('\u0011') || e.line.includes('\u0013')).toBe(false);
        }
        expect(signals).toBe(bytes.filter((b) => b === XON || b === XOFF).length);
      }),
      { numRuns: 1000 },
    );
  });

  it('classifies a framed stream in order, with flow signals in place', () => {
    const stream = Uint8Array.from([
      ...enc.encode('{"sr":{"stat":5}}\r\n'),
      XOFF,
      ...enc.encode('{"r":{},"f":[3,0,11]}\n'),
      XON,
      ...enc.encode('{"ack":true}\n'),
    ]);
    const kinds = decodeInbound([stream]).map((e: Inbound) => (e.kind === 'FlowSignal' ? e.signal : e.kind));
    expect(kinds).toEqual(['StatusReport', 'xoff', 'Response', 'xon', 'Ack']);
  });
});

describe('decodeInbound: large chunks (batch 9, finding P0-07 #1)', () => {
  it('decodes one 200000-byte chunk of XON without a RangeError', () => {
    const events = decodeInbound([new Uint8Array(200000).fill(0x11)]);
    expect(events).toHaveLength(200000);
    expect(events.every((e) => e.kind === 'FlowSignal')).toBe(true);
  });

  it('matches the live decoder on a chunk with more events than the argument limit', () => {
    const chunk = new Uint8Array(300000).fill(0x13);
    const live = createInboundDecoder().push(chunk);
    expect(decodeInbound([chunk])).toEqual(live);
  });
});
