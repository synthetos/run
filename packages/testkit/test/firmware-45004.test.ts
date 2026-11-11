import { expect, it } from 'vitest';
import { enSim, get, statuses } from './helpers.ts';
import { HoldOutputLatch } from '../src/firmware/holdOutputs.ts';

const build = { fb: 450.04, fv: 0.97, hv: 8, layout: 10002 };
it('[EN-HOLD-OUTPUTS] real settings, pause, spin-up delay, and repeated hold cancellation', () => {
  const sim = enSim({ build });
  expect(get(sim, 'spph')).toBe(1);
  expect(get(sim, 'spde')).toBe(1);
  expect(get(sim, 'coph')).toBe(0);
  sim.host.sendLine('M3 S1000'); sim.clock.advance(100);
  sim.host.sendLine('G1 X100 F60'); sim.clock.advance(200);
  sim.host.send('!'); sim.clock.advance(500);
  expect(sim.device.snapshot()).toMatchObject({ hold: 6, spindle: 'off' });
  sim.host.send('~'); sim.clock.advance(500);
  expect(sim.device.snapshot()).toMatchObject({ hold: 6, spindle: 'cw' });
  sim.host.send('!'); sim.clock.advance(500);
  expect(sim.device.snapshot()).toMatchObject({ hold: 6, spindle: 'off' });
  sim.host.send('~'); sim.clock.advance(1100);
  expect(sim.device.snapshot()).toMatchObject({ hold: 0, spindle: 'cw' });
});
it('[EN-HOLD-OUTPUTS] disabled spindle pause and optional coolant pause; cancellation cannot restart outputs', () => {
  const latch = new HoldOutputLatch();
  const on = { spindle: 'cw' as const, mist: true, flood: true };
  const paused = latch.pause(on, false, true);
  expect(paused).toEqual({ spindle: 'cw', mist: false, flood: false });
  expect(latch.resume(paused, 0, 100)).toEqual({ ready: true, outputs: on });
  const off = latch.pause(on, true, true);
  expect(latch.resume(off, 0, 1).ready).toBe(false);
  expect(latch.resume(off, 1009, 1).ready).toBe(false);
  expect(latch.resume(off, 1010, 1)).toEqual({ ready: true, outputs: on });
  latch.pause(on, true, true); latch.clear();
  expect(latch.resume(off, 2000, 1)).toEqual({ ready: true, outputs: off });
});
it('[EN-ARC-REFUSAL] 157 is a refusal without motion or alarm, while the old model stays unchanged', () => {
  for (const fb of [450.02, 450.04]) {
    const sim = enSim({ build: { ...build, fb } });
    sim.host.take(); sim.host.sendLine('G2 X1 Y1 F100'); sim.clock.advance(50);
    expect(statuses(sim.host.take())).toContain(157);
    expect(sim.device.snapshot().machineState).toBe(fb >= 450.04 ? 'ready' : 'alarm');
  }
});

it('E060: flush during spin-up cancels output restoration and queued motion', () => {
  const sim = enSim({ build });
  sim.host.sendLine('M3 S1000'); sim.clock.advance(100);
  sim.host.sendLine('G1 X100 F60'); sim.clock.advance(200);
  sim.host.send('!'); sim.clock.advance(500);
  sim.host.send('~'); sim.clock.advance(500);
  expect(sim.device.snapshot().spindle).toBe('cw');
  const position = sim.device.snapshot().position;
  sim.host.send('%'); sim.clock.advance(1500);
  expect(sim.device.snapshot()).toMatchObject({ spindle: 'off', hold: 0, position });
  sim.host.send('~'); sim.clock.advance(1500);
  expect(sim.device.snapshot()).toMatchObject({ spindle: 'off', position });
});
it('N99 remains unfixed: standalone G4 after program end still reports stat 4', () => {
  const sim = enSim({ build });
  sim.host.sendLine('M30'); sim.clock.advance(100);
  sim.host.sendLine('G4 P2'); sim.clock.advance(100);
  expect(sim.device.snapshot()).toMatchObject({ stat: 4, plannerAvailable: 31 });
  sim.clock.advance(2200);
  expect(sim.device.snapshot().plannerAvailable).toBe(32);
});
