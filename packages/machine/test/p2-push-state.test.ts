/**
 * Push-driven state, homing, set machine position, offsets and the ways out of UNKNOWN (owner 2026-11-02;
 * SAFETY §4.2 and §4.5b as amended, H64-H69): T-S101 (the connect sequence: full read, the status report list
 * written only when it differs and read back, sv and an absurd si, the heartbeat), T-S102 (no periodic GETs
 * while idle), T-S103 (liveness: "No reports from the board"), T-S104 (homing), T-S105 (the UNKNOWN exits),
 * T-S106 (offsets). The session, the link and the edge-next model share one virtual clock.
 */
import type { ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import type { TinyGEdgeNextModel, TinyGModelOptions } from '@synthetos/testkit';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMINGS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_S, RUN_SR_FIELDS, SEED_TOKENS, srListLine, type SessionIntent } from '../src/index.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT, shown } from './simTransport.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

/** Homing switches on X and Z (max) and Y (min, where the machine already stands), with search speeds and travel. */
/** An EEPROM image the edge-next model loads (its layout marker, then the values). */
const EN_LAYOUT = { __layout: 10002 };

const HOMING_EEPROM = { ...EN_LAYOUT, xsx: 1, xsv: 600, ysn: 3, ysv: 600, zsx: 1, zsv: 400, xtm: 50, ytm: 50, ztm: 20 };

async function connected(device: TinyGModelOptions = {}, options: { readonly unknown?: boolean; readonly settle?: number } = {}): Promise<Harness> {
  const h = harness('en', { device: { start: 'ready', ...device }, session: { manifest: EN_APPROVED, release: PHASE_2_RELEASE } });
  void h.session.connect(PORT, { unknown: options.unknown === true });
  await h.run(options.settle ?? 3000);
  return h;
}

function writes(h: Harness): string[] {
  return (h.transports.at(-1)?.writes ?? []).map(shown);
}

function model(h: Harness): TinyGEdgeNextModel {
  return h.device as TinyGEdgeNextModel;
}

/** Reads the axis groups (as the window's settings read does) so the session knows the homing settings. */
async function readAxes(h: Harness): Promise<void> {
  expect(h.session.read(['x', 'y', 'z', 'a']).allowed).toBe(true);
  await h.run(300);
}

const req = (h: Harness, r: SessionIntent) => h.session.request(r);

describe('T-S101: the connect sequence', () => {
  it('reads the full state once, writes the status report list only because it differs, reads it back, then turns on the heartbeat', async () => {
    const h = await connected();
    const w = writes(h);
    const seedAt = w.indexOf('{"home":null}\\n', w.indexOf('{"unit":null}\\n') + 1);
    // Every seed token was read once, after READING.
    for (const t of SEED_TOKENS) expect(w.filter((x) => x === `{"${t}":null}\\n`).length, t).toBeGreaterThanOrEqual(1);
    expect(seedAt).toBeGreaterThan(0);
    const config = w.slice(w.indexOf('{"si":null}\\n') + 1);
    expect(config).toEqual([`${srListLine()}\\n`, '{"sr":null}\\n', '{"rt":null}\\n', `{"rt":{"hb":${HEARTBEAT_S}}}\\n`]);
    const s = h.session.snapshot;
    expect(s.reports).toMatchObject({ phase: 'done', heartbeatMs: HEARTBEAT_INTERVAL_MS, changes: [{ setting: 'sr' }], detail: null });
    expect(s.link).toEqual({ heartbeatMs: HEARTBEAT_INTERVAL_MS, silenceMs: DEFAULT_TIMINGS.reportSilenceMs });
    expect(s.live.srList).toEqual(RUN_SR_FIELDS);
    expect(model(h).snapshot().srList).toEqual(RUN_SR_FIELDS);
    expect(model(h).srListWrites).toBe(1);
    // Never the RAM flag (parked by the firmware maintainer).
    expect(w.some((x) => x.includes('ram'))).toBe(false);
    const log = h.session.log().map((e) => e.text);
    expect(log.some((t) => t.includes("Run set this board's status reports to include position, spindle, coolant and tool (saved on the board)"))).toBe(true);
  });

  it('a board whose list already holds what run needs is not written; sv 0 and an absurd si are set and read back', async () => {
    const h = await connected({ srList: RUN_SR_FIELDS, eeprom: { ...EN_LAYOUT, sv: 0, si: 5000 } });
    const config = writes(h).slice(writes(h).indexOf('{"si":null}\\n') + 1);
    expect(config).toEqual(['{sv:1}\\n', '{"sv":null}\\n', '{si:250}\\n', '{"si":null}\\n', '{"rt":null}\\n', `{"rt":{"hb":${HEARTBEAT_S}}}\\n`]);
    expect(model(h).srListWrites).toBe(0);
    expect(h.session.snapshot.reports.changes).toEqual([
      { setting: 'sv', from: 0, to: 1 },
      { setting: 'si', from: 5000, to: 250 },
    ]);
  });

  it('a second connect to the same board writes nothing: the list was saved', async () => {
    const eeprom = {};
    const first = await connected({ eeprom });
    expect(model(first).srListWrites).toBe(1);
    const again = await connected({ eeprom });
    expect(model(again).srListWrites).toBe(0);
    expect(writes(again).some((x) => x.startsWith('{sr:{'))).toBe(false);
    expect(again.session.snapshot.reports).toMatchObject({ phase: 'done', changes: [] });
  });

  it('firmware without rt: no heartbeat, the watchdog falls back to one ENQ after the idle window', async () => {
    const h = await connected({ rt: false });
    expect(h.session.snapshot.reports).toMatchObject({ phase: 'done', heartbeatMs: null });
    expect(writes(h).some((x) => x.startsWith('{"rt":{"hb"'))).toBe(false);
    const from = writes(h).length;
    await h.run(DEFAULT_TIMINGS.livenessIdleMs * 3);
    const later = writes(h).slice(from);
    expect(later.every((x) => x === '\\x05')).toBe(true);
    expect(later.length).toBeGreaterThanOrEqual(2);
    expect(later.length).toBeLessThanOrEqual(3);
    expect(h.session.snapshot.overlays).toEqual([]);
  });

});

