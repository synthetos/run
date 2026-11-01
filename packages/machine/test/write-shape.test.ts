/**
 * Line validation (ROADMAP P0-12 acceptance "Line validation tests"; SAFETY
 * H2, H2b; PN §7.4, §9.1). Every rule in writeShape.ts has a case here that
 * fails if the rule is removed, plus properties over arbitrary bytes.
 */
import fc from 'fast-check';
import { BYTE, DIALECTS, G2CORE_EDGE, TINYG_EN } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { MAX_REALTIME_GROUP_BYTES, MAX_WRITE_LINE_BYTES, REALTIME_BYTES, classifyWrite, writeLineCapFor, type WriteRejectionReason } from '../src/writeShape.ts';
import { enc } from './fakeTransport.ts';

const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);

function reason(input: Uint8Array): WriteRejectionReason | 'line' | 'realtime' {
  const r = classifyWrite(input);
  return r.kind === 'rejected' ? r.reason : r.kind;
}

describe('accepted lines', () => {
  it.each([
    '{"sr":null}\n',
    '{"fb":null}\n',
    'N10 G0 X10 Y-2.5\n',
    'G1\tX1 F100\n',
    ' G0 X0\n',
    '(comment) G0 X0\n',
    '$sv\n',
  ])('%j is one line', (line) => {
    expect(classifyWrite(enc(line))).toEqual({ kind: 'line' });
  });

  it('accepts a line of exactly MAX_WRITE_LINE_BYTES and refuses one byte more', () => {
    const body = (n: number): Uint8Array => enc(`${'G'.repeat(n - 1)}\n`);
    expect(reason(body(MAX_WRITE_LINE_BYTES))).toBe('line');
    expect(reason(body(MAX_WRITE_LINE_BYTES + 1))).toBe('too-long');
  });

  it('the cap is dialect data: the largest line any dialect accepts, never below one (RUN_PLAN §5.1 rule 5)', () => {
    const body = (n: number): Uint8Array => enc(`${'G'.repeat(n - 1)}\n`);
    for (const d of DIALECTS) {
      expect(d.limits.maxLineBytes + 1, d.id).toBeLessThanOrEqual(MAX_WRITE_LINE_BYTES);
      expect(d.limits.maxJsonLineBytes + 1, d.id).toBeLessThanOrEqual(MAX_WRITE_LINE_BYTES);
      expect(writeLineCapFor(d), d.id).toBe(Math.max(d.limits.maxLineBytes, d.limits.maxJsonLineBytes) + 1);
    }
    expect(MAX_WRITE_LINE_BYTES).toBe(Math.max(...DIALECTS.map(writeLineCapFor)));
    // TinyG keeps its 255 (JSON_INPUT_STRING_MAX 254 + LF); a 400-byte g2core job line is not refused mid-job.
    expect(writeLineCapFor(TINYG_EN)).toBe(255);
    expect(writeLineCapFor(G2CORE_EDGE)).toBe(512);
    expect(reason(body(401))).toBe('line');
  });

  it('a tighter cap passed in refuses longer lines; a looser one is clamped to the maximum', () => {
    const line = enc(`${'G'.repeat(255)}\n`);
    expect(classifyWrite(line, 255)).toEqual({ kind: 'rejected', reason: 'too-long' });
    expect(classifyWrite(line, 256)).toEqual({ kind: 'line' });
    const huge = enc(`${'G'.repeat(MAX_WRITE_LINE_BYTES)}\n`);
    expect(classifyWrite(huge, 10_000)).toEqual({ kind: 'rejected', reason: 'too-long' });
  });
});

describe('refused lines', () => {
  it('refuses an empty write', () => {
    expect(classifyWrite(new Uint8Array(0))).toEqual({ kind: 'rejected', reason: 'empty' });
  });

  it('refuses a line without its LF (a fragment)', () => {
    expect(reason(enc('G1 X12.5'))).toBe('no-line-end');
    expect(reason(enc('{"sr":null}'))).toBe('no-line-end');
  });

  it('refuses two lines in one write', () => {
    expect(classifyWrite(enc('G0 X1\nG0 X2\n'))).toEqual({ kind: 'rejected', reason: 'embedded-lf', at: 5 });
  });

  it('refuses CR anywhere: TinyG ends a line on CR, so one write would become two', () => {
    expect(classifyWrite(enc('G0 X1\r\n'))).toEqual({ kind: 'rejected', reason: 'cr', at: 5 });
    expect(classifyWrite(enc('G0\rX1\n'))).toEqual({ kind: 'rejected', reason: 'cr', at: 2 });
    expect(reason(enc('G0 X1\r'))).toBe('cr');
  });

  it('refuses a bare LF and a blank line', () => {
    expect(reason(enc('\n'))).toBe('blank-line');
    expect(reason(enc('  \t \n'))).toBe('blank-line');
  });

  it.each([
    ['!', BYTE.FEEDHOLD],
    ['~', BYTE.RESUME],
    ['%', BYTE.FLUSH],
  ])('refuses %s inside a line: TinyG traps it anywhere, even in a comment (SAFETY H2)', (ch, code) => {
    expect(classifyWrite(enc(`G0 X1 (a${ch}b)\n`))).toEqual({ kind: 'rejected', reason: 'realtime-in-line', at: 8 });
    expect(classifyWrite(bytes(code, 0x0a))).toEqual({ kind: 'rejected', reason: 'realtime-in-line', at: 0 });
  });

  it.each([
    ['^D job kill', BYTE.KILL],
    ['ENQ', BYTE.ENQ],
    ['^X reset', BYTE.RESET],
    ['XON', BYTE.XON],
    ['XOFF', BYTE.XOFF],
    ['NUL', 0x00],
    ['ESC', 0x1b],
  ])('refuses %s inside a line', (_name, code) => {
    expect(classifyWrite(Uint8Array.from([...enc('G0 X1'), code, 0x0a]))).toEqual({ kind: 'rejected', reason: 'control-byte', at: 5 });
  });

  it('refuses DEL and every byte at or above 0x7F', () => {
    for (const b of [0x7f, 0x80, 0xc3, 0xff]) {
      expect(classifyWrite(bytes(0x47, b, 0x0a))).toEqual({ kind: 'rejected', reason: 'non-ascii', at: 1 });
    }
    expect(reason(enc('G0 X1 (café)\n'))).toBe('non-ascii');
  });

  it('accepts TAB and every printable byte except ! ~ %, and refuses all other bytes, one byte at a time', () => {
    for (let b = 0; b <= 0xff; b++) {
      const r = reason(bytes(0x47, b, 0x0a));
      const printable = (b >= 0x20 && b <= 0x7e) || b === 0x09;
      const trapped = b === 0x21 || b === 0x7e || b === 0x25;
      if (printable && !trapped) expect(r, `byte 0x${b.toString(16)}`).toBe('line');
      else expect(r, `byte 0x${b.toString(16)}`).not.toBe('line');
    }
  });

  it('reports the offending byte of a would-be line that lacks its LF', () => {
    expect(classifyWrite(bytes(0x47, BYTE.XON))).toEqual({ kind: 'rejected', reason: 'control-byte', at: 1 });
    expect(classifyWrite(enc('G0 X1\r'))).toEqual({ kind: 'rejected', reason: 'cr', at: 5 });
    expect(classifyWrite(enc('G0 X1\nG0'))).toEqual({ kind: 'rejected', reason: 'embedded-lf', at: 5 });
  });
});

