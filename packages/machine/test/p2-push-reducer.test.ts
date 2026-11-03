/**
 * The push-driven connect sequence, homing and offsets on the pure reducer with scripted answers (amendment
 * 2026-11-02; T-S101–T-S106): the branches the firmware model does not reach on its own (refused and
 * mismatched report steps, damaged and missing answers, an alarm at connect, homing that ends unseen, a
 * refused G28.2 or G92, the heartbeat silence window).
 */
import { type ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_2_RELEASE } from '@synthetos/safety';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMINGS, HEARTBEAT_MS, RUN_SR_FIELDS, checkWrite, droView, phase1WriteVerdict, reportSteps, snapshotOf, srListLine, srListMatches, type SessionEffect, type SessionIntent } from '../src/index.ts';
import { Driver, EN_ANSWERS, TG_ANSWERS } from './sessionDriver.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

const OK = '{"r":{},"f":[3,0,10]}';
const num = (token: string, v: number): string => `{"r":{"${token}":${v}},"f":[3,0,10]}`;
const RUN_SR = `{"r":{"sr":{${RUN_SR_FIELDS.map((f) => `"${f}":0`).join(',')}}},"f":[3,0,10]}`;
const BASE: Record<string, string> = { ...EN_ANSWERS, gc: OK, clear: '{"r":{"clear":null},"f":[3,0,10]}' };

/** Connects in a motion session and answers everything up to the first report step (left unwritten). */
function toReports(patch: Record<string, string> = {}, options: { readonly unknown?: boolean } = {}): Driver {
  const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
  if (options.unknown === true) d.state = { ...d.state, unknownOnNextConnect: true };
  d.open();
  d.answer({ ...BASE, ...patch }, () => d.state.reports.phase === 'configuring');
  return d;
}

/** Writes the line being written and answers it with `reply`. */
function step(d: Driver, reply: string): string {
  const line = d.state.writing?.token as string;
  d.written();
  d.line(reply);
  return line;
}

const logs = (d: Driver): string[] => d.effects.filter((e): e is Extract<SessionEffect, { kind: 'log' }> => e.kind === 'log').map((e) => e.text);
const req = (d: Driver, r: SessionIntent) => d.intent(r);

