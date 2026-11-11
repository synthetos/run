import { expect, it } from 'vitest';
import { enSim, get, statuses } from './helpers.ts';

for (const fb of [450.02, 450.04]) {
  it(`[EN-DWELL-IDLE] ${fb}: full planner and old stat while G4 runs; persisted SET refuses without mutation`, () => {
    const sim = enSim({ build: { fb, fv: 0.97, hv: 8, layout: 10002 } });
    sim.host.sendLine('M30'); sim.clock.advance(100);
    const before = get(sim, 'xvm');
    const storedBefore = sim.device.settings.eeprom['xvm'];
    sim.host.take();
    sim.host.sendLine('G4 P2'); sim.clock.advance(200);
    expect(sim.device.snapshot()).toMatchObject({ stat: 4, plannerAvailable: 32, hold: 0 });
    sim.host.sendLine('{xvm:123}'); sim.clock.advance(100);
    expect(statuses(sim.host.take())).toContain(117);
    expect(get(sim, 'xvm')).toBe(before);
    expect(sim.device.settings.eeprom['xvm']).toBe(storedBefore);
    sim.clock.advance(2200);
    sim.host.take(); sim.host.sendLine('{xvm:123}'); sim.clock.advance(100);
    expect(statuses(sim.host.take())).toContain(0);
    expect(get(sim, 'xvm')).toBe(123);
  });
}
// The register scanner requires a literal test title.
it('[EN-DWELL-IDLE] M0 prevents a following dwell from starting', () => {
  const sim = enSim({ build: { fb: 450.04, fv: 0.97, hv: 8, layout: 10002 } });
  sim.host.sendLine('M0'); sim.host.sendLine('G4 P2'); sim.clock.advance(3000);
  expect(sim.device.snapshot()).toMatchObject({ stat: 3, hold: 6, plannerAvailable: 31 });
  sim.host.send('~'); sim.clock.advance(200);
  expect(sim.device.snapshot().plannerAvailable).toBe(32);
  sim.host.take(); sim.host.sendLine('{xvm:123}'); sim.clock.advance(100);
  expect(statuses(sim.host.take())).toContain(117);
});

it('a held standalone dwell reports HOLD even after its planner slot is freed', () => {
  const sim = enSim({ build: { fb: 450.04, fv: 0.97, hv: 8, layout: 10002 } });
  sim.host.sendLine('M30'); sim.clock.advance(100);
  sim.host.sendLine('G4 P2'); sim.clock.advance(200);
  expect(sim.device.snapshot()).toMatchObject({ stat: 4, plannerAvailable: 32 });
  sim.host.send('!'); sim.clock.advance(100);
  expect(sim.device.snapshot()).toMatchObject({ stat: 6, hold: 6, plannerAvailable: 32 });
  sim.clock.advance(2500);
  expect(sim.device.snapshot()).toMatchObject({ stat: 6, hold: 6 });
  sim.host.send('~'); sim.clock.advance(100);
  expect(sim.device.snapshot().hold).toBe(0);
});