describe('T-S102: nothing polls while idle', () => {
  it('after the connect sequence, a minute idle writes nothing at all: reports and the heartbeat are the liveness', async () => {
    const h = await connected();
    const from = writes(h).length;
    await h.run(60_000);
    expect(writes(h).slice(from)).toEqual([]);
    expect(h.session.snapshot.overlays).toEqual([]);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  });

  it('a move made by another program reaches the page by a pushed report, not a poll', async () => {
    const h = await connected();
    const from = writes(h).length;
    model(h).setMachinePosition({ x: 12.5, y: -3 });
    await h.run(2000);
    expect(h.session.snapshot.live.mpo).toMatchObject({ x: 12.5, y: -3 });
    expect(writes(h).slice(from)).toEqual([]);
  });
});

describe('T-S103: liveness', () => {
  it('no report or heartbeat for the silence window is STALE ("No reports from the board"); the next line clears it', async () => {
    const h = harness('en', {
      device: { start: 'ready' },
      session: { manifest: EN_APPROVED, release: PHASE_2_RELEASE },
      faults: { faults: [{ kind: 'latency', direction: 'toHost', fromMs: 10_000, toMs: 20_000, extraMs: 15_000 }] },
    });
    void h.session.connect(PORT);
    await h.run(9_999);
    expect(h.session.snapshot.reports.heartbeatMs).toBe(HEARTBEAT_INTERVAL_MS);
    expect(h.session.snapshot.overlays).toEqual([]);
    const from = writes(h).length;
    await h.run(DEFAULT_TIMINGS.reportSilenceMs + 1500);
    expect(h.session.snapshot.overlays).toContain('STALE');
    expect(h.session.snapshot.stale?.silentForMs).toBeGreaterThanOrEqual(DEFAULT_TIMINGS.reportSilenceMs);
    // Nothing is sent to ask: the heartbeat is the proof of life.
    expect(writes(h).slice(from)).toEqual([]);
    await h.run(30_000);
    expect(h.session.snapshot.overlays).not.toContain('STALE');
  });
});

