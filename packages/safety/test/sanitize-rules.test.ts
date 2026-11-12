/**
 * The sanitiser's rules one by one (ROADMAP P0-10, SAFETY §4.7). Each test
 * fails if its rule is removed: it shows the rule's block (or change) and,
 * where it matters, the safe neighbour that must still pass.
 */
import { G2CORE_EDGE, TINYG_440, TINYG_449_STOCK, TINYG_EN, type Dialect } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { LINE_TERMINATOR, sanitizeJob, type StartState } from '../src/index.ts';
import { MOTION, START, blocks, bodies, run } from './sanitizeHelpers.ts';

const EN = TINYG_EN;
const TG = TINYG_440;

describe('read-only dialects never get a job', () => {
  it.each([TINYG_449_STOCK, G2CORE_EDGE])('$id', (d) => {
    const r = run('G0 X1\n', d);
    expect(r.lines).toEqual([]);
    expect(blocks(r)).toEqual(['read-only-dialect']);
    expect(r.report.endState).toEqual({ spindle: 'off', mist: false, flood: false });
  });
});

describe('options are checked', () => {
  it('refuses a ceiling outside 2..20 s, a k outside (0, 1] and a non-positive velocity', () => {
    const bad = [
      { ...MOTION, ceilingSeconds: 1.9 },
      { ...MOTION, ceilingSeconds: 20.1 },
      { ...MOTION, ceilingSeconds: Number.NaN },
      { ...MOTION, k: 0 },
      { ...MOTION, k: 1.01 },
      { ...MOTION, maxVelocity: { X: 0 }, feedrateMax: { X: 0 } },
      { ...MOTION, maxVelocity: { X: Number.POSITIVE_INFINITY }, feedrateMax: { X: Number.POSITIVE_INFINITY } },
    ];
    for (const motion of bad) expect(() => sanitizeJob('G0 X1', EN, { motion })).toThrow(RangeError);
    expect(() => sanitizeJob('G0 X1', EN, { motion: { ...MOTION, ceilingSeconds: 2, k: 1 } })).not.toThrow();
    expect(() => sanitizeJob('G0 X1', EN, { motion: { ...MOTION, ceilingSeconds: 20 } })).not.toThrow();
  });
});

