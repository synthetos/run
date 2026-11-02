/**
 * Finer behaviour of both firmware models: G-code word rules, offsets and
 * units, verbosity and syntax settings, report options, faults that reach the
 * device, and the loud ModelGapError for anything not modelled.
 */
import { describe, expect, it } from 'vitest';
import { ModelGapError } from '../src/firmware/common.ts';
import { enSim, exceptions, get, replies, reports, statuses, tgSim } from './helpers.ts';

describe('edge-next G-code word rules', () => {
  it('[EN-RT-PERCENT-MIDLINE] rejects bad words with the firmware status codes and runs nothing', () => {
    const sim = enSim();
    const cases: [string, number][] = [
      ['G1 G0 X1', 133], // two motion codes (E152)
      ['M3 M5', 133],
      ['M7 M9', 133],
      ['G17 G18', 133],
      ['G20 G21', 133],
      ['G54 G55', 133],
      ['G90 G91', 133],
      ['G90.1 G91.1', 133],
      ['G4 G92 X0', 133],
      ['G59.1', 131], // a dotted code that takes no sub-code (E150)
      ['G1.25 X1', 131],
      ['G1000', 131],
      ['M3.1', 132],
      ['M48', 132],
      ['M1000', 132],
      ['M99', 132],
      ['G99', 131],
      ['T40', 181], // beyond TOOL_SELECT_MAX (E154)
      ['T1.5', 181],
      ['F-1', 108],
      ['S-5', 179],
      ['G4 P-1', 163],
      ['L2.5', 173],
      ['Q1', 131], // an unsupported word letter is an error, not an alarm (E042)
      ['G80 X1', 135],
      ['G53 G2 X1 I1', 145],
      ['G1 X1', 142], // no feed rate yet
      ['G1 X1E5 F100', 131], // E159: E is a word letter
    ];
    for (const [line] of cases) sim.host.sendLine(line);
    sim.clock.advance(200);
    expect(statuses(sim.host.lines())).toEqual(cases.map(([, st]) => st));
    expect(sim.device.snapshot().position).toEqual([0, 0, 0, 0, 0, 0]);
    expect(sim.device.snapshot().stat).toBe(1); // none of them alarmed
  });

  it('accepts comment-only lines, block delete (NOOP) and N words', () => {
    const sim = enSim();
    sim.host.sendLine('(just a comment)');
    sim.host.sendLine('/G1 X1 F600');
    sim.host.sendLine('N10 G4 P0.01');
    sim.host.sendLine('%');
    sim.clock.advance(100);
    expect(statuses(sim.host.lines())).toEqual([0, 3, 0]); // a lone % at a line start is trapped
  });

  it('G92 offsets the work position; G92.1 cancels it; G53 moves in machine coordinates', () => {
    const sim = enSim();
    sim.host.sendLine('G92 X10');
    sim.clock.advance(20);
    expect(get(sim, 'posx')).toBe(10);
    sim.host.sendLine('G1 X20 F6000'); // the feed is limited to xfr=800 mm/min
    sim.clock.advance(1000);
    expect(sim.device.snapshot().position[0]).toBe(10);
    expect(get(sim, 'posx')).toBe(20);
    expect(get(sim, 'ofsx')).toBe(-10);
    sim.host.sendLine('G53 G0 X0');
    sim.clock.advance(1500);
    expect(sim.device.snapshot().position[0]).toBe(0);
    sim.host.sendLine('G92.1');
    sim.clock.advance(20);
    expect(get(sim, 'posx')).toBe(0);
  });

  it('G20 works in inches: targets, feed, reports and length settings are converted', () => {
    const sim = enSim();
    sim.host.sendLine('G20');
    sim.host.sendLine('G91');
    sim.host.sendLine('G1 X1 F30');
    sim.clock.advance(3000);
    expect(sim.device.snapshot().position[0]).toBe(Math.fround(25.4)); // float32 target, as on the board
    expect(get(sim, 'posx')).toBe(1);
    expect(get(sim, 'unit')).toBe(0);
    expect(get(sim, 'dist')).toBe(1);
    sim.host.sendLine('{"xtm":2}');
    sim.clock.advance(20);
    expect(sim.device.settings.get('xtm')).toBeCloseTo(50.8, 9); // set_flu stores millimetres
  });

  it('M7/M8 and M9 drive the coolant outputs in queue order; M6 and T are accepted', () => {
    const sim = enSim();
    sim.host.sendLine('T3 M6');
    sim.host.sendLine('M7');
    sim.host.sendLine('M8');
    sim.clock.advance(20);
    expect(sim.device.snapshot().coolant).toEqual({ mist: true, flood: true });
    expect(get(sim, 'tool')).toBe(3);
    sim.host.sendLine('M9');
    sim.clock.advance(20);
    expect(sim.device.snapshot().coolant).toEqual({ mist: false, flood: false });
  });

  it('G10 L20 and L2 set and persist the G54..G59 offset; other L and P values are refused (LIM-EN-G10)', () => {
    const sim = enSim();
    sim.host.sendLine('G0 X5 Y2');
    sim.clock.advance(2000);
    sim.host.sendLine('G10 L20 P1 X0 Y1');
    sim.clock.advance(20);
    expect(sim.device.settings.num('g54x')).toBeCloseTo(5, 6);
    expect(sim.device.settings.num('g54y')).toBeCloseTo(1, 6);
    expect(sim.device.settings.eeprom['g54x']).toBeCloseTo(5, 6);
    sim.host.sendLine('G10 L2 P2 Z-3');
    sim.clock.advance(20);
    expect(sim.device.settings.num('g55z')).toBe(-3);
    for (const line of ['G10 L1 P1 X0', 'G10 L20 P7 X0', 'G10 L20 X0']) {
      const s = enSim();
      s.host.take();
      s.host.sendLine(line);
      s.clock.advance(20);
      expect(statuses(s.host.take()), line).not.toContain(0);
    }
  });

  it('throws ModelGapError for firmware features the model does not implement', () => {
    for (const line of ['G28.2 X0', 'G38.2 Z-1 F10', 'M114', 'G2 X1 R1 F100']) {
      const sim = enSim();
      sim.host.sendLine(line);
      expect(() => sim.clock.advance(20), line).toThrow(ModelGapError);
    }
    const plane = enSim();
    plane.host.sendLine('G18 G2 X1 I1 F100');
    expect(() => plane.clock.advance(20)).toThrow(ModelGapError);
  });

  it('an arc with no centre offset is an ALARM (arc offsets missing)', () => {
    const sim = enSim();
    sim.host.sendLine('G2 X1 F100');
    sim.clock.advance(20);
    expect(exceptions(sim.host.lines()).map((e) => e.st)).toEqual([157]);
    expect(sim.device.snapshot().stat).toBe(2);
  });
});

