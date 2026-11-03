/**
 * TinyGEdgeNextModel (ROADMAP P0-11, RUN_PLAN §8.1). Test titles carry the
 * behaviour ids of src/honesty/behaviours.ts; test/honesty.test.ts checks
 * that every registered behaviour has at least one.
 */
import { describe, expect, it } from 'vitest';
import { exceptions, enSim, get, replies, reports, statuses } from './helpers.ts';

const ETX = '\x04';

describe('TinyGEdgeNextModel: P0-11 acceptance', () => {
  it('[EN-RT-FEEDHOLD] ! with no motion changes nothing', () => {
    const sim = enSim();
    const before = sim.device.snapshot();
    sim.host.send('!');
    sim.clock.advance(100);
    const after = sim.device.snapshot();
    expect(after.hold).toBe(0);
    expect(after.stat).toBe(before.stat);
    expect(after.motionState).toBe('stop');
    expect(sim.host.lines()).toEqual([]); // no report: nothing changed
    expect(get(sim, 'hold')).toBe(0);
  });

  it('[EN-RT-FEEDHOLD] ! during a G4 that no move started does not hold', () => {
    const sim = enSim();
    sim.host.sendLine('G4 P1');
    sim.clock.advance(200);
    expect(sim.device.snapshot().plannerAvailable).toBe(31); // the dwell is running
    sim.host.send('!');
    sim.clock.advance(100);
    expect(sim.device.snapshot().hold).toBe(0);
    expect(sim.device.snapshot().motionState).toBe('stop');
    sim.clock.advance(800);
    expect(sim.device.snapshot().plannerAvailable).toBe(32); // the dwell ran to the end
    expect(sim.device.snapshot().hold).toBe(0);
  });

  it('[EN-RT-FEEDHOLD] ! during a move holds it (the contrast case)', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(500);
    sim.host.send('!');
    sim.clock.advance(300);
    const s = sim.device.snapshot();
    expect(s.hold).toBe(6);
    expect(s.stat).toBe(6);
    expect(s.velocity).toBe(0);
    expect(s.position[0]).toBeLessThan(50);
  });

  it('[EN-RT-KILL] ^D gives stat 2 with er 207, the spindle output off at once and an empty planner', () => {
    const sim = enSim();
    sim.host.sendLine('M3 S1000');
    sim.host.sendLine('G1 X100 F600');
    sim.host.sendLine('G1 X0');
    sim.clock.advance(500);
    expect(sim.device.snapshot().spindle).toBe('cw');
    expect(sim.device.snapshot().velocity).toBeGreaterThan(0);
    sim.host.take();
    sim.host.send(ETX);
    sim.clock.advance(3); // the byte arrives and the main loop raises the alarm
    const atKill = sim.device.snapshot();
    expect(atKill.spindle).toBe('off'); // immediate, while the machine is still decelerating
    expect(atKill.stat).toBe(2);
    sim.clock.advance(400);
    const after = sim.device.snapshot();
    expect(exceptions(sim.host.take()).map((e) => e.st)).toEqual([207]);
    expect(after.stat).toBe(2);
    expect(after.velocity).toBe(0);
    expect(after.plannerAvailable).toBe(32);
    expect(get(sim, 'qr')).toBe(32);
    expect(get(sim, 'stat')).toBe(2);
  });

  it('[EN-RT-KILL] ^D during a standalone dwell stops it at once (E044 path)', () => {
    const sim = enSim();
    sim.host.sendLine('M3');
    sim.host.sendLine('G4 P5');
    sim.clock.advance(300);
    sim.host.send(ETX);
    sim.clock.advance(20);
    const s = sim.device.snapshot();
    expect(s.stat).toBe(2);
    expect(s.spindle).toBe('off');
    expect(s.plannerAvailable).toBe(32);
  });

  it('[EN-RT-FLUSH] % outside a hold is ignored: nothing is flushed and the job runs on', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X10 F600');
    sim.host.sendLine('G1 X20');
    sim.clock.advance(300);
    sim.host.send('%');
    sim.clock.advance(50);
    expect(sim.device.snapshot().plannerAvailable).toBe(30);
    expect(sim.device.sideEffects.filter((e) => e.what === 'queue-flush')).toEqual([]);
    sim.clock.advance(2500);
    expect(sim.device.snapshot().position[0]).toBe(20);
    // idle as well: still nothing
    sim.host.send('%');
    sim.clock.advance(50);
    expect(sim.device.sideEffects.filter((e) => e.what === 'queue-flush')).toEqual([]);
  });

  it('[EN-RT-FLUSH] % in a hold flushes the planner and drops only the input sent before it (E146)', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X50 F600');
    sim.host.sendLine('G1 X0');
    sim.clock.advance(400);
    sim.host.send('!');
    sim.clock.advance(300);
    expect(sim.device.snapshot().hold).toBe(6);
    sim.host.send('%{"stat":null}\n');
    sim.clock.advance(50);
    const s = sim.device.snapshot();
    expect(s.plannerAvailable).toBe(32);
    expect(s.hold).toBe(0);
    expect(replies(sim.host.lines()).some((r) => r.r['stat'] === 3)).toBe(true); // the line after the % ran
  });

  it('[EN-RT-PERCENT-MIDLINE] a % inside a line makes it a malformed-command error and nothing runs', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X5 % F100');
    sim.clock.advance(50);
    const r = replies(sim.host.lines());
    expect(r).toHaveLength(1);
    expect(r[0]?.f[1]).toBe(101);
    expect(r[0]?.r).toEqual({}); // jv=3: the gc echo is filtered on errors too (EN json_parser.c:911-925)
    sim.clock.advance(1000);
    expect(sim.device.snapshot().position[0]).toBe(0);
  });

  it('[EN-M0] M0 gives stat 3 with hold 6 and the spindle on; ~ resumes', () => {
    const sim = enSim();
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X5 F600');
    sim.host.sendLine('M0');
    sim.host.sendLine('G1 X10');
    sim.clock.advance(1500);
    const paused = sim.device.snapshot();
    expect(paused.stat).toBe(3);
    expect(paused.hold).toBe(6);
    expect(paused.spindle).toBe('cw');
    expect(paused.position[0]).toBe(5);
    sim.clock.advance(2000);
    expect(sim.device.snapshot().position[0]).toBe(5); // stays paused
    sim.host.send('~');
    sim.clock.advance(1000);
    expect(sim.device.snapshot().position[0]).toBe(10);
    expect(sim.device.snapshot().stat).toBe(3);
    expect(sim.device.snapshot().hold).toBe(0);
  });

  it('[EN-M2-CLEARS-ALARM] an M30 buffered behind the planner clears an alarm (E135)', () => {
    const sim = enSim();
    for (let i = 1; i <= 22; i++) sim.host.sendLine(`G1 X${i * 10} F600`);
    sim.clock.advance(300);
    expect(sim.device.snapshot().plannerAvailable).toBeLessThan(12); // data lines now wait in the line pool
    sim.host.sendLine('M30');
    sim.clock.advance(100);
    sim.host.take();
    sim.host.send(ETX);
    sim.clock.advance(600);
    const lines = sim.host.take();
    expect(exceptions(lines).map((e) => e.st)).toEqual([207]);
    // No {clear} was sent, yet the buffered M30 ran and cleared the alarm: the H35 hazard.
    expect(statuses(lines)).toContain(0);
    const s = sim.device.snapshot();
    expect(s.stat).toBe(4);
    expect(s.machineState).toBe('programEnd');
  });

  it('[EN-M2-CLEARS-ALARM] only a standalone program end clears: G1 X1 M30 is rejected 204', () => {
    const sim = enSim();
    sim.host.sendLine('{"alarm":null}');
    sim.host.sendLine('G1 X1 F100 M30');
    sim.host.sendLine('N7 M30');
    sim.clock.advance(100);
    const st = statuses(sim.host.lines());
    expect(st.slice(-2)).toEqual([204, 0]);
    expect(sim.device.snapshot().stat).toBe(4);
  });

  it('[EN-E162] an injected overrun answers 13 for the damaged line and the line that follows the loss; ALARM 13', () => {
    // Bytes 13.. are the second line; losing byte 15 cuts it in two.
    const sim = enSim({}, { faults: { faults: [{ kind: 'ringOverrun', atByte: 15 }] } });
    sim.host.send('{"stat":null}\nG1 X1 F600\nG1 X2\n');
    sim.clock.advance(100);
    const lines = sim.host.lines();
    expect(statuses(lines)).toEqual([0, 13, 13, 204]);
    expect(exceptions(lines).map((e) => e.st)).toEqual([13]);
    expect(sim.device.snapshot().stat).toBe(2);
    sim.clock.advance(500);
    expect(sim.device.snapshot().position[0]).toBe(0); // nothing spliced ran
  });

  it('[EN-E162] a real overrun with flow control off never runs a spliced line (EN-HIL test_e162, char mode)', () => {
    const sim = enSim();
    sim.host.sendLine('{"rxm":0}');
    sim.host.sendLine('{"ex":0}');
    sim.clock.advance(50);
    for (let i = 0; i < 40; i++) sim.host.sendLine('G4 P0.1'); // fills the planner: data lines wait
    sim.clock.advance(200);
    sim.host.take();
    const burst = Array.from({ length: 60 }, (_, k) => `G4 P0.${'0'.repeat(k % 5)}${(k % 9) + 1}`);
    sim.host.send(burst.map((l) => `${l}\n`).join(''));
    sim.clock.advance(12_000);
    const lines = sim.host.take();
    const lengths = new Set(burst.map((l) => l.length + 1));
    const r = replies(lines);
    const okLengths = r.filter((x) => x.f[1] === 0).map((x) => x.f[2]);
    expect(exceptions(lines).map((e) => e.st)).toContain(13);
    expect(r.some((x) => x.f[1] === 13)).toBe(true);
    for (const n of okLengths) expect(lengths.has(n as number)).toBe(true); // no OK reply of a length no sent line has
  });

  it('[EN-SETTINGS-GATE] a settings write during a cycle answers 106 plus an er; RAM changed, EEPROM not', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(300);
    sim.host.take();
    sim.host.sendLine('{"xvm":1200}');
    sim.clock.advance(30);
    const lines = sim.host.take();
    expect(exceptions(lines)).toEqual([{ fb: 450.01, st: 106, msg: "COMMAND_NOT_ACCEPTED - Can't save when moving" }]);
    expect(statuses(lines)).toEqual([106]);
    expect(sim.device.settings.get('xvm')).toBe(1200);
    expect(sim.device.settings.eeprom['xvm']).toBe(800);
    sim.clock.advance(6000);
    sim.host.sendLine('{"xvm":1300}');
    sim.clock.advance(30);
    expect(sim.device.settings.eeprom['xvm']).toBe(1300);
  });

  it('[EN-EEPROM-STALL] a persisted write stalls the board: its answer waits for the EEPROM write, and bytes sent meanwhile are lost', () => {
    const sim = enSim({ eepromWriteMs: 40 });
    sim.host.sendLine('{"xvm":1234}');
    sim.clock.advance(5);
    // The write is being saved: no answer yet, and a GET sent now is lost.
    expect(replies(sim.host.take())).toEqual([]);
    sim.host.sendLine('{"xfr":null}');
    sim.clock.advance(60);
    const lines = sim.host.take();
    expect(statuses(lines)).toEqual([0]);
    expect(replies(lines)[0]?.r).toEqual({ xvm: 1234 });
    expect(sim.device.settings.eeprom['xvm']).toBe(1234);
    expect(sim.device.eepromWrites).toBe(1);
    expect(sim.device.eepromLostBytes).toBe('{"xfr":null}\n'.length);
    // After the stall the board answers again; a write that changes nothing in EEPROM does not stall.
    sim.host.sendLine('{"xvm":1234}');
    sim.clock.advance(30);
    expect(statuses(sim.host.take())).toEqual([0]);
    expect(sim.device.eepromWrites).toBe(1);
    // Off by default: existing transcripts are unchanged.
    const plain = enSim();
    plain.host.sendLine('{"xvm":1300}');
    plain.clock.advance(30);
    expect(statuses(plain.host.take())).toEqual([0]);
  });

  it('[EN-E138] a GET of md sets the motors-de-energized flag', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X1 F600');
    sim.clock.advance(300);
    expect(sim.device.snapshot().motorsEnergized).toBe(true);
    sim.host.sendLine('{"md":null}');
    sim.clock.advance(30);
    expect(sim.device.snapshot().motorsEnergized).toBe(false);
    expect(sim.device.sideEffects.map((e) => `${e.what} ${e.via}`)).toContain('motors-deenergized GET md');
  });
});