describe('steps 1-5: text', () => {
  it('LF is the only terminator the streamer adds', () => {
    expect(LINE_TERMINATOR).toBe('\n');
  });

  it('takes an iterable of lines as well as a string', () => {
    const r = run(['G90', 'G0 X1\r\nG0 X2', ''], EN);
    expect(bodies(r)).toEqual(['G90', 'G0 X1', 'G0 X2']);
    expect(r.report.entries.find((e) => e.rule === 'dropped-empty')?.line).toBe(4);
  });

  it('a comment holding "!", "~" or "%" is removed and the user is warned; the same byte in code still blocks', () => {
    const r = run('G0 X1 (pause! then ~ resume)\nG0 X2 ; 50%\n(only ~)\nG0 X3 (ok)\n', EN);
    expect(bodies(r)).toEqual(['G0 X1', 'G0 X2', 'G0 X3']);
    expect(r.report.entries.filter((e) => e.rule === 'realtime-in-comment').map((e) => [e.line, e.severity])).toEqual([
      [1, 'warn'],
      [2, 'warn'],
      [3, 'warn'],
    ]);
    const code = run('G0 X1 ! (note ~)\n', EN);
    expect(code.report.entries.map((e) => e.rule)).toContain('realtime-character');
    expect(code.report.entries.map((e) => e.rule)).not.toContain('realtime-in-comment');
  });

  it('reports comments stripped and blank or number-only lines dropped', () => {
    const r = run('G0 X1 ;c\n\n   \nN20\nN30 G0 X2\n', EN);
    expect(bodies(r)).toEqual(['G0 X1', 'G0 X2']);
    expect(r.report.entries.map((e) => [e.line, e.rule])).toEqual([
      [1, 'comment-stripped'],
      [2, 'dropped-empty'],
      [3, 'dropped-empty'],
      [4, 'dropped-empty'],
      [5, 'n-word-stripped'],
    ]);
  });

  it('rejects an unclosed "(" rather than sending the code before it', () => {
    const r = run('G0 X1 (unclosed\n', EN);
    expect(blocks(r)).toEqual(['unclosed-comment']);
    expect(r.lines).toEqual([]);
  });

  it('allows further comments after a trailing comment', () => {
    expect(bodies(run('G0 X1 (a) (b) ;c\n', EN))).toEqual(['G0 X1']);
  });

  it('a dialect without the comment rule strips embedded comments and keeps the code around them', () => {
    const lenient: Dialect = { ...EN, gcode: { ...EN.gcode, blocked: EN.gcode.blocked.filter((r) => r.kind !== 'textAfterComment') } };
    expect(bodies(run('G0 (a) X1\n', lenient))).toEqual(['G0   X1']);
    expect(blocks(run('G0 (a X1\n', lenient))).toEqual(['unclosed-comment']);
  });

  it('a control byte anywhere, even inside a comment, rejects the line', () => {
    for (const c of ['\x04', '\x05', '\x11', '\x13', '\x1b', '\x00']) {
      expect(blocks(run(`G0 X1 (a${c})\n`, EN)), JSON.stringify(c)).toEqual(['control-byte']);
    }
    expect(run('G0\tX1\n', EN).report.blocked).toBe(false);
  });

  it('non-ASCII text is fine in a comment but rejects code', () => {
    expect(run('G0 X1 (Ø6 mm)\n', EN).report.blocked).toBe(false);
    expect(blocks(run('G0 X1é\n', EN))).toEqual(['non-ascii']);
    expect(blocks(run('G0 X1\x7f\n', EN))).toEqual(['non-ascii']);
  });

  it.each(['!', '~', '%'])('rejects "%s" in code', (c) => {
    expect(blocks(run(`G0 X1${c}\n`, EN))).toEqual(['realtime-character']);
  });

  it.each(['$', '?', 'H', 'h', '{'])('rejects a line starting with "%s"', (c) => {
    expect(blocks(run(`${c}x\n`, EN))).toEqual(['first-character']);
  });

  it('rejects characters outside the G-code set, and malformed words', () => {
    expect(blocks(run('/G0 X1\n', EN))).toEqual(['invalid-character']);
    expect(blocks(run('G0 X1*2\n', EN))).toEqual(['invalid-character']);
    expect(blocks(run('G0 X\n', EN))).toEqual(['malformed']);
    expect(blocks(run('G0 X1.2.3\n', EN))).toEqual(['malformed']);
    expect(blocks(run('1 G0\n', EN))).toEqual(['malformed']);
    expect(blocks(run(`G0 X1${'0'.repeat(400)}\n`, EN))).toEqual(['malformed']);
  });
});

