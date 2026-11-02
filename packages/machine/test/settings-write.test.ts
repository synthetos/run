/**
 * Settings writes in the machine session (SAFETY §4.6, H57-H63, T-S95..T-S99,
 * amendment 2026-11-02): one token at a time, each answer awaited before any
 * other line, the idle gate read right before each write, the read-back,
 * refusals that never write, forbidden keys, and the write gate's own
 * `setting` command kind.
 */
import { describe, expect, it } from 'vitest';
import type { ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_1_RELEASE, PHASE_1_SETTINGS_RELEASE } from '@synthetos/safety';
import { TINYG_440, TINYG_EN } from '@synthetos/protocol';
import { checkWrite, gateTokens, judgeGate, MachineSession, phase1WriteVerdict, sessionSettings, settingLine, settingRefusal, wireNumber, type SessionEffect } from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';
import { harness } from './sessionHarness.ts';
import { PORT, shown } from './simTransport.ts';

const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

const ANSWERS: Readonly<Record<string, string>> = { ...EN_ANSWERS, unit: '{"r":{"unit":1},"f":[3,0,10]}' };
const GATE_LINES = ['{"stat":null}', '{"hold":null}', '{"vel":null}', '{"qr":null}', '{"unit":null}'];

function ready(options: { release?: typeof PHASE_1_RELEASE; manifest?: ApprovedBuilds | null } = {}): Driver {
  const d = new Driver({ release: options.release ?? PHASE_1_SETTINGS_RELEASE, ...(options.manifest === null ? {} : { manifest: options.manifest ?? EN_APPROVED }) });
  d.open();
  d.answer(ANSWERS);
  expect(d.state.base).toBe('CONNECTED_UNKNOWN');
  return d;
}

const lineEffects = (effects: readonly SessionEffect[]) => effects.filter((e) => e.kind === 'writeLine') as Extract<SessionEffect, { kind: 'writeLine' }>[];

/** Answers the gate reads from `answers`, then stops at the settings line (not yet written). */
function passGate(d: Driver, answers: Readonly<Record<string, string>> = ANSWERS): void {
  d.answer(answers, (token) => d.state.writing?.purpose === 'setting' || d.state.writing?.purpose === 'readback' || token === '');
}

describe('settings writes: the gates before anything is written', () => {
  it('Phase 1 (no settings release) denies them; the settings release on an unapproved (READ_ONLY) board denies them', () => {
    const p1 = ready({ release: PHASE_1_RELEASE });
    expect(p1.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 })).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
    const ro = ready({ manifest: null });
    expect(ro.state.overlays).toContain('READ_ONLY');
    expect(ro.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 })).toMatchObject({ allowed: false });
    for (const d of [p1, ro]) expect(d.lines().some((l) => l.includes('1234'))).toBe(false);
  });

  it('forbidden, identity, read-only and unreviewed keys are refused at the intent, and nothing is written', () => {
    const d = ready();
    const cases: [string, number][] = [
      ['hv', 8], ['fb', 450.01], ['fv', 0.97], ['id', 1], ['baud', 5], ['ex', 1], ['ej', 1], ['jv', 4], ['js', 0], ['rxm', 1], ['boot', 1], ['defa', 1],
      ['rt', 1], ['rthb', 1], ['spe', 1], ['sps', 1000], ['cof', 1], ['md', 1], ['me', 1], ['se00', 1], ['jogx', 1], ['si', 250], ['ee', 1], ['ec', 1], ['XVM', 5], ['zzz', 1],
    ];
    for (const [key, value] of cases) {
      const decision = d.intent({ intent: 'settingsWrite', key, value });
      expect(decision.allowed, key).toBe(false);
    }
    expect(d.intent({ intent: 'settingsWrite', key: 'xvm', value: Number.NaN }).allowed).toBe(false);
    expect(d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1e30 }).allowed).toBe(false);
    expect(d.state.settingWrite).toBeNull();
    expect(d.lines().filter((l) => !l.endsWith(':null}') && l !== '{sr:null}')).toEqual([]);
  });

  it('the idle gate is read right before the write, and a board that is not idle, holding, moving, queued or in inches is not written', () => {
    const notIdle: [string, Record<string, string>, RegExp][] = [
      ['running', { stat: '{"r":{"stat":5},"f":[3,0,10]}' }, /not idle/],
      ['holding', { hold: '{"r":{"hold":4},"f":[3,0,10]}' }, /holding/],
      ['moving', { vel: '{"r":{"vel":12.5},"f":[3,0,10]}' }, /moving/],
      ['queued', { qr: '{"r":{"qr":30},"f":[3,0,10]}' }, /moves queued/],
      ['inches', { unit: '{"r":{"unit":0},"f":[3,0,10]}' }, /inches/],
      ['unreadable', { qr: '{"r":{},"f":[3,100,10]}' }, /did not answer the qr read/],
    ];
    for (const [name, patch, words] of notIdle) {
      const d = ready();
      expect(d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 }).allowed, name).toBe(true);
      expect(d.state.settingWrite).toMatchObject({ phase: 'gate', key: 'xvm', value: 1234 });
      passGate(d, { ...ANSWERS, ...patch });
      expect(d.state.settingWrite, name).toMatchObject({ phase: 'done', outcome: 'refused' });
      expect(d.state.settingWrite?.detail, name).toMatch(words);
      expect(d.lines().some((l) => l.startsWith('{"xvm":1234')), name).toBe(false);
    }
  });
});