describe('T-S101: report configuration branches', () => {
  it('pure steps: only what differs, then the heartbeat; the list shape fits a JSON line', () => {
    expect(reportSteps({ srList: RUN_SR_FIELDS, sv: 1, si: 250 }).map((s) => s.kind)).toEqual(['rtProbe', 'heartbeat']);
    expect(reportSteps({ srList: undefined, sv: undefined, si: undefined }).map((s) => s.kind)).toEqual(['srList', 'srReadback', 'rtProbe', 'heartbeat']);
    expect(reportSteps({ srList: [...RUN_SR_FIELDS].reverse(), sv: 2, si: 1001 }).map((s) => s.kind)).toEqual(['sv', 'svReadback', 'si', 'siReadback', 'rtProbe', 'heartbeat']);
    expect(srListMatches(undefined)).toBe(false);
    expect(srListMatches([...RUN_SR_FIELDS, 'tool'])).toBe(false);
    expect(srListLine().length).toBeLessThan(254);
    expect(srListLine()).not.toContain('ram');
  });

  it('a refused list write skips its read-back and is recorded; a refused heartbeat too; the configuration still ends', () => {
    const d = toReports({ rt: '{"r":{"rt":{"hb":0,"qt":"","up":5}},"f":[3,0,10]}' });
    expect(d.state.reports.step?.kind).toBe('srList');
    step(d, '{"r":{},"f":[3,100,10]}');
    expect(d.state.reports.step?.kind).toBe('rtProbe');
    step(d, '{"r":{"rt":{"hb":0,"qt":"","up":5}},"f":[3,0,10]}');
    expect(d.state.reports.step?.kind).toBe('heartbeat');
    step(d, '{"r":{},"f":[3,110,10]}');
    expect(d.state.reports).toMatchObject({ phase: 'done', heartbeatMs: null, changes: [] });
    expect(d.state.reports.detail).toBe(`the board refused ${srListLine()} (status 100); the board refused the heartbeat (status 110)`);
    expect(logs(d).at(-1)).toContain('reports: configured (heartbeat not available)');
  });

  it('sv and si are set and read back; a read-back that differs is said', () => {
    const d = toReports({ sv: num('sv', 0), si: num('si', 2000), sr: RUN_SR });
    expect(d.state.reports.step?.line).toBe('{sv:1}');
    step(d, num('sv', 1));
    step(d, num('sv', 0));
    expect(d.state.reports.step?.line).toBe('{si:250}');
    step(d, num('si', 250));
    step(d, '{"r":{},"f":[3,100,10]}');
    step(d, '{"r":{"rt":{"hb":0,"qt":"","up":5}},"f":[3,0,10]}');
    step(d, `{"r":{"rt":{"hb":${HEARTBEAT_MS}}},"f":[3,0,10]}`);
    expect(d.state.reports.changes).toEqual([
      { setting: 'sv', from: 0, to: 1 },
      { setting: 'si', from: 2000, to: 250 },
    ]);
    expect(d.state.reports.detail).toBe('sv reads back 0, not 1; si reads back null, not 250');
    expect(d.state.reports.heartbeatMs).toBe(HEARTBEAT_MS);
    expect(logs(d)).toContain('reports: Run changed sv from 0 to 1 (saved on the board)');
  });

  it('an sv or si that could not be read is left alone', () => {
    const d = toReports({ sr: RUN_SR, sv: '{"r":{},"f":[3,100,10]}', si: '{"r":{"si":"x"},"f":[3,0,10]}' });
    expect(d.state.reports.step?.kind).toBe('rtProbe');
  });

  it('a damaged answer to the watchdog\'s stat GET (no ENQ on this board) is ignored: the next ask follows', () => {
    const d = new Driver();
    d.open();
    d.answer(TG_ANSWERS);
    d.at += DEFAULT_TIMINGS.livenessIdleMs;
    d.fire('watchdog');
    expect(d.state.writing?.token).toBe('stat');
    d.written();
    d.line('{"r":{"stat":');
    expect(d.state.overlays).not.toContain('STALE');
  });

  it('a list read-back that is not run\'s list (or fails) is said', () => {
    const d = toReports();
    step(d, RUN_SR);
    step(d, '{"r":{},"f":[3,100,10]}');
    expect(d.state.reports.detail).toBe('the status report list read back is not the one run set');
    expect(d.state.reports.changes).toEqual([{ setting: 'sr' }]);
  });

  it('a damaged answer, or none, fails the configuration (and an unanswered one is STALE)', () => {
    const garbled = toReports();
    garbled.written();
    garbled.line('{"r":{"sr":');
    expect(garbled.state.reports).toMatchObject({ phase: 'failed', detail: `the answer to ${srListLine()} arrived damaged` });
    const readback = toReports();
    step(readback, RUN_SR);
    readback.written();
    readback.line('{"r":{"sr":');
    expect(readback.state.reports.detail).toBe('the answer to {"sr":null} arrived damaged');
    const silent = toReports();
    silent.written();
    silent.fire('answer');
    expect(silent.state.reports).toMatchObject({ phase: 'failed', detail: 'the board did not answer the sr read in time' });
    expect(silent.state.overlays).toContain('STALE');
    expect(logs(silent).at(-1)).toContain('reports: not configured');
  });

  it('a FAULT while configuring fails it; a second failure changes nothing', () => {
    const d = toReports();
    d.line('{"er":{"fb":450.01,"st":20,"msg":"x"}}');
    expect(d.state.overlays).toContain('FAULT');
    expect(d.state.reports.phase).toBe('failed');
    d.line('{"er":{"fb":450.01,"st":21,"msg":"y"}}');
    expect(d.state.reports.detail).toBe('a fault latched');
  });

  it('the connect-time read: a damaged answer leaves that value unknown, a missing one fails the read', () => {
    const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    d.open();
    d.answer(BASE, (t) => t === 'tool' && d.state.reports.phase === 'seeding');
    d.written();
    d.line('{"r":{"tool":');
    expect(d.state.values['tool']).toMatchObject({ value: null, status: -1 });
    d.answer(BASE, (t) => t === 'sps');
    d.written();
    d.fire('answer');
    expect(d.state.reports).toMatchObject({ phase: 'failed', detail: 'the board did not answer the sps read in time' });
  });

  it('a board in alarm at connect is configured only once the alarm is cleared', () => {
    const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
    d.open();
    d.answer({ ...BASE, stat: num('stat', 2) }, () => d.state.reports.phase === 'pending');
    d.answer({ ...BASE, stat: num('stat', 2) });
    expect(d.state.base).toBe('ALARM');
    expect(d.state.reports.phase).toBe('pending');
    expect(req(d, { intent: 'clearAlarm' })).toEqual({ allowed: true });
    d.answer({ ...BASE, stat: num('stat', 1) }, () => d.state.reports.phase === 'configuring');
    expect(d.state.base).toBe('IDLE_UNHOMED');
    expect(d.state.reports.step?.kind).toBe('srList');
  });

  it('with the heartbeat on, silence for the window is STALE and nothing is sent; any line clears it', () => {
    const d = toReports({ sr: RUN_SR, rt: '{"r":{"rt":{"hb":0,"qt":"","up":5}},"f":[3,0,10]}' });
    step(d, '{"r":{"rt":{"hb":0,"qt":"","up":5}},"f":[3,0,10]}');
    step(d, `{"r":{"rt":{"hb":${HEARTBEAT_MS}}},"f":[3,0,10]}`);
    expect(d.state.link).toEqual({ heartbeatMs: HEARTBEAT_MS, silenceMs: DEFAULT_TIMINGS.reportSilenceMs });
    expect(d.last).toContainEqual(expect.objectContaining({ kind: 'armTimer', id: 'watchdog', ms: DEFAULT_TIMINGS.reportSilenceMs }));
    const before = d.effects.length;
    d.at += DEFAULT_TIMINGS.reportSilenceMs;
    d.fire('watchdog');
    expect(d.state.overlays).toContain('STALE');
    expect(d.effects.slice(before).some((e) => e.kind === 'writeLine' || e.kind === 'writeRealtime')).toBe(false);
    d.line('{"hb":{"stat":1,"hold":0,"up":9000,"qt":""}}');
    expect(d.state.overlays).not.toContain('STALE');
    expect(d.state.live.stat).toBe(1);
  });
});

