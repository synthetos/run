/**
 * TinyG440Model (ROADMAP P0-11, RUN_PLAN §8.1 "as OLD-TP §7, corrected").
 * Test titles carry the behaviour ids of src/honesty/behaviours.ts.
 */
import { describe, expect, it } from 'vitest';
import { decodeInbound } from '@synthetos/protocol';
import { checksum440 } from '../src/firmware/tg440.ts';
import { bytes } from '../src/bytes.ts';
import { enSim, exceptions, get, replies, statuses, tgSim } from './helpers.ts';

describe('TinyG440Model: P0-11 acceptance', () => {
  it('[TG-M0-NO-PAUSE] M0 does not pause: the next move runs without ~', () => {
    const sim = tgSim();
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X5 F600');
    sim.host.sendLine('M0');
    sim.host.sendLine('G1 X10');
    sim.clock.advance(700);
    expect(sim.device.snapshot().position[0]).toBeGreaterThan(5); // already past the M0
    expect(sim.device.snapshot().stat).toBe(3); // and it reports program stop while it moves
    sim.clock.advance(1000);
    expect(sim.device.snapshot().position[0]).toBe(10);
    expect(sim.device.snapshot().hold).toBe(0);
    // The same program on edge-next stops at X5.
    const en = enSim();
    en.host.sendLine('G1 X5 F600');
    en.host.sendLine('M0');
    en.host.sendLine('G1 X10');
    en.clock.advance(1700);
    expect(en.device.snapshot().position[0]).toBe(5);
  });

  it('[TG-ARC-NO-SOFT-LIMIT] an arc that sweeps beyond the envelope is not alarmed and runs', () => {
    const sim = tgSim();
    sim.host.sendLine('{"sl":1}');
    sim.host.sendLine('G0 X5 Y30');
    sim.clock.advance(5000);
    sim.device.setHomed(['x', 'y', 'z']);
    sim.host.take();
    sim.host.sendLine('G3 X5 Y10 I0 J-10 F600'); // turns left through X=-5, outside 0..150
    sim.clock.advance(1700);
    const mid = sim.device.snapshot().position;
    expect(mid[0]).toBeLessThan(0);
    sim.clock.advance(3000);
    const lines = sim.host.take();
    expect(exceptions(lines)).toEqual([]);
    expect(statuses(lines)).toEqual([0]);
    expect(sim.device.snapshot().position[1]).toBeCloseTo(10, 6);
    // A straight move to the same outside point is refused (soft limits are on).
    sim.host.sendLine('G1 X-5 Y20');
    sim.clock.advance(50);
    expect(exceptions(sim.host.take()).map((e) => e.st)).toEqual([220]);
  });

  it('[TG-RT-FLUSH-LATCHED] a % inside a "(50%)" comment latches a flush that drops the planner at the next stop', () => {
    const sim = tgSim();
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(300);
    sim.host.sendLine('G1 X60 (50%)');
    sim.clock.advance(100);
    expect(sim.device.snapshot().plannerAvailable).toBe(30); // the rest of the line ran: G1 X60 is queued
    expect(sim.device.sideEffects).toEqual([]); // latched, not run: the machine is moving
    sim.host.send('!');
    sim.clock.advance(300);
    const s = sim.device.snapshot();
    expect(s.plannerAvailable).toBe(32); // the hold completed and the latched flush dropped G1 X60
    expect(sim.device.sideEffects.map((e) => e.what)).toEqual(['queue-flush']);
    expect(s.position[0]).toBeLessThan(50);
    // On edge-next the same comment is just text: nothing is flushed.
    const en = enSim();
    en.host.sendLine('G1 X50 F600');
    en.clock.advance(300);
    en.host.sendLine('G1 X60 (50%)');
    en.clock.advance(100);
    en.host.send('!');
    en.clock.advance(300);
    expect(en.device.snapshot().plannerAvailable).toBe(30);
  });

  it('[TG-RT-FLUSH-LATCHED] at idle the latched flush runs at once and drops the line it arrived in', () => {
    const sim = tgSim();
    sim.host.sendLine('G1 X5 F600 (50%)');
    sim.clock.advance(1500);
    expect(sim.device.snapshot().position[0]).toBe(0);
    expect(sim.device.sideEffects.map((e) => e.what)).toEqual(['queue-flush']);
  });

  it('[TG-SOFT-ALARM] a soft alarm keeps moving: queued moves and the spindle run on; new blocks get 203', () => {
    const sim = tgSim();
    sim.host.sendLine('{"sl":1}');
    sim.clock.advance(20);
    sim.device.setHomed(['x', 'y', 'z']);
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X50 F600');
    sim.host.sendLine('G1 X200');
    sim.clock.advance(400);
    const lines = sim.host.take();
    expect(exceptions(lines).map((e) => e.st)).toEqual([220]);
    expect(statuses(lines).slice(-1)).toEqual([220]);
    const moving = sim.device.snapshot();
    expect(moving.velocity).toBeGreaterThan(0);
    expect(moving.spindle).toBe('cw');
    expect(moving.machineState).toBe('alarm');
    expect(moving.stat).toBe(5); // [TG-STAT] a cycle hides the alarm from stat
    sim.host.sendLine('G1 X1');
    sim.clock.advance(50);
    expect(statuses(sim.host.take())).toEqual([203]);
    sim.clock.advance(5000);
    expect(sim.device.snapshot().position[0]).toBe(50);
  });
});