describe('edge-next JSON, verbosity and reports', () => {
  it('answers SET errors with the firmware codes', () => {
    const sim = enSim();
    sim.host.sendLine('{"fb":451}'); // read-only
    sim.host.sendLine('{"jv":7}'); // out of range
    sim.host.sendLine('{"nosuch":1}');
    sim.host.sendLine('{"xvm":"fast"}');
    sim.host.sendLine('{"gc":5}');
    sim.host.sendLine('{"fb":');
    sim.host.sendLine('{"spph":1}');
    sim.clock.advance(100);
    expect(statuses(sim.host.lines())).toEqual([104, 110, 100, 116, 116, 111, 17]);
    expect(replies(sim.host.lines())[5]?.r).toEqual({ err: '{"fb":' });
  });

  it('refuses a spindle polarity change while the spindle runs (EN spindle.c:62-81)', () => {
    const sim = enSim();
    sim.host.sendLine('M3');
    sim.host.sendLine('{"spep":0}');
    sim.host.sendLine('M5');
    sim.host.sendLine('{"spep":0}');
    sim.clock.advance(100);
    expect(statuses(sim.host.lines())).toEqual([0, 106, 0, 0]);
  });

  it('clamps si to 100 ms and runs G-code sent as {"gc":...}', () => {
    const sim = enSim();
    sim.host.sendLine('{"si":50}');
    sim.host.sendLine('{"gc":"G1 X2 F600"}');
    sim.clock.advance(500);
    expect(replies(sim.host.lines())[0]?.r).toEqual({ si: 100 });
    expect(sim.device.snapshot().position[0]).toBe(2);
  });

  it('jv=0 is silent, jv=5 echoes G-code, jv=4 adds line numbers, js=0 relaxes the output', () => {
    const sim = enSim();
    sim.host.sendLine('{"jv":5}');
    sim.host.sendLine('G4 P0');
    sim.host.sendLine('{"jv":4}');
    sim.host.sendLine('N12 G4 P0');
    sim.host.sendLine('{"js":0}');
    sim.host.sendLine('{"fb":null}');
    sim.host.sendLine('{"jv":0}');
    sim.host.sendLine('{"fb":null}');
    sim.clock.advance(100);
    const lines = sim.host.lines();
    expect(lines).toContain('{"r":{"gc":"G4 P0"},"f":[3,0,10]}');
    expect(lines).toContain('{"r":{"n":12},"f":[3,0,10]}');
    expect(lines).toContain('{r:{fb:450.01},f:[3,0,10]}');
    expect(lines.filter((l) => l.includes('fb'))).toHaveLength(1);
  });

  it('GETs of groups, sr, me, adc3 and help', () => {
    const sim = enSim();
    sim.host.sendLine('{"mpo":null}');
    sim.host.sendLine('{"me":null}');
    sim.host.sendLine('{"adc3":null}');
    sim.host.sendLine('{"help":null}');
    sim.clock.advance(50);
    expect(replies(sim.host.lines())[0]?.r).toEqual({ mpo: { x: 0, y: 0, z: 0, a: 0, b: 0, c: 0 } });
    expect(sim.device.snapshot().motorsEnergized).toBe(true);
    expect(sim.device.sideEffects.map((e) => e.what)).toEqual(['motors-energized', 'adc-conversion', 'help-text']);
  });

  it('SETs that act: md/me/clear/alarm/shutd/panic', () => {
    const sim = enSim();
    sim.host.sendLine('{"me":5}');
    sim.host.sendLine('{"md":1}');
    sim.host.sendLine('{"shutd":1}');
    sim.clock.advance(50);
    expect(sim.device.snapshot().stat).toBe(12);
    expect(sim.device.snapshot().motorsEnergized).toBe(false);
    sim.host.sendLine('{"clear":null}');
    sim.host.sendLine('{"alarm":1}');
    sim.clock.advance(50);
    expect(sim.device.snapshot().stat).toBe(2);
    sim.host.sendLine('{"clear":null}');
    sim.host.sendLine('{"panic":1}');
    sim.clock.advance(50);
    expect(sim.device.snapshot().stat).toBe(13);
  });

  it('a group SET and the dangerous SETs (baud, boot, defaults) are model gaps, never silently accepted', () => {
    for (const line of ['{"sr":{"line":true}}', '{"baud":5}', '{"boot":1}', '{"defa":1}']) {
      const sim = enSim();
      sim.host.sendLine(line);
      expect(() => sim.clock.advance(20), line).toThrow(ModelGapError);
    }
  });

  it('qv=1 sends queue reports when the free buffer count changes; sv=0 stops status reports', () => {
    const sim = enSim();
    sim.host.sendLine('{"qv":1}');
    sim.host.sendLine('{"sv":0}');
    sim.host.sendLine('G4 P0.1');
    sim.clock.advance(300);
    const qr = sim.host.lines().filter((l) => l.startsWith('{"qr"'));
    expect(qr).toEqual(['{"qr":31}', '{"qr":32}']);
    expect(reports(sim.host.lines())).toEqual([]);
  });

  it('a host XOFF pauses the board output until XON (EN re-enables TX: no deadlock)', () => {
    const sim = enSim();
    sim.host.send('\x13');
    sim.host.sendLine('{"fb":null}');
    sim.clock.advance(200);
    expect(sim.host.lines()).toEqual([]);
    sim.host.send('\x11');
    sim.clock.advance(20);
    expect(replies(sim.host.lines())).toHaveLength(1);
  });

  it('character mode holds a data line read while only control lines are wanted (no overtaking)', () => {
    const sim = enSim();
    sim.host.sendLine('{"rxm":0}');
    for (let i = 0; i < 21; i++) sim.host.sendLine('G4 P0.5');
    sim.clock.advance(100);
    sim.host.take();
    sim.host.sendLine('G4 P0.5');
    sim.host.sendLine('{"stat":null}');
    sim.clock.advance(200);
    expect(sim.host.take()).toEqual([]); // the control line is stuck behind the held data line
    sim.clock.advance(1000);
    expect(replies(sim.host.take()).map((r) => r.r)).toEqual([{}, { stat: 1 }]);
  });

  it('an overlong line in character mode is answered 107 with its length counted', () => {
    const sim = enSim();
    sim.host.sendLine('{"rxm":0}');
    sim.clock.advance(20);
    sim.host.take();
    sim.host.sendLine('x'.repeat(300));
    sim.clock.advance(100);
    const r = replies(sim.host.take());
    expect(r.map((x) => x.f[1])).toEqual([107]);
  });
});

