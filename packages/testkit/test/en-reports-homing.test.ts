/**
 * Edge-next model: the status report list (sr_set), pushed report timing (report.c facts, firmware maintainer
 * 2026-11-02), the rt heartbeat, G28.2 homing, G28.3, and the G92 readouts. Model limits LIM-EN-SR-LIST,
 * LIM-EN-SR-TIMING, LIM-EN-RT-HB and LIM-EN-HOMING (STATUS.md).
 */
import { describe, expect, it } from 'vitest';
import { TinyGEdgeNextModel } from '../src/firmware/edgeNext.ts';
import { createSim } from '../src/simHost.ts';
import { enSim, get, replies, reports, statuses } from './helpers.ts';

function lastReply(lines: readonly string[]) {
  const r = replies(lines).at(-1);
  if (r === undefined) throw new Error('no reply');
  return r;
}

function hbLines(lines: readonly string[]): Record<string, unknown>[] {
  return lines.filter((l) => l.startsWith('{"hb"')).map((l) => (JSON.parse(l) as { hb: Record<string, unknown> }).hb);
}

describe('status report list (sr_set)', () => {
  it('GET returns the default list; a SET replaces it, answers the new values and persists', () => {
    const sim = enSim();
    expect(Object.keys(get(sim, 'sr') as object)).toEqual(['line', 'posx', 'posy', 'posz', 'posa', 'feed', 'vel', 'unit', 'coor', 'dist', 'admo', 'frmo', 'momo', 'stat']);
    sim.host.sendLine('{sr:{stat:true,hold:true,mpox:true,spe:t}}');
    sim.clock.advance(30);
    const r = lastReply(sim.host.take());
    expect(r.f[1]).toBe(0);
    expect(r.r).toEqual({ sr: { stat: 1, hold: 0, mpox: 0, spe: 0 } });
    expect(sim.device.snapshot().srList).toEqual(['stat', 'hold', 'mpox', 'spe']);
    expect(sim.device.srListWrites).toBe(1);
    expect(Object.keys(get(sim, 'sr') as object)).toEqual(['stat', 'hold', 'mpox', 'spe']);
    // Pushed reports follow the new list only.
    sim.host.sendLine('G1 X3 F600');
    sim.clock.advance(1000);
    const keys = new Set(reports(sim.host.lines()).flatMap((x) => Object.keys(x)));
    expect([...keys].every((k) => ['stat', 'hold', 'mpox', 'spe'].includes(k))).toBe(true);
    expect(keys.has('mpox')).toBe(true);
  });

  it('refuses false, unknown tokens, an empty list and more than 30 entries, changing nothing', () => {
    const sim = enSim();
    const before = sim.device.snapshot().srList;
    const tooMany = `{sr:{${Array.from({ length: 31 }, () => 'stat:t').join(',')}}}`;
    for (const [line, st] of [
      ['{"sr":{"stat":true,"posx":false}}', 100],
      ['{"sr":{"stat":true,"nosuch":true}}', 100],
      ['{"sr":{"stat":1}}', 100],
      ['{"sr":{}}', 101],
      [tooMany, 107],
    ] as const) {
      sim.host.take();
      sim.host.sendLine(line);
      sim.clock.advance(30);
      expect(statuses(sim.host.take()), line).toEqual([st]);
    }
    expect(sim.device.snapshot().srList).toEqual(before);
    expect(sim.device.srListWrites).toBe(0);
  });

  it('survives a reset and a power cycle (EEPROM); a fresh EEPROM can start with a given list', () => {
    const eeprom = {};
    const sim = createSim(new TinyGEdgeNextModel({ eeprom }));
    sim.host.sendLine('{"sr":{"stat":true,"posx":true}}');
    sim.clock.advance(30);
    sim.host.send('\x18');
    sim.clock.advance(1200);
    expect(sim.device.snapshot().srList).toEqual(['stat', 'posx']);
    const again = createSim(new TinyGEdgeNextModel({ eeprom }));
    expect(again.device.snapshot().srList).toEqual(['stat', 'posx']);
    const preset = enSim({ srList: ['stat', 'mpox'] });
    expect(Object.keys(get(preset, 'sr') as object)).toEqual(['stat', 'mpox']);
  });

  it('is refused while alarmed, like every SET', () => {
    const sim = enSim();
    sim.host.send('\x04');
    sim.clock.advance(30);
    sim.host.take();
    sim.host.sendLine('{"sr":{"stat":true}}');
    sim.clock.advance(30);
    const [st] = statuses(sim.host.take());
    expect(st).not.toBe(0);
    expect(sim.device.snapshot().srList).toHaveLength(14);
  });

  it('counts an EEPROM write with the stall when one is modelled', () => {
    const sim = enSim({ eepromWriteMs: 20 });
    sim.host.sendLine('{"sr":{"stat":true}}');
    sim.clock.advance(60);
    expect(sim.device.eepromWrites).toBe(1);
    expect(statuses(sim.host.take())).toEqual([0]);
  });
});

