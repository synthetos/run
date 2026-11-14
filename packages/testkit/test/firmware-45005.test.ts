import { expect, it } from 'vitest';
import { enSim, get, statuses } from './helpers.ts';
const build = { fb: 450.05, fv: 0.97, hv: 8, layout: 10003 };
it('[EN-45005] migrates stored settings, removes hold keys and reads reset override values', () => {
  const sim = enSim({ build, eeprom: { __layout: 10002, xvm: 1234, spph: 1, spde: 10, coph: 1 } });
  expect(get(sim, 'xvm')).toBe(1234);
  expect(sim.device.settings.eeprom['__layout']).toBe(10003);
  for (const key of ['spph', 'spde', 'coph']) {
    expect(sim.device.settings.eeprom[key]).toBeUndefined();
    sim.host.take(); sim.host.sendLine(`{"${key}":null}`); sim.clock.advance(100);
    expect(statuses(sim.host.take())).toContain(100);
    sim.host.sendLine(`{"${key}":1}`); sim.clock.advance(100);
    expect(statuses(sim.host.take())).toContain(100);
  }
  for (const key of ['mfo', 'mfoe', 'm48e', 'mfc', 'mfe']) expect(get(sim, key)).toBe(1);
  expect(get(sim, 'mcp')).toBe(0);
});
it('[EN-45005] dwell reports Run with a free planner slot, hold keeps outputs, M0 remains stopped', () => {
  const sim = enSim({ build });
  sim.host.sendLine('M3 S1000'); sim.host.sendLine('M8'); sim.host.sendLine('G4 P2'); sim.clock.advance(200);
  expect(sim.device.snapshot()).toMatchObject({ stat: 5, plannerAvailable: 32, spindle: 'cw', coolant: { flood: true } });
  sim.host.send('!'); sim.clock.advance(100);
  expect(sim.device.snapshot()).toMatchObject({ stat: 6, spindle: 'cw', coolant: { flood: true } });
  sim.host.send('~'); sim.clock.advance(2200);
  sim.host.sendLine('M0'); sim.host.sendLine('G4 P2'); sim.clock.advance(300);
  expect(sim.device.snapshot().stat).toBe(3);
});

it('[EN-45005] unknown layouts still reset to defaults', () => {
  const sim = enSim({ build, eeprom: { __layout: 98765, xvm: 1234 } });
  expect(get(sim, 'xvm')).not.toBe(1234);
  expect(sim.device.settings.eeprom['__layout']).toBe(10003);
});

it('[EN-45005] override writes remain an explicit model gap in Part A', () => {
  for (const key of ['mfo', 'mfoe', 'm48e', 'mfc', 'mcp', 'mfe']) {
    const sim = enSim({ build });
    sim.host.sendLine(`{"${key}":1}`);
    expect(() => sim.clock.advance(100)).toThrow('outside the Part A model');
  }
});
