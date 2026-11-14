import { describe, expect, it } from 'vitest';
import { PHASE_1_RELEASE, PHASE_2_RELEASE, withJobs } from '@synthetos/safety';
import { TINYG_EN, type ApprovedBuilds } from '@synthetos/protocol';
import { FirmwareSession } from '../src/session/firmwareSession.ts';
import { firmwareReducer, firmwareRuntime, firmwareWrite } from '../src/session/firmwareRuntime.ts';
import type { SessionState } from '../src/session/types.ts';
import { createSessionReducer } from '../src/session/reducerCore.ts';
import { workspaceReducerFeatures } from '../src/session/workspaceReducerFeatures.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';
import type { SessionIntent, SessionEvent } from '../src/session/types.ts';
import { classifyLine } from '@synthetos/protocol';
import { harness } from './sessionHarness.ts';
import { PORT, SimTransport, simSource, shown } from './simTransport.ts';
const release = { ...PHASE_1_RELEASE, name: 'Firmware only', settings: true, flash: true, reports: true, motion: false, jobs: false };
const manifest: ApprovedBuilds = { environment: 'staging', builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }] };
const enc = new TextEncoder();
function ready(): SessionState {
  return { ...firmwareReducer.initialState(), base: 'CONNECTED_UNKNOWN', ready: true, dialect: TINYG_EN, footerRev: 3 };
}
function check(state: SessionState, text: string, intent: Parameters<typeof firmwareWrite>[4] = 'read') { return firmwareWrite(state, state, release, enc.encode(text), intent); }

describe('firmware session uses the common connection and restore gates', () => {
  it('identifies the test board with reads and performs a gated, read-back settings write', async () => {
    const h = harness('en');
    const writes: string[] = [];
    const source = simSource(() => {
      const transport = new SimTransport(h.endpoint);
      const original = transport.writeLine.bind(transport);
      transport.writeLine = async bytes => { writes.push(shown(bytes)); await original(bytes); };
      return transport;
    });
    const session = new FirmwareSession({ source, clock: h.clock, release, manifest });
    void session.connect(PORT);
    await h.run(6000);
    expect(session.snapshot.classification?.mode).toBe('full');
    expect(session.snapshot.base).toBe('CONNECTED_UNKNOWN');
    expect(writes.filter(line => !/^(?:\{sr:null\}|\{"[a-z0-9_]+":null\})\\n$/.test(line) && line !== '\\x05')).toEqual([]);
    expect(session.writeSetting('xvm', 1234).allowed).toBe(true);
    await h.run(2000);
    expect(session.snapshot.settingWrite?.outcome).toBe('verified');
    const at = writes.indexOf('{"xvm":1234}\\n');
    expect(at).toBeGreaterThan(0);
    expect(writes.slice(at - 5, at)).toEqual(['{"stat":null}\\n', '{"hold":null}\\n', '{"vel":null}\\n', '{"qr":null}\\n', '{"unit":null}\\n']);
    expect(writes[at + 1]).toBe('{"xvm":null}\\n');
    expect(session.request({ intent: 'loadJob', job: { name: 'x', text: 'G1 X1', c22: true } }).allowed).toBe(false);
    expect(session.request({ intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 10 }).allowed).toBe(false);
    await session.disconnect();
  });
  it('a restore acknowledgement clears only UNKNOWN and emits no machine write', () => {
    const d = new Driver({ release, manifest });
    const out = firmwareReducer.reduce(d.config, { ...ready(), overlays: ['UNKNOWN', 'NEEDS_REVIEW'] }, { type: 'intent', at: 0, request: { intent: 'positionVerify' } });
    expect(out.state.overlays).toEqual(['NEEDS_REVIEW']);
    expect(out.state.base).toBe('CONNECTED_UNKNOWN');
    expect(out.effects).toContainEqual(expect.objectContaining({ kind: 'decision', decision: { allowed: true } }));
    expect(out.effects.some(e => e.kind === 'writeLine' || e.kind === 'writeRealtime')).toBe(false);
  });
  it('projects an inert job/probe view', () => {
    const snapshot = firmwareRuntime.snapshotOf(ready());
    expect(snapshot.job).toBeNull();
    expect(snapshot.probeZ).toMatchObject({ step: 'closed', plateOut: false, plan: null });
  });
});