describe('step 6: universal rejections', () => {
  it('M100 and G38.x', () => {
    expect(blocks(run('M100\n', EN))).toEqual(['m100']);
    expect(blocks(run('G38.3 Z-1\n', EN))).toEqual(['probe']);
    expect(blocks(run('G38 Z-1\n', TG))).toEqual(['probe']);
  });

  it('negative F and S', () => {
    expect(blocks(run('G1 X1 F-100\n', EN))).toContain('negative-feed');
    expect(blocks(run('M3 S-100\n', EN))).toEqual(['negative-speed']);
    expect(run('M3 S0\n', EN, { c22: true }).report.blocked).toBe(false);
  });

  it('T must be a whole number within the dialect range (E154)', () => {
    expect(blocks(run('T32\n', EN))).toEqual(['bad-tool']);
    expect(blocks(run('T1.5\n', EN))).toEqual(['bad-tool']);
    expect(blocks(run('T-1\n', EN))).toEqual(['bad-tool']);
    expect(run('T31\n', EN).report.blocked).toBe(false);
    expect(run('T255\n', TG).report.blocked).toBe(false);
    expect(blocks(run('T256\n', TG))).toEqual(['bad-tool']);
  });

  it('unsupported codes, including dotted codes the firmware would run as their integer code', () => {
    expect(blocks(run('G59.1\n', TG))).toEqual(['unsupported-code']);
    expect(run('G59.1\n', TG).report.entries[0]?.message).toContain('never sent as G59');
    expect(blocks(run('G43\n', EN))).toEqual(['unsupported-code']);
    expect(blocks(run('G-1\n', EN))).toEqual(['unsupported-code']);
    expect(blocks(run('M114\n', EN))).toEqual(['unsupported-code']);
    expect(blocks(run('G28.2 X0\n', EN))).toEqual(['unsupported-code']);
    expect(blocks(run('M48\n', EN))).toEqual(['unsupported-code']);
    expect(blocks(run('G90.1\n', TG))).toEqual(['unsupported-code']);
    // Trailing zeros are not a sub-code: G1.0 is G1, G01 is G1 (E150).
    expect(run('G1.0 X1 F100\nG01 X2\n', EN).report.blocked).toBe(false);
  });

  it('ignored codes are kept with a warning (TG M48-M51)', () => {
    const r = run('M48\n', TG);
    expect(r.report.blocked).toBe(false);
    expect(r.report.entries.map((e) => [e.severity, e.rule])).toEqual([['warn', 'ignored-code']]);
    expect(bodies(r)).toEqual(['M48']);
  });

  it('unsupported word letters', () => {
    expect(blocks(run('G0 X1 Q2\n', EN))).toEqual(['unsupported-word']);
    expect(blocks(run('G0 X1 E2\n', EN))).toEqual(['unsupported-word']);
    expect(blocks(run('G0 X1 E2\n', TG))).toEqual(['e-word']);
  });

  it('modal conflicts (E152)', () => {
    for (const line of ['G0 G1 X1', 'G17 G18', 'G90 G91', 'G20 G21', 'G54 G55', 'M3 M4', 'M8 M9', 'M7 M7', 'G0 X1 X2', 'G80 G80', 'G43.1 G49 Z1']) {
      expect(blocks(run(`${line}\n`, EN)), line).toContain('modal-conflict');
    }
    expect(run('M7 M8\nM9\n', EN).report.blocked).toBe(false);
    expect(run('G80 G1 X1 F100\n', EN).report.blocked).toBe(false);
  });

  it('axis words used by both a motion code and a group-0 code; G53 rules; axis words under G80; stray arc words', () => {
    expect(blocks(run('G1 G92 X0\n', EN))).toContain('modal-conflict');
    expect(blocks(run('G53 G4 P1\n', EN))).toContain('modal-conflict');
    expect(blocks(run('G2\nG53 X1\n', EN))).toContain('modal-conflict');
    expect(blocks(run('G80\nX1\n', EN))).toEqual(['modal-conflict']);
    expect(blocks(run('G1 X1 I1 F100\n', EN))).toEqual(['modal-conflict']);
    expect(blocks(run('G2 X1 R1 I1 F100\n', EN))).toContain('modal-conflict');
    expect(run('G92 X0\nG53 G0 X1\n', EN).report.blocked).toBe(false);
  });

  it('G10 needs an allowed L and P1..P6', () => {
    expect(blocks(run('G10 L2 X0\n', EN))).toEqual(['bad-parameter']);
    expect(blocks(run('G10 P1 X0\n', EN))).toEqual(['l-word']);
    expect(blocks(run('G10 L1 P1 X0\n', EN))).toEqual(['l-word']);
    expect(blocks(run('G10 L2 P7 X0\n', EN))).toEqual(['bad-parameter']);
    expect(blocks(run('G10 L2 P1.5 X0\n', EN))).toEqual(['bad-parameter']);
    expect(run('G10 L2 P2 X0\nG10 L20 P1 X0\n', EN).report.blocked).toBe(false);
    expect(run('G10 L2 P2 X0\n', TG).report.blocked).toBe(false);
  });

  it('a negative dwell and bad arc turns', () => {
    expect(blocks(run('G4 P-1\n', EN))).toEqual(['bad-parameter']);
    expect(run('G4 P1\nG4\n', EN).report.blocked).toBe(false);
    expect(blocks(run('G2 X10 Y0 I5 P1.5 F100\n', EN))).toEqual(['bad-parameter']);
    expect(blocks(run('G2 X10 Y0 I5 P-1 F100\n', EN))).toEqual(['bad-parameter']);
  });

  it('a feed move needs a feed rate', () => {
    const noFeed: StartState = { ...START, motion: 'G1' };
    expect(blocks(run('G1 X1\n', EN))).toEqual(['feed-not-set']);
    expect(blocks(run('X1\n', EN, { start: noFeed }))).toEqual(['feed-not-set']);
    expect(blocks(run('G1 X1 F0\n', EN))).toEqual(['feed-not-set']);
    expect(blocks(run('G2 X10 Y0 I5\n', EN))).toEqual(['feed-not-set']);
    expect(run('G1 X1\n', EN, { start: { ...noFeed, feedMmPerMin: 100 } }).report.blocked).toBe(false);
    expect(run('G0 X1\n', EN).report.blocked).toBe(false);
    // F0 clears the feed, so the next feed move has none.
    expect(blocks(run('F0\nG1 X1\n', EN))).toEqual(['feed-not-set']);
  });
});