describe('settings writes: one at a time, the answer awaited, the read-back compared', () => {
  it('writes gate GETs, then {"xvm":1234}, then reads xvm back; verified when the read-back matches', () => {
    const d = ready();
    const before = d.lines().length;
    expect(d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 }).allowed).toBe(true);
    passGate(d);
    expect(d.state.writing).toMatchObject({ token: 'xvm', purpose: 'setting' });
    const written = lineEffects(d.effects).at(-1);
    expect(written).toMatchObject({ line: '{"xvm":1234}', intent: 'settingsWrite' });
    d.written();
    d.line('{"r":{"xvm":1234},"f":[3,0,10]}');
    expect(d.state.writing).toMatchObject({ token: 'xvm', purpose: 'readback' });
    d.written();
    d.line('{"r":{"xvm":1234.000},"f":[3,0,10]}');
    expect(d.state.settingWrite).toMatchObject({ id: 1, phase: 'done', outcome: 'verified', readBack: 1234, answer: { status: 0, value: 1234 } });
    expect(d.lines().slice(before)).toEqual([...GATE_LINES, '{"xvm":1234}', '{"xvm":null}']);
    expect(d.state.values['xvm']).toMatchObject({ value: 1234, status: 0 });
  });

  it('a second write is refused until the first is done, then accepted with the next id', () => {
    const d = ready();
    expect(d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 }).allowed).toBe(true);
    expect(d.intent({ intent: 'settingsWrite', key: 'yvm', value: 1000 })).toMatchObject({ allowed: false, reason: 'One setting at a time: the last write has not finished.' });
    passGate(d);
    d.written();
    expect(d.intent({ intent: 'settingsWrite', key: 'yvm', value: 1000 }).allowed).toBe(false);
    d.line('{"r":{"xvm":1234},"f":[3,0,10]}');
    expect(d.intent({ intent: 'settingsWrite', key: 'yvm', value: 1000 }).allowed).toBe(false);
    d.written();
    d.line('{"r":{"xvm":1234},"f":[3,0,10]}');
    expect(d.intent({ intent: 'settingsWrite', key: 'yvm', value: 1000 }).allowed).toBe(true);
    expect(d.state.settingWrite).toMatchObject({ id: 2, key: 'yvm', phase: 'gate' });
  });

  it('nothing else is written while the write is unanswered: a read asked for meanwhile waits for the answer (EEPROM stall)', () => {
    const d = ready();
    d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    passGate(d);
    d.written();
    const linesBefore = d.lines().length;
    expect(d.intent({ intent: 'read', tokens: ['posx'] }).allowed).toBe(true);
    expect(d.lines().length).toBe(linesBefore);
    expect(d.state.writing).toBeNull();
    d.line('{"r":{"xvm":1234},"f":[3,0,10]}');
    // The read-back goes first (it was queued ahead), then the read.
    expect(d.lines().slice(linesBefore)).toEqual(['{"xvm":null}']);
  });

  it('a read-back that differs is a mismatch; a non-zero answer is rejected and nothing is read back', () => {
    const m = ready();
    m.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    passGate(m);
    m.written();
    m.line('{"r":{"xvm":1234},"f":[3,0,10]}');
    m.written();
    m.line('{"r":{"xvm":1200},"f":[3,0,10]}');
    expect(m.state.settingWrite).toMatchObject({ outcome: 'mismatch', readBack: 1200 });
    expect(m.state.settingWrite?.detail).toMatch(/reads back 1200, not 1234/);

    const r = ready();
    r.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    passGate(r);
    r.written();
    r.line('{"r":{},"f":[3,108,10]}');
    expect(r.state.settingWrite).toMatchObject({ outcome: 'rejected', answer: { status: 108 } });
    expect(r.lines().at(-1)).toBe('{"xvm":1234}');
  });

  it('an er 106 while the write is answered is a refusal of that write, not a FAULT', () => {
    const d = ready();
    d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    passGate(d);
    d.written();
    d.line('{"er":{"fb":450.01,"st":106,"msg":"COMMAND_NOT_ACCEPTED - Can\'t save when moving"}}');
    expect(d.state.overlays).not.toContain('FAULT');
    d.line('{"r":{"xvm":1234},"f":[3,106,10]}');
    expect(d.state.settingWrite).toMatchObject({ outcome: 'rejected', exception: 106 });
  });

  it('an unanswered write is unconfirmed (STALE), and a FAULT or a lost link interrupts a write in progress', () => {
    const t = ready();
    t.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    passGate(t);
    t.written();
    t.fire('answer');
    expect(t.state.settingWrite).toMatchObject({ outcome: 'unconfirmed' });
    expect(t.state.overlays).toContain('STALE');

    const f = ready();
    f.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    passGate(f);
    f.written();
    f.line('{"r":{"nobody":1},"f":[3,0,10]}');
    expect(f.state.overlays).toContain('FAULT');
    expect(f.state.settingWrite).toMatchObject({ outcome: 'interrupted' });

    const l = ready();
    l.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    l.feed({ type: 'linkLost', epoch: l.state.epoch, at: 0 });
    expect(l.state.settingWrite).toMatchObject({ outcome: 'refused' });
  });
});

