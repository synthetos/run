/** Unit tests of the model building blocks (host JSON reader, G-code words, motion). */
import { describe, expect, it } from 'vitest';
import { parseHostJson } from '../src/firmware/hostJson.ts';
import { normalizeBlock, readWords } from '../src/firmware/gcode.ts';
import { EN_GCODE_SYNTAX, arcPath, arcSweeps, classifyLine, scanTid } from '../src/firmware/edgeNext.ts';
import { TG_GCODE_SYNTAX } from '../src/firmware/tg440.ts';
import { Motion, pointAt, zeroVec, type Block, type Vec } from '../src/firmware/motion.ts';
import { serialize, fixed } from '../src/firmware/output.ts';
import { escapeBytes, bytes, text } from '../src/bytes.ts';

describe('host JSON reader (the firmware relaxed tokenizer)', () => {
  it('reads relaxed keys, folds case, and the n / t / f shorthands', () => {
    expect(parseHostJson('{FB:n, "XVM" : 12.5e1, ok:t, no:f, s:"a\\"b\\n"}')).toEqual({
      ok: true,
      pairs: [
        ['fb', null],
        ['xvm', 125],
        ['ok', true],
        ['no', false],
        ['s', 'a"b\n'],
      ],
    });
    expect(parseHostJson('{"sr":{"line":true}}')).toEqual({ ok: true, pairs: [['sr', { pairs: [['line', true]] }]] });
    expect(parseHostJson('{}')).toEqual({ ok: true, pairs: [] });
  });

  it('refuses what the tokenizer refuses', () => {
    for (const bad of ['{"a":', '{"a":1', '{"a" 1}', '{a:1}x', '{"a":"x', '{"a":{"b":{"c":1}}}', '{"a":1.2.3}', '{"a":#}', '{-:1}', '']) {
      expect(parseHostJson(bad).ok, bad).toBe(false);
    }
  });

  it('classifies control and data lines as EN line mode does', () => {
    expect(['', '  ', '{"fb":null}', '$', '?', '!', '%', 'h', '{"gc":null}'].map(classifyLine)).toEqual(Array(9).fill('ctrl'));
    expect(['G1 X1', '?G1 X1', '{"gc":"G1"}', '{"txt":"{\\"x\\":1}"}', 'M3', '{bad'].map(classifyLine)).toEqual([
      'data',
      'data',
      'data',
      'data',
      'data',
      'ctrl',
    ]);
    expect(scanTid('{"a":1,"tid":7}')).toBe(7);
    expect(scanTid('{"tid":4294967296}')).toBeUndefined();
    expect(scanTid('{"tid":"7"}')).toBeUndefined();
    expect(scanTid('{bad')).toBeUndefined();
  });
});

describe('G-code words', () => {
  it('EN keeps invalid characters and reads E as a word; TG deletes them and reads an exponent', () => {
    expect(normalizeBlock('g1 x0.001*9 (comment) y5', EN_GCODE_SYNTAX)).toEqual({ block: 'G1X0.001*9', comment: 'comment', blockDelete: false });
    expect(normalizeBlock('g1 x0.001*9', TG_GCODE_SYNTAX).block).toBe('G1X0.0019');
    expect(readWords('X10E5', EN_GCODE_SYNTAX)).toEqual({ ok: true, words: [{ letter: 'X', value: 10, decimals: 0 }, { letter: 'E', value: 5, decimals: 0 }] });
    expect(readWords('X10E5', TG_GCODE_SYNTAX)).toEqual({ ok: true, words: [{ letter: 'X', value: 1_000_000, decimals: 0 }] });
    expect(readWords('G92.10', EN_GCODE_SYNTAX)).toEqual({ ok: true, words: [{ letter: 'G', value: 92.1, decimals: 1 }] });
    expect(readWords('G0X100', EN_GCODE_SYNTAX).ok).toBe(true);
    expect(readWords('X', EN_GCODE_SYNTAX)).toEqual({ ok: false, status: 'BAD_NUMBER_FORMAT' });
    expect(readWords('1X', EN_GCODE_SYNTAX)).toEqual({ ok: false, status: 'INVALID_OR_MALFORMED_COMMAND' });
    expect(normalizeBlock('G01 X007', EN_GCODE_SYNTAX).block).toBe('G1X7'); // octal-looking zeros stripped
    expect(normalizeBlock('%', EN_GCODE_SYNTAX).block).toBe('');
    expect(normalizeBlock('/G1', EN_GCODE_SYNTAX).blockDelete).toBe(true);
  });
});