describe('TinyGEdgeNextModel: receive path', () => {
  it('[EN-RX-RING] the ring holds 248 bytes; with the planner and line pool full, more bytes are lost', () => {
    const sim = enSim();
    sim.host.sendLine('{"ex":0}');
    for (let i = 0; i < 21; i++) sim.host.sendLine('G4 P1');
    sim.clock.advance(100);
    // 12 headers take the next lines; then the ring fills and overflows.
    sim.host.send('G4 P0.01 (pad pad pad pad pad pad)\n'.repeat(30));
    sim.clock.advance(200);
    expect(sim.device.snapshot().rxCount).toBe(248);
    expect(exceptions(sim.host.lines())).toEqual([]);
    sim.clock.advance(30_000); // the reader reaches the loss when the planner drains (E162)
    expect(exceptions(sim.host.lines()).map((e) => e.st)).toEqual([13]);
  });

  it('[EN-RX-XOFF] with ex=1 the board sends XOFF above 75 bytes and XON below 37.5', () => {
    const sim = enSim();
    for (let i = 0; i < 21; i++) sim.host.sendLine('G4 P0.2');
    sim.clock.advance(50);
    sim.host.send('G4 P0.2 (comment to fill the ring quickly)\n'.repeat(14));
    sim.clock.advance(100);
    expect(sim.host.flow.map((f) => f.signal)).toEqual(['xoff']);
    expect(sim.device.snapshot().rxCount).toBeGreaterThan(75);
    sim.clock.advance(15_000);
    expect(sim.host.flow.map((f) => f.signal)).toEqual(['xoff', 'xon']);
  });

  it('[EN-RX-LINEMODE] control lines are answered while the planner is full; data lines wait their turn', () => {
    const sim = enSim();
    for (let i = 0; i < 21; i++) sim.host.sendLine('G4 P1');
    sim.clock.advance(100);
    sim.host.take();
    sim.host.sendLine('G1 X1 F600'); // data: waits for planner headroom
    sim.host.sendLine('{"stat":null}'); // control: overtakes it
    sim.clock.advance(50);
    const r = replies(sim.host.take());
    expect(r).toHaveLength(1);
    expect(r[0]?.r).toEqual({ stat: 1 });
    sim.clock.advance(25_000);
    expect(sim.device.snapshot().position[0]).toBe(1);
  });

  it('[EN-FOOTER] line mode reports free line headers; they fall as lines wait', () => {
    const sim = enSim();
    for (let i = 0; i < 21; i++) sim.host.sendLine('G4 P1');
    sim.clock.advance(100);
    sim.host.take();
    for (let i = 0; i < 4; i++) sim.host.sendLine('G4 P1');
    sim.host.sendLine('{"stat":null}');
    sim.clock.advance(50);
    const f = replies(sim.host.take())[0]?.f;
    expect(f?.[0]).toBe(3);
    expect(f?.[2]).toBe(7); // 12 headers - 4 lines waiting - this line (PROCESSING)
  });

  it('[EN-FOOTER] character mode reports the bytes read since the previous reply, blank lines included (E164)', () => {
    const sim = enSim();
    sim.host.sendLine('{"rxm":0}');
    sim.clock.advance(20);
    sim.host.take();
    sim.host.send('{"stat":null}\r\n');
    sim.clock.advance(20);
    sim.host.send('{"stat":null}\n');
    sim.clock.advance(20);
    const f = replies(sim.host.take()).map((x) => x.f);
    expect(f[0]).toEqual([2, 0, 14]);
    expect(f[1]).toEqual([2, 0, 15]); // the LF of the CRLF rides on the next reply
  });

  it('[EN-BANNER] boot prints bare sr banners, strict JSON, with no footer', () => {
    const sim = enSim({ start: 'boot', id: 'BENCH-EN' });
    sim.clock.advance(1100);
    expect(sim.host.lines()).toEqual([
      '{"sr":{"fv":0.970,"fb":450.01,"hp":1,"hv":8,"id":"BENCH-EN","msg":"Initializing configs to default settings"}}',
      '{"sr":{"fv":0.970,"fb":450.01,"hp":1,"hv":8,"id":"BENCH-EN","msg":"SYSTEM READY"}}',
    ]);
  });

  it('[EN-TID] a top-level tid is echoed at the top level, on errors too', () => {
    const sim = enSim();
    sim.host.sendLine('{"fb":null,"tid":33}');
    sim.host.sendLine('{"nosuch":null,"tid":17}');
    sim.host.sendLine('{"tid":5,"stat":null}');
    sim.host.sendLine('{"stat":null,"tid":-1}');
    sim.clock.advance(50);
    const r = replies(sim.host.lines());
    expect(r.map((x) => x.line)).toEqual([
      '{"r":{"fb":450.01},"tid":33,"f":[3,0,10]}',
      '{"r":{},"tid":17,"f":[3,100,10]}',
      '{"r":{"stat":1},"tid":5,"f":[3,0,10]}',
      '{"r":{"stat":1},"f":[3,0,10]}',
    ]);
  });

  it('[EN-JSON-PAIRS] every pair of a multi-pair line runs', () => {
    const sim = enSim();
    sim.host.sendLine('{"fb":null,"fv":null,"hp":null}');
    sim.clock.advance(20);
    expect(replies(sim.host.lines())[0]?.r).toEqual({ fb: 450.01, fv: 0.97, hp: 1 });
  });

  it('[EN-TEXT-MODE] $ switches to text mode, { switches back, and a stray ? before a line is stripped (E053)', () => {
    const sim = enSim();
    sim.host.sendLine('$');
    sim.clock.advance(20);
    expect(sim.host.take()).toEqual(['tinyg [mm] ok>']);
    sim.host.sendLine('G21');
    sim.clock.advance(20);
    expect(sim.host.take()).toEqual(['tinyg [mm] ok>']);
    sim.host.sendLine('{"stat":null}');
    sim.host.sendLine('?{"fb":null}');
    sim.clock.advance(20);
    expect(replies(sim.host.take()).map((r) => r.r)).toEqual([{ stat: 1 }, { fb: 450.01 }]);
  });

  it('[EN-OVERLONG] a 255-character line is answered 107 once, never runs, and raises no alarm', () => {
    const sim = enSim();
    sim.host.sendLine(`G1 X1 F600 (${'x'.repeat(260)})`);
    sim.host.sendLine('{"stat":null}');
    sim.clock.advance(100);
    expect(statuses(sim.host.lines())).toEqual([107, 0]);
    expect(sim.device.snapshot().stat).toBe(1);
    expect(sim.device.snapshot().position[0]).toBe(0);
  });
});