describe('step 6: per-dialect rejections', () => {
  it('TG: G18 arcs, also when the plane is unknown; EN: G18 arcs are fine', () => {
    expect(blocks(run('G18 G2 X2 Z0 I1 K0.75 F120\n', TG))).toEqual(['g18-arc']);
    expect(blocks(run('G2 X2 Y0 I1 F120\n', TG, { start: { ...START, plane: undefined as never } }))).toEqual(['g18-arc']);
    expect(run('G18 G2 X2 Z0 I1 K0.75 F120\n', EN).report.blocked).toBe(false);
  });

  it('TG: G28/G30 under G20 or G91, or when units or distance are unknown', () => {
    expect(blocks(run('G91 G28 Z0\n', TG))).toEqual(['g28-g30-g20-g91']);
    expect(blocks(run('G20\nG30\n', TG))).toEqual(['g28-g30-g20-g91']);
    expect(blocks(run('G28\n', TG, { start: { ...START, units: undefined as never } }))[0]).toBe('g28-g30-g20-g91');
    expect(run('G28\n', TG).report.blocked).toBe(false);
    expect(run('G91 G28 Z0\n', EN).report.blocked).toBe(false);
  });

  it('TG: G28.4; both: G93', () => {
    expect(blocks(run('G28.4\n', TG))).toEqual(['g28.4']);
    expect(blocks(run('G93\n', TG))).toEqual(['g93']);
    expect(blocks(run('G93\n', EN))).toEqual(['g93']);
  });

  it('TG: at most 3 queued commands per line besides motion (E088)', () => {
    expect(blocks(run('S1000 M3 M8 G4 P1\n', TG, { c22: true }))).toEqual(['e088-queued-per-line']);
    expect(run('S1000 M3 M8 G0 X1\n', TG, { c22: true }).report.blocked).toBe(false);
    expect(run('S1000 M3 M8 G4 P1\n', EN, { c22: true }).report.blocked).toBe(false);
  });

  it('TG E088 also counts program stop/end, G92 offsets and the second leg of G28/G30 (440.21 queues each)', () => {
    expect(blocks(run('S1000 M3 M8 G0 X1 M30\n', TG, { c22: true }))).toEqual(['e088-queued-per-line']);
    expect(blocks(run('S1000 M3 M8 G0 X1 M0\n', TG, { c22: true }))).toEqual(['e088-queued-per-line']);
    expect(blocks(run('S1000 M3 M8 G92 X0\n', TG, { c22: true }))).toEqual(['e088-queued-per-line']);
    expect(blocks(run('S1000 M3 M8 G28\n', TG, { c22: true }))).toEqual(['e088-queued-per-line']);
    expect(blocks(run('S1000 M3 M8 G30\n', TG, { c22: true, start: { ...START, g30: { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 } } }))).toEqual(['e088-queued-per-line']);
    expect(run('S1000 T1 G0 X1 M30\n', TG).report.blocked).toBe(false);
    expect(run('S1000 M3 M8 G0 X1 M30\n', EN).report.blocked).toBe(false);
  });

  it('EN: M201.3', () => {
    expect(blocks(run('M201.3 X100\n', EN))).toEqual(['m201.3']);
  });
});

