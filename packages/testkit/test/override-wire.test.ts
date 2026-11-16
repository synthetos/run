import { expect, it } from 'vitest';
import { enSim, get, statuses } from './helpers.ts';
const build = { fb: 450.06, fv: 0.97, hv: 8, layout: 10003 };
it('[EN-45006-OVERRIDES] rt aliases, read-only replies and reset values match flat reads', () => {
  const sim = enSim({ build });
  for (const [line, status] of [['{"rt":{"mfo":1.2}}', 0], ['{"rt":{"sso":0.8}}', 0], ['{"mfc":2}', 104], ['{"sso":3}', 110]] as const) {
    sim.host.take(); sim.host.sendLine(line); sim.clock.advance(100);
    expect(statuses(sim.host.take())).toContain(status);
  }
  expect(get(sim, 'mfo')).toBe(1.2);
  expect(get(sim, 'sso')).toBe(0.8);
  expect(get(sim, 'ssc')).toBe(1); // cannot turn an off spindle on
  sim.host.send('\x04'); sim.clock.advance(100);
  expect(get(sim, 'mfo')).toBe(1);
  expect(get(sim, 'sso')).toBe(1);
});
it('[EN-45006-OVERRIDES] queued program permission cannot be bypassed by operator enables', () => {
  const sim = enSim({ build });
  sim.host.sendLine('G4 P1'); sim.host.sendLine('M49'); sim.clock.advance(100);
  expect(get(sim, 'mfe')).toBe(1);
  sim.clock.advance(1500);
  expect(get(sim, 'mfe')).toBe(0);
  expect(get(sim, 'sse')).toBe(0);
  sim.host.sendLine('{"m48e":1}'); sim.host.sendLine('{"mfoe":1}'); sim.host.sendLine('{"ssoe":1}'); sim.clock.advance(100);
  expect(get(sim, 'mfe')).toBe(0);
  sim.host.sendLine('M50'); sim.clock.advance(100);
  expect(get(sim, 'mfe')).toBe(1);
  expect(get(sim, 'sse')).toBe(0);
  sim.host.sendLine('M51'); sim.clock.advance(100);
  expect(get(sim, 'sse')).toBe(1);
  sim.host.sendLine('M50 P0'); sim.host.sendLine('M51 P0'); sim.clock.advance(100);
  expect(get(sim, 'mfe')).toBe(0);
  expect(get(sim, 'sse')).toBe(0);
  sim.host.take(); sim.host.sendLine('M51 P2'); sim.clock.advance(100);
  expect(statuses(sim.host.take())).toContain(161);
  expect(get(sim, 'sse')).toBe(0);
  sim.host.sendLine('M2'); sim.clock.advance(100);
  expect(get(sim, 'mfe')).toBe(1);
  expect(get(sim, 'sse')).toBe(1);
});

it('[EN-45006-OVERRIDES] a prior program is an initial condition, not persisted permission', () => {
  const sim = enSim({ build, overrideProgram: { feed: false, spindle: false } });
  expect(get(sim, 'mfe')).toBe(0);
  expect(get(sim, 'sse')).toBe(0);
  sim.host.send('\x18'); sim.clock.advance(2000);
  expect(get(sim, 'mfe')).toBe(1);
  expect(get(sim, 'sse')).toBe(1);
});