describe('TinyG440Model: alarm state', () => {
  it('[TG-QUEUED-END-CLEARS] the cycle end at planner drain overwrites the soft alarm', () => {
    const sim = tgSim();
    sim.host.sendLine('{"sl":1}');
    sim.clock.advance(20);
    sim.device.setHomed(['x']);
    sim.host.sendLine('G1 X5 F600');
    sim.host.sendLine('G1 X500');
    sim.clock.advance(100);
    expect(sim.device.snapshot().machineState).toBe('alarm');
    sim.clock.advance(1000);
    expect(sim.device.snapshot().machineState).toBe('programStop');
    expect(sim.device.snapshot().stat).toBe(3);
    sim.host.take();
    sim.host.sendLine('G1 X1');
    sim.clock.advance(50);
    expect(statuses(sim.host.take())).toEqual([0]); // accepted again: nothing cleared it on purpose
  });

  it('[TG-SPINDLE-NOT-INHIBITED] a queued M3 runs after a soft alarm and switches the spindle on', () => {
    const sim = tgSim();
    sim.host.sendLine('{"sl":1}');
    sim.clock.advance(20);
    sim.device.setHomed(['x']);
    sim.host.sendLine('G1 X5 F600');
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X500');
    sim.clock.advance(1000);
    expect(exceptions(sim.host.lines()).map((e) => e.st)).toEqual([220]);
    expect(sim.device.snapshot().spindle).toBe('cw');
  });

  it('[TG-HARD-ALARM] a limit switch is SHUTDOWN (stat 11) and later commands get no answer until ^X', () => {
    const sim = tgSim({}, { faults: { faults: [{ kind: 'alarm', atMs: 300, cause: 'limitSwitch' }] } });
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(400);
    expect(exceptions(sim.host.lines()).map((e) => e.st)).toEqual([204]);
    const s = sim.device.snapshot();
    expect(s.stat).toBe(11);
    expect(s.velocity).toBe(0);
    sim.host.take();
    sim.host.sendLine('{"stat":null}');
    sim.clock.advance(500);
    expect(sim.host.take()).toEqual([]);
    sim.host.send('\x18');
    sim.clock.advance(1100);
    expect(sim.host.take().at(-1)).toContain('SYSTEM READY');
    expect(sim.device.snapshot().stat).toBe(1);
  });

  it('[TG-HARD-ALARM-SPINDLE] after a hard alarm the queued spindle off never runs: the model keeps the spindle on', () => {
    const sim = tgSim({}, { faults: { faults: [{ kind: 'alarm', atMs: 300, cause: 'limitSwitch' }] } });
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(1000);
    expect(sim.device.snapshot().stat).toBe(11);
    expect(sim.device.snapshot().spindle).toBe('cw');
  });

  it('[TG-PROGRAM-END-SPINDLE] M2 turns the spindle off through commands queued at the program end', () => {
    const sim = tgSim();
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X5 F600');
    sim.host.sendLine('M2');
    sim.clock.advance(200);
    expect(sim.device.snapshot().spindle).toBe('cw');
    sim.clock.advance(800);
    expect(sim.device.snapshot().spindle).toBe('off');
    expect(sim.device.snapshot().stat).toBe(4);
  });
});