describe('device faults reach the edge-next model', () => {
  it('report suppression silences status reports for its window only', () => {
    const sim = enSim({}, { faults: { faults: [{ kind: 'suppressReports', fromMs: 0, toMs: 800 }] } });
    sim.host.sendLine('G1 X15 F600');
    sim.clock.advance(700);
    expect(reports(sim.host.lines())).toEqual([]);
    sim.clock.advance(800);
    expect(reports(sim.host.lines()).length).toBeGreaterThan(0);
  });

  it('a board reset loses the state and prints the banner again; a banner delay pushes it later', () => {
    const sim = enSim({}, { faults: { faults: [{ kind: 'boardReset', atMs: 300 }, { kind: 'bannerDelay', extraMs: 500 }] } });
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X20 F600');
    sim.clock.advance(1700);
    expect(sim.host.lines().some((l) => l.includes('SYSTEM READY'))).toBe(false);
    sim.clock.advance(200);
    expect(sim.host.lines().at(-1)).toContain('SYSTEM READY');
    const s = sim.device.snapshot();
    expect(s.spindle).toBe('off');
    expect(s.position[0]).toBe(0);
    expect(s.plannerAvailable).toBe(32);
  });

  it('bytes sent while the board boots are lost', () => {
    const sim = enSim({ start: 'boot' });
    sim.host.sendLine('{"fb":null}');
    sim.clock.advance(1200);
    expect(replies(sim.host.lines())).toEqual([]);
  });
});