describe('the write gate: settings lines are their own command kind', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('a settings line is refused unless the context says it is the write being made', () => {
    expect(phase1WriteVerdict(enc('{"xvm":1234}\n'), { readable: () => true, enqAllowed: false })).toMatchObject({ ok: false, reason: 'settings writes are not allowed in this release' });
    expect(phase1WriteVerdict(enc('{"xvm":1234}\n'), { readable: () => true, enqAllowed: false, settingWritable: () => false })).toMatchObject({ ok: false });
    expect(phase1WriteVerdict(enc('{"xvm":1234}\n'), { readable: () => true, enqAllowed: false, settingWritable: (k, v) => k === 'xvm' && v === 1234 })).toEqual({ ok: true, kind: 'setting', token: 'xvm' });
    for (const bad of ['{"xvm":1e3}\n', '{"xvm":"1"}\n', '{"xvm":1234,"hv":8}\n', '{xvm:1234}\n', '{"xvm":1234}', '{"xvm":-}\n', '{"XVM":1}\n']) {
      expect(phase1WriteVerdict(enc(bad), { readable: () => true, enqAllowed: false, settingWritable: () => true }).ok, bad).toBe(false);
    }
  });

  it('checkWrite: denied without the settings release; refused when the line is not the current write, or issued as a read', () => {
    const d = ready();
    d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    passGate(d);
    const s = d.state;
    expect(checkWrite(s, s, PHASE_1_SETTINGS_RELEASE, enc('{"xvm":1234}\n'), 'settingsWrite')).toBeUndefined();
    expect(checkWrite(s, s, PHASE_1_RELEASE, enc('{"xvm":1234}\n'), 'settingsWrite')).toMatchObject({ kind: 'denied' });
    expect(checkWrite(s, s, PHASE_1_SETTINGS_RELEASE, enc('{"xvm":1235}\n'), 'settingsWrite')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(s, s, PHASE_1_SETTINGS_RELEASE, enc('{"hv":8}\n'), 'settingsWrite')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(s, s, PHASE_1_SETTINGS_RELEASE, enc('{"xvm":1234}\n'), 'read')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(s, s, PHASE_1_SETTINGS_RELEASE, enc('{"xvm":null}\n'), 'settingsWrite')).toMatchObject({ kind: 'refused' });
  });

  it('formats values as plain decimals and refuses what cannot be one', () => {
    expect(wireNumber(1234)).toBe('1234');
    expect(wireNumber(-12.5)).toBe('-12.5');
    expect(wireNumber(0.0001)).toBe('0.0001');
    expect(wireNumber(1e-9)).toBeNull();
    expect(wireNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(settingLine('1sa', 1.8)).toBe('{"1sa":1.8}');
    expect(settingLine('x"y', 1)).toBeNull();
  });
});