describe('T-S104: homing', () => {
  it('homes the configured axes with one G28.2, confirms the end with polled reads, reads back, and is IDLE_HOMED', async () => {
    const h = await connected({ eeprom: { ...HOMING_EEPROM } });
    await readAxes(h);
    const from = writes(h).length;
    expect(req(h, { intent: 'home', axes: ['x', 'y', 'z'] })).toEqual({ allowed: true });
    expect(h.session.snapshot.base).toBe('HOMING');
    expect(req(h, { intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 }).allowed).toBe(false);
    await h.run(20_000);
    const w = writes(h).slice(from);
    expect(w[0]).toBe('G28.2 X0 Y0 Z0\\n');
    expect(w.filter((x) => x.startsWith('G'))).toEqual(['G28.2 X0 Y0 Z0\\n']);
    expect(w).toContain('{"hom":null}\\n');
    expect(w.at(-1)).toBe('{"home":null}\\n');
    const s = h.session.snapshot;
    expect(s.base).toBe('IDLE_HOMED');
    expect(s.live.home).toBe(1);
    expect(s.motion).toBeNull();
    expect(s.notices.change).toMatchObject({ kind: 'done' });
    expect(model(h).snapshot().homed.slice(0, 3)).toEqual([true, true, true]);
    // Polls during homing are bounded: the fallback check is at most once per homingCheckMs.
    expect(w.filter((x) => x === '{"stat":null}\\n').length).toBeLessThan(40);
  });

  it('refuses an axis without homing configured, and says why; nothing is written', async () => {
    const h = await connected({ eeprom: { ...HOMING_EEPROM } });
    const before = writes(h).length;
    const unread = req(h, { intent: 'home', axes: ['x'] });
    expect(unread).toMatchObject({ allowed: false });
    if (!unread.allowed) expect(unread.reason).toContain('were not read');
    await readAxes(h);
    const a = req(h, { intent: 'home', axes: ['x', 'a'] });
    expect(a).toMatchObject({ allowed: false });
    if (!a.allowed) {
      expect(a.reason).toContain('Homing is not configured for A (A: no switch is set for homing)');
      expect(a.remedy).toContain('G28.3');
    }
    expect(writes(h).slice(before).filter((x) => x.startsWith('G'))).toEqual([]);
    expect(req(h, { intent: 'home', axes: [] }).allowed).toBe(false);
  });

  it('Pause during homing ends it (!, then %): the machine is not homed, and the page says so', async () => {
    const h = await connected({ eeprom: { ...HOMING_EEPROM } });
    await readAxes(h);
    req(h, { intent: 'home', axes: ['x'] });
    await h.run(500);
    expect(h.session.snapshot.base).toBe('HOMING');
    const from = writes(h).length;
    expect(h.session.feedhold()).toEqual({ allowed: true });
    await h.run(5000);
    const w = writes(h).slice(from);
    expect(w[0]).toBe('!');
    expect(w).toContain('%');
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
    expect(h.session.snapshot.notices.change?.text).toContain('Homing stopped by Pause');
    expect(model(h).snapshot().homed[0]).toBe(false);
  });

  it('Stop job during homing runs the flush sequence with M5 and M9', async () => {
    const h = await connected({ eeprom: { ...HOMING_EEPROM } });
    await readAxes(h);
    req(h, { intent: 'home', axes: ['x'] });
    await h.run(500);
    const from = writes(h).length;
    h.session.stopJob();
    await h.run(5000);
    const w = writes(h).slice(from).filter((x) => !x.startsWith('{"'));
    expect(w).toEqual(['!', '%', 'M5\\n', 'M9\\n', 'G90\\n']);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  });
});