describe('step 7: barriers and M1', () => {
  it('M0 and M60 are barriers on every dialect', () => {
    for (const d of [EN, TG]) {
      const r = run('M0\nG0 X1\nM60\n', d);
      expect(r.lines.map((l) => l.barrier), d.id).toEqual([true, false, true]);
    }
  });

  it('M1 with optional stop on is a barrier on every dialect', () => {
    for (const d of [EN, TG]) expect(run('M1\n', d, { optionalStop: true }).lines.map((l) => [l.body, l.barrier])).toEqual([['M1', true]]);
  });

  it('M1 with optional stop off: EN sends it (not a barrier), TG drops it', () => {
    expect(run('M1\n', EN).lines.map((l) => [l.body, l.barrier])).toEqual([['M1', false]]);
    const tg = run('M1\nG0 X1 M1\n', TG);
    expect(bodies(tg)).toEqual(['G0 X1']);
    expect(tg.report.entries.filter((e) => e.rule === 'm1-dropped').map((e) => e.line)).toEqual([1, 2]);
    expect(tg.report.entries.find((e) => e.line === 1 && e.rule === 'dropped-empty')).toBeDefined();
  });

  it('TG drops M1 from the last sub-segment of a split move', () => {
    const slow = { ...MOTION, ceilingSeconds: 2, maxVelocity: { X: 600 }, feedrateMax: { X: 600 } };
    const r = run('G1 X100 F600 M1\n', TG, { motion: slow });
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.lines.some((l) => /M1\b/.test(l.body))).toBe(false);
    expect(r.lines.every((l) => !l.barrier)).toBe(true);
  });

  it('C14 is not inserted twice when the three lines before M6 are already M5, M9, M0', () => {
    const r = run('M5\nM9\nM0\nT1 M6\n', EN, { c14: true });
    expect(bodies(r)).toEqual(['M5', 'M9', 'M0', 'T1 M6']);
    expect(r.report.entries.some((e) => e.rule === 'c14-inserted')).toBe(false);
  });

  // T-S1 counterexample (2026-11-03): the C14 M5 M9 are the commanded state from then on, so the end-state check adds
  // nothing after the M0 for a file whose M6 line also ends the program, and a second sanitise changes nothing.
  it.each([
    ['EN', EN],
    ['TG', TG],
  ] as const)('C14 before an M6 that ends the program (%s): no second M5 M9 after the M0, and sanitising again changes nothing', (_name, d) => {
    const o = { c14: true, c22: true };
    const once = run('M3 ()\nM6 M2\n', d, o);
    expect(once.report.blocked).toBe(false);
    expect(bodies(once)).toEqual(['M3', 'M5', 'M9', 'M0', 'M6 M2']);
    expect(once.report.entries.some((e) => e.rule === 'c22-inserted')).toBe(false);
    expect(once.report.endState).toEqual({ spindle: 'off', mist: false, flood: false });
    const again = run(`${once.lines.map((l) => l.text).join('\n')}\n`, d, o);
    expect(again.lines.map((l) => l.text)).toEqual(once.lines.map((l) => l.text));
    // An M6 line that also turns the spindle on again keeps that: the state after the line is what the line says.
    const restart = run('M3 S1000\nM6 M3\nG1 X1 F100\nM2\n', d, o);
    expect(bodies(restart).slice(0, 5)).toEqual(['M3 S1000', 'M5', 'M9', 'M0', 'M6 M3']);
    expect(restart.report.entries.some((e) => e.rule === 'c22-inserted')).toBe(d.gcode.job?.programEndStopsOutputs !== true);
  });
});

// After C14 the outputs are what the M6 line itself switches: off, unless the line turns one on again (then the end of
// the file needs C22's M5 M9). Pinned per output code, so the rule cannot lose one code unnoticed (mutation testing,
// 2026-11-09: sanitize.ts lines 207-208 survived for every single code).
describe('C14: the outputs after the M6 line', () => {
  it.each([
    ['T1 M6', false],
    ['T1 M6 M5', false],
    ['T1 M6 M9', false],
    ['T1 M6 M3', true],
    ['T1 M6 M4', true],
    ['T1 M6 M7', true],
    ['T1 M6 M8', true],
  ] as const)('%s after M3 and M8: C22 adds M5 M9 at the end only when the line turns an output on again (%s)', (m6, again) => {
    for (const d of [EN, TG]) {
      const r = run(`M3 S1000\nM8\n${m6}\n`, d, { c14: true, c22: true });
      expect(bodies(r), d.id).toEqual(['M3 S1000', 'M8', 'M5', 'M9', 'M0', m6, ...(again ? ['M5', 'M9'] : [])]);
      expect(r.report.endState).toEqual({ spindle: 'off', mist: false, flood: false });
    }
  });

  it.each([
    ['M5\nM9\nG4 P1\n', ['M5', 'M9', 'G4 P1']],
    ['M9\nM0\n', ['M9', 'M0']],
    ['G4 P1\nM9\nM0\n', ['G4 P1', 'M9', 'M0']],
    ['M5\nG4 P1\nM0\n', ['M5', 'G4 P1', 'M0']],
    ['M5\nM9\n', ['M5', 'M9']],
  ] as const)('C14 is inserted unless the three lines before M6 are exactly M5, M9, M0 (%j)', (before, lines) => {
    const r = run(`${before}T1 M6\n`, EN, { c14: true });
    expect(bodies(r)).toEqual([...lines, 'M5', 'M9', 'M0', 'T1 M6']);
    expect(r.report.entries.some((e) => e.rule === 'c14-inserted')).toBe(true);
  });

  it('an M6 line that turns on one coolant leaves the other off: C22 still ends the file with M9', () => {
    for (const d of [EN, TG]) {
      expect(bodies(run('M3 S1000\nM7 M8\nT1 M6 M8\n', d, { c14: true, c22: true })), d.id).toEqual(['M3 S1000', 'M7 M8', 'M5', 'M9', 'M0', 'T1 M6 M8', 'M5', 'M9']);
      expect(bodies(run('M4 S1000\nM7\nT1 M6\n', d, { c14: true, c22: true })), d.id).toEqual(['M4 S1000', 'M7', 'M5', 'M9', 'M0', 'T1 M6']);
    }
  });
});

