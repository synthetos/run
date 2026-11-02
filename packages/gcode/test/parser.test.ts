import fc from 'fast-check';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOf, parseLine, parseLines, parseStream } from '../src/index.ts';
import { fixture } from './helpers.ts';

async function* chunks(parts: readonly string[]): AsyncGenerator<string> {
  for (const p of parts) yield p;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('parseLine (cncjs fork)', () => {
  it('keeps R0 as the value 0, not as "no R" (the upstream `if (params.R)` bug)', () => {
    const p = parseLine('G2 X10 Y0 R0');
    expect(p.words.find((w) => w.letter === 'R')?.value).toBe(0);
    expect(p.errors).toEqual([]);
  });

  it('reads words, the line number, and both comment forms', () => {
    const p = parseLine('N10 G01 X-1.5 y+.5 (move) ; tail');
    expect(p.n).toBe(10);
    expect(p.words.map((w) => [w.letter, w.value])).toEqual([['G', 1], ['X', -1.5], ['Y', 0.5]]);
    expect(p.comments).toEqual(['move', 'tail']);
    expect(codeOf(p.words[0]!)).toBe('G1');
    expect(codeOf({ letter: 'G', value: 28.1, text: 'G28.10' })).toBe('G28.1');
    expect(codeOf({ letter: 'X', value: 1, text: 'X1' })).toBeUndefined();
  });

  it('reports what it cannot read instead of dropping it', () => {
    expect(parseLine('G X1').errors.map((e) => e.kind)).toEqual(['badNumber']);
    expect(parseLine('G1 X1.2.3').errors.map((e) => e.kind)).toEqual(['badNumber']);
    expect(parseLine('G1 X1 #5').errors.map((e) => e.kind)).toEqual(['unparsed']);
    expect(parseLine('G1 ) X1').errors.map((e) => e.kind)).toEqual(['unparsed']);
    expect(parseLine('G1 X1 *12 *13').errors.map((e) => e.kind)).toEqual(['unparsed']);
    expect(parseLine('$H').cmds).toEqual(['$H']);
    expect(parseLine('{"sr":null}').cmds).toEqual(['{"sr":null}']);
    expect(parseLine('(unclosed G1 X1').words).toEqual([]);
  });

  it('never throws on any text, and keeps the raw line exactly', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const p = parseLine(s);
        expect(p.raw).toBe(s);
      }),
      { numRuns: 2000 },
    );
  });

  it('round-trips the corpus: every character outside comments is a word, the N word, a command or an error', () => {
    const cam = readdirSync(fileURLToPath(new URL('../../../test-fixtures/cam/', import.meta.url))).filter((f) => f.endsWith('.nc'));
    const diff = readdirSync(fileURLToPath(new URL('./differential/corpus/', import.meta.url)));
    const files = [...cam.map((f) => `cam/${f}`), ...diff.map((f) => `../packages/gcode/test/differential/corpus/${f}`)];
    expect(files.length).toBeGreaterThan(20);
    let checked = 0;
    for (const f of files) {
      for (const p of parseLines(fixture(f))) {
        if (p.raw.includes('(') || p.raw.includes(';') || p.cmds.length > 0) continue;
        const code = p.raw.replace(/\s+/g, '');
        const n = p.n === undefined ? '' : (/[Nn][0-9.+-]+/.exec(code)?.[0] ?? '');
        const accounted = [...p.words.map((w) => w.text), ...p.errors.map((e) => e.text)].join('').length;
        expect(n.length + accounted, `${f}:${String(p.lineNo)}`).toBe(code.length);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('parseStream', () => {
  it('splits on CR, LF and CRLF, including a CRLF split across chunks', async () => {
    const lines = await collect(parseStream(chunks(['G0 X1\r', '\nG0 X2\rG0', ' X3\n', 'G0 X4'])));
    expect(lines.map((l) => [l.lineNo, l.raw])).toEqual([[1, 'G0 X1'], [2, 'G0 X2'], [3, 'G0 X3'], [4, 'G0 X4']]);
  });

  it('gives the same lines as parsing the whole text, however it is chunked', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom('G1 X1', '\r', '\n', '\r\n', ' (c) ', 'Y2'), { maxLength: 30 }), fc.integer({ min: 1, max: 7 }), async (parts, size) => {
        const text = parts.join('');
        const pieces: string[] = [];
        for (let i = 0; i < text.length; i += size) pieces.push(text.slice(i, i + size));
        const streamed = (await collect(parseStream(chunks(pieces)))).map((l) => l.raw);
        const whole = [...parseLines(text)].map((l) => l.raw);
        // A terminator at the very end leaves an empty last line in split(); the stream does not emit it.
        if (whole.length > 0 && whole[whole.length - 1] === '' && /[\r\n]$/.test(text)) whole.pop();
        if (text === '') whole.pop();
        expect(streamed).toEqual(whole);
      }),
      { numRuns: 300 },
    );
  });
});