describe('TinyGEdgeNextModel: planner and states', () => {
  it('[EN-PLANNER] a data line waits until 12 buffers are free; the cycle ends when the planner empties', () => {
    const sim = enSim();
    for (let i = 0; i < 21; i++) sim.host.sendLine(`G4 P0.1`);
    sim.host.sendLine('G4 P0.1');
    sim.clock.advance(50);
    expect(sim.device.snapshot().plannerAvailable).toBe(11); // 21 queued; the 22nd waits
    expect(statuses(sim.host.lines())).toHaveLength(21);
    sim.clock.advance(200);
    expect(statuses(sim.host.lines())).toHaveLength(22);
  });

  it('[EN-STARTUP-DELAY] the first move waits 50 ms; a ! in that window holds at once', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X10 F600');
    sim.clock.advance(40);
    expect(sim.device.snapshot().position[0]).toBe(0);
    sim.clock.advance(30);
    expect(sim.device.snapshot().position[0]).toBeGreaterThan(0);

    const held = enSim();
    held.host.sendLine('G1 X10 F600');
    held.clock.advance(20);
    held.host.send('!');
    held.clock.advance(5);
    expect(held.device.snapshot().hold).toBe(6);
    held.clock.advance(500);
    expect(held.device.snapshot().position[0]).toBe(0);
  });

  it('[EN-STAT] stat follows the combined state: 1, 5, 6, 3, 4, 2', () => {
    const sim = enSim();
    expect(get(sim, 'stat')).toBe(1);
    sim.host.sendLine('G1 X20 F600');
    sim.clock.advance(200);
    expect(sim.device.snapshot().stat).toBe(5);
    sim.host.send('!');
    sim.clock.advance(300);
    expect(sim.device.snapshot().stat).toBe(6);
    sim.host.send('~');
    sim.clock.advance(3000);
    expect(sim.device.snapshot().stat).toBe(3);
    sim.host.sendLine('M2');
    sim.clock.advance(50);
    expect(sim.device.snapshot().stat).toBe(4);
    sim.host.sendLine('{"alarm":null}');
    sim.clock.advance(50);
    expect(sim.device.snapshot().stat).toBe(2);
  });

  it('[EN-SPINDLE-QUEUED] M3 and M5 switch the output in queue order, behind earlier moves', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X10 F600');
    sim.host.sendLine('M3');
    sim.clock.advance(500);
    expect(sim.device.snapshot().spindle).toBe('off'); // still behind the move
    sim.clock.advance(1000);
    expect(sim.device.snapshot().spindle).toBe('cw');
    sim.host.sendLine('G1 X0');
    sim.host.sendLine('M5');
    sim.clock.advance(300);
    sim.host.send('!');
    sim.clock.advance(1000);
    expect(sim.device.snapshot().spindle).toBe('cw'); // an M5 during a hold waits behind the held move
  });

  it('[EN-SPINDLE-READOUTS] spe, spc, spd, sps, cof and com report the outputs as last driven', () => {
    const sim = enSim();
    expect([get(sim, 'spe'), get(sim, 'spc'), get(sim, 'spd'), get(sim, 'sps'), get(sim, 'cof'), get(sim, 'com')]).toEqual([0, 0, 0, 0, 0, 0]);
    sim.host.sendLine('G1 X10 F600');
    sim.host.sendLine('M4 S12000');
    sim.host.sendLine('M8');
    sim.clock.advance(300);
    expect(get(sim, 'spe')).toBe(0); // queued behind the move: the output is not driven yet
    sim.clock.advance(1500);
    expect([get(sim, 'spe'), get(sim, 'spc'), get(sim, 'spd'), get(sim, 'cof'), get(sim, 'com')]).toEqual([1, 2, 1, 1, 0]);
    expect(get(sim, 'sps')).toBeGreaterThan(0);
    sim.host.sendLine('M5');
    sim.host.sendLine('M9');
    sim.clock.advance(100);
    expect([get(sim, 'spe'), get(sim, 'spc'), get(sim, 'spd'), get(sim, 'sps'), get(sim, 'cof')]).toEqual([0, 0, 1, 0, 0]); // spd keeps CCW while off
  });

  it('[EN-PROGRAM-END] M2 turns the spindle and coolant off in queue order and ends the program', () => {
    const sim = enSim();
    sim.host.sendLine('M3');
    sim.host.sendLine('M8');
    sim.host.sendLine('G1 X5 F600');
    sim.host.sendLine('M2');
    sim.clock.advance(200);
    expect(sim.device.snapshot().spindle).toBe('cw');
    expect(sim.device.snapshot().coolant.flood).toBe(true);
    sim.clock.advance(1000);
    const s = sim.device.snapshot();
    expect(s.spindle).toBe('off');
    expect(s.coolant.flood).toBe(false);
    expect(s.stat).toBe(4);
  });

  it('[EN-M1-OS] M1 stops only with os=1', () => {
    const off = enSim();
    off.host.sendLine('G1 X2 F600');
    off.host.sendLine('M1');
    off.host.sendLine('G1 X4');
    off.clock.advance(1500);
    expect(off.device.snapshot().position[0]).toBe(4);

    const on = enSim();
    on.host.sendLine('{"os":1}');
    on.host.sendLine('G1 X2 F600');
    on.host.sendLine('M1');
    on.host.sendLine('G1 X4');
    on.clock.advance(1500);
    expect(on.device.snapshot().position[0]).toBe(2);
    expect(on.device.snapshot().hold).toBe(6);
  });

  it('[EN-M400] the M400 reply waits for the drain; control lines answer meanwhile; it must be alone', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X5 F600');
    sim.host.sendLine('M400');
    sim.clock.advance(100);
    sim.host.sendLine('{"stat":null}');
    sim.clock.advance(50);
    expect(replies(sim.host.lines()).map((r) => r.r)).toEqual([{}, { stat: 5 }]);
    sim.clock.advance(1000);
    const r = replies(sim.host.lines());
    expect(r.at(-1)?.r).toEqual({ gc: 'M400' });
    expect(r.at(-1)?.f[1]).toBe(0);
    sim.host.sendLine('G1 X1 M400');
    sim.host.sendLine('N10 M400');
    sim.clock.advance(50);
    expect(statuses(sim.host.lines()).slice(-2)).toEqual([106, 0]);
  });

  it('[EN-M400] an alarm while M400 waits answers it with 204', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X50 F600');
    sim.host.sendLine('{"gc":"M400","tid":9}');
    sim.clock.advance(200);
    sim.host.send(ETX);
    sim.clock.advance(400);
    const last = replies(sim.host.lines()).at(-1);
    expect(last?.r).toEqual({ gc: 'M400' });
    expect(last?.tid).toBe(9);
    expect(last?.f[1]).toBe(204);
  });

  it('[EN-SR] filtered status reports send only changed values, si ms after the first request, sampled when printed', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X10 F600');
    sim.clock.advance(1300);
    const sr = reports(sim.host.lines());
    // The first change (the G1 parsed) requests a report; it prints si = 250 ms later with the values then.
    expect(sr[0]).toEqual({ posx: 2, feed: 600, vel: 600, momo: 1, stat: 5 });
    expect(sr.at(-1)).toEqual({ posx: 10, vel: 0, stat: 3 });
    const times = sim.host.timedLines().filter((l) => l.text.startsWith('{"sr"')).map((l) => l.t);
    // si is enforced at the board; arrival times at the host also carry the line's serialisation time.
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(240);
  });
});