describe('step 8: holdback and mid-file program end', () => {
  it('holds back only a final M2/M30', () => {
    expect(run('G0 X1\nM2\n', EN).lines.map((l) => l.holdback)).toEqual([false, true]);
    expect(run('M30\nG0 X1\n', TG).lines.map((l) => l.holdback)).toEqual([false, false]);
    expect(run('G0 X1\n', EN).lines.map((l) => l.holdback)).toEqual([false]);
    expect(run('', EN).lines).toEqual([]);
  });

  it('after a TG mid-file M30 the board defaults are restored, so the next lines are still modelled', () => {
    const r = run('G91\nM30\nG0 X1\nM30\n', TG);
    expect(r.report.blocked).toBe(false);
    expect(r.lines.find((l) => l.body === 'G0 X1')?.motion?.plannerLength).toBe(1);
  });

  it('with unknown board defaults, the move after a mid-file M30 cannot be modelled', () => {
    const r = run('M30\nG0 X1\nM30\n', TG, { start: { ...START, defaults: {} } });
    expect(blocks(r)).toEqual(['unknown-state']);
  });
});

describe('step 8a: end state (T-S76)', () => {
  it('blocks a file that ends with the spindle or coolant on, naming what is on', () => {
    for (const [file, what] of [
      ['M3 S1000\nG0 X1\n', 'the spindle on (M3)'],
      ['M4 S1000\n', 'the spindle on (M4)'],
      ['M7\n', 'mist coolant on (M7)'],
      ['M8\n', 'flood coolant on (M8)'],
    ] as const) {
      for (const d of [EN, TG]) {
        const r = run(file, d);
        expect(blocks(r), `${d.id} ${file}`).toEqual(['end-state']);
        expect(r.report.entries.find((e) => e.rule === 'end-state')?.message).toContain(what);
        expect(r.report.endState).not.toEqual({ spindle: 'off', mist: false, flood: false });
      }
    }
  });

  it('C22 appends M5 and M9 when there is no program end', () => {
    for (const d of [EN, TG]) {
      const r = run('M3 S1000\nG0 X1\n', d, { c22: true });
      expect(r.report.blocked).toBe(false);
      expect(bodies(r).slice(-2)).toEqual(['M5', 'M9']);
      expect(r.lines.slice(-2).map((l) => l.origin)).toEqual(['c22', 'c22']);
      expect(r.report.endState).toEqual({ spindle: 'off', mist: false, flood: false });
    }
  });

  it('EN: a final M2/M30 turns outputs off; TG: C22 inserts M5 M9 before it (B-M2-1)', () => {
    expect(run('M3 S1000\nM30\n', EN).report.blocked).toBe(false);
    expect(blocks(run('M3 S1000\nM30\n', TG))).toEqual(['end-state']);
    const tg = run('M3 S1000\nM30\n', TG, { c22: true });
    expect(bodies(tg)).toEqual(['M3 S1000', 'M5', 'M9', 'M30']);
    expect(tg.lines.at(-1)?.holdback).toBe(true);
  });

  it('TG: C22 cannot fix a last line that turns outputs on together with the program end', () => {
    const r = run('M3 M30\n', TG, { c22: true });
    expect(blocks(r)).toEqual(['end-state']);
    expect(bodies(r)).toEqual(['M3 M30']);
  });

  it('an empty file with the spindle already on is blocked at line 0, or gets M5 M9 with C22', () => {
    const on = { ...START, spindle: 'cw' } as const;
    const r = run('', EN, { start: on });
    expect(r.report.entries).toEqual([{ line: 0, severity: 'block', rule: 'end-state', message: 'the file ends with the spindle on (M3); accept C22 to add M5 and M9' }]);
    const fixed = run('(comment only)\n', EN, { start: on, c22: true });
    expect(bodies(fixed)).toEqual(['M5', 'M9']);
    expect(fixed.lines.map((l) => l.sourceLine)).toEqual([0, 0]);
  });

  it('the start state counts: a spindle already on and never turned off blocks', () => {
    expect(blocks(run('G0 X1\n', EN, { start: { ...START, spindle: 'cw' } }))).toEqual(['end-state']);
    expect(run('G0 X1\nM5\n', EN, { start: { ...START, spindle: 'cw' } }).report.blocked).toBe(false);
  });
});