describe('pushed status report timing', () => {
  it('[EN-SR] the first request wins and the report samples at print: a short state never appears', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X0.5 F6000');
    sim.clock.advance(600);
    const timed = sim.host.timedLines().filter((l) => l.text.startsWith('{"sr"'));
    expect(timed).toHaveLength(1);
    // Requested when the line was parsed (about 4 ms), printed si = 250 ms later.
    expect(timed[0]?.t).toBeGreaterThanOrEqual(250);
    expect(timed[0]?.t).toBeLessThan(270);
    const [sr] = reports(sim.host.lines());
    expect(sr?.['stat']).toBe(3); // the 5 (running) came and went between request and print
    expect(sr?.['posx']).toBe(0.5);
  });

  it('[EN-SR] a persistent state (a finished feedhold, stat 6) appears within si; sv=2 sends every field; sv=0 none', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X20 F600');
    sim.clock.advance(400);
    sim.host.take();
    sim.host.send('!');
    sim.clock.advance(100 + 260);
    expect(reports(sim.host.take()).some((r) => r['stat'] === 6)).toBe(true);
    const all = enSim();
    all.host.sendLine('{"sv":2}');
    all.host.sendLine('G1 X1 F600');
    all.clock.advance(400);
    expect(Object.keys(reports(all.host.lines())[0] ?? {})).toHaveLength(14);
  });
});

describe('rt family and heartbeat', () => {
  it('{"rt":null} reads hb, qt and up; {"rt":{"hb":N}} sets whole seconds 0..60; range, envelope and unsupported builds', () => {
    const sim = enSim();
    sim.clock.advance(2100);
    sim.host.sendLine('{"rt":null}');
    sim.clock.advance(30);
    const r = lastReply(sim.host.take());
    expect(r.f[1]).toBe(0);
    expect(r.r['rt']).toMatchObject({ hb: 0, qt: '' });
    // up is whole seconds since power-up (runtime.c rt_get_up)
    expect((r.r['rt'] as { up: unknown }).up).toBe(2);
    for (const n of [60, 0, 1]) {
      sim.host.sendLine(`{"rt":{"hb":${n}}}`);
      sim.clock.advance(30);
      expect(lastReply(sim.host.take()).r).toEqual({ rt: { hb: n } });
    }
    for (const [line, st] of [
      ['{"rt":{"hb":1000}}', 110],
      ['{"rt":{"hb":61}}', 110],
      ['{"rt":{"hb":70000}}', 110],
      ['{"rt":{"hb":1.5}}', 110],
      ['{"rt":{"hb":-1}}', 110],
      ['{"rt":{"hb":"1"}}', 110],
      ['{"rt":{"qq":1}}', 100],
      ['{"rt":5}', 116],
      ['{"rt":null,"stat":null}', 100],
    ] as const) {
      sim.host.take();
      sim.host.sendLine(line);
      sim.clock.advance(30);
      expect(statuses(sim.host.take()), line).toEqual([st]);
    }
    // A refused value changes nothing.
    sim.host.sendLine('{"rt":null}');
    sim.clock.advance(30);
    expect(lastReply(sim.host.take()).r['rt']).toMatchObject({ hb: 1 });
    const old = enSim({ rt: false });
    old.host.sendLine('{"rt":null}');
    old.clock.advance(30);
    const o = lastReply(old.host.take());
    expect(o.f[1]).toBe(100);
    expect(o.r).toEqual({});
  });

  it('hb lines arrive every hb seconds while the link and the machine are quiet; 0 and ^X turn it off', () => {
    const sim = enSim();
    sim.host.sendLine('{"rt":{"hb":1}}');
    sim.clock.advance(3500);
    const idle = hbLines(sim.host.take());
    expect(idle.length).toBe(3);
    expect(idle[0]).toMatchObject({ stat: 1, hold: 0, qt: '' });
    const ups = idle.map((b) => b['up'] as number);
    expect(ups.every((u) => Number.isInteger(u))).toBe(true);
    expect((ups[2] as number) - (ups[0] as number)).toBe(2);
    // A longer interval: one beat in 2.5 s at hb 2.
    sim.host.sendLine('{"rt":{"hb":2}}');
    sim.clock.advance(2500);
    expect(hbLines(sim.host.take()).length).toBe(1);
    sim.host.sendLine('{"rt":{"hb":1}}');
    sim.clock.advance(30);
    sim.host.take();
    // While the machine moves (reports flow or not) no beat is sent.
    sim.host.sendLine('{sv:0}');
    sim.clock.advance(30);
    sim.host.sendLine('G1 X30 F600');
    sim.clock.advance(2500);
    expect(hbLines(sim.host.take())).toEqual([]);
    // Host bytes restart the interval: a byte (XON, a no-op here) every 600 ms keeps the link busy.
    sim.clock.advance(2000);
    sim.host.take();
    for (let i = 0; i < 5; i++) {
      sim.host.send('\x11');
      sim.clock.advance(600);
    }
    expect(hbLines(sim.host.take())).toEqual([]);
    sim.clock.advance(1100);
    expect(hbLines(sim.host.take()).length).toBe(1);
    sim.host.sendLine('{"rt":{"hb":0}}');
    sim.clock.advance(5000);
    expect(hbLines(sim.host.take())).toEqual([]);
    sim.host.sendLine('{"rt":{"hb":1}}');
    sim.clock.advance(30);
    sim.host.send('\x18');
    sim.clock.advance(5000);
    expect(hbLines(sim.host.take())).toEqual([]);
  });
});