describe('TinyGEdgeNextModel: realtime bytes', () => {
  it('[EN-RT-TRAP] ! inside a line is trapped (the line still runs); ~ inside a line reaches the parser', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X5 F600');
    sim.clock.advance(200);
    sim.host.send('G1 X1!0\n');
    sim.clock.advance(300);
    expect(sim.device.snapshot().hold).toBe(6);
    expect(sim.device.snapshot().plannerAvailable).toBe(30); // G1 X10 was queued
    sim.host.take();
    sim.host.sendLine('{"stat":null}~');
    sim.clock.advance(50);
    expect(statuses(sim.host.take())).toEqual([111]); // the ~ made the JSON invalid
    expect(sim.device.snapshot().hold).toBe(6);
  });

  it('[EN-RT-ENQ] ENQ is answered {"ack":true} even with the planner full', () => {
    const sim = enSim();
    for (let i = 0; i < 24; i++) sim.host.sendLine('G4 P1');
    sim.clock.advance(100);
    sim.host.take();
    sim.host.send('\x05');
    sim.clock.advance(5);
    expect(sim.host.take()).toEqual(['{"ack":true}']);
  });

  it('[EN-RT-RESET] ^X stops everything at once and reboots after the watchdog; persisted settings survive', () => {
    const sim = enSim();
    sim.host.sendLine('{"xvm":900}');
    sim.host.sendLine('{"os":1}');
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(500);
    sim.host.take();
    sim.host.send('\x18');
    sim.clock.advance(5);
    const stopped = sim.device.snapshot();
    expect(stopped.velocity).toBe(0); // interrupts off: the steppers stop at once
    expect(stopped.position[0]).toBeGreaterThan(0);
    sim.clock.advance(8);
    expect(sim.device.snapshot().position).toEqual(stopped.position);
    expect(sim.host.take()).toEqual([]); // nothing more is reported before the reboot
    sim.clock.advance(1100);
    const lines = sim.host.take();
    expect(lines.at(-1)).toContain('SYSTEM READY');
    expect(lines.at(-2)).toContain('Loading configs from EEPROM');
    const s = sim.device.snapshot();
    expect(s.spindle).toBe('off');
    expect(s.stat).toBe(1);
    expect(get(sim, 'xvm')).toBe(900); // [EN-EEPROM] persisted
    expect(get(sim, 'os')).toBe(0); // session-only
  });
});