describe('settings writes against the edge-next model with an EEPROM stall (T-S98)', () => {
  it('each write is answered before anything else is sent: no byte is lost while EEPROM is written, and the value persists', async () => {
    const h = harness('en', { device: { eepromWriteMs: 30 }, session: { manifest: EN_APPROVED, release: PHASE_1_SETTINGS_RELEASE } });
    void h.session.connect(PORT);
    await h.run(6000);
    expect(h.session.snapshot.classification).toMatchObject({ mode: 'full' });
    const device = h.device as import('@synthetos/testkit').TinyGEdgeNextModel;
    for (const [key, value] of [['xvm', 4321], ['yfr', 2345], ['zjm', 750]] as const) {
      expect(h.session.writeSetting(key, value).allowed, key).toBe(true);
      // Reads asked for while the write is in flight (the pollers do this) must wait.
      h.session.read(['posx', 'mpox']);
      await h.run(500);
      expect(h.session.snapshot.settingWrite, key).toMatchObject({ key, outcome: 'verified' });
      expect(device.settings.eeprom[key], key).toBe(value);
    }
    expect(device.eepromWrites).toBe(3);
    expect(device.eepromLostBytes).toBe(0);
    expect(h.session.snapshot.overlays).toEqual([]);
    const writes = (h.transports.at(-1)?.writes ?? []).map(shown);
    expect(writes.filter((w) => /:\d/.test(w))).toEqual(['{"xvm":4321}\\n', '{"yfr":2345}\\n', '{"zjm":750}\\n']);
  });
});

describe('settings writes: every way a write can end', () => {
  function writing(): Driver {
    const d = ready();
    d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    passGate(d);
    return d;
  }

  it('a key that is not a string is refused', () => {
    const d = ready();
    expect(d.intent({ intent: 'settingsWrite', key: 5 as never, value: 1 })).toMatchObject({ allowed: false, reason: 'Name one setting.' });
  });

  it('TG style: an er 9 with a status-0 answer is rejected (nothing saved)', () => {
    const d = writing();
    d.written();
    d.line('{"er":{"fb":450.01,"st":9,"msg":"x"}}');
    d.line('{"r":{"xvm":1234},"f":[3,0,10]}');
    expect(d.state.settingWrite).toMatchObject({ outcome: 'rejected', exception: 9 });
  });

  it('any other er while writing is still a FAULT', () => {
    const d = writing();
    d.written();
    d.line('{"er":{"fb":450.01,"st":50,"msg":"x"}}');
    expect(d.state.overlays).toContain('FAULT');
    expect(d.state.settingWrite).toMatchObject({ outcome: 'interrupted' });
  });

  it('a read-back with a non-zero status is a mismatch', () => {
    const d = writing();
    d.written();
    d.line('{"r":{"xvm":1234},"f":[3,0,10]}');
    d.written();
    d.line('{"r":{},"f":[3,100,10]}');
    expect(d.state.settingWrite?.outcome).toBe('mismatch');
    expect(d.state.settingWrite?.detail).toMatch(/read-back failed \(status 100\)/);
  });

  it('timeouts: an unanswered gate read refuses, an unanswered read-back is a mismatch', () => {
    const g = ready();
    g.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    g.written();
    g.fire('answer');
    expect(g.state.settingWrite).toMatchObject({ outcome: 'refused' });
    const r = writing();
    r.written();
    r.line('{"r":{"xvm":1234},"f":[3,0,10]}');
    r.written();
    r.fire('answer');
    expect(r.state.settingWrite).toMatchObject({ outcome: 'mismatch' });
  });

  it('a damaged answer: gate refuses, write unconfirmed, read-back mismatch', () => {
    const g = ready();
    g.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    g.written();
    g.line('{"r":{"stat":1');
    expect(g.state.settingWrite).toMatchObject({ outcome: 'refused' });
    const w = writing();
    w.written();
    w.line('{"r":{"xvm":12');
    expect(w.state.settingWrite).toMatchObject({ outcome: 'unconfirmed' });
    const r = writing();
    r.written();
    r.line('{"r":{"xvm":1234},"f":[3,0,10]}');
    r.written();
    r.line('{"r":{"xvm":12');
    expect(r.state.settingWrite).toMatchObject({ outcome: 'mismatch' });
  });
});