/** A connected, configured motion session with homing settings read. */
function idle(patch: Record<string, string> = {}, options: { readonly unknown?: boolean } = {}): Driver {
  const d = new Driver({ release: PHASE_2_RELEASE, manifest: EN_APPROVED });
  if (options.unknown === true) d.state = { ...d.state, unknownOnNextConnect: true };
  d.open();
  d.answer({ ...BASE, ...patch });
  req(d, { intent: 'read', tokens: ['x'] });
  d.answer({ ...BASE, x: '{"r":{"x":{"am":1,"sn":0,"sx":1,"sv":500,"tn":0,"tm":100,"lb":2}},"f":[3,0,10]}', ...patch });
  return d;
}

describe('T-S104: homing branches', () => {
  it('ends after three resting polls when the cycle was never seen running', () => {
    const d = idle();
    expect(req(d, { intent: 'home', axes: ['x'] })).toEqual({ allowed: true });
    d.answer({ ...BASE, gc: OK, stat: num('stat', 1), vel: num('vel', 0) }, (t) => t === 'qr');
    step(d, num('qr', 32));
    expect(d.state.motion?.phase).toBe('homing');
    d.fire('motion');
    d.answer({ ...BASE }, (t) => t === 'qr');
    step(d, num('qr', 32));
    expect(d.state.motion?.phase).toBe('homing');
    d.answer({ ...BASE }, (t) => t === 'qr');
    step(d, num('qr', 32));
    expect(d.state.motion?.phase).toBe('readback');
    d.answer({ ...BASE, home: num('home', 0) });
    expect(d.state.motion).toBeNull();
    expect(d.state.notices.change?.text).toContain('does not report X, Y and Z all homed');
  });

  it('a pushed report: homing (stat 9) is seen; a resting stat asks for a confirming poll; an alarm during the read-back keeps ALARM', () => {
    const d = idle();
    req(d, { intent: 'home', axes: ['x'] });
    step(d, OK);
    d.answer({ ...BASE, stat: num('stat', 9), vel: num('vel', 5), qr: num('qr', 31) });
    d.line('{"sr":{"stat":9}}');
    expect(d.state.motion?.seen).toBe(true);
    d.line('{"sr":{"posx":1}}');
    d.line('{"sr":{"stat":3}}');
    expect(d.state.writing?.token).toBe('stat');
    d.answer({ ...BASE, stat: num('stat', 3), hold: num('hold', 0) }, (t) => t === 'qr');
    step(d, num('qr', 32));
    d.answer({ ...BASE, stat: num('stat', 3), hold: num('hold', 0) }, (t) => t === 'qr');
    step(d, num('qr', 32));
    expect(d.state.motion?.phase).toBe('readback');
    d.answer({ ...BASE }, (t) => t === 'home');
    d.line('{"sr":{"stat":2}}');
    expect(d.state.base).toBe('ALARM');
    step(d, num('home', 1));
    expect(d.state.base).toBe('ALARM');
  });

  it('a G28.2 the board refuses ends the homing without a hold, and reads the homing state back', () => {
    const d = idle();
    req(d, { intent: 'home', axes: ['x'] });
    const from = d.effects.length;
    step(d, '{"r":{},"f":[3,246,10]}');
    expect(d.state.motion).toBeNull();
    expect(d.state.base).toBe('IDLE_UNHOMED');
    expect(d.state.notices.change).toMatchObject({ kind: 'refused' });
    expect(d.effects.slice(from).some((e) => e.kind === 'writeRealtime')).toBe(false);
    expect([d.state.writing?.token, ...d.state.queue.map((q) => q.token)]).toEqual(['hom', 'home']);
  });
});