describe('TinyGEdgeNextModel: alarms', () => {
  it('[EN-ALARM] an alarm while moving holds then flushes; G-code is rejected 204 and GETs still answer', () => {
    const sim = enSim();
    sim.host.sendLine('M8');
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(400);
    sim.host.sendLine('{"alarm":null}');
    sim.clock.advance(5);
    expect(sim.device.snapshot().coolant.flood).toBe(false);
    sim.clock.advance(300);
    expect(sim.device.snapshot().plannerAvailable).toBe(32);
    sim.host.take();
    sim.host.sendLine('G1 X1');
    sim.host.sendLine('{"stat":null}');
    sim.clock.advance(50);
    expect(statuses(sim.host.take())).toEqual([204, 0]);
  });

  it('[EN-SET-ALARMED] SETs are rejected while alarmed; {clear:null} (a GET) clears', () => {
    const sim = enSim();
    sim.host.sendLine('{"alarm":null}');
    sim.host.sendLine('{"xvm":1000}');
    sim.host.sendLine('{"clear":true}');
    sim.host.sendLine('{"clear":null}');
    sim.host.sendLine('{"xvm":1000}');
    sim.clock.advance(50);
    expect(statuses(sim.host.lines())).toEqual([0, 204, 204, 0, 0]);
    expect(sim.device.snapshot().stat).toBe(3);
  });

  it('[EN-OUTPUTS-INHIBITED] a queued M3 that the runtime reaches after an alarm leaves the spindle off', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X1 F600');
    sim.host.sendLine('G4 P0.5');
    sim.host.sendLine('M3');
    sim.host.sendLine('G1 X40');
    sim.clock.advance(300); // in the dwell, after a move: motion is RUN
    sim.host.sendLine('{"alarm":null}');
    sim.clock.advance(600); // the dwell ends and the queued M3 runs
    expect(sim.device.snapshot().spindle).toBe('off');
    expect(sim.device.snapshot().stat).toBe(2);
  });

  it('[EN-CYCLE-END-ALARM] an alarm raised in the last dwell of a cycle is overwritten by the cycle end', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X1 F600');
    sim.host.sendLine('G4 P0.5');
    sim.clock.advance(300);
    sim.host.send(ETX);
    sim.clock.advance(10);
    expect(sim.device.snapshot().stat).toBe(2);
    sim.clock.advance(600);
    expect(exceptions(sim.host.lines()).map((e) => e.st)).toEqual([207]);
    expect(sim.device.snapshot().stat).toBe(3); // the er 207 is the only lasting evidence
  });

  it('[EN-LIMIT] a limit switch raises ALARM 203 and un-homes every axis', () => {
    const sim = enSim({}, { faults: { faults: [{ kind: 'alarm', atMs: 300, cause: 'limitSwitch' }] } });
    sim.device.setHomed(['x', 'y', 'z']);
    sim.host.sendLine('G1 X50 F600');
    sim.clock.advance(600);
    expect(exceptions(sim.host.lines()).map((e) => e.st)).toEqual([203]);
    const s = sim.device.snapshot();
    expect(s.stat).toBe(2);
    expect(s.homed).toEqual([false, false, false, false, false, false]);
    expect(s.velocity).toBe(0);
  });

  it('[EN-SHUTDOWN] SHUTDOWN is stat 12 and {clear} returns it to READY', () => {
    const sim = enSim();
    sim.host.sendLine('{"shutd":null}');
    sim.clock.advance(30);
    expect(sim.device.snapshot().stat).toBe(12);
    sim.host.sendLine('G1 X1 F100');
    sim.host.sendLine('{"clear":null}');
    sim.clock.advance(30);
    expect(statuses(sim.host.lines()).slice(-2)).toEqual([205, 0]);
    expect(sim.device.snapshot().stat).toBe(1);
  });

  it('[EN-PANIC] PANIC is stat 13; {clear} does not leave it; ^X does', () => {
    const sim = enSim();
    sim.host.sendLine('{"panic":null}');
    sim.host.sendLine('{"clear":null}');
    sim.clock.advance(30);
    expect(sim.device.snapshot().stat).toBe(13);
    sim.host.send('\x18');
    sim.clock.advance(1100);
    expect(sim.device.snapshot().stat).toBe(1);
  });

  it('[EN-SOFT-LIMITS] with sl=1 a straight move past the travel of a homed axis is an alarm, not a move', () => {
    const sim = enSim();
    sim.host.sendLine('{"sl":1}');
    sim.clock.advance(20);
    sim.device.setHomed(['x', 'y', 'z']);
    sim.host.sendLine('G1 X200 F600');
    sim.clock.advance(500);
    expect(statuses(sim.host.lines()).at(-1)).toBe(220);
    expect(exceptions(sim.host.lines()).map((e) => e.st)).toEqual([220]);
    expect(sim.device.snapshot().position[0]).toBe(0);
  });

  it('[EN-ARC-SOFT-LIMITS] an arc whose sweep leaves the travel is an alarm even with both ends inside', () => {
    const sim = enSim();
    sim.host.sendLine('{"sl":1}');
    sim.host.sendLine('G0 X5 Y10');
    sim.clock.advance(3000);
    sim.device.setHomed(['x', 'y', 'z']);
    sim.host.take();
    // Half circles around (5,20), radius 10, both ends inside the 0..150 travel.
    // G3 from the bottom turns right through X=15: inside.
    sim.host.sendLine('G3 X5 Y30 I0 J10 F600');
    sim.clock.advance(50);
    expect(statuses(sim.host.take())).toEqual([0]);
    sim.clock.advance(5000);
    expect(sim.device.snapshot().position[1]).toBeCloseTo(30, 6);
    // G3 from the top turns left through X=-5: outside.
    sim.host.sendLine('G3 X5 Y10 I0 J-10');
    sim.clock.advance(50);
    const after = sim.host.take();
    expect(exceptions(after).map((e) => e.st)).toEqual([220]);
    expect(statuses(after)).toEqual([220]);
    sim.clock.advance(5000);
    expect(sim.device.snapshot().position[1]).toBeCloseTo(30, 6); // it never moved
  });
});

