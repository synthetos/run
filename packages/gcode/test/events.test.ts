/**
 * The analytic event tape (events.ts; docs/design/ANALYZE.md slice 1 fixtures): what each sent line does, in order,
 * from the one interpreter, with arcs measured analytically and inserted or split lines mapped to their file line.
 */
import { describe, expect, it } from 'vitest';
import { TINYG_EN } from '@synthetos/protocol';
import { EVENT, EVENT_FLAG, NO_EVENT_TOOL, emptyTape, interpretJob, tapeBuffers, type EventTape } from '../src/index.ts';
import { analyse, MOTION, start, unchecked } from './helpers.ts';

const tape = (text: string, options: Parameters<typeof analyse>[2] = {}): EventTape => analyse(text, TINYG_EN, options).analysis.events;
const kinds = (t: EventTape): number[] => Array.from(t.kinds);
const moves = (t: EventTape): number[] => kinds(t).map((k, i) => (k === EVENT.LINE || k === EVENT.ARC ? i : -1)).filter((i) => i >= 0);

describe('the event tape', () => {
  it('is the same with and without an operation comment, and an F-only change adds no stop', () => {
    const body = ['G21 G90', 'G0 X0 Y0', 'G1 X10 F600', 'G1 X20 F900', 'G1 X30', 'M30'];
    const a = tape(body.join('\n'));
    const b = tape(['(01 Pocket)', ...body].join('\n'));
    expect(kinds(a)).toEqual(kinds(b));
    expect(Array.from(a.feed).filter((f) => !Number.isNaN(f))).toEqual([600, 900, 900]);
    // The F change is just the next move: no barrier or command between the cuts.
    const cuts = moves(a).slice(1);
    expect(cuts).toEqual([cuts[0], (cuts[0] as number) + 1, (cuts[0] as number) + 2]);
    expect(kinds(a)).not.toContain(EVENT.BARRIER);
  });

  it('reads F in the units of its own line, word order aside (G20 with F on one line)', () => {
    const t = tape(['G90', 'F10 G20 G1 X1', 'G21', 'G1 X30 F600', 'M30'].join('\n'));
    const inch = moves(t).filter((i) => t.source[i] === 2);
    for (const i of inch) expect(t.feed[i]).toBeCloseTo(254, 9);
    expect(inch.reduce((s, i) => s + (t.lengthMm[i] as number), 0)).toBeCloseTo(25.4, 9);
    const mm = moves(t).find((i) => t.source[i] === 4) as number;
    expect(t.feed[mm]).toBe(600);
    expect(t.lengthMm[mm]).toBeCloseTo(4.6, 9);
  });

  it('keeps plunge and cut moves apart by their deltas, under one tool', () => {
    const t = tape(['G21 G90', 'T1 M6', 'G0 X0 Y0 Z5', 'G1 Z-1 F200', 'G1 X10 F800', 'M30'].join('\n'));
    const [rapid, plunge, cut] = moves(t);
    expect((t.flags[rapid as number] as number) & EVENT_FLAG.RAPID).toBe(EVENT_FLAG.RAPID);
    expect(Number.isNaN(t.feed[rapid as number])).toBe(true);
    expect(Array.from(t.delta.subarray((plunge as number) * 3, (plunge as number) * 3 + 3))).toEqual([0, 0, -6]);
    expect(Array.from(t.delta.subarray((cut as number) * 3, (cut as number) * 3 + 3))).toEqual([10, 0, 0]);
    expect([t.tool[plunge as number], t.tool[cut as number]]).toEqual([1, 1]);
  });

  it('makes a tool active at M6, from a T selected on an earlier line; unknown before', () => {
    const t = tape(['G21 G90', 'S12000 M3', 'G1 X1 F300', 'T2', 'G1 X2', 'M6', 'G1 X3', 'M30'].join('\n'), { sanitize: { c14: false } });
    const [a, b, c] = moves(t);
    expect([t.tool[a as number], t.tool[b as number], t.tool[c as number]]).toEqual([NO_EVENT_TOOL, NO_EVENT_TOOL, 2]);
    expect(kinds(t)).toContain(EVENT.TOOL_CHANGE);
    expect(t.spindle[a as number]).toBe(12000);
  });

  it('measures an arc from its model: a coarser drawing changes the vertices, never the length', () => {
    const text = ['G21 G90 G17', 'G0 X10 Y0', 'G2 X-10 Y0 I-10 J0 F600', 'M30'].join('\n');
    const fine = analyse(text, TINYG_EN, { interpret: { chordMm: 0.001 } }).analysis;
    const coarse = analyse(text, TINYG_EN, { interpret: { chordMm: 2 } }).analysis;
    expect(fine.vertices.length).not.toBe(coarse.vertices.length);
    const arc = (a: typeof fine): number => a.events.lengthMm[kinds(a.events).indexOf(EVENT.ARC)] as number;
    expect(arc(fine)).toBeCloseTo(Math.PI * 10, 9);
    expect(arc(coarse)).toBe(arc(fine));
  });

  it('records dwells with their seconds and barriers in order, and maps inserted lines to their file line', () => {
    const text = ['G21 G90', 'S10000 M3', 'G4 P1.5', 'G1 X1 F100', 'M0', 'T1 M6', 'G1 X2', 'M30'].join('\n');
    const t = tape(text, { sanitize: { c14: true } });
    const dwell = kinds(t).indexOf(EVENT.DWELL);
    expect(t.seconds[dwell]).toBe(1.5);
    expect(t.source[dwell]).toBe(3);
    const barrier = kinds(t).indexOf(EVENT.BARRIER);
    expect(t.source[barrier]).toBe(5);
    const inserted = Array.from(t.flags).map((f, i) => ((f & EVENT_FLAG.INSERTED) !== 0 ? i : -1)).filter((i) => i >= 0);
    expect(inserted.length).toBeGreaterThan(0);
    for (const i of inserted) expect(t.source[i]).toBe(6);
    // Every sent line has at least one event, in order.
    const sent = Array.from(t.sent);
    expect(sent).toEqual([...sent].sort((x, y) => x - y));
    expect(new Set(sent).size).toBe(analyse(text, TINYG_EN, { sanitize: { c14: true } }).sanitized.lines.length);
  });

  it('maps the pieces of a split move to their file line and keeps the total length', () => {
    const slow = { ...MOTION, ceilingSeconds: 2, feedrateMax: { ...MOTION.feedrateMax, X: 600 } };
    const { analysis, sanitized } = analyse(['G21 G90', 'G1 X100 F600', 'M30'].join('\n'), TINYG_EN, { sanitize: { motion: slow } });
    expect(sanitized.lines.some((l) => l.origin === 'split')).toBe(true);
    const t = analysis.events;
    const pieces = moves(t);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(t.source[p]).toBe(2);
    expect(pieces.some((p) => (t.flags[p] as number) & EVENT_FLAG.SPLIT)).toBe(true);
    expect(pieces.reduce((s, p) => s + (t.lengthMm[p] as number), 0)).toBeCloseTo(100, 9);
  });

  it('marks unknown feed, rotary moves and uncertain geometry instead of guessing', () => {
    // G1 before any F: the sanitiser blocks it; behind a missing check the tape still says the feed is unknown.
    const t = interpretJob(unchecked(['G21 G90', 'G1 X1', 'G1 A90 F600'], TINYG_EN), TINYG_EN, { start: start() }).events;
    const [nofeed, rotary] = moves(t);
    expect(Number.isNaN(t.feed[nofeed as number])).toBe(true);
    expect((t.flags[rotary as number] as number) & EVENT_FLAG.ROTARY).toBe(EVENT_FLAG.ROTARY);
    expect(t.lengthMm[rotary as number]).toBe(0); // degrees never count as millimetres
    // A G28 whose stored position was never read (the interpreter's own check, behind the sanitiser's).
    const unknownHome = interpretJob(unchecked(['G21 G90', 'G28', 'G1 X5 F300'], TINYG_EN), TINYG_EN, { start: { ...start(), g28: undefined } as never }).events;
    expect(kinds(unknownHome)).toContain(EVENT.UNMODELLED);
    const after = moves(unknownHome).at(-1) as number;
    expect((unknownHome.flags[after] as number) & EVENT_FLAG.UNCERTAIN).toBe(EVENT_FLAG.UNCERTAIN);
  });

  it('records a blocked line as unmodelled, and an empty tape has no buffers in common with another', () => {
    // An arc the firmware would refuse (radius shorter than half the chord), past a missing sanitiser check.
    const t = interpretJob(unchecked(['G21 G90', 'G1 X1 F100', 'G2 X20 Y0 R1'], TINYG_EN), TINYG_EN, { start: start() }).events;
    expect(kinds(t)).toContain(EVENT.UNMODELLED);
    expect(emptyTape().count).toBe(0);
    expect(tapeBuffers(t).length).toBe(12);
  });

  it('marks the commands the firmware queues (they stop motion), exact stop, and each arc’s shape', () => {
    const t = tape(['G21 G90 G17', 'G1 X10 F600', 'S12000 G1 X20', 'G1 X30', 'M3', 'G4 P0.2', 'G61.1', 'G1 X40', 'G61', 'G2 X50 Y10 I0 J10', 'M30'].join('\n'));
    const syncLines = Array.from(t.kinds).map((k, i) => (k === EVENT.COMMAND && ((t.flags[i] as number) & EVENT_FLAG.SYNC) !== 0 ? t.source[i] : -1)).filter((l) => (l as number) >= 0);
    expect(syncLines).toEqual([3, 5, 11]); // the S before line 3's move, M3, and M30 after the last move
    const s3 = Array.from(t.source).indexOf(3);
    expect(t.kinds[s3]).toBe(EVENT.COMMAND); // the S is queued before the move on its line
    const moves = Array.from(t.kinds).map((k, i) => (k === EVENT.LINE || k === EVENT.ARC ? i : -1)).filter((i) => i >= 0);
    const exact = moves.filter((i) => ((t.flags[i] as number) & EVENT_FLAG.EXACT_STOP) !== 0).map((i) => t.source[i]);
    expect(exact).toEqual([8]);
    const arc = moves.find((i) => t.kinds[i] === EVENT.ARC) as number;
    const k = t.arcIndex[arc] as number;
    expect(k).toBe(0);
    expect(Array.from(t.arcs.subarray(k * 5, k * 5 + 5)).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 10, Math.round(-Math.PI * 1e6) / 1e6, Math.round(((3 * Math.PI) / 2) * 1e6) / 1e6, 0]); // from 6 o'clock, clockwise to 3 o'clock
    expect(t.arcIndex[moves[0] as number]).toBe(-1);
  });
});

describe('a tape that outgrows its first buffers', () => {
  it('keeps every move’s three deltas when it grows past one event per line', () => {
    // Each S line adds a command event before its move, so there are more events than lines.
    const lines = ['G21 G90'];
    for (let i = 1; i <= 40; i++) lines.push(`S${1000 + i} G1 X${i} Y${-i} Z${-i / 10} F600`);
    lines.push('M30');
    const t = tape(lines.join('\n'));
    expect(t.count).toBeGreaterThan(lines.length);
    const moves = Array.from(t.kinds).map((k, i) => (k === EVENT.LINE ? i : -1)).filter((i) => i >= 0);
    expect(moves).toHaveLength(40);
    for (const e of moves) {
      expect(Array.from(t.delta.subarray(e * 3, e * 3 + 3)).map((v) => Math.round(v * 1000) / 1000)).toEqual([1, -1, -0.1]);
      expect(t.lengthMm[e]).toBeCloseTo(Math.hypot(1, 1, 0.1), 9);
    }
  });
});
