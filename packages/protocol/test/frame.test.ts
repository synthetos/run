import { describe, expect, it } from 'vitest';
import { MAX_LINE_BYTES, XOFF, XON, createFramer } from '../src/frame.ts';
import type { FrameEvent } from '../src/frame.ts';

const enc = new TextEncoder();
const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...enc.encode(p)] : p)));

function frameAll(...chunks: Uint8Array[]): FrameEvent[] {
  const f = createFramer();
  return chunks.flatMap((c) => f.push(c));
}

const line = (text: string) => ({ kind: 'Line', line: text });
const xon = { kind: 'FlowSignal', signal: 'xon' };
const xoff = { kind: 'FlowSignal', signal: 'xoff' };

describe('frame: line ends', () => {
  it('ends a line at LF, CR, CRLF and LFCR, never emitting a blank line', () => {
    expect(frameAll(bytes('a\nb\rc\r\nd\n\re\n'))).toEqual(['a', 'b', 'c', 'd', 'e'].map(line));
  });

  it('drops empty lines and runs of line ends', () => {
    expect(frameAll(bytes('\n\r\n\r\r\nx\n\n\n'))).toEqual([line('x')]);
  });

  it('holds a partial line until its line end arrives, across any number of chunks', () => {
    const f = createFramer();
    expect(f.push(bytes('{"sr":'))).toEqual([]);
    expect(f.push(bytes('{"stat":5'))).toEqual([]);
    expect(f.push(bytes('}}'))).toEqual([]);
    expect(f.push(bytes('\r'))).toEqual([line('{"sr":{"stat":5}}')]);
    expect(f.push(bytes('\n'))).toEqual([]); // the LF of the CRLF split across chunks: no blank line
  });

  it('keeps spaces and tabs inside a line exactly', () => {
    expect(frameAll(bytes('tinyg [mm] ok> \n'))).toEqual([line('tinyg [mm] ok> ')]);
  });
});

describe('frame: XON/XOFF', () => {
  it('removes XON and XOFF anywhere and reports them in stream order', () => {
    const events = frameAll(bytes([XOFF], '{"r":', [XON], '{}', [XOFF], ',"f":[3,0,11]}\n', [XON]));
    expect(events).toEqual([xoff, xon, xoff, line('{"r":{},"f":[3,0,11]}'), xon]);
  });

  it('reports a flow signal between lines before the next line', () => {
    expect(frameAll(bytes('a\n', [XOFF], 'b\n'))).toEqual([line('a'), xoff, line('b')]);
  });

  it('removes XON/XOFF inside a multi-byte character without breaking it', () => {
    // 'é' is C3 A9; a flow byte between them is still removed and the character survives.
    expect(frameAll(bytes([0xc3, XON, 0xa9], '\n'))).toEqual([xon, line('é')]);
  });

  it('does not count XON/XOFF bytes towards the line length', () => {
    const payload = 'x'.repeat(MAX_LINE_BYTES);
    const withFlow = bytes(...[...payload].map((c, i) => (i % 100 === 0 ? [XOFF, ...enc.encode(c)] : c)), '\n');
    const events = frameAll(withFlow);
    expect(events.filter((e) => e.kind === 'Line')).toEqual([line(payload)]);
    expect(events.filter((e) => e.kind === 'FlowSignal')).toHaveLength(Math.ceil(MAX_LINE_BYTES / 100));
  });
});

describe('frame: UTF-8', () => {
  it('decodes a character split across chunks exactly as if it arrived whole', () => {
    const text = 'msg:"°µé€𝄞"';
    const all = enc.encode(`${text}\n`);
    for (let cut = 0; cut <= all.length; cut++) {
      expect(frameAll(all.slice(0, cut), all.slice(cut))).toEqual([line(text)]);
    }
    // One byte per chunk.
    expect(frameAll(...[...all].map((b) => Uint8Array.of(b)))).toEqual([line(text)]);
  });

  it('reports invalid UTF-8 as Garbled with a lossy line, and goes on framing', () => {
    const events = frameAll(bytes('ok\n', [0x7b, 0xff, 0x7d], '\n', [0xc3], '\n', [0xed, 0xa0, 0x80], '\nnext\n'));
    expect(events).toEqual([
      line('ok'),
      { kind: 'Garbled', reason: 'invalid-utf8', line: '{�}' },
      { kind: 'Garbled', reason: 'invalid-utf8', line: '�' }, // truncated sequence
      { kind: 'Garbled', reason: 'invalid-utf8', line: '���' }, // encoded surrogate
      line('next'),
    ]);
  });

  it('keeps a byte-order mark as data (never stripped silently)', () => {
    expect(frameAll(bytes([0xef, 0xbb, 0xbf], '{}\n'))).toEqual([line('﻿{}')]);
  });
});

describe('frame: 4 KB line cap', () => {
  it('accepts a line of exactly MAX_LINE_BYTES bytes', () => {
    const text = 'a'.repeat(MAX_LINE_BYTES);
    expect(frameAll(bytes(text, '\n'))).toEqual([line(text)]);
    expect(MAX_LINE_BYTES).toBe(4096);
  });

  it('reports a longer line as overlong at the first extra byte and drops the rest of it', () => {
    const f = createFramer();
    const head = 'b'.repeat(MAX_LINE_BYTES);
    expect(f.push(bytes(head))).toEqual([]);
    const events = f.push(bytes('c'));
    expect(events).toEqual([{ kind: 'Garbled', reason: 'overlong', line: head }]);
    // The rest of the line is discarded, however long, with no further events...
    expect(f.push(bytes('d'.repeat(3 * MAX_LINE_BYTES)))).toEqual([]);
    // ...but flow signals inside it are still reported...
    expect(f.push(bytes([XON]))).toEqual([xon]);
    // ...and framing resumes after the next line end.
    expect(f.push(bytes('\r\n{"qr":32}\n'))).toEqual([line('{"qr":32}')]);
  });

  it('keeps memory bounded: an endless line yields exactly one overlong event', () => {
    const f = createFramer();
    let count = 0;
    for (let i = 0; i < 64; i++) count += f.push(new Uint8Array(65536).fill(0x41)).length;
    expect(count).toBe(1);
  });
});
