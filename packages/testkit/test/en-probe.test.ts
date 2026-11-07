/**
 * Edge-next model: G38.2 probing (cycle_probing.c), the probe input (switch.c) and the simulated plate and lead
 * (probing.ts). Behaviours EN-PROBE-* (STATUS.md).
 */
import { describe, expect, it } from 'vitest';
import type { TinyGModelOptions } from '../src/firmware/common.ts';
import { enSim, exceptions, get, replies, reports, statuses } from './helpers.ts';

const BUILD = { fb: 450.02, fv: 0.97, hv: 8, layout: 10002 };
const PROBE_EEPROM = { __layout: 10002, zsn: 4, zjh: 40, prbp: 0 };

function probeSim(options: TinyGModelOptions = {}) {
  const sim = enSim({ build: BUILD, ...options, eeprom: { ...PROBE_EEPROM, ...options.eeprom } });
  sim.clock.advance(10);
  return sim;
}

interface Prb {
  readonly e: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function prbLines(lines: readonly string[]): Prb[] {
  return lines.filter((l) => l.startsWith('{"prb"')).map((l) => (JSON.parse(l) as { prb: Prb }).prb);
}

type ProbeSim = ReturnType<typeof probeSim>;

/** Sends a line, runs the clock, and returns the lines received meanwhile. */
function send(sim: ProbeSim, line: string, ms = 30): string[] {
  const from = sim.host.lines().length;
  sim.host.sendLine(line);
  sim.clock.advance(ms);
  return sim.host.lines().slice(from);
}

describe('the probe input and the plate', () => {
  it('[EN-PROBE-INPUT] in5 reads the plate: 0 clear, 1 touching; a lead that is off reads 0 (prbp 0) or 1 (prbp 1)', () => {
    const sim = probeSim();
    expect(get(sim, 'in5')).toBe(0);
    sim.device.setProbeTouch(true);
    expect(get(sim, 'in5')).toBe(1);
    sim.device.setProbeTouch(false);
    sim.device.setProbePlate(0);
    expect(get(sim, 'in5')).toBe(1); // the tool is at the plate's top
    sim.device.setProbePlate(-1);
    expect(get(sim, 'in5')).toBe(0);
    sim.device.setProbeTouch(true);
    sim.device.setProbeLead(false);
    expect(get(sim, 'in5')).toBe(0);
    const nc = probeSim({ eeprom: { prbp: 1 } });
    nc.device.setProbeLead(false);
    expect(get(nc, 'in5')).toBe(1);
    nc.device.setProbeLead(true);
    expect(get(nc, 'in5')).toBe(0);
    // An input that is not in probe mode keeps the test's own input states.
    expect(get(sim, 'in1')).toBe(0);
    const driven = probeSim({ inputs: (n) => (n === 1 ? 1 : 0) });
    expect(get(driven, 'in1')).toBe(1);
  });

  it('[EN-PROBE-SWITCH] G38.2 needs exactly one probe input on X, Y or Z: none 252, several 253, on A 254; nothing moves', () => {
    for (const [eeprom, st] of [
      [{ zsn: 0 }, 252],
      [{ zsn: 4, xsx: 4 }, 253],
      [{ zsn: 4, asn: 4 }, 254],
      [{ zsn: 0, asx: 4 }, 254],
    ] as const) {
      const sim = probeSim({ eeprom });
      expect(statuses(send(sim, 'G91 G38.2 Z-5 F100')), JSON.stringify(eeprom)).toEqual([st]);
      sim.clock.advance(1000);
      expect(sim.device.snapshot().position[2]).toBe(0);
      expect(exceptions(sim.host.lines())).toEqual([]);
    }
  });
});

describe('G38.2 command checks', () => {
  it('[EN-PROBE-COMMAND] reply-only refusals in the source order: no F 142, A word 135, no axis 134, short travel 251', () => {
    const cases: readonly (readonly [string, number])[] = [
      ['G91 G38.2 Z-5', 142],
      ['G91 G38.2 Z-5 A1 F100', 135],
      ['G38.2 F100', 134],
      ['G91 G38.2 Z-0.2 F100', 251],
      ['G20 G91 G38.2 Z-0.009 F4', 251],
    ];
    for (const [line, st] of cases) {
      const sim = probeSim();
      expect(statuses(send(sim, line)), line).toEqual([st]);
      sim.clock.advance(500);
      expect(exceptions(sim.host.lines()), line).toEqual([]);
      expect(sim.device.snapshot().stat, line).toBe(1);
    }
    // F is modal: a G38.2 without F after an F is accepted. G20 travel counts in mm (0.01 in = 0.254 mm).
    const sim = probeSim();
    sim.device.setProbePlate(-2);
    send(sim, 'G1 F100');
    expect(statuses(send(sim, 'G91 G38.2 Z-5'))).toEqual([0]);
    const inch = probeSim();
    inch.device.setProbePlate(-2);
    expect(statuses(send(inch, 'G20 G91 G38.2 Z-0.2 F4'))).toEqual([0]);
  });

  it('[EN-PROBE-STAT] stat is 7 through the cycle, the hold after contact included, then 3', () => {
    const sim = probeSim();
    sim.device.setProbePlate(-1);
    expect(statuses(send(sim, 'G91 G38.2 Z-5 F100', 5))).toEqual([0]);
    sim.clock.advance(100);
    expect(sim.device.snapshot().stat).toBe(7);
    expect(get(sim, 'cycs')).toBe(3);
    let sawHeld = false;
    for (let i = 0; i < 200 && sim.device.snapshot().stat === 7; i++) {
      if (sim.device.snapshot().hold !== 0) sawHeld = true;
      sim.clock.advance(5);
    }
    expect(sawHeld).toBe(true);
    sim.clock.advance(200);
    expect(sim.device.snapshot().stat).toBe(3);
    expect(reports(sim.host.lines()).some((r) => r['stat'] === 7)).toBe(true);
  });
});

describe('G38.2 cycle', () => {
  it('[EN-PROBE-CONTACT-HOLD] contact holds normally: Z stops a little below the plate and stays there', () => {
    const sim = probeSim();
    sim.device.setProbePlate(-2);
    send(sim, 'G91 G38.2 Z-5 F100', 3000);
    const z = sim.device.snapshot().position[2] as number;
    expect(z).toBeLessThan(-2);
    expect(z).toBeGreaterThan(-2.1);
    sim.clock.advance(1000);
    expect(sim.device.snapshot().position[2]).toBe(z);
  });

  it('[EN-PROBE-REPORT] contact: one unsolicited prb line, e=1, the position after the stop in work coordinates (450.02), then G91 kept and motion cancelled', () => {
    const sim = probeSim();
    send(sim, 'G10 L20 P1 Z10');
    sim.device.setProbePlate(-2);
    const lines = send(sim, 'G91 G38.2 Z-5 F100', 3000);
    const prb = prbLines(lines);
    expect(prb).toHaveLength(1);
    expect(prb[0]?.e).toBe(1);
    const mpoz = sim.device.snapshot().position[2] as number;
    expect(prb[0]?.z).toBeCloseTo(mpoz + 10, 3);
    expect(lines.find((l) => l.startsWith('{"prb"'))).toMatch(/^\{"prb":\{"e":1,"x":0\.000,"y":0\.000,"z":-?\d+\.\d{3},"a":0\.000,"b":0\.000,"c":0\.000\}\}$/);
    expect(exceptions(lines)).toEqual([]);
    expect(get(sim, 'dist')).toBe(1);
    // Motion mode is cancelled: an axis word alone is refused.
    expect(statuses(send(sim, 'Z1'))).toEqual([135]);
    // From 450.03 the frame is machine millimetres.
    const next = probeSim({ build: { ...BUILD, fb: 450.03 } });
    send(next, 'G10 L20 P1 Z10');
    next.device.setProbePlate(-2);
    const p3 = prbLines(send(next, 'G91 G38.2 Z-5 F100', 3000));
    expect(p3[0]?.z).toBeCloseTo(next.device.snapshot().position[2] as number, 3);
  });

  it('[EN-PROBE-MISS-ALARM] no contact: Z runs to the target, prb e=0, then ALARM 250 "Probe did not trip"; a lead off on prbp 0 is the same', () => {
    for (const lead of [true, false]) {
      const sim = probeSim();
      sim.device.setProbePlate(-10);
      sim.device.setProbeLead(lead);
      sim.device.setProbeTouch(!lead);
      const lines = send(sim, 'G91 G38.2 Z-3 F200', 3000);
      expect(sim.device.snapshot().position[2]).toBeCloseTo(-3, 6);
      expect(prbLines(lines).map((p) => p.e)).toEqual([0]);
      const er = exceptions(lines);
      expect(er.map((e) => e.st)).toEqual([250]);
      expect(er[0]?.msg).toContain('Probe did not trip');
      expect(lines.findIndex((l) => l.startsWith('{"prb"'))).toBeLessThan(lines.findIndex((l) => l.startsWith('{"er"')));
      expect(sim.device.snapshot().stat).toBe(2);
      // Refused while alarmed (204) until cleared.
      expect(statuses(send(sim, 'G91 G38.2 Z-3 F200'))).toEqual([204]);
    }
  });

  it('[EN-PROBE-ALREADY-TRIPPED] an input active before the move: no motion, prb e=0, ALARM 250 "Probe already tripped" (also a broken NC lead)', () => {
    const touching = probeSim();
    touching.device.setProbeTouch(true);
    const nc = probeSim({ eeprom: { prbp: 1 } });
    nc.device.setProbeLead(false);
    for (const sim of [touching, nc]) {
      const lines = send(sim, 'G91 G38.2 Z-5 F100', 1000);
      expect(sim.device.snapshot().position[2]).toBe(0);
      expect(prbLines(lines).map((p) => p.e)).toEqual([0]);
      const er = exceptions(lines);
      expect(er.map((e) => e.st)).toEqual([250]);
      expect(er[0]?.msg).toContain('Probe already tripped');
    }
  });

  it('[EN-PROBE-CYCLE] a soft limit is ALARM 220 with no report; ^D is ALARM 207 with no report; a limit input is 203; Pause ends the probe in 250; ~ does not resume', () => {
    // Soft limit: homed Z, sl=1, the target below Z travel min.
    const soft = probeSim({ eeprom: { sl: 1, ztn: 0, ztm: 75 } });
    send(soft, 'G28.3 Z0');
    const sl = send(soft, 'G91 G38.2 Z-5 F100', 1000);
    expect(exceptions(sl).map((e) => e.st)).toEqual([220]);
    expect(prbLines(sl)).toEqual([]);
    expect(soft.device.snapshot().position[2]).toBe(0);

    const kill = probeSim();
    kill.device.setProbePlate(-10);
    send(kill, 'G91 G38.2 Z-5 F60', 500);
    kill.host.send('\x04');
    kill.clock.advance(1000);
    const k = kill.host.lines();
    expect(exceptions(k).map((e) => e.st)).toEqual([207]);
    expect(prbLines(k)).toEqual([]);
    expect(kill.device.snapshot().stat).toBe(2);
    expect(kill.device.snapshot().position[2]).toBeGreaterThan(-1);

    const limit = probeSim();
    send(limit, 'G91 G38.2 Z-5 F60', 500);
    limit.device.injectLimitSwitch(6);
    limit.clock.advance(1000);
    expect(exceptions(limit.host.lines()).map((e) => e.st)).toEqual([203]);
    expect(prbLines(limit.host.lines())).toEqual([]);

    const pause = probeSim();
    send(pause, 'G91 G38.2 Z-5 F60', 500);
    pause.host.send('!');
    pause.clock.advance(1000);
    pause.host.send('~');
    pause.clock.advance(1000);
    const p = pause.host.lines();
    expect(prbLines(p).map((x) => x.e)).toEqual([0]);
    expect(exceptions(p).map((e) => e.st)).toEqual([250]);
    const z = pause.device.snapshot().position[2] as number;
    expect(z).toBeGreaterThan(-1);
    pause.clock.advance(2000);
    expect(pause.device.snapshot().position[2]).toBe(z);

    // A GET is answered while the probe runs (control lines are read first); the next G-code waits for the cycle.
    const busy = probeSim();
    busy.device.setProbePlate(-1);
    busy.host.sendLine('G91 G38.2 Z-5 F60');
    busy.host.sendLine('{"in5":null}');
    busy.host.sendLine('G90');
    busy.clock.advance(300);
    const early = replies(busy.host.lines());
    expect(early.some((r) => 'in5' in r.r)).toBe(true);
    expect(early).toHaveLength(2);
    busy.clock.advance(3000);
    expect(replies(busy.host.lines())).toHaveLength(3);
  });

  it('[EN-PROBE-CYCLE] a reset during the cycle ends it; a new probe after a clear works', () => {
    const sim = probeSim();
    sim.device.setProbePlate(-10);
    send(sim, 'G91 G38.2 Z-1 F200', 2000);
    expect(exceptions(sim.host.lines()).map((e) => e.st)).toEqual([250]);
    send(sim, '{"clear":null}', 500);
    sim.device.setProbePlate(-1.5);
    const lines = send(sim, 'G91 G38.2 Z-5 F100', 3000);
    expect(prbLines(lines).map((p) => p.e)).toEqual([1]);
    expect(prbLines(sim.host.lines()).map((p) => p.e)).toEqual([0, 1]);
    const reset = probeSim();
    send(reset, 'G91 G38.2 Z-5 F60', 300);
    reset.device.resetBoard();
    reset.clock.advance(3000);
    expect(reset.device.snapshot().stat).toBe(1);
    expect(prbLines(reset.host.lines())).toEqual([]);
  });
});