describe('TinyG440Model: receive path and realtime bytes', () => {
  it('[TG-RX-RING] the ring holds 252 bytes and tosses the rest silently', () => {
    const sim = tgSim();
    sim.host.sendLine('{"ex":0}');
    for (let i = 0; i < 28; i++) sim.host.sendLine('G4 P1');
    sim.clock.advance(100);
    sim.host.send('G4 P0.01 (pad pad pad pad pad pad)\n'.repeat(12));
    sim.clock.advance(200);
    expect(sim.device.snapshot().rxCount).toBe(252);
    sim.clock.advance(40_000);
    expect(exceptions(sim.host.lines())).toEqual([]); // no record of the loss
  });

  it('[TG-OVERRUN-SPLICE] losing the line end splices two lines and the result runs', () => {
    const sim = tgSim({}, { faults: { faults: [{ kind: 'ringOverrun', atByte: 10 }] } });
    sim.host.send('G1 X1 F600\nG1 Y2\n'); // byte 10 is the first LF
    sim.clock.advance(1000);
    expect(statuses(sim.host.lines())).toEqual([0]);
    expect(sim.device.snapshot().position.slice(0, 2)).toEqual([1, 2]);
    // edge-next refuses the same splice (E162).
    const en = enSim({}, { faults: { faults: [{ kind: 'ringOverrun', atByte: 10 }] } });
    en.host.send('G1 X1 F600\nG1 Y2\n');
    en.clock.advance(1000);
    expect(en.device.snapshot().position.slice(0, 2)).toEqual([0, 0]);
  });

  it('[TG-RX-XOFF] with ex=1 the board sends XOFF above 80 % of the ring and XON below 10 %', () => {
    const sim = tgSim();
    for (let i = 0; i < 28; i++) sim.host.sendLine('G4 P0.2');
    sim.clock.advance(50);
    sim.host.send('G4 P0.2 (comment to fill the ring quickly)\n'.repeat(6));
    sim.clock.advance(100);
    expect(sim.host.flow.map((f) => f.signal)).toEqual(['xoff']);
    expect(sim.device.snapshot().rxCount).toBeGreaterThan(203);
    sim.clock.advance(15_000);
    expect(sim.host.flow.map((f) => f.signal)).toEqual(['xoff', 'xon']);
  });

  it('[TG-RT-TRAP] ~ inside a line is trapped (resume) and the line itself is intact', () => {
    const sim = tgSim();
    sim.host.sendLine('G1 X20 F600');
    sim.clock.advance(300);
    sim.host.send('!');
    sim.clock.advance(300);
    expect(sim.device.snapshot().hold).toBe(4);
    sim.host.take();
    sim.host.send('{"stat"~:null}\n');
    sim.clock.advance(50);
    expect(replies(sim.host.take()).map((r) => r.r)).toEqual([{ stat: 5 }]);
    expect(sim.device.snapshot().hold).toBe(0);
  });

  it('[TG-RT-FEEDHOLD] ! is ignored with no motion and holds a running move', () => {
    const sim = tgSim();
    sim.host.send('!');
    sim.clock.advance(50);
    expect(sim.device.snapshot().hold).toBe(0);
    sim.host.sendLine('G1 X20 F600');
    sim.clock.advance(300);
    sim.host.send('!');
    sim.clock.advance(300);
    expect(sim.device.snapshot().hold).toBe(4);
    expect(sim.device.snapshot().stat).toBe(6);
  });

  it('[TG-NO-KILL-ENQ] ENQ and ^D are not trapped: they corrupt the next line', () => {
    const sim = tgSim();
    sim.host.send('\x05{"fb":null}\n');
    sim.host.send('\x04{"stat":null}\n');
    sim.clock.advance(50);
    const r = replies(sim.host.lines());
    expect(sim.host.lines()).not.toContain('{"ack":true}');
    expect(r).toHaveLength(2);
    // The control byte makes each line G-code, run wrapped as {"gc":"..."} and cut at the first quote
    // (TG-GC-WRAP-QUOTE): the GET never runs.
    expect(r.every((x) => !('fb' in x.r) && !('stat' in x.r))).toBe(true);
  });

  it('[TG-RESET-DEFERRED] ^X resets through the main loop, but not while a stalled TX buffer blocks it', () => {
    const ok = tgSim();
    ok.host.send('\x18');
    ok.clock.advance(1100);
    expect(ok.host.lines().at(-1)).toContain('SYSTEM READY');

    const stuck = tgSim();
    stuck.host.send('\x11'); // E142: TX stalls
    for (let i = 0; i < 20; i++) stuck.host.sendLine('{"fb":null}');
    stuck.clock.advance(200);
    expect(stuck.device.loopBlocked()).toBe(true);
    stuck.host.send('\x18');
    stuck.clock.advance(3000);
    expect(stuck.host.lines()).toEqual([]);
    expect(stuck.device.snapshot().booted).toBe(true); // never reset
  });

  it('[TG-HOST-XON-DEADLOCK] an XON from the host stops all output', () => {
    const sim = tgSim();
    sim.host.sendLine('{"fb":null}');
    sim.clock.advance(20);
    expect(replies(sim.host.take())).toHaveLength(1);
    sim.host.send('\x11');
    sim.host.sendLine('{"fb":null}');
    sim.clock.advance(1000);
    expect(sim.host.take()).toEqual([]);
  });
});

