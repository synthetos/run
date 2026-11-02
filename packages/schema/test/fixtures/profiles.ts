/** Profile fixtures for the TB-01 tests. */
import type { MachineProfileV2 } from '../../src/index.ts';

export const MACHINE_ID = '3f1c2a9e-8b7d-4c6e-9a1f-0b2c3d4e5f60';
export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);

/** A bound TinyG edge-next router with a dual-motor Y axis. */
export function v2Router(): MachineProfileV2 {
  return {
    schemaVersion: 2,
    id: MACHINE_ID,
    name: 'Shop router',
    boundDevice: { family: 'tinyg', id: '9H3583-WQX', fb: 450.01, dialectId: 'tinyg-en' },
    board: { id: 'tinyg-v8', rev: 'v8h', hv: 8 },
    firmware: { dialectId: 'tinyg-en', fb: 450.01, imageSha256: 'c'.repeat(64) },
    machine: {
      type: 'router',
      axes: {
        x: { motors: [1], drive: { kind: 'screw', pitchMm: 5, starts: 1 }, measuredTravelMm: 300, homeEnd: 'min' },
        y: { motors: [2, 3], drive: { kind: 'belt', pitchMm: 2, teeth: 20 }, measuredTravelMm: 400, homeEnd: 'min' },
        z: { motors: [4], drive: { kind: 'screw', pitchMm: 2, starts: 1 }, measuredTravelMm: null, homeEnd: 'max' },
      },
      homingOrder: ['z', 'x', 'y'],
      spindle: { kind: 'spindle', drive: 'relay', activeLow: false },
      psu: { volts: 24, amps: 10, earthed: true },
      estop: { kind: 'mushroom-nc+contactor', auxInput: null },
      hostLossPolicy: 'drain',
      queuedMotionCeilingS: 5,
      jogCaps: { maxStepMm: 10, maxFeedMmPerMin: 1000 },
      holdTimeoutS: 60,
    },
    settings: { draft: { xvm: 16000, '1ma': 0, '1tr': 5 }, schemaKey: 'tinyg-en@6ec70652', deviceHash: HASH_A },
    wiringRef: { id: 'wiring-1', sha256: 'd'.repeat(64) },
    createdWith: { tool: 'run', version: '0.2.0', sha: '35ca895' },
  };
}

/** A v1 file as OLD TOOLS_PLAN §5.1 describes it, with facts, overrides and confirmations. */
export function v1File(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: MACHINE_ID,
    name: 'Shop router',
    boundDevice: { family: 'tinyg', id: '9H3583-WQX', fb: 440.21 },
    board: { id: 'tinyg-v8', rev: 'v8h', hv: 8 },
    firmware: { dialectId: 'tinyg-440', fv: 0.97, fb: 440.21, imageSha256: 'c'.repeat(64) },
    machine: {
      type: 'router',
      axes: {
        x: { motors: [1], drive: { kind: 'screw', pitch: 2, starts: 1 }, travelMm: 300, homeEnd: 'min' },
        y: { motors: [2] },
        z: { motors: [3], drive: { kind: 'screw', pitch: 2, starts: 1 }, homeEnd: 'max' },
      },
      spindle: { kind: 'relay', activeLow: true },
      psu: { volts: 24, amps: 10, earthed: true },
      estop: { kind: 'mushroom-nc+contactor', auxInput: 'amax' },
      hostLossPolicy: 'hold-and-spindle-pause',
    },
    settings: { device: { xvm: 16000 }, draft: { xvm: 12000 }, schemaKey: 'tinyg@440.21', deviceHash: 'not-a-sha' },
    wiring: { parts: [{ id: 'p1' }], wires: [], hash: 'h' },
    facts: [
      { key: 'dir.x.verified', value: true, at: '2026-01-01', by: 'tool', evidence: 'jog +0.25 mm confirmed', boundTo: 'x' },
      { key: 'switch.xmin', value: true },
      { key: 'dir.x.verified', value: true },
    ],
    overrides: [{ key: 'run-unhomed', at: '2026-01-01', toolVersion: '0.3.0' }],
    confirmations: [{ id: 'C5' }],
    createdWith: { tool: 'machine-tools', version: '0.3.0', sha: 'zz' },
  };
}