describe('T-S105: the ways out of UNKNOWN', () => {
  it('homing clears UNKNOWN when X, Y and Z are all homed', async () => {
    const h = await connected({ eeprom: { ...HOMING_EEPROM } }, { unknown: true });
    expect(h.session.snapshot.overlays).toEqual(['UNKNOWN']);
    expect(h.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    // The report configuration moves nothing, so it runs under UNKNOWN too.
    expect(h.session.snapshot.reports.phase).toBe('done');
    await readAxes(h);
    expect(req(h, { intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 }).allowed).toBe(false);
    expect(req(h, { intent: 'home', axes: ['x', 'y', 'z'] })).toEqual({ allowed: true });
    await h.run(20_000);
    expect(h.session.snapshot.overlays).toEqual([]);
    expect(h.session.snapshot.base).toBe('IDLE_HOMED');
  });

  it('homing only Z keeps UNKNOWN (X and Y are still unknown)', async () => {
    const h = await connected({ eeprom: { ...HOMING_EEPROM } }, { unknown: true });
    await readAxes(h);
    req(h, { intent: 'home', axes: ['z'] });
    await h.run(10_000);
    expect(h.session.snapshot.overlays).toEqual(['UNKNOWN']);
    expect(h.session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    expect(h.session.snapshot.notices.change?.kind).toBe('failed');
  });

  it('set machine position here (G28.3) on a machine without switches clears UNKNOWN once X, Y and Z are set', async () => {
    const h = await connected({}, { unknown: true });
    const from = writes(h).length;
    expect(req(h, { intent: 'setMachinePosition', axes: ['x', 'y', 'z'] })).toEqual({ allowed: true });
    await h.run(2000);
    const w = writes(h).slice(from);
    expect(w[0]).toBe('G28.3 X0 Y0 Z0\\n');
    expect(w.at(-1)).toBe('{"home":null}\\n');
    expect(h.session.snapshot.overlays).toEqual([]);
    expect(h.session.snapshot.base).toBe('IDLE_HOMED');
    expect(h.session.snapshot.live.mpo).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('"I\'ve checked the machine" clears UNKNOWN; the base follows the homing state', async () => {
    const h = await connected({}, { unknown: true });
    expect(req(h, { intent: 'positionVerify' })).toEqual({ allowed: true });
    expect(h.session.snapshot.overlays).toEqual([]);
    expect(h.session.snapshot.base).toBe('IDLE_UNHOMED');
  });
});

describe('T-S106: offsets, each read back once', () => {
  it('selects G55, sets work zero there (G10 L20 P2) and reads its offsets back', async () => {
    const h = await connected();
    req(h, { intent: 'jog', axes: { x: 1 }, distanceMm: 4, feed: 3000 });
    await h.run(2000);
    const from = writes(h).length;
    expect(req(h, { intent: 'selectCoordSystem', system: 2 })).toEqual({ allowed: true });
    await h.run(1000);
    expect(h.session.snapshot.live.coor).toBe(2);
    expect(req(h, { intent: 'setWorkZero', axes: ['x'] })).toEqual({ allowed: true });
    await h.run(1000);
    const w = writes(h).slice(from);
    expect(w.filter((x) => /^G/.test(x))).toEqual(['G55\\n', 'G10 L20 P2 X0\\n']);
    expect(w).toContain('{"g55":null}\\n');
    expect(h.session.snapshot.values['g55']?.value).toMatchObject({ x: 4 });
    expect(h.session.snapshot.live.pos.x).toBeCloseTo(0, 3);
    expect(h.session.snapshot.notices.change?.text).toContain('Work zero set for X');
  });

  it('a temporary offset (G92) makes the axes read 0 and is read back; G92.1 clears it', async () => {
    const h = await connected();
    req(h, { intent: 'jog', axes: { y: 1 }, distanceMm: 3, feed: 3000 });
    await h.run(2000);
    expect(req(h, { intent: 'tempOffset', axes: ['y'] })).toEqual({ allowed: true });
    await h.run(1000);
    expect(h.session.snapshot.values['g92']?.value).toMatchObject({ y: 3 });
    expect(h.session.snapshot.live.pos.y).toBeCloseTo(0, 3);
    expect(req(h, { intent: 'tempOffset', clear: true })).toEqual({ allowed: true });
    await h.run(1000);
    expect(h.session.snapshot.values['g92']?.value).toMatchObject({ y: 0 });
    expect(h.session.snapshot.live.pos.y).toBeCloseTo(3, 3);
    expect(writes(h).filter((x) => x.startsWith('G92'))).toEqual(['G92 Y0\\n', 'G92.1\\n']);
  });

  it('refuses a bad coordinate system and a second change while one runs', async () => {
    const h = await connected();
    expect(req(h, { intent: 'selectCoordSystem', system: 7 }).allowed).toBe(false);
    expect(req(h, { intent: 'selectCoordSystem', system: 1.5 }).allowed).toBe(false);
    expect(req(h, { intent: 'tempOffset', axes: [] }).allowed).toBe(false);
    expect(req(h, { intent: 'setMachinePosition', axes: [] }).allowed).toBe(false);
    expect(req(h, { intent: 'tempOffset', axes: ['x'] }).allowed).toBe(true);
    expect(req(h, { intent: 'tempOffset', clear: true }).allowed).toBe(false);
    expect(req(h, { intent: 'setWorkZero', axes: ['x'] }).allowed).toBe(false);
    expect(req(h, { intent: 'home', axes: ['x'] }).allowed).toBe(false);
    expect(req(h, { intent: 'setMachinePosition', axes: ['x'] }).allowed).toBe(false);
    expect(req(h, { intent: 'selectCoordSystem', system: 1 }).allowed).toBe(false);
  });
});