describe('G28.2 homing and G28.3', () => {
  function homingSim() {
    const sim = enSim();
    for (const line of ['{"zsn":1}', '{"zsv":600}', '{"xsx":1}', '{"xsv":600}']) sim.host.sendLine(line);
    sim.clock.advance(100);
    sim.device.setMachinePosition({ z: 30, x: 100 });
    sim.host.take();
    return sim;
  }

  it('homes the named axes Z first, toward their switches, with stat 9 while it runs; positions set to the travel ends', () => {
    const sim = homingSim();
    sim.host.sendLine('G28.2 X0 Z0');
    sim.clock.advance(500);
    expect(get(sim, 'stat')).toBe(9);
    expect(sim.device.snapshot().position[2]).toBeLessThan(30); // Z moves first
    expect(sim.device.snapshot().position[0]).toBe(100);
    sim.clock.advance(10000);
    const snap = sim.device.snapshot();
    expect(snap.homed.slice(0, 3)).toEqual([true, false, true]);
    expect(snap.position[2]).toBe(0); // ztn
    expect(snap.position[0]).toBe(150); // xtm
    expect(get(sim, 'stat')).toBe(3);
    expect(get(sim, 'homz')).toBe(1);
    expect(get(sim, 'home')).toBe(0); // Y not homed
  });

  it('refuses an axis without a homing switch (246) or no axis (241), and nothing moves', () => {
    const sim = homingSim();
    sim.host.sendLine('G28.2 Y0');
    sim.host.sendLine('G28.2');
    sim.clock.advance(100);
    expect(statuses(sim.host.take())).toEqual([246, 241]);
    expect(sim.device.snapshot().position[2]).toBe(30);
    expect(sim.device.snapshot().homed.every((h) => !h)).toBe(true);
  });

  it('a feedhold then a flush ends homing with the remaining axes not homed', () => {
    const sim = homingSim();
    sim.host.sendLine('G28.2 Z0 X0');
    sim.clock.advance(500);
    sim.host.send('!');
    sim.clock.advance(300);
    sim.host.send('%');
    sim.clock.advance(300);
    const snap = sim.device.snapshot();
    expect(snap.homed.slice(0, 3)).toEqual([false, false, false]);
    expect(get(sim, 'stat')).not.toBe(9);
    sim.clock.advance(10000);
    expect(sim.device.snapshot().homed.slice(0, 3)).toEqual([false, false, false]);
  });

  it('^D during homing alarms and ends the cycle', () => {
    const sim = homingSim();
    sim.host.sendLine('G28.2 Z0');
    sim.clock.advance(500);
    sim.host.send('\x04');
    sim.clock.advance(10000);
    expect(get(sim, 'stat')).toBe(2);
    expect(sim.device.snapshot().homed[2]).toBe(false);
  });

  it('G28.3 sets the machine position of the named axes and marks them homed, without motion', () => {
    const sim = enSim();
    sim.host.sendLine('G28.3 X5 Y-2');
    sim.clock.advance(50);
    expect(statuses(sim.host.take())).toEqual([0]);
    expect(get(sim, 'mpox')).toBe(5);
    expect(get(sim, 'mpoy')).toBe(-2);
    expect(get(sim, 'posx')).toBe(5);
    expect(sim.device.snapshot().homed.slice(0, 3)).toEqual([true, true, false]);
    sim.host.sendLine('G20');
    sim.host.sendLine('G28.3 Z1');
    sim.clock.advance(50);
    expect(sim.device.snapshot().position[2]).toBeCloseTo(25.4);
  });
});