describe('TinyG440Model: replies and settings', () => {
  it('[TG-FOOTER] footers are [1,status,length+1,checksum] with a checksum protocol accepts', () => {
    const sim = tgSim();
    sim.host.sendLine('{"fb":null}');
    sim.host.sendLine('{"nosuch":null}');
    sim.clock.advance(30);
    const r = replies(sim.host.lines());
    expect(r.map((x) => x.f.slice(0, 3))).toEqual([
      [1, 0, 12],
      [1, 100, 16],
    ]);
    for (const line of sim.host.lines()) {
      const [event] = decodeInbound([bytes(`${line}\n`)]);
      expect(event?.kind).toBe('Response');
    }
    // EN-HIL fixtures captured from a 440.20 board (tests/hil/tests/test_harness_offline.py:7-10).
    expect(checksum440('{"r":{"fb":440.20},"f":[1,0,12')).toBe(1645);
    expect(checksum440('{"r":{},"f":[1,132,5')).toBe(6965);
  });

  it('[TG-BANNER] boot prints r responses with footer revision 1: status 15, then SYSTEM READY status 0', () => {
    const sim = tgSim({ start: 'boot' });
    sim.clock.advance(1100);
    const r = replies(sim.host.lines());
    expect(r.map((x) => [x.r['msg'], x.f[1]])).toEqual([
      ['Initializing configs to default settings', 15],
      ['SYSTEM READY', 0],
    ]);
    const events = decodeInbound([bytes(sim.host.lines().map((l) => `${l}\n`).join(''))]);
    expect(events.map((e) => (e.kind === 'Banner' ? `${e.shape}:${e.ready}` : e.kind))).toEqual(['r-footer:false', 'r-footer:true']);
  });

  it('[TG-PLANNER] with fewer than 4 free buffers no line is read, JSON included', () => {
    const sim = tgSim();
    for (let i = 0; i < 28; i++) sim.host.sendLine('G4 P1');
    sim.clock.advance(100);
    expect(sim.device.snapshot().plannerAvailable).toBe(4); // still enough headroom for one more line
    sim.host.sendLine('G4 P1');
    sim.clock.advance(50);
    expect(sim.device.snapshot().plannerAvailable).toBe(3);
    sim.host.take();
    sim.host.sendLine('{"stat":null}');
    sim.clock.advance(500);
    expect(sim.host.take()).toEqual([]); // waits behind the planner
    sim.clock.advance(1000); // the first dwell ends: 4 free again
    expect(replies(sim.host.take()).map((x) => x.r)).toEqual([{ stat: 1 }]);
  });

  it('[TG-STAT] stat is the previous value while a cycle has motion stopped; 11 in SHUTDOWN', () => {
    const sim = tgSim();
    expect(get(sim, 'stat')).toBe(1);
    sim.host.sendLine('G1 X5 F600');
    sim.clock.advance(100);
    expect(sim.device.snapshot().stat).toBe(5);
    sim.clock.advance(1000);
    expect(sim.device.snapshot().stat).toBe(3);
  });

  it('[TG-SETTINGS-GATE] a settings write in a cycle emits er 9 but answers status 0; RAM changes, EEPROM does not', () => {
    const sim = tgSim();
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(300);
    sim.host.take();
    sim.host.sendLine('{"xvm":1200}');
    sim.clock.advance(30);
    const lines = sim.host.take();
    expect(exceptions(lines).map((e) => e.st)).toEqual([9]);
    expect(statuses(lines)).toEqual([0]);
    expect(sim.device.settings.get('xvm')).toBe(1200);
    expect(sim.device.settings.eeprom['xvm']).toBe(800);
  });

  it('[TG-EEPROM] settings persist across a reset; an EEPROM from another build is reset to defaults', () => {
    const eeprom = {};
    const first = tgSim({ eeprom });
    first.host.sendLine('{"xvm":700}');
    first.clock.advance(30);
    const again = tgSim({ eeprom, start: 'boot' });
    again.clock.advance(1100);
    // No "Loading configs" line: it is printed while jv is still 0 in RAM (TG config.c:134).
    expect(again.host.lines()).toHaveLength(1);
    expect(again.host.lines()[0]).toContain('SYSTEM READY');
    expect(get(again, 'xvm')).toBe(700);
    const other = tgSim({ eeprom: { __build: 449.01, xvm: 5 }, start: 'boot' });
    other.clock.advance(1100);
    expect(other.host.lines()[0]).toContain('Initializing configs');
    expect(get(other, 'xvm')).toBe(800);
  });

  it('[TG-JSON-FIRST-PAIR] only the first pair runs, the rest echo null; a tid pair is an unknown token', () => {
    const sim = tgSim();
    sim.host.sendLine('{"fv":null,"hp":null}');
    sim.host.sendLine('{"fb":null,"tid":3}');
    sim.clock.advance(30);
    const r = replies(sim.host.lines());
    expect(r[0]?.r).toEqual({ fv: 0.97, hp: null });
    expect(r[1]?.f[1]).toBe(100);
    expect(r[1]?.tid).toBeUndefined();
  });

  it('[TG-GC-WRAP-QUOTE] JSON mode: a partial G0 X1 completed by {"sr":null} moves; completed by {sr:null} it does not', () => {
    const quoted = tgSim();
    quoted.host.send('G0 X1');
    quoted.host.sendLine('{"sr":null}');
    quoted.clock.advance(2000);
    expect(statuses(quoted.host.lines())[0]).toBe(0);
    expect(quoted.device.snapshot().position[0]).not.toBe(0);

    const bare = tgSim();
    bare.host.send('G0 X1');
    bare.host.sendLine('{sr:null}');
    bare.clock.advance(2000);
    expect(statuses(bare.host.lines())[0]).not.toBe(0);
    expect(bare.device.snapshot().position.every((v) => v === 0)).toBe(true);
  });

  it('a clean {sr:null} (bare key) answers the status report', () => {
    const sim = tgSim();
    sim.host.sendLine('{sr:null}');
    sim.clock.advance(30);
    const r = replies(sim.host.lines());
    expect(r[0]?.f[1]).toBe(0);
    expect(r[0]?.r).toHaveProperty('sr');
  });

  it('[TG-E138] a GET of md de-energizes the motors', () => {
    const sim = tgSim();
    sim.host.sendLine('G1 X1 F600');
    sim.clock.advance(300);
    expect(sim.device.snapshot().motorsEnergized).toBe(true);
    sim.host.sendLine('{"md":null}');
    sim.clock.advance(30);
    expect(sim.device.snapshot().motorsEnergized).toBe(false);
    expect(sim.device.sideEffects.map((e) => `${e.what} ${e.via}`)).toEqual(['motors-deenergized GET md']);
  });

  it('[TG-GCODE-DROP-INVALID] invalid characters are deleted: X0.001*9 runs as X0.0019', () => {
    const sim = tgSim();
    sim.host.sendLine('G1 X0.001*9 F600');
    sim.clock.advance(500);
    expect(statuses(sim.host.lines())).toEqual([0]);
    expect(sim.device.snapshot().position[0]).toBeCloseTo(0.0019, 9);
    const en = enSim();
    en.host.sendLine('G1 X0.001*9 F600');
    en.clock.advance(500);
    expect(statuses(en.host.lines())).toEqual([101]); // EN keeps the * and fails the line (E161)
  });
});

