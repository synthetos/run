// THE TELEMETRY SEAM. Every value the workspace shows about the live machine
// comes through this module, and nowhere else. Two kinds of source:
//
//   status  - fields the firmware reports today (sr: line, posx..posa, feed,
//             vel, unit, coor, dist, admo, frmo, momo, stat; qr with qv=1/2).
//             In this study they are simulated, in the app they come from the
//             machine worker's snapshot.
//   MOCK    - firmware features that do not exist yet. Each is tagged
//             `mock: 'firmware pending'` and is rendered with a visible tag.
//             When the firmware ships one, replace its provider below and
//             drop the tag: the views do not change.
//
// Nothing here talks to a port, a worker or the network.

export const FIRMWARE_PENDING = 'firmware pending';

export const features = {
  // (a) Spindle state report: on/off, direction, actual speed. Today the
  // firmware has no such key; the app can only show the last M3/M4/M5 S.
  spindleReport: { mock: FIRMWARE_PENDING, shape: '{"sr":{"spe":1,"spd":0,"sps":17940}} (candidate, not decided)' },
  // (b) Live feed/spindle/rapid overrides. edge-next rejects M48-M51 and has
  // no realtime override characters. A runtime shape like {rt:{fo:0.8}} is
  // under discussion only.
  overrides: { mock: FIRMWARE_PENDING, shape: '{"rt":{"fo":0.8,"so":1.0,"ro":0.5}} (discussion only)' },
  // (c) Firmware tool table. None exists and none is planned; the firmware
  // reports only the active tool ("tool" in sr) and G43/G49 length.
  toolTable: { mock: FIRMWARE_PENDING, shape: 'slot -> {T, length, diameter} (no design decided)' },
};

// Simulated status fields per preview state. In the app: the worker snapshot.
const status = {
  disconnected: null,
  identified: { stat: 'ready', line: 0, posx: 0, posy: 0, posz: 12, feed: 0, vel: 0, tool: 1, qr: 28, age: 0.2 },
  idle: { stat: 'ready', line: 0, posx: 0, posy: 0, posz: 12, feed: 0, vel: 0, tool: 1, qr: 28, age: 0.2 },
  outdated: { stat: 'ready', line: 0, posx: 0, posy: 0, posz: 12, feed: 0, vel: 0, tool: 1, qr: null, age: 0.25 },
  running: { stat: 'run', line: 1184, posx: 92.4, posy: 61.8, posz: -2, feed: 1500, vel: 1112, tool: 1, qr: 19, age: 0.25 },
  toolchange: { stat: 'stop', line: 61, posx: 20, posy: 100, posz: 5, feed: 0, vel: 0, tool: 5, qr: 28, age: 0.25 },
  held: { stat: 'hold', line: 1184, posx: 92.4, posy: 61.8, posz: -2, feed: 1500, vel: 0, tool: 1, qr: 21, age: 0.25 },
  lost: { stat: 'unknown', line: 1184, posx: 92.4, posy: 61.8, posz: -2, feed: 1500, vel: null, tool: 1, qr: null, age: 8 },
  orphaned: { stat: 'unknown', line: null, posx: null, posy: null, posz: null, feed: null, vel: null, tool: null, qr: null, age: null },
};

// MOCK providers. Swap each for the real report when the firmware ships it.
const mockSpindle = {
  disconnected: null,
  identified: { on: false, dir: 'cw', rpm: 0, commanded: 0 },
  idle: { on: false, dir: 'cw', rpm: 0, commanded: 0 },
  outdated: { on: false, dir: 'cw', rpm: 0, commanded: 0 },
  running: { on: true, dir: 'cw', rpm: 17940, commanded: 18000 },
  toolchange: { on: false, dir: 'cw', rpm: 0, commanded: 0 },
  held: { on: true, dir: 'cw', rpm: 17960, commanded: 18000 },
  lost: null, orphaned: null,
};
const mockCoolant = { running: { mist: true, flood: false }, held: { mist: true, flood: false } };
const mockOverrides = { feed: 1.0, spindle: 1.0, rapid: 1.0 };
const mockToolTable = [
  { slot: 1, tool: 'T1', length: 38.42, diameter: 3.175 },
  { slot: 2, tool: 'T2', length: 49.8, diameter: 6 },
  { slot: 5, tool: 'T5', length: 86.1, diameter: 5 },
];

export function snapshot(state) {
  return {
    status: status[state] ?? null,
    spindle: mockSpindle[state] ?? null, spindleMock: features.spindleReport.mock,
    coolant: mockCoolant[state] ?? { mist: false, flood: false },
    overrides: { ...mockOverrides }, overridesMock: features.overrides.mock,
    toolTable: mockToolTable, toolTableMock: features.toolTable.mock,
  };
}
// Planner health from qr: free planner buffers. High while cutting means the
// sender is not keeping up (starving); near the dialect's low mark means the
// planner is full and the machine is limited by corners and jerk.
export function plannerHealth(qr, cutting) {
  if (qr == null) return { label: 'Not reported', level: 'muted' };
  if (cutting && qr >= 18) return { label: 'Starving', level: 'warn' };
  if (qr <= 12) return { label: 'Full · corner limited', level: 'ok' };
  return { label: 'Healthy', level: 'ok' };
}