describe('TinyGEdgeNextModel: settings and reads', () => {
  it('[EN-E138] GETs of alarm, shutd and er act; ordinary GETs do not', () => {
    const sim = enSim();
    for (const k of ['stat', 'fb', 'qr', 'posx', 'mpox', 'xvm']) sim.host.sendLine(`{"${k}":null}`);
    sim.clock.advance(50);
    expect(sim.device.sideEffects).toEqual([]);
    sim.host.sendLine('{"er":null}');
    sim.clock.advance(20);
    expect(exceptions(sim.host.lines()).map((e) => e.st)).toEqual([29]);
    sim.host.sendLine('{"alarm":null}');
    sim.clock.advance(20);
    expect(sim.device.snapshot().stat).toBe(2);
    expect(sim.device.sideEffects.map((e) => e.what)).toEqual(['fake-exception', 'alarm']);
  });

  it('[EN-SPPH-STUB] spph answers 17; the capability tokens answer values', () => {
    const sim = enSim();
    for (const k of ['spph', 'spep', 'prbp', 'fstk', 'os']) sim.host.sendLine(`{"${k}":null}`);
    sim.clock.advance(50);
    expect(replies(sim.host.lines()).map((r) => [r.f[1], Object.keys(r.r)])).toEqual([
      [17, []],
      [0, ['spep']],
      [0, ['prbp']],
      [0, ['fstk']],
      [0, ['os']],
    ]);
  });

  it('[EN-EEPROM] persisted settings survive a power cycle; an image with another layout is replaced by defaults', () => {
    const eeprom = {};
    const first = enSim({ eeprom });
    first.host.sendLine('{"xvm":700}');
    first.clock.advance(20);
    const second = enSim({ eeprom, start: 'boot' });
    second.clock.advance(1100);
    expect(second.host.lines()[0]).toContain('Loading configs from EEPROM');
    expect(get(second, 'xvm')).toBe(700);
    const foreign = enSim({ eeprom: { __layout: 1, xvm: 5 }, start: 'boot' });
    foreign.clock.advance(1100);
    expect(foreign.host.lines()[0]).toContain('Initializing configs');
    expect(get(foreign, 'xvm')).toBe(800);
  });
});