describe('firmware byte gate', () => {
  it('allows only exact allowlisted reads and never control bytes or G-code', () => {
    const s = ready();
    expect(check(s, '{"fb":null}\n')).toBeUndefined();
    expect(check(s, '{sr:null}\n')).toBeUndefined();
    for (const text of ['', 'x'.repeat(41), 'x'.repeat(33), 'G1 X1\n', 'M3\n', '\x18', 'é', '{"clear":null}\n', '{"unknown":null}\n', '{"fb":null}\n\n', '{"fb":null}']) expect(check(s, text), text).toBeDefined();
    expect(check(firmwareReducer.initialState(), '{"fb":null}\n')).toMatchObject({ kind: 'denied' });
  });
  it('ENQ requires its exact byte and a classified footer revision that supports it', () => {
    const s = ready();
    expect(check(s, '\x05', 'enq')).toBeUndefined();
    for (const text of ['!', '\x05\x05', '']) expect(check(s, text, 'enq')).toBeDefined();
    expect(check({ ...s, footerRev: undefined }, '\x05', 'enq')).toBeDefined();
  });
  it('normalizes identity replies only while the negotiation is in progress', () => {
    const probe = { next: 0, answers: [], banner: undefined, spliceRetried: false, settling: 'none' as const, restarts: 0, backlog: 0, normalized: true, normalizing: true };
    const s = { ...ready(), probe };
    expect(check(s, '{jv:4}\n', 'configureReports')).toBeUndefined();
    expect(check(s, '{"sv":1}\n', 'configureReports')).toBeDefined();
    expect(check({ ...s, probe: { ...probe, normalizing: false } }, '{jv:4}\n', 'configureReports')).toBeDefined();
  });
  it('boot requires the exact line in the writing phase', () => {
    const s: SessionState = { ...ready(), bootEntry: { phase: 'writing', gate: {} } };
    expect(check(s, '{"boot":1}\n', 'flash')).toBeUndefined();
    expect(check(s, '{"boot":0}\n', 'flash')).toBeDefined();
    expect(check(ready(), '{"boot":1}\n', 'flash')).toBeDefined();
    expect(check({ ...s, bootEntry: { phase: 'gate', gate: {} } }, '{"boot":1}\n', 'flash')).toBeDefined();
  });
  it('a SET must be the exact writing step and pass the schema', () => {
    const s: SessionState = { ...ready(), settingWrite: { id: 1, key: 'xvm', value: 1234, phase: 'writing', gate: {} } };
    expect(check(s, '{"xvm":1234}\n', 'settingsWrite')).toBeUndefined();
    for (const text of ['{"yvm":1234}\n', '{"xvm":1235}\n', '{"fb":null}\n']) expect(check(s, text, 'settingsWrite')).toBeDefined();
    expect(check(ready(), '{"xvm":1234}\n', 'settingsWrite')).toBeDefined();
    expect(check({ ...s, dialect: null }, '{"xvm":1234}\n', 'settingsWrite')).toBeDefined();
    expect(check({ ...s, settingWrite: { ...s.settingWrite!, phase: 'readback' } }, '{"xvm":1234}\n', 'settingsWrite')).toBeDefined();
    expect(check({ ...s, settingWrite: { ...s.settingWrite!, key: 'boot', value: 1 } }, '{"boot":1}\n', 'settingsWrite')).toBeDefined();
  });
  it('the executor refuses control-tagged lines and realtime output', () => {
    const s = ready();
    const line = { epoch: 0, seq: 1, bytes: enc.encode('{"fb":null}\n'), emitted: s };
    expect(firmwareRuntime.checkLine(s, s, release, line)).toBeUndefined();
    for (const extra of [{ motion: 'jog' as const }, { job: 0 }, { lineMode: true as const }, { jobRuntime: true as const }]) expect(firmwareRuntime.checkLine(s, s, release, { ...line, ...extra })).toBeDefined();
    for (const extra of [{ boot: true as const }, { setting: true as const }, { report: true as const }]) expect(firmwareRuntime.checkLine(s, s, release, { ...line, ...extra })).toBeDefined();
    expect(firmwareRuntime.checkRealtime(s, release, enc.encode('\x05'), 'enq')).toBeUndefined();
    expect(firmwareRuntime.checkRealtime(s, release, enc.encode('!'), 'feedhold')).toBeDefined();
  });
});