describe('motion runtime', () => {
  const hooks = { earliestStart: (_b: Block, t: number) => t, onStart: () => undefined, onFree: () => undefined, onHoldReached: () => undefined, inhibited: () => false };
  const line = (to: number): Block => ({ kind: 'move', path: { kind: 'line', from: zeroVec(), to: [to, 0, 0, 0, 0, 0] as Vec, length: to }, feed: 600, line: 0 });

  it('refuses to overfill the pool, to flush while moving and to set position mid-move', () => {
    const m = new Motion(1, hooks);
    m.push(line(10));
    expect(() => m.push(line(1))).toThrow(/pool exhausted/);
    m.advance(10);
    expect(m.executingMove()).toBe(true);
    expect(m.executingDwell()).toBe(false);
    expect(() => m.flush(10)).toThrow(/moves/);
    expect(() => m.setPosition(zeroVec())).toThrow(/move runs/);
    m.halt(500);
    expect(m.position(500)[0]).toBeCloseTo(5, 9); // started at t=0 at 10 mm/s
    expect(m.available()).toBe(1);
  });

  it('[EN-INHIBITED-JOINT] motor space: the step target follows the joint per segment; halt and setPosition', () => {
    let yInhibited = false;
    const m = new Motion(4, { ...hooks, inhibited: (axis: number) => axis === 1 && yInhibited });
    const to = (x: number, y: number, from: Vec): Block => ({
      kind: 'move',
      path: { kind: 'line', from, to: [x, y, 0, 0, 0, 0] as Vec, length: Math.hypot(x - from[0], y - from[1]) },
      feed: 600,
      line: 0,
    });
    m.push(to(0, 20, zeroVec()));
    m.advance(5000);
    expect(m.motorPosition(5000)[1]).toBe(20);
    yInhibited = true;
    m.push(to(10, 20, [0, 20, 0, 0, 0, 0]));
    m.advance(5100); // mid-move: the Y motor went to step 0 with the first segment
    expect(m.motorPosition(5100)[1]).toBe(0);
    expect(m.motorPosition(5100)[0]).toBeGreaterThan(0);
    m.halt(5200);
    const halted = m.motorPosition(5200);
    expect(halted[0]).toBeCloseTo(m.position(5200)[0], 9);
    expect(halted[1]).toBe(0);
    // A resync rewrites the step targets and moves nothing; un-inhibited, the next move drives Y out to 20 again.
    m.setPosition(m.position(5200));
    yInhibited = false;
    m.push(to(0, 20, m.position(5200)));
    m.advance(20_000);
    expect(m.motorPosition(20_000)[1]).toBe(20);
  });

  it('a hold near the end of a move stops exactly at its end', () => {
    let held = 0;
    const m = new Motion(4, { ...hooks, onHoldReached: () => held++ });
    m.push(line(1));
    m.advance(90); // 0.9 mm done, 0.1 mm left: less than a full 100 ms deceleration needs
    expect(m.startHold(90, 100)).toBe('decel');
    m.advance(200);
    expect(held).toBe(1);
    expect(m.position(200)[0]).toBe(1);
    expect(m.current()).toBeNull();
  });

  it('pointAt follows an arc and lands exactly on its end point', () => {
    const p = arcPath([0, 0, 0, 0, 0, 0], [0, 10, 0, 0, 0, 0], 0, 5, true);
    // The arc is computed in float32 as on the board (arcs.ts): pi is 3.1415927 there.
    expect(p.sweep).toBeCloseTo(Math.PI, 6);
    const mid = pointAt(p, p.length / 2);
    expect(mid[0]).toBeCloseTo(-5, 6); // G2 from the bottom of the circle turns left
    expect(pointAt(p, p.length)).toEqual([0, 10, 0, 0, 0, 0]);
    const full = arcPath([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], 0, 5, false);
    expect(full.sweep).toBeCloseTo(-2 * Math.PI, 6);
    expect(arcSweeps(full, 1)).toBe(true);
  });
});

describe('output and bytes', () => {
  it('prints numbers with the requested precision and escapes strings', () => {
    expect(serialize({ a: fixed(-0.0001, 3), b: 2, c: 2.5, d: true, e: null, f: 'q"\\\u0001' })).toBe('{"a":0.000,"b":2,"c":2.500,"d":true,"e":null,"f":"q\\"\\\\\\u0001"}');
    expect(serialize({ a: { b: 1 } }, true)).toBe('{a:{b:1}}');
  });

  it('round-trips latin-1 and renders bytes unambiguously', () => {
    expect(text(bytes('aÿ'))).toBe('aÿ');
    expect(() => bytes('Ā')).toThrow(RangeError);
    expect(escapeBytes(bytes('a\\\n\r\x13'))).toBe('a\\\\\\n\\r\\x13');
  });
});