describe('TinyG440Model: P0 review fidelity', () => {
  it('[TG-BANNER-JV] at jv=1 the SYSTEM READY banner has no msg; at jv=0 there is none; the classifier still sees the reset', () => {
    const one = tgSim({ eeprom: { __build: 440.21, jv: 1 }, start: 'boot' });
    one.clock.advance(1100);
    const r = replies(one.host.lines());
    expect(r).toHaveLength(1);
    expect(Object.keys(r[0]?.r ?? {}).sort()).toEqual(['fb', 'fv', 'hp', 'hv', 'id']);
    const events = decodeInbound([bytes(one.host.lines().map((l) => `${l}\n`).join(''))]);
    expect(events).toMatchObject([{ kind: 'Banner', shape: 'r-footer', ready: null, fb: 440.21 }]);
    const zero = tgSim({ eeprom: { __build: 440.21, jv: 0 }, start: 'boot' });
    zero.clock.advance(1100);
    expect(zero.host.lines()).toEqual([]);
    // Relaxed syntax applies to the banner too (it goes through json_print_response).
    const relaxed = tgSim({ eeprom: { __build: 440.21, js: 0 }, start: 'boot' });
    relaxed.clock.advance(1100);
    expect(relaxed.host.lines()[0]).toMatch(/^\{r:\{fv:/);
  });

  it('[TG-FLUSH-REPORTS] every % prints {"rx":n} (strict, whatever js), after a {"qr":n} when qv is not 0', () => {
    const sim = tgSim();
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(300);
    sim.host.send('!');
    sim.clock.advance(1500);
    sim.host.take();
    sim.host.send('%');
    sim.clock.advance(100);
    const notSr = (lines: string[]): string[] => lines.filter((l) => !l.startsWith('{"sr"') && !l.startsWith('{sr'));
    expect(notSr(sim.host.take())).toEqual(['{"rx":254}']);
    const q = tgSim({ eeprom: { __build: 440.21, qv: 1, js: 0 } });
    q.host.send('%');
    q.clock.advance(100);
    expect(notSr(q.host.take())).toEqual(['{qr:32}', '{"rx":254}']);
    const q2 = tgSim({ eeprom: { __build: 440.21, qv: 2 } });
    q2.host.send('%');
    q2.clock.advance(100);
    expect(notSr(q2.host.take())).toEqual(['{"qr":32,"qi":0,"qo":0}', '{"rx":254}']);
  });
});