describe('realtime groups', () => {
  it('is exactly the realtime bytes the dialects define, without XON/XOFF', () => {
    expect([...REALTIME_BYTES].sort((a, b) => a - b)).toEqual([BYTE.KILL, BYTE.ENQ, BYTE.RESET, BYTE.FEEDHOLD, BYTE.FLUSH, BYTE.RESUME]);
    expect(REALTIME_BYTES.has(BYTE.XON)).toBe(false);
    expect(REALTIME_BYTES.has(BYTE.XOFF)).toBe(false);
    for (const d of DIALECTS) {
      expect(REALTIME_BYTES.has(d.realtime.feedhold.byte), d.id).toBe(true);
      expect(REALTIME_BYTES.has(d.realtime.reset.byte), d.id).toBe(true);
    }
  });

  it('accepts each realtime byte alone', () => {
    for (const b of REALTIME_BYTES) expect(classifyWrite(bytes(b))).toEqual({ kind: 'realtime' });
  });

  it('accepts a short group such as ! then %', () => {
    expect(reason(bytes(BYTE.FEEDHOLD, BYTE.FLUSH))).toBe('realtime');
    expect(reason(new Uint8Array(MAX_REALTIME_GROUP_BYTES).fill(BYTE.FEEDHOLD))).toBe('realtime');
  });

  it('refuses a group longer than MAX_REALTIME_GROUP_BYTES', () => {
    expect(reason(new Uint8Array(MAX_REALTIME_GROUP_BYTES + 1).fill(BYTE.FEEDHOLD))).toBe('realtime-group-too-long');
  });

  it('refuses XON and XOFF even alone: the host never sends flow control (PN §7.4)', () => {
    expect(reason(bytes(BYTE.XON))).toBe('control-byte');
    expect(reason(bytes(BYTE.XOFF))).toBe('control-byte');
    expect(reason(bytes(BYTE.FEEDHOLD, BYTE.XOFF))).not.toBe('realtime');
  });

  it('refuses a realtime byte followed by text and no LF', () => {
    expect(classifyWrite(enc('!G0'))).toEqual({ kind: 'rejected', reason: 'realtime-in-line', at: 0 });
  });

  it('a realtime byte followed by LF is a line, and refused as one', () => {
    expect(reason(bytes(BYTE.KILL, 0x0a))).toBe('control-byte');
  });
});

describe('properties over arbitrary bytes', () => {
  it('an accepted line has exactly one LF, at the end, no CR, and only printable ASCII or TAB before it', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (input) => {
        const r = classifyWrite(input);
        if (r.kind !== 'line') return;
        expect(input[input.length - 1]).toBe(0x0a);
        const body = input.subarray(0, input.length - 1);
        expect(input.length).toBeLessThanOrEqual(MAX_WRITE_LINE_BYTES);
        for (const b of body) {
          expect((b >= 0x20 && b <= 0x7e) || b === 0x09).toBe(true);
          expect([0x21, 0x7e, 0x25]).not.toContain(b);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('an accepted realtime group is short and made only of realtime bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 8 }), (input) => {
        const r = classifyWrite(input);
        if (r.kind !== 'realtime') return;
        expect(input.length).toBeLessThanOrEqual(MAX_REALTIME_GROUP_BYTES);
        for (const b of input) expect(REALTIME_BYTES.has(b)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('printable lines built from the allowed alphabet are always accepted', () => {
    const allowed = Array.from({ length: 0x7f - 0x20 }, (_, i) => i + 0x20).filter((b) => ![0x21, 0x7e, 0x25].includes(b));
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...allowed), { minLength: 1, maxLength: MAX_WRITE_LINE_BYTES - 1 }), (body) => {
        fc.pre(body.some((b) => b !== 0x20));
        expect(classifyWrite(Uint8Array.from([...body, 0x0a]))).toEqual({ kind: 'line' });
      }),
      { numRuns: 500 },
    );
  });
});