describe('440.21 details', () => {
  it('[TG-DOTTED-CODES] G59.1 runs as G59, M3.1 as M3, and T256 is tool 0', () => {
    const sim = tgSim();
    sim.host.sendLine('G59.1');
    sim.host.sendLine('M3.1');
    sim.host.sendLine('T256');
    sim.clock.advance(50);
    expect(statuses(sim.host.lines())).toEqual([0, 0, 0]);
    expect(get(sim, 'coor')).toBe(6);
    expect(sim.device.snapshot().spindle).toBe('cw');
  });

  it('switches to text mode on $, ? or H and back on {', () => {
    const sim = tgSim();
    sim.host.sendLine('h');
    sim.host.sendLine('G21');
    sim.host.sendLine('');
    sim.host.sendLine('{"fb":null}');
    sim.clock.advance(50);
    expect(sim.host.lines().slice(0, 2)).toEqual(['tinyg [mm] ok>', 'tinyg [mm] ok>']);
    expect(replies(sim.host.lines())).toHaveLength(1);
  });

  it('JSON errors, read-only and alarmed SETs, and acting GETs', () => {
    const sim = tgSim();
    sim.host.sendLine('{"fb":');
    sim.host.sendLine('{"fb":441}');
    sim.host.sendLine('{"er":null}');
    sim.host.sendLine('{"me":null}');
    sim.host.sendLine('{"help":null}');
    sim.host.sendLine('{"mpo":null}');
    sim.host.sendLine('{"gc":"G4 P0"}');
    sim.clock.advance(100);
    expect(statuses(sim.host.lines())).toEqual([111, 104, 29, 0, 0, 0, 0]);
    expect(exceptions(sim.host.lines()).map((e) => e.st)).toEqual([29]);
    expect(sim.device.sideEffects.map((e) => e.what)).toEqual(['fake-exception', 'motors-energized', 'help-text']);
  });

  it('{clear:null} clears a soft alarm; SETs in a soft alarm get 203', () => {
    const sim = tgSim();
    sim.host.sendLine('{"sl":1}');
    sim.clock.advance(20);
    sim.device.setHomed(['x']);
    sim.host.sendLine('G0 X500');
    sim.host.sendLine('{"xvm":700}');
    sim.host.sendLine('{"clear":null}');
    sim.host.sendLine('{"xvm":700}');
    sim.clock.advance(100);
    expect(statuses(sim.host.lines()).slice(-4)).toEqual([220, 203, 0, 0]);
    expect(sim.device.sideEffects.map((e) => e.what)).toEqual(['alarm-cleared']);
  });

  it('coolant, inches, line numbers and an ignored L word', () => {
    const sim = tgSim();
    sim.host.sendLine('M7');
    sim.host.sendLine('M8');
    sim.clock.advance(20);
    expect(sim.device.snapshot().coolant).toEqual({ mist: true, flood: true });
    sim.host.sendLine('M9');
    sim.host.sendLine('G20');
    sim.host.sendLine('N7 G1 X1 F30 L20');
    sim.clock.advance(3000);
    expect(sim.device.snapshot().coolant).toEqual({ mist: false, flood: false });
    expect(sim.device.snapshot().position[0]).toBe(Math.fround(25.4)); // float32 target, as on the board
    expect(get(sim, 'line')).toBe(7);
    expect(get(sim, 'posx')).toBe(1);
  });

  it('model gaps throw instead of guessing', () => {
    for (const line of ['G28.2 X0', 'M400', 'G1 X1 R1 F10', '{"x":{"vm":1}}', '{"boot":1}']) {
      const sim = tgSim();
      sim.host.sendLine(line);
      expect(() => sim.clock.advance(20), line).toThrow(ModelGapError);
    }
  });
});