describe('offsets readable', () => {
  it('G92 and G92.1: g92 reads the active offset, pos follows, and a pushed report follows', () => {
    const sim = enSim();
    sim.host.sendLine('G1 X10 F6000');
    sim.clock.advance(1500);
    sim.host.take();
    sim.host.sendLine('G92 X0');
    sim.clock.advance(400);
    expect(reports(sim.host.take()).some((r) => r['posx'] === 0)).toBe(true);
    expect(get(sim, 'g92')).toMatchObject({ x: 10 });
    expect(get(sim, 'posx')).toBe(0);
    expect(get(sim, 'ofs')).toMatchObject({ x: 10 });
    sim.host.sendLine('G92.1');
    sim.clock.advance(400);
    expect(reports(sim.host.take()).some((r) => r['posx'] === 10)).toBe(true);
    expect(get(sim, 'g92')).toMatchObject({ x: 0 });
    for (const key of ['g28', 'g30', 'g54', 'g59', 'pos', 'mpo', 'ofs', 'hom', 'coor', 'dist', 'tool']) expect(get(sim, key), key).toBeDefined();
  });
});

describe('RAM-only writes (proposed capability, option ramWrites)', () => {
  it('today: {"rt":{"unsaved":null}} and any ram key answer 100; pairs before ram still run', () => {
    const sim = enSim();
    sim.host.sendLine('{"rt":{"unsaved":null}}');
    sim.clock.advance(30);
    const r = lastReply(sim.host.take());
    expect(r.f[1]).toBe(100);
    expect(r.r).toEqual({});
    sim.host.sendLine('{ram:1,sv:2}');
    sim.host.sendLine('{si:300,ram:1}');
    sim.clock.advance(60);
    expect(statuses(sim.host.take())).toEqual([100, 100]);
    expect(get(sim, 'sv')).toBe(1);
    expect(get(sim, 'si')).toBe(300);
  });

  it('with ramWrites: the probe answers unsaved 0; ram:1 first writes in RAM only (no EEPROM), lost at reset', () => {
    const eeprom: Record<string, number> = {};
    const sim = createSim(new TinyGEdgeNextModel({ eeprom, ramWrites: true, eepromWriteMs: 20 }));
    sim.host.sendLine('{"rt":{"unsaved":null}}');
    sim.clock.advance(30);
    expect(lastReply(sim.host.take()).r).toEqual({ rt: { unsaved: 0 } });
    sim.host.sendLine('{ram:1,sr:{stat:true,mpox:true}}');
    sim.clock.advance(30);
    const r = lastReply(sim.host.take());
    expect(r.f[1]).toBe(0);
    expect(Object.keys(r.r)).toEqual(['ram', 'sr']);
    sim.host.sendLine('{ram:1,sv:2}');
    sim.clock.advance(30);
    expect(lastReply(sim.host.take()).r).toEqual({ ram: 1, sv: 2 });
    expect(sim.device.eepromWrites).toBe(0);
    expect(eeprom['sv']).toBe(1);
    expect(sim.device.snapshot().srList).toEqual(['stat', 'mpox']);
    // ram not first: 100, and the pair before it already ran and persisted.
    sim.host.sendLine('{si:400,ram:1}');
    sim.clock.advance(60);
    expect(statuses(sim.host.take())).toEqual([100]);
    expect(eeprom['si']).toBe(400);
    sim.host.send('\x18');
    sim.clock.advance(1200);
    expect(sim.device.snapshot().srList).toHaveLength(14);
    expect(sim.device.settings.num('sv')).toBe(1);
    expect(sim.device.settings.num('si')).toBe(400);
  });
});