describe('settings-write helpers', () => {
  it('the gate skips hold where the dialect does not trust it', () => {
    expect(gateTokens(TINYG_EN, true)).toEqual(['stat', 'hold', 'vel', 'qr', 'unit']);
    expect(gateTokens(TINYG_440, false)).not.toContain('hold');
  });

  it('judgeGate names every unread value', () => {
    const v = judgeGate(TINYG_EN, {}, true);
    expect(v.ok).toBe(false);
    for (const w of ['stat', 'hold state', 'velocity', 'planner queue', 'units']) expect(v.detail).toContain(w);
    expect(judgeGate(TINYG_EN, { stat: 1, vel: 0, qr: TINYG_EN.limits.plannerBlocks, unit: 1 }, false).ok).toBe(true);
  });

  it('sessionSettings puts later single-token reads over the groups; settingRefusal refuses a dialect with no schema', () => {
    const values = { x: { value: { vm: 100, fr: 50 }, status: 0, at: 1 }, xvm: { value: 200, status: 0, at: 2 }, xfr: { value: 1, status: 7, at: 3 }, zzz: { value: 5, status: 0, at: 4 } };
    const s = sessionSettings('tinyg-en', values);
    expect(s['xvm']).toBe(200);
    expect(s['xfr']).toBe(50);
    expect(s['zzz']).toBeUndefined();
    expect(settingRefusal('g2core-edge', 'xvm', 1, {})).toMatch(/no settings schema/);
    expect(settingRefusal('tinyg-en', 'xvm', '1', {})).toMatch(/not a number/);
  });

  it('a 33- to 40-byte line that is not a settings write is refused', () => {
    const line = new TextEncoder().encode(`{"posx":null,"${'a'.repeat(16)}":1}\n`);
    expect(line.length).toBeGreaterThan(32);
    expect(phase1WriteVerdict(line, { readable: () => true, enqAllowed: false, settingWritable: () => true }).ok).toBe(false);
  });

  it('useApprovedBuilds is taken only while not connected', async () => {
    const h = harness('en', { session: { release: PHASE_1_SETTINGS_RELEASE } });
    expect(h.session.useApprovedBuilds(EN_APPROVED, 'note: approved')).toBe(true);
    expect(h.session.useApprovedBuilds(EN_APPROVED)).toBe(true);
    expect(h.session.log().some((e) => e.text === 'note: approved')).toBe(true);
    void h.session.connect(PORT);
    await h.run(6000);
    expect(h.session.snapshot.classification).toMatchObject({ mode: 'full' });
    expect(h.session.useApprovedBuilds(EN_APPROVED)).toBe(false);
    expect(MachineSession).toBeDefined();
  });
});

describe('settings writes and Phase 2 motion share the link, never at once', () => {
  it('a jog is refused while a setting is being written, and a setting is refused while a move is in progress', async () => {
    const { PHASE_2_RELEASE, withSettingsWrites } = await import('@synthetos/safety');
    const release = withSettingsWrites(PHASE_2_RELEASE, 'staging');
    const answers = { ...ANSWERS, home: '{"r":{"home":0},"f":[3,0,10]}' };
    const d = new Driver({ release, manifest: EN_APPROVED });
    d.open();
    d.answer(answers);
    expect(d.state.base).toBe('IDLE_UNHOMED');
    expect(d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 }).allowed).toBe(true);
    expect(d.intent({ intent: 'jog', axes: { x: 1 }, distanceMm: 0.1, feed: 600 })).toMatchObject({ allowed: false, reason: 'A setting is being written.' });

    const m = new Driver({ release, manifest: EN_APPROVED });
    m.open();
    m.answer(answers);
    expect(m.intent({ intent: 'jog', axes: { x: 1 }, distanceMm: 0.1, feed: 600 }).allowed).toBe(true);
    expect(m.state.motion).not.toBeNull();
    expect(m.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 })).toMatchObject({ allowed: false });
  });
});