/** Deliberately misconfigured releases cannot supply control implementations to this reducer. */
describe('missing workspace extensions fail closed', () => {
  const controlRelease = withJobs(PHASE_2_RELEASE, 'staging');
  function connectedDriver() {
    const d = new Driver({ release: controlRelease, manifest });
    d.open(); d.answer(EN_ANSWERS);
    return d;
  }
  it('refuses workspace intents even when a caller supplies a control-enabled release', () => {
    const d = connectedDriver();
    const requests: SessionIntent[] = [
      { intent: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 10 },
      { intent: 'typedMove', line: 'G1 X1', lowZ: null },
      { intent: 'loadJob', job: { name: 'part.nc', text: 'G1 X1', c22: true } },
      { intent: 'startJob', breakpoints: [], confirm: { unhomed: true, workZero: true, spindle: true } },
      { intent: 'jobBreakpoints', lines: [] },
      { intent: 'probeZClose', step: 'cancel' },
    ];
    for (const request of requests) {
      const out = firmwareReducer.reduce(d.config, d.state, { type: 'intent', at: 0, request });
      expect(out.effects).toContainEqual(expect.objectContaining({ kind: 'decision', decision: expect.objectContaining({ allowed: false, reason: 'This session only updates firmware.' }) }));
      expect(out.effects.some(e => e.kind === 'writeLine' || e.kind === 'writeRealtime')).toBe(false);
    }
    const partial = createSessionReducer({ jobActive: () => true });
    const out = partial.reduce(d.config, { ...d.state, base: 'HELD' }, { type: 'intent', at: 0, request: { intent: 'resume' } });
    expect(out.effects).toContainEqual(expect.objectContaining({ kind: 'decision', decision: expect.objectContaining({ allowed: false, reason: 'This session only updates firmware.' }) }));
    d.intent({ intent: 'loadJob', job: { name: 'part.nc', text: 'G1 X1', c22: true } });
    expect(d.state.job).not.toBeNull();
    expect(firmwareRuntime.snapshotOf(d.state).job).toBeNull();
  });
  it('does not infer workspace idle state from home reads without the workspace projection', () => {
    const d = connectedDriver();
    for (const purpose of ['poll', 'seed'] as const) {
      const s = { ...d.state, base: 'IDLE_UNHOMED' as const, queue: [], writing: null, expected: [{ token: 'home', purpose, late: false }] };
      const event: SessionEvent = { type: 'inbound', epoch: s.epoch, at: 100, event: classifyLine(EN_ANSWERS.home!) };
      expect(firmwareReducer.reduce(d.config, s, event).state.base).toBe('CONNECTED_UNKNOWN');
    }
  });
  it('connects conservatively when motion capability exists without an idle-state projection', () => {
    const { idleBase: _idle, ...features } = workspaceReducerFeatures;
    const reducer = createSessionReducer(features);
    class PartialDriver extends Driver {
      override feed(event: SessionEvent) {
        const out = reducer.reduce(this.config, this.state, event);
        this.state = out.state; this.last = out.effects; this.effects.push(...out.effects);
        return out.effects;
      }
    }
    const d = new PartialDriver({ release: controlRelease, manifest });
    d.open(); d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
  });
});