describe('T-S106: offset branches', () => {
  it('Set work zero needs a known G54..G59; a refused G92 says so; a refused M3 too', () => {
    const g53 = idle({ coor: num('coor', 0) });
    expect(req(g53, { intent: 'setWorkZero', axes: ['x'] })).toMatchObject({ allowed: false, remedy: 'Select G54 to G59 first.' });
    const unknown = idle({ coor: '{"r":{},"f":[3,100,10]}' });
    expect(req(unknown, { intent: 'setWorkZero', axes: ['x'] }).allowed).toBe(false);
    const d = idle();
    req(d, { intent: 'tempOffset', axes: ['x'] });
    step(d, '{"r":{},"f":[3,100,10]}');
    expect(d.state.notices.change).toMatchObject({ kind: 'refused', text: 'The controller refused G92 X0 (status 100).' });
    expect(d.state.motion).toBeNull();
    req(d, { intent: 'spindleOn', output: 'spindle', direction: 'cw', rpm: 1000 });
    step(d, '{"r":{},"f":[3,100,10]}');
    expect(d.state.notices.motion).toMatchObject({ kind: 'refused' });
  });

  it('the DRO shows a dash for an axis the reports never carried', () => {
    const d = idle();
    const s = snapshotOf(d.state);
    const v = droView({ ...s, live: { ...s.live, pos: {} } }, 0);
    expect(v.axes[0]?.work).toBeNull();
  });
});

describe('the write gate: report configuration lines (H64)', () => {
  const enc = (t: string) => new TextEncoder().encode(`${t}\n`);
  const ctx = { readable: () => false, enqAllowed: false };

  it('admits a configuration shape only as the step in progress, and only with a reports release', () => {
    expect(phase1WriteVerdict(enc('{sv:1}'), ctx)).toMatchObject({ ok: false, reason: 'report configuration is not allowed in this release' });
    expect(phase1WriteVerdict(enc('{sv:1}'), { ...ctx, reportWritable: () => false })).toMatchObject({ ok: false });
    expect(phase1WriteVerdict(enc('{sv:1}'), { ...ctx, reportWritable: () => true })).toEqual({ ok: true, kind: 'report' });
    expect(phase1WriteVerdict(enc('{sr:{stat:true,mpox:true}}'), { ...ctx, reportWritable: () => true })).toEqual({ ok: true, kind: 'report' });
    for (const bad of ['{sr:{stat:true,md:true}}', '{ram:1,sr:{stat:true}}', '{sv:2}', '{si:5}', '{"rt":{"unsaved":null}}', '{"rt":{"hb":1}}', '{sr:{}}']) {
      expect(phase1WriteVerdict(enc(bad), { ...ctx, reportWritable: () => true }).ok, bad).toBe(false);
    }
    const d = toReports();
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc(srListLine()), 'configureReports')).toBeUndefined();
    expect(checkWrite(d.state, d.state, PHASE_2_RELEASE, enc('{sv:1}'), 'configureReports')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(d.state, d.state, { ...PHASE_2_RELEASE, reports: false }, enc(srListLine()), 'configureReports')).toMatchObject({ kind: 'denied' });
  });
});