describe('step 9: numbering and length', () => {
  it('numbers kept lines 1..k after removing a too-long line', () => {
    const long = `G4 P${'1'.repeat(115)}`;
    const r = run(`G0 X1\n${long}\nG0 X2\n`, EN);
    expect(blocks(r)).toEqual(['too-long']);
    expect(r.lines.map((l) => l.text)).toEqual(['N1 G0 X1', 'N2 G0 X2']);
  });

  it('a final M30 on a line too long to send leaves nothing held back', () => {
    const r = run(`G4 P${'1'.repeat(115)} M30\n`, EN);
    expect(blocks(r)).toEqual(['too-long']);
    expect(r.lines).toEqual([]);
  });

  it('a line that fits only with a short N is checked with its real N', () => {
    // 117 bytes of body: with "N1 " it is 120 and fits; with "N10 " it is 121 and does not.
    const body = `G4 P${'1'.repeat(113)}`;
    expect(body.length).toBe(117);
    const filler = Array.from({ length: 9 }, () => 'G4').join('\n');
    expect(blocks(run(`${body}\n`, EN))).toEqual([]);
    expect(blocks(run(`${filler}\n${body}\n`, EN))).toEqual(['too-long']);
  });
});

describe('verdict wording from the bench 1 file (presentation only: levels and rules unchanged)', () => {
  const messages = (r: ReturnType<typeof run>, rule: string): string[] => r.report.entries.filter((e) => e.rule === rule).map((e) => e.message);

  it('a tool change is an INFO stop point on edge-next (Phase 3, H74), with the tool number; 440.21 still blocks it', () => {
    const r = run('G21\nN10 T1 M06\n', EN);
    expect(blocks(r)).toEqual([]);
    expect(r.report.entries.find((e) => e.rule === 'tool-change-stop')?.severity).toBe('info');
    expect(messages(r, 'tool-change-stop')).toEqual(['Tool change (T1): Run stops here for a manual tool change.']);
    expect(messages(run('M6\n', EN), 'tool-change-stop')).toEqual(['Tool change: Run stops here for a manual tool change.']);
    const line = r.lines.find((l) => l.toolChange !== undefined);
    expect(line?.toolChange).toEqual({ tool: 1, spindle: 'off', speed: null, mist: false, flood: false, restartsSpindle: false });
    expect(r.lines.filter((l) => l.origin === 'c14')).toEqual([]);
    expect(messages(run('G21\nT1 M6\n', TG), 'm6-without-c14')).toEqual(["Tool change (T1): TinyG doesn't stop for M6, and Run streams jobs only to edge-next, which it stops before each tool change."]);
  });

  it('a tool change records the spindle and coolant before it, and whether the file restarts the spindle before moving', () => {
    const on = run('G21 G90\nM3 S9000\nM8\nG1 X1 F100\nT2 M6\nM3 S8000\nG1 X2\nT3 M6\nG1 X3\nM5 M9\nM30\n', EN);
    const tcs = on.lines.filter((l) => l.toolChange !== undefined).map((l) => l.toolChange);
    expect(tcs).toEqual([
      { tool: 2, spindle: 'cw', speed: 9000, mist: false, flood: true, restartsSpindle: true },
      { tool: 3, spindle: 'cw', speed: 8000, mist: false, flood: true, restartsSpindle: false },
    ]);
    const sameLine = run('G21\nT4 M6 M4 S500\nG1 X1 F100\nM5\n', EN);
    expect(sameLine.lines.find((l) => l.toolChange !== undefined)?.toolChange?.restartsSpindle).toBe(true);
    const atEnd = run('G21\nT4 M6\n', EN);
    expect(atEnd.lines.find((l) => l.toolChange !== undefined)?.toolChange?.restartsSpindle).toBe(false);
  });

  it.each([
    { label: 'tool change', words: 'T2 M6', tool: true, spindle: false },
    { label: 'clockwise spindle start', words: 'M3 S9000', tool: false, spindle: true },
    { label: 'counterclockwise spindle start', words: 'M4 S9000', tool: false, spindle: true },
    { label: 'tool change and spindle start', words: 'T2 M6 M3 S9000', tool: true, spindle: true },
    { label: 'neither', words: '', tool: false, spindle: false },
  ])('split move: $label belongs to the first segment only', ({ words, tool, spindle }) => {
    // Cover first-segment conditions and later-segment short circuits without a random property seed.
    // The preceding tool stop makes the internal startsSpindle marker observable through restartsSpindle.
    const r = run(`G21 G90\nT1 M6\n${words} G1 X100 F600\nM5\n`, EN, { motion: { ...MOTION, ceilingSeconds: 2, maxVelocity: { X: 600 }, feedrateMax: { X: 600 } } });
    expect(r.report.blocked, JSON.stringify(r.report.entries)).toBe(false);
    const segments = r.lines.filter((l) => l.origin === 'split');
    expect(segments.length).toBeGreaterThan(1);
    expect(r.lines.find(l => l.sourceLine === 2)?.toolChange?.restartsSpindle).toBe(spindle);
    if (tool) expect(segments[0]?.toolChange).toEqual({ tool: 2, spindle: 'off', speed: null, mist: false, flood: false, restartsSpindle: spindle });
    else expect(segments[0]?.toolChange).toBeUndefined();
    expect(segments[0]?.body.includes('M3') || segments[0]?.body.includes('M4')).toBe(spindle);
    for (const segment of segments.slice(1)) {
      expect(segment.toolChange).toBeUndefined();
      expect(segment.body).not.toMatch(/\bM[346]\b/);
    }
  });

  it('a G or M word whose digits run together across spaces is explained, still as unsupported-code', () => {
    const r = run('G21\nG90\nG0 X0 Y0\nS5000\nG17\nN30 G92 064 Y0.326 X0.000\n', EN);
    expect(blocks(r)).toContain('unsupported-code');
    const entry = r.report.entries.find((e) => e.rule === 'unsupported-code');
    expect(entry?.severity).toBe('block');
    expect(entry?.line).toBe(6);
    expect(entry?.message).toBe("'G92 064' reads as G92064 because TinyG ignores spaces, and that isn't a valid command. This looks like a broken line from the post-processor. Check the file around line 6.");
    // Without spaces inside the number the plain message stays.
    expect(messages(run('G92064 X0\n', EN), 'unsupported-code')).toEqual(['G92064 is not supported in a job on this firmware']);
    expect(messages(run('M1 14\n', EN), 'unsupported-code')[0]).toMatch(/^'M1 14' reads as M114 because TinyG ignores spaces/);
    // Only the spaced word's finding is reworded; another unsupported code on the line keeps its message.
    const two = messages(run('G43 G1 2\n', EN), 'unsupported-code');
    expect(two).toContain('G43 is not supported in a job on this firmware');
    expect(two.some((m) => m.startsWith("'G1 2' reads as G12 "))).toBe(true);
    // Leading zeros: the message names the code as TinyG counts it.
    expect(messages(run('G01 2\n', EN), 'unsupported-code')[0]).toMatch(/^'G01 2' reads as G12 /);
    // A signed code has no canonical form: named as written.
    expect(messages(run('G-1 2\n', EN), 'unsupported-code')[0]).toMatch(/^'G-1 2' reads as G-12 /);
  });
});