describe('TinyGEdgeNextModel: P0 review fidelity', () => {
  it('[EN-GC-ECHO] a failing G-code line at the default jv=3 gets an empty r; only jv=5 echoes gc', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X1 F-5');
    sim.host.sendLine('{"gc":"G1 X1 F-5"}');
    sim.clock.advance(50);
    const r = replies(sim.host.take());
    expect(r.map((x) => x.f[1] !== 0)).toEqual([true, true]);
    expect(r.map((x) => x.r)).toEqual([{}, {}]);
    sim.host.sendLine('{"jv":5}');
    sim.clock.advance(30);
    sim.host.take();
    sim.host.sendLine('G1 X1 F-5');
    sim.host.sendLine('G0 X0');
    sim.clock.advance(50);
    expect(replies(sim.host.take()).map((x) => x.r['gc'])).toEqual(['G1 X1 F-5', 'G0 X0']);
  });

  it('[EN-REPLY-OVERFLOW] a reply too big for the output buffer becomes {"r":{}} with 13; the command ran', () => {
    const sim = enSim();
    sim.host.sendLine('{"sys":null,"x":null,"y":null}');
    sim.clock.advance(50);
    const lines = sim.host.take();
    expect(lines).toEqual(['{"r":{},"f":[3,13,10]}']);
    expect(exceptions(lines)).toEqual([]);
    expect(sim.device.snapshot().stat).not.toBe(2);
    // A SET that overflows has still been applied: resending it would apply it twice.
    sim.host.sendLine('{"xvm":1234,"sys":null,"x":null,"y":null}');
    sim.clock.advance(50);
    expect(replies(sim.host.take()).map((x) => [x.r, x.f[1]])).toEqual([[{}, 13]]);
    expect(get(sim, 'xvm')).toBe(1234);
    // A reply that fits is untouched.
    sim.host.sendLine('{"x":null}');
    sim.clock.advance(50);
    expect(replies(sim.host.take())[0]?.f[1]).toBe(0);
  });
});
