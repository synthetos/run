/**
 * The read-only session reducer (ROADMAP P1-02): the connection path, every
 * overlay, the Phase 1 allow-matrix, and the safety tests that live at this
 * layer: T-S10 (both banner shapes), T-S21 (device id mismatch), T-S26 and
 * T-S24a (no 0x18 or 0x04 in any effect, generated over states × events),
 * T-S3 (the matrix decides every intent first).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BYTE, PROBE_STEPS, TINYG_EN, classifyLine, type ApprovedBuilds, type Inbound } from '@synthetos/protocol';
import { CURRENT_RELEASE, INTENTS, OVERLAYS, type Intent } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import { DEFAULT_TIMINGS, MAX_PROBE_RESTARTS, MAX_QUEUED_READS, READING_TOKENS, enqAllowedNow, matrixSnapshot, readableNow, type SessionEffect, type SessionIntent } from '../src/index.ts';
import { Driver, EN_ANSWERS, EN_BOOT_BANNER, EN_READY_BANNER, SIM_INFO, TG_ANSWERS, TG_READY_BANNER, tg } from './sessionDriver.ts';
import { PORT } from './simTransport.ts';

/** A manifest that approves the scripted edge-next build, so the session is classified full (ENQ allowed). */
const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

const PROBE_LINES = PROBE_STEPS.map((s) => s.line);
const READING_LINES = READING_TOKENS.map((t) => `{"${t}":null}`);

function connected(answers = EN_ANSWERS, options: ConstructorParameters<typeof Driver>[0] = {}, expected: string | null = null): Driver {
  const d = new Driver(options);
  d.open(expected);
  d.answer(answers);
  return d;
}

const realtime = (effects: readonly SessionEffect[]): number[] =>
  effects.filter((e) => e.kind === 'writeRealtime').map((e) => (e as Extract<SessionEffect, { kind: 'writeRealtime' }>).byte);

describe('the connection path', () => {
  it('NOT_CONNECTED → PORT_REQUEST → OPENING → IDENTIFYING → READING → CONNECTED_UNKNOWN, {sr:null} first (edge-next)', () => {
    const d = new Driver();
    expect(d.state.base).toBe('NOT_CONNECTED');
    expect(d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null })).toEqual({ allowed: true });
    expect(d.state.base).toBe('PORT_REQUEST');
    expect(d.last).toContainEqual({ kind: 'acquireTransport', epoch: 1, port: PORT });
    d.feed({ type: 'transportAcquired', epoch: 1 });
    expect(d.state.base).toBe('OPENING');
    expect(d.last).toContainEqual({ kind: 'open', epoch: 1 });
    d.feed({ type: 'opened', epoch: 1, info: SIM_INFO });
    expect(d.state.base).toBe('IDENTIFYING');
    expect(d.last).toContainEqual({ kind: 'writeLine', epoch: 1, seq: 1, token: 'sr', line: '{sr:null}' });
    d.answer(EN_ANSWERS, (t) => t === 'stat');
    expect(d.state.base).toBe('READING');
    expect(d.last).toContainEqual({ kind: 'tightenLineCap', epoch: 1, maxLineBytes: 255 });
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.lines()).toEqual([...PROBE_LINES, ...READING_LINES]);
    expect(d.realtime()).toEqual([]);
    expect(d.state.classification).toMatchObject({ dialectId: 'tinyg-en', mode: 'readOnly', reason: 'en-not-approved' });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    expect(d.state.identity).toEqual({ fb: 450.01, fv: 0.97, hp: 1, hv: 8, id: 'EN-1' });
    expect(d.state.live).toMatchObject({ stat: 1, machineClass: 'idle', hold: 0, vel: 0, qr: 32, line: 0, unit: 1, pos: { x: 1.5, y: 0, z: 0 } });
    expect(d.state.footerRev).toBe(3);
    // Only the receive watchdog runs once connected (SAFETY §4.2).
    expect(Object.keys(d.state.timers)).toEqual(['watchdog']);
  });

  it('classifies 440.21 the same way, with its rev-1 footers and the r-footer dialect', () => {
    const d = connected(TG_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.classification).toMatchObject({ dialectId: 'tinyg-440', mode: 'readOnly', upgradeOffer: true });
    expect(d.lines()).toEqual([...PROBE_LINES, ...READING_LINES]);
    expect(d.state.footerRev).toBe(1);
  });

  it('a manifest approval makes the session full (no READ_ONLY); Phase 1 still allows no motion or write', () => {
    const d = connected(EN_ANSWERS, { manifest: EN_APPROVED });
    expect(d.state.classification).toMatchObject({ mode: 'full', reason: 'en-approved', buildIdentity: 'fbOnly' });
    expect(d.state.overlays).toEqual([]);
    for (const intent of ['jog', 'home', 'start', 'settingsWrite', 'resetController', 'spindleOn', 'setWorkZero'] as const) {
      expect(d.intent({ intent }), intent).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
    }
  });

  it('an unclassified board ends READ_ONLY in CONNECTED_UNKNOWN with no reads beyond the probe', () => {
    const answers = { ...EN_ANSWERS, fv: '{"r":{"fv":0.98},"f":[3,0,10]}' };
    const d = connected(answers);
    expect(d.state.classification).toMatchObject({ dialectId: null, mode: 'readOnly' });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.lines()).toEqual(PROBE_LINES);
    expect(d.intent({ intent: 'read', tokens: ['posx'] })).toMatchObject({ allowed: false, citation: 'SAFETY H37; PN §12.3' });
  });

  it('a transport source with no port, or a failed open, returns to NOT_CONNECTED with the reason', () => {
    const d = new Driver();
    d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null });
    d.feed({ type: 'transportUnavailable', epoch: 1, reason: 'no port was chosen' });
    expect(d.state).toMatchObject({ base: 'NOT_CONNECTED', epoch: 2, notices: { connectFailed: { code: 'unavailable', reason: 'no port was chosen' } } });
    d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null });
    d.feed({ type: 'transportAcquired', epoch: 3 });
    d.feed({ type: 'openFailed', epoch: 3, reason: 'busy' });
    expect(d.state).toMatchObject({ base: 'NOT_CONNECTED', notices: { connectFailed: { code: 'open-failed', reason: 'busy' } } });
  });

  it('ignores events from another epoch and events that do not fit the state', () => {
    const d = new Driver();
    const before = d.state;
    d.feed({ type: 'transportAcquired', epoch: 0 });
    d.feed({ type: 'opened', epoch: 0, info: SIM_INFO });
    d.feed({ type: 'transportUnavailable', epoch: 0, reason: 'x' });
    d.feed({ type: 'inbound', epoch: 0, at: 0, event: classifyLine(EN_ANSWERS.fb as string) });
    d.feed({ type: 'lineWritten', epoch: 0, seq: 1 });
    d.feed({ type: 'lineDropped', epoch: 9, seq: 1 });
    d.feed({ type: 'writeFailed', epoch: 0, at: 0, detail: 'x' });
    d.feed({ type: 'writeRefused', epoch: 0, at: 0, detail: 'x' });
    d.feed({ type: 'linkLost', epoch: 0, at: 0 });
    d.feed({ type: 'driftDetected', epoch: 0 });
    d.feed({ type: 'timer', id: 'answer', seq: 1, at: 0 });
    expect(d.state).toEqual(before);
    d.open();
    const opened = d.state;
    d.feed({ type: 'inbound', epoch: 0, at: 0, event: classifyLine(EN_ANSWERS.fb as string) });
    d.feed({ type: 'transportAcquired', epoch: 1 });
    d.feed({ type: 'opened', epoch: 1, info: SIM_INFO });
    d.feed({ type: 'openFailed', epoch: 1, reason: 'late' });
    expect(d.state).toEqual(opened);
  });

  it('a lineWritten with nothing being written changes nothing', () => {
    const d = connected();
    const before = d.state;
    d.written();
    expect(d.state).toEqual(before);
  });
});

describe('splice guard and boot (PN §2.3 step 0 and 1; SAFETY H49)', () => {
  it('a G-code answer to the first line (no "sr" key) is a leftover partial line: ORPHANED_MOTION, the probe stops (bench 2, 2026-11-02)', () => {
    for (const reply of ['{"r":{},"f":[3,101,10]}', '{"r":{},"f":[1,102,17,7684]}', '{"r":{},"f":[3,0,10]}', '{"r":{},"f":[1,0,24,104]}']) {
      const d = new Driver();
      d.open();
      d.written();
      d.line(reply);
      expect(d.state.overlays, reply).toContain('ORPHANED_MOTION');
      expect(d.state.queue, reply).toEqual([]);
      expect(d.writing, reply).toBeUndefined();
      expect(d.lines(), reply).toEqual(['{sr:null}']);
      expect(d.state.classification, reply).toBeNull();
    }
  });

  it('an ok answer whose "sr" is not an object still counts as the status answer and continues', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":null},"f":[3,0,10]}');
    expect(d.state.overlays).not.toContain('ORPHANED_MOTION');
    expect(d.writing).toBe('fb');
  });

  it('a damaged identity probe after an empty status answer cannot establish rest', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":null},"f":[3,0,10]}');
    d.written();
    d.line('damaged{');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
    expect(d.state.queue).toEqual([]);
  });

  it('an error answer that does carry "sr" repeats {sr:null} once, then continues either way', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":{"stat":1}},"f":[3,108,10]}');
    expect(d.writing).toBe('sr');
    d.written();
    d.line('{"r":{"sr":{"stat":1}},"f":[3,108,10]}');
    expect(d.writing).toBe('fb');
    expect(d.lines().slice(0, 3)).toEqual(['{sr:null}', '{sr:null}', '{"fb":null}']);
  });

  it('a successful repeat continues with the identity GETs', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":{"stat":1}},"f":[3,108,10]}');
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
  });

  it('an er report answering the first line (the spliced fragment) is only recorded', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"er":{"fb":450.01,"st":13,"msg":"damaged"}}');
    expect(d.state.fault).toBeNull();
    d.line(EN_ANSWERS.sr as string);
    expect(d.writing).toBe('fb');
  });

  it.each([false, true])('a damaged splice answer stops identification (write pending: %s)', (pendingWrite) => {
    for (const retried of [false, true]) {
      const d = new Driver();
      d.open();
      if (retried) {
        d.written();
        d.line('{"r":{"sr":{"stat":1}},"f":[3,108,10]}');
      }
      if (!pendingWrite) d.written();
      d.line('{"r":{"sr":');
      expect(d.state.overlays).toContain('ORPHANED_MOTION');
      expect(d.state.queue).toEqual([]);
      if (pendingWrite) d.written();
      // Late clean data must not restart identification after an uncertain splice.
      d.line(EN_ANSWERS.sr as string);
      expect(d.writing).toBeUndefined();
      expect(d.lines()).toEqual(retried ? ['{sr:null}', '{sr:null}'] : ['{sr:null}']);
      expect(d.state.classification).toBeNull();
      expect(d.intent({ intent: 'feedhold' })).toEqual({ allowed: true });
      expect(d.realtime()).toContain(BYTE.FEEDHOLD);
    }
  });

  it('a damaged splice answer writes the same kind of session-log line as a clean answer with no sr', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line('{"r":{"sr":');
    const logs = d.effects.filter((e) => e.kind === 'log').map((e) => (e as Extract<SessionEffect, { kind: 'log' }>).text);
    expect(logs).toEqual([
      "probe: the answer to the first line ({sr:null}) arrived damaged: it cannot show the line was read as a status request, and a leftover partial line in the board's buffer may have joined it and run → ORPHANED_MOTION",
    ]);
  });

  it('a board that boots while it is probed: the probe restarts from {sr:null} once it is ready and quiet', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.line(EN_BOOT_BANNER);
    expect(d.state.probe).toMatchObject({ settling: 'boot' });
    expect(d.last).toContainEqual({ kind: 'armTimer', id: 'settle', seq: expect.any(Number), ms: DEFAULT_TIMINGS.bannerWaitMs });
    d.line(EN_READY_BANNER);
    expect(d.last).toContainEqual({ kind: 'armTimer', id: 'settle', seq: expect.any(Number), ms: DEFAULT_TIMINGS.bannerSettleMs });
    // An answer to a line sent before the reset arrives while settling: discarded, never misattributed.
    d.line(EN_ANSWERS.sr as string);
    d.line('garbage{');
    expect(d.state.fault).toBeNull();
    d.fire('settle');
    expect(d.writing).toBe('sr');
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    expect(d.lines().filter((l) => l === '{sr:null}')).toHaveLength(2);
  });

  it('a line whose write completes while the board resets expects no answer', () => {
    const d = new Driver();
    d.open();
    d.line(EN_READY_BANNER);
    d.written();
    expect(d.state.expected).toEqual([]);
    expect(d.state.timers.answer).toBeUndefined();
  });

  it(`a board that keeps resetting latches FAULT after ${MAX_PROBE_RESTARTS} restarts`, () => {
    const d = new Driver();
    d.open();
    for (let i = 0; i < MAX_PROBE_RESTARTS; i++) {
      d.line(EN_READY_BANNER);
      d.fire('settle');
    }
    d.line(EN_READY_BANNER);
    d.fire('settle');
    expect(d.state.fault).toMatchObject({ cause: 'resetLoop', kind: 'integrity' });
    expect(d.state.overlays).toContain('FAULT');
  });

  it('a settle timer outside the probe does nothing', () => {
    const d = new Driver();
    d.open();
    d.line(EN_READY_BANNER);
    const seq = d.state.timers.settle as number;
    d.answer(EN_ANSWERS);
    // Fabricate a stale settle with the right sequence number after the probe completed.
    d.state = { ...d.state, timers: { settle: seq } };
    d.feed({ type: 'timer', id: 'settle', seq, at: 0 });
    expect(d.state.base).toBe('IDENTIFYING');
  });
});

describe('T-S10: a banner after Ready is FAULT then UNKNOWN, for both banner shapes', () => {
  it.each([
    ['bare-sr (edge-next)', EN_ANSWERS, EN_READY_BANNER],
    ['r-footer (440.21)', TG_ANSWERS, TG_READY_BANNER],
  ])('%s', (_label, answers, banner) => {
    const d = connected(answers);
    d.line(banner);
    expect(d.state.overlays.slice(0, 1)).toEqual(['FAULT']);
    expect(d.state.overlays).toContain('UNKNOWN');
    expect(d.state.fault).toMatchObject({ cause: 'bannerAfterReady', kind: 'integrity' });
    expect(d.state.fault?.detail).toContain(banner === EN_READY_BANNER ? 'bare-sr' : 'r-footer');
  });

  it('a boot banner (not READY) and 440.21 at jv=1 (no msg) count too', () => {
    const d = connected();
    d.line(EN_BOOT_BANNER);
    expect(d.state.fault?.cause).toBe('bannerAfterReady');
    const t = connected(TG_ANSWERS);
    const head = '{"r":{"fv":0.970,"fb":440.21,"hp":1,"hv":8,"id":"TG-1"},"f":[1,0,0,';
    t.line(tg('{"fv":0.970,"fb":440.21,"hp":1,"hv":8,"id":"TG-1"}', 0, 0));
    expect(head.length).toBeGreaterThan(0);
    expect(t.state.fault?.cause).toBe('bannerAfterReady');
  });

  it('during READING too (the probe is complete, so the board was ready)', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'hold');
    expect(d.state.base).toBe('READING');
    d.line(EN_READY_BANNER);
    expect(d.state.overlays).toEqual(expect.arrayContaining(['FAULT', 'UNKNOWN']));
  });
});

describe('T-S21: the board is not the selected machine', () => {
  it('goes BLOCKED after the probe and writes nothing more; reads are refused, Pause still works', () => {
    const d = connected(EN_ANSWERS, {}, 'OTHER-MACHINE');
    expect(d.state.base).toBe('BLOCKED');
    expect(d.state.blocked).toEqual({ expected: 'OTHER-MACHINE', reported: 'EN-1' });
    expect(d.lines()).toEqual(PROBE_LINES);
    expect(d.intent({ intent: 'read', tokens: ['posx'] })).toMatchObject({ allowed: false, citation: 'T-S21; SAFETY §3 BLOCKED' });
    expect(d.lines()).toEqual(PROBE_LINES);
    expect(d.intent({ intent: 'feedhold' })).toEqual({ allowed: true });
    expect(d.realtime()).toEqual([BYTE.FEEDHOLD]);
  });

  it('the matching machine continues to READING', () => {
    const d = connected(EN_ANSWERS, {}, 'EN-1');
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.blocked).toBeNull();
  });
});

describe('UNKNOWN on the connect after a reload or discard while LIVE (SAFETY §3)', () => {
  it('connect with unknown: true adds the UNKNOWN overlay on open; a plain connect does not', () => {
    const d = new Driver();
    d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null, unknown: true });
    d.feed({ type: 'transportAcquired', epoch: 1 });
    d.feed({ type: 'opened', epoch: 1, info: SIM_INFO });
    expect(d.state.overlays).toEqual(['UNKNOWN']);
    d.answer(EN_ANSWERS);
    expect(d.state.overlays).toEqual(['UNKNOWN', 'READ_ONLY']);

    const plain = connected();
    expect(plain.state.overlays).toEqual(['READ_ONLY']);
  });
});

describe('ORPHANED_MOTION (PN §2.3 step 0; SAFETY H14)', () => {
  it('no answer to {sr:null} within 3 s: ORPHANED_MOTION, unclassified, and only ! is allowed', () => {
    const d = new Driver();
    d.open();
    d.written();
    expect(d.last).toContainEqual({ kind: 'armTimer', id: 'answer', seq: expect.any(Number), ms: 3000 });
    d.fire('answer');
    expect(d.state.overlays).toEqual(['ORPHANED_MOTION']);
    expect(d.state.writing).toBeNull();
    expect(d.intent({ intent: 'read', tokens: ['stat'] }).allowed).toBe(false);
    expect(d.intent({ intent: 'disconnect' }).allowed).toBe(false);
    expect(d.intent({ intent: 'resetController' })).toMatchObject({ allowed: false });
    expect(d.intent({ intent: 'stopJob' })).toEqual({ allowed: true });
    expect(d.realtime()).toEqual([BYTE.FEEDHOLD]);
    expect(d.state.notices.adviseEstop).toBe(true);
    // The late answer is consumed, and nothing more is written.
    d.line(EN_ANSWERS.sr as string);
    expect(d.state.fault).toBeNull();
    expect(d.lines()).toEqual(['{sr:null}']);
  });

  it('silence in the middle of the probe is ORPHANED_MOTION as well', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'id');
    d.written();
    d.fire('answer');
    expect(d.state.overlays).toEqual(['ORPHANED_MOTION']);
    d.line(EN_ANSWERS.id as string);
    expect(d.state.writing).toBeNull();
    expect(d.state.queue).toEqual([]);
  });

  it('a boot banner while unclassified ends it (the reset ended the motion) and the probe restarts', () => {
    const d = new Driver();
    d.open();
    d.written();
    d.fire('answer');
    d.line(EN_READY_BANNER);
    expect(d.state.overlays).toEqual(['UNKNOWN']);
    d.fire('settle');
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toEqual(['UNKNOWN', 'READ_ONLY']);
  });

  it('an unsolicited report showing motion while identifying: ORPHANED_MOTION, the probe stops', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'fv');
    d.line('{"sr":{"vel":120.5,"posx":3}}');
    expect(d.state.overlays).toEqual(['ORPHANED_MOTION']);
    expect(d.state.live.vel).toBe(120.5);
    d.written();
    d.line(EN_ANSWERS.fv as string);
    expect(d.writing).toBeUndefined();
  });

  it('while READING, a report of a running class makes it ORPHANED_MOTION (classified)', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'stat');
    d.line('{"sr":{"stat":5}}');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
    d.answer({ ...EN_ANSWERS, stat: '{"r":{"stat":5},"f":[3,0,10]}' });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });

  it('a report while connected (not connecting) only updates the live values', () => {
    const d = connected();
    d.line('{"sr":{"vel":50,"stat":5,"mpox":4,"posa":9,"posq":1,"feed":3}}');
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    expect(d.state.live).toMatchObject({ vel: 50, stat: 5, machineClass: 'running', mpo: { x: 4 }, pos: { a: 9 } });
  });

  it('a report carries the commanded feed and the active tool as reported, for display only', () => {
    const d = connected();
    d.line('{"sr":{"feed":1500,"tool":3}}');
    expect(d.state.live).toMatchObject({ feed: 1500, tool: 3 });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    d.line('{"sr":{"tool":"x"}}');
    expect(d.state.live.tool).toBe(3);
  });

  it('a report carries the spindle and coolant readouts as reported, for display only; the {sr:null} answer records the status list', () => {
    const d = connected();
    expect(d.state.live.srList).toEqual(['line', 'posx', 'posy', 'posz', 'vel', 'unit', 'stat']);
    expect(d.state.live.spe).toBeUndefined();
    const before = d.effects.length;
    d.line('{"sr":{"spe":1,"spc":1,"spd":0,"sps":18000,"cof":1,"com":0}}');
    expect(d.state.live).toMatchObject({ spe: 1, spc: 1, spd: 0, sps: 18000, cof: 1, com: 0 });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    d.line('{"sr":{"spe":"on"}}');
    expect(d.state.live.spe).toBe(1);
    // Nothing is written in answer to a readout: no setting write, no sr-list configuration.
    expect(d.effects.slice(before).filter((e) => e.kind === 'writeLine' || e.kind === 'writeRealtime')).toEqual([]);
  });

  it('the spindle and coolant readouts never reach a safety decision: Pause, Stop job, Spindle off and FAULT entry are the same whatever they say', () => {
    const run = (report: string): { effects: unknown[]; matrix: unknown; notices: unknown; overlays: unknown } => {
      const d = connected(EN_ANSWERS, { manifest: EN_APPROVED });
      d.line(report);
      const before = d.effects.length;
      d.at = 42;
      d.intent({ intent: 'feedhold' });
      d.intent({ intent: 'stopJob' });
      d.intent({ intent: 'spindleOffNow' });
      // A reset banner while connected is a FAULT; at rest (vel 0, stat 1) no feedhold follows, whatever the spindle says.
      d.line(EN_READY_BANNER);
      return { effects: d.effects.slice(before), matrix: matrixSnapshot(d.state), notices: d.state.notices, overlays: d.state.overlays };
    };
    const none = run('{"sr":{"vel":0}}');
    const on = run('{"sr":{"spe":1,"spc":2,"spd":1,"sps":24000,"cof":1,"com":1}}');
    const off = run('{"sr":{"spe":0,"spc":0,"spd":0,"sps":0,"cof":0,"com":0}}');
    expect(on).toEqual(none);
    expect(off).toEqual(none);
    expect(realtime(none.effects as SessionEffect[])).toEqual([BYTE.FEEDHOLD, BYTE.FEEDHOLD, BYTE.FEEDHOLD]);
    expect(none.overlays).toContain('FAULT');
  });

  it('polled spindle and coolant answers (snapshot.values) never reach a safety decision either', () => {
    const run = (answers: Readonly<Record<string, number>> | null): { effects: unknown[]; matrix: unknown; notices: unknown; overlays: unknown } => {
      const d = connected(EN_ANSWERS, { manifest: EN_APPROVED });
      if (answers !== null) {
        const tokens = Object.keys(answers);
        expect(d.intent({ intent: 'read', tokens }).allowed).toBe(true);
        for (const t of tokens) d.line(`{"r":{"${t}":${String(answers[t])}},"f":[3,0,10]}`);
        for (const t of tokens) expect(d.state.values[t]).toMatchObject({ value: answers[t], status: 0 });
      }
      const before = d.effects.length;
      d.at = 42;
      d.intent({ intent: 'feedhold' });
      d.intent({ intent: 'stopJob' });
      d.intent({ intent: 'spindleOffNow' });
      d.line(EN_READY_BANNER);
      // Timer sequence numbers count the earlier reads' timers; everything else must be identical.
      const effects = d.effects.slice(before).map((e) => ('seq' in e ? { ...e, seq: 0 } : e));
      return { effects, matrix: matrixSnapshot(d.state), notices: d.state.notices, overlays: d.state.overlays };
    };
    const none = run(null);
    const on = run({ spe: 1, spc: 2, sps: 24000, cof: 1, com: 1 });
    const off = run({ spe: 0, spc: 0, sps: 0, cof: 0, com: 0 });
    expect(on).toEqual(none);
    expect(off).toEqual(none);
    expect(none.overlays).toContain('FAULT');
  });

  it('a report while connecting that shows no motion changes no overlay', () => {
    const d = new Driver();
    d.open();
    d.line('{"sr":{"vel":0,"posx":1}}');
    d.line('{"sr":{"line":3}}');
    expect(d.state.overlays).toEqual([]);
  });

  it.each([
    ['stat 3 (program stop)', 'stat', '{"r":{"stat":3},"f":[3,0,10]}'],
    ['stat 2 (alarm)', 'stat', '{"r":{"stat":2},"f":[3,0,10]}'],
    ['an unknown stat', 'stat', '{"r":{"stat":99},"f":[3,0,10]}'],
    ['hold 2', 'hold', '{"r":{"hold":2},"f":[3,0,10]}'],
    ['vel 10', 'vel', '{"r":{"vel":10},"f":[3,0,10]}'],
    ['a short qr', 'qr', '{"r":{"qr":30},"f":[3,0,10]}'],
    ['qr not answered', 'qr', '{"r":{},"f":[3,100,10]}'],
    ['stat not a number', 'stat', '{"r":{"stat":"x"},"f":[3,0,10]}'],
  ])('READING finds the board not resting (%s): ORPHANED_MOTION', (_label, token, reply) => {
    const d = connected({ ...EN_ANSWERS, [token]: reply });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });

  it('stat 4 (program end) counts as resting', () => {
    const d = connected({ ...EN_ANSWERS, stat: '{"r":{"stat":4},"f":[3,0,10]}' });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });

  it('a damaged READING answer leaves its value unknown, so the board is not trusted as resting', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'qr');
    d.written();
    d.line('{"r":{"qr":');
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });

  it('a damaged READING answer before the last one keeps READING going', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'stat');
    d.written();
    d.line('{"r":{"stat":');
    expect(d.state.base).toBe('READING');
    d.answer(EN_ANSWERS);
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });
});

describe('an unclassified board is checked for rest from its {sr:null} answer (SAFETY H14 mitigation 5, T-S60)', () => {
  const HELD_SR = '{"r":{"sr":{"line":0,"posx":1.5,"vel":0,"unit":1,"stat":6,"hold":6}},"f":[3,0,10]}';

  it('a held board whose probe answer arrives damaged is ORPHANED_MOTION, not only READ_ONLY', () => {
    const d = new Driver();
    d.open();
    d.answer({ ...EN_ANSWERS, sr: HELD_SR }, (t) => t === 'hp');
    d.written();
    d.line('{"r":{"hp":1},"f":[3,0');
    expect(d.state.classification).toMatchObject({ dialectId: null, reason: 'probeFailed' });
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
    expect(d.intent({ intent: 'stopJob' })).toEqual({ allowed: true });
  });

  it('a held board whose probe cannot be built is ORPHANED_MOTION', () => {
    const d = new Driver();
    d.open();
    d.answer({ ...EN_ANSWERS, sr: HELD_SR }, (t) => t === 'spph');
    const probe = d.state.probe;
    if (probe === null) throw new Error('no probe');
    d.state = { ...d.state, probe: { ...probe, answers: probe.answers.filter(([k]) => k !== 'fb') } };
    d.answer(EN_ANSWERS);
    expect(d.state.classification).toMatchObject({ dialectId: null, reason: 'probeFailed' });
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });

  it('a held board that no dialect matches (READING never runs) is ORPHANED_MOTION', () => {
    const d = connected({ ...EN_ANSWERS, sr: HELD_SR, fv: '{"r":{"fv":0.5},"f":[3,0,10]}' });
    expect(d.state.classification).toMatchObject({ dialectId: null });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
    const resting = connected({ ...EN_ANSWERS, fv: '{"r":{"fv":0.5},"f":[3,0,10]}' });
    expect(resting.state.overlays).toEqual(['READ_ONLY']);
  });

  it('a classified board already ORPHANED_MOTION at the end of the probe skips READING', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'spph');
    d.written();
    d.line('{"sr":{"vel":12}}');
    d.line(EN_ANSWERS.spph as string);
    expect(d.state.classification).toMatchObject({ dialectId: 'tinyg-en' });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });

  it.each([
    ['stat missing', '{"r":{"sr":{"posx":0,"vel":0}},"f":[3,0,10]}'],
    ['stat 3', '{"r":{"sr":{"posx":0,"vel":0,"stat":3}},"f":[3,0,10]}'],
    ['vel not 0', '{"r":{"sr":{"posx":0,"vel":4,"stat":1}},"f":[3,0,10]}'],
    ['hold not 0', '{"r":{"sr":{"posx":0,"vel":0,"stat":1,"hold":4}},"f":[3,0,10]}'],
  ])('damaged probe, %s: ORPHANED_MOTION', (_label, sr) => {
    const d = new Driver();
    d.open();
    d.answer({ ...EN_ANSWERS, sr }, (t) => t === 'hp');
    d.written();
    d.line('{"r":{"hp":1},"f":[3,0');
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });

  it('a resting board (stat 1 or 4, vel 0) with a damaged probe stays READ_ONLY only', () => {
    for (const stat of [1, 4]) {
      const d = new Driver();
      d.open();
      d.answer({ ...EN_ANSWERS, sr: `{"r":{"sr":{"posx":0,"vel":0,"stat":${stat}}},"f":[3,0,10]}` }, (t) => t === 'hp');
      d.written();
      d.line('{"r":{"hp":1},"f":[3,0');
      expect(d.state.overlays).toEqual(['READ_ONLY']);
    }
  });
});

describe('the resting check on 440.21 uses only stat and vel (SAFETY H14 mitigation 2)', () => {
  it('an idle, empty 440.21 board that reports hold != 0 is not ORPHANED_MOTION', () => {
    const d = connected({ ...TG_ANSWERS, hold: tg('{"hold":3}') });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });

  it('a 440.21 board whose hold read fails is not ORPHANED_MOTION either', () => {
    const d = connected({ ...TG_ANSWERS, hold: tg('{}', 100) });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });

  it('edge-next still requires hold = 0', () => {
    const d = connected({ ...EN_ANSWERS, hold: '{"r":{"hold":3},"f":[3,0,10]}' });
    expect(d.state.overlays).toContain('ORPHANED_MOTION');
  });
});

describe('flow control: ex = 2 (RTS/CTS) is READ_ONLY on both dialects (ROADMAP P1-03; PN §5.3)', () => {
  const logs = (d: Driver): string[] => d.effects.filter((e) => e.kind === 'log').map((e) => (e as Extract<SessionEffect, { kind: 'log' }>).text);

  it('an approved edge-next with ex = 2 ends READ_ONLY with reason flowControl, keeping its dialect', () => {
    const d = connected({ ...EN_ANSWERS, ex: '{"r":{"ex":2},"f":[3,0,10]}' }, { manifest: EN_APPROVED });
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.classification).toMatchObject({ dialectId: 'tinyg-en', mode: 'readOnly', reason: 'flowControl', buildIdentity: 'fbOnly' });
    expect(d.state.classification?.detail).toContain('ex) is 2 (RTS/CTS)');
    expect(d.state.overlays).toEqual(['READ_ONLY']);
    expect(d.state.live.ex).toBe(2);
    expect(logs(d).at(-1)).toBe('classification: read-only, flow control (ex) is 2 (RTS/CTS)');
  });

  it('an ex that cannot be read is treated the same (fail closed)', () => {
    for (const ex of ['{"r":{},"f":[3,100,10]}', '{"r":{"ex":"2"},"f":[3,0,10]}', '{"r":{"ex":3},"f":[3,0,10]}']) {
      const d = connected({ ...EN_ANSWERS, ex }, { manifest: EN_APPROVED });
      expect(d.state.classification, ex).toMatchObject({ mode: 'readOnly', reason: 'flowControl' });
      expect(d.state.overlays, ex).toEqual(['READ_ONLY']);
    }
  });

  it('ex = 0 and ex = 1 keep the approved session full', () => {
    for (const v of [0, 1]) {
      const d = connected({ ...EN_ANSWERS, ex: `{"r":{"ex":${v}},"f":[3,0,10]}` }, { manifest: EN_APPROVED });
      expect(d.state.classification).toMatchObject({ mode: 'full', reason: 'en-approved' });
      expect(d.state.overlays).toEqual([]);
    }
  });

  it('a board already READ_ONLY keeps its classifier reason (440.21 at ex = 2)', () => {
    const d = connected({ ...TG_ANSWERS, ex: tg('{"ex":2}') });
    expect(d.state.classification).toMatchObject({ dialectId: 'tinyg-440', mode: 'readOnly', reason: 'tg440-not-approved' });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });
});

describe('the probe result is recorded in the session log (ROADMAP P1-03)', () => {
  const logs = (d: Driver): string[] => d.effects.filter((e) => e.kind === 'log').map((e) => (e as Extract<SessionEffect, { kind: 'log' }>).text);

  it('one line with the identity, the capability answers, the footers and the verdict', () => {
    const d = connected(EN_ANSWERS);
    const [line, ...rest] = logs(d);
    expect(rest).toEqual([]);
    expect(line).toMatch(/^probe: \{/);
    const json = JSON.parse((line as string).slice('probe: '.length, line!.indexOf(' → '))) as Record<string, unknown>;
    expect(json).toMatchObject({ banner: 'none', footerRev: 3, fb: 450.01, fv: 0.97, hp: 1, hv: 8, id: 'EN-1', spph: 'stubbed', conflicts: [] });
    expect(json['tokens']).toEqual({ spep: 'value', prbp: 'value', fstk: 'value', os: 'value' });
    expect(json['footers']).toHaveLength(PROBE_STEPS.length - 1);
    expect(line).toContain('→ tinyg-en read-only (en-not-approved): ');
  });

  it('a damaged or missing probe answer is recorded too', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'hp');
    d.written();
    d.line('{"r":{"hp":1},"f":[3,0');
    expect(logs(d)).toEqual(['probe: the answer to hp arrived damaged → unclassified, read-only']);

    const m = new Driver();
    m.open();
    m.answer(EN_ANSWERS, (t) => t === 'spph');
    const probe = m.state.probe;
    if (probe === null) throw new Error('no probe');
    m.state = { ...m.state, probe: { ...probe, answers: probe.answers.filter(([k]) => k !== 'fb') } };
    m.answer(EN_ANSWERS);
    expect(logs(m)).toEqual(['probe: could not be read (missing-answer at fb) → unclassified, read-only']);
  });
});

describe('probe failures', () => {
  it('a damaged probe answer leaves the board unclassified and READ_ONLY', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'hp');
    d.written();
    d.line('{"r":{"hp":1},"f":[3,0');
    expect(d.state).toMatchObject({ base: 'CONNECTED_UNKNOWN', ready: true, classification: { dialectId: null, reason: 'probeFailed' } });
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });

  it('a footer revision that changes during the probe is a FAULT (the board was reset or reconfigured)', () => {
    const d = new Driver();
    d.open();
    d.answer({ ...EN_ANSWERS, fv: '{"r":{"fv":0.97},"f":[2,0,10]}' }, (t) => t === 'hp');
    expect(d.state.fault).toMatchObject({ cause: 'footerRevisionChanged' });
  });

  it('an answer the probe cannot read (conflicting identity) is unclassified', () => {
    const d = connected({ ...EN_ANSWERS, id: '{"r":{"id":7},"f":[3,0,10]}' });
    expect(d.state.classification).toMatchObject({ dialectId: null, reason: 'conflict' });
  });

  it('a probe that ends with a missing answer is reported as a probe failure', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'spph');
    // Remove a recorded answer to reach buildProbeResult's missing-answer outcome.
    const probe = d.state.probe;
    if (probe === null) throw new Error('no probe');
    d.state = { ...d.state, probe: { ...probe, answers: probe.answers.filter(([k]) => k !== 'fb') } };
    d.answer(EN_ANSWERS);
    expect(d.state.classification).toMatchObject({ reason: 'probeFailed', detail: 'the probe could not be read (missing-answer at fb)' });
  });
});

describe('FAULT triggers and ackFault (SAFETY §3)', () => {
  it('an unexpected response, a response with a tid, a footer change and an er report are integrity FAULTs', () => {
    const cases: [string, string][] = [
      ['unexpectedResponse', '{"r":{"posx":1},"f":[3,0,10]}'],
      ['unexpectedResponse', '{"r":{},"f":[3,0,10],"tid":7}'],
      ['footerRevisionChanged', '{"r":{},"f":[2,0,10]}'],
      ['exceptionReport', '{"er":{"fb":450.01,"st":20,"msg":"x"}}'],
    ];
    for (const [cause, line] of cases) {
      const d = connected();
      d.line(line);
      expect(d.state.fault?.cause, line).toBe(cause);
      expect(d.state.fault?.kind).toBe('integrity');
      expect(d.state.overlays[0]).toBe('FAULT');
    }
  });

  it('a write failure and a refused write are integrity FAULTs; the first cause is kept', () => {
    const d = connected();
    d.feed({ type: 'writeFailed', epoch: d.state.epoch, at: 5, detail: 'USB stalled' });
    d.feed({ type: 'writeRefused', epoch: d.state.epoch, at: 6, detail: 'x' });
    expect(d.state.fault).toMatchObject({ cause: 'writeFailed', at: 5 });
    expect(d.state.fault?.detail).toContain('USB stalled');
  });

  it('a refused write is reported as such', () => {
    const d = connected();
    d.feed({ type: 'writeRefused', epoch: d.state.epoch, at: 6, detail: 'bad bytes' });
    expect(d.state.fault).toMatchObject({ cause: 'writeRefused' });
  });

  it('on FAULT with the machine moving, ! is written at once (FAULT entry effect 2); idle, nothing is', () => {
    const d = connected();
    d.line('{"sr":{"vel":300}}');
    d.feed({ type: 'writeFailed', epoch: d.state.epoch, at: 1, detail: 'x' });
    expect(realtime(d.last)).toEqual([BYTE.FEEDHOLD]);
    const idle = connected();
    idle.feed({ type: 'writeFailed', epoch: idle.state.epoch, at: 1, detail: 'x' });
    expect(realtime(idle.last)).toEqual([]);
    const homing = connected();
    homing.line('{"sr":{"stat":9}}');
    homing.feed({ type: 'writeFailed', epoch: homing.state.epoch, at: 1, detail: 'x' });
    expect(realtime(homing.last)).toEqual([BYTE.FEEDHOLD]);
  });

  it('ackFault verifies hold = 0 and qr = plannerBlocks twice, 250 ms apart, then probes again from {sr:null}', () => {
    const d = connected();
    d.line(EN_READY_BANNER);
    expect(d.intent({ intent: 'ackFault' })).toEqual({ allowed: true });
    expect(d.intent({ intent: 'ackFault' })).toMatchObject({ allowed: false, reason: 'The fault is already being verified.' });
    expect(d.answer(EN_ANSWERS)).toEqual(['hold', 'qr']);
    expect(d.last).toContainEqual({ kind: 'armTimer', id: 'verify', seq: expect.any(Number), ms: 250 });
    expect(d.state.overlays).toContain('FAULT');
    d.fire('verify');
    expect(d.answer(EN_ANSWERS, (t) => t === 'sr')).toEqual(['hold', 'qr']);
    expect(d.state.fault).toBeNull();
    expect(d.state.base).toBe('IDENTIFYING');
    expect(d.state.overlays).toEqual(['UNKNOWN']);
    expect(d.writing).toBe('sr');
    d.answer(EN_ANSWERS);
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toEqual(['UNKNOWN', 'READ_ONLY']);
  });

  it.each([
    ['hold is not 0', { hold: '{"r":{"hold":4},"f":[3,0,10]}' }, 'hold is 4'],
    ['the planner is not empty', { qr: '{"r":{"qr":20},"f":[3,0,10]}' }, '20 of 32'],
    ['hold gives no value', { hold: '{"r":{},"f":[3,100,10]}' }, 'the hold read gave no value'],
  ])('ackFault does not complete when %s', (_label, override, why) => {
    const d = connected();
    d.line(EN_READY_BANNER);
    d.intent({ intent: 'ackFault' });
    d.answer({ ...EN_ANSWERS, ...override });
    expect(d.state.overlays).toContain('FAULT');
    expect(d.state.notices.ackFaultRefused).toContain(why);
    // It can be tried again, and the refusal is cleared.
    expect(d.intent({ intent: 'ackFault' })).toEqual({ allowed: true });
    expect(d.state.notices.ackFaultRefused).toBeUndefined();
  });

  it('ackFault does not complete when the second round disagrees', () => {
    const d = connected();
    d.line(EN_READY_BANNER);
    d.intent({ intent: 'ackFault' });
    d.answer(EN_ANSWERS);
    d.fire('verify');
    d.answer({ ...EN_ANSWERS, hold: '{"r":{"hold":1},"f":[3,0,10]}' });
    expect(d.state.overlays).toContain('FAULT');
    expect(d.state.ackVerify).toBeNull();
  });

  it('a damaged or missing verification answer refuses the acknowledgement', () => {
    const damaged = connected();
    damaged.line(EN_READY_BANNER);
    damaged.intent({ intent: 'ackFault' });
    damaged.written();
    damaged.line('{"r":{"hold":');
    expect(damaged.state.notices.ackFaultRefused).toBe('the hold read arrived damaged');
    const silent = connected();
    silent.line(EN_READY_BANNER);
    silent.intent({ intent: 'ackFault' });
    silent.written();
    silent.fire('answer');
    expect(silent.state.notices.ackFaultRefused).toBe('no answer to the hold read');
    expect(silent.state.overlays).toEqual(expect.arrayContaining(['FAULT', 'STALE']));
  });

  it('a FAULT during the verification ends it', () => {
    const d = connected();
    d.line(EN_READY_BANNER);
    d.intent({ intent: 'ackFault' });
    d.answer(EN_ANSWERS);
    d.feed({ type: 'writeFailed', epoch: d.state.epoch, at: 0, detail: 'x' });
    expect(d.state.ackVerify).toBeNull();
    expect(d.state.timers.verify).toBeUndefined();
  });

  it('a verify timer with no verification pending does nothing', () => {
    const d = connected();
    d.line(EN_READY_BANNER);
    d.intent({ intent: 'ackFault' });
    d.answer(EN_ANSWERS);
    d.state = { ...d.state, ackVerify: null };
    d.fire('verify');
    expect(d.state.queue).toEqual([]);
    d.state = { ...d.state, ackVerify: { round: 0 } };
    d.feed({ type: 'inbound', epoch: d.state.epoch, at: 0, event: classifyLine('{"r":{"hold":0},"f":[3,0,10]}') });
    expect(d.state.fault?.cause).toBe('bannerAfterReady');
  });

  it('a verification answer after the verification ended is ignored', () => {
    const d = connected();
    d.line(EN_READY_BANNER);
    d.intent({ intent: 'ackFault' });
    d.written();
    d.state = { ...d.state, ackVerify: null };
    d.line(EN_ANSWERS.hold as string);
    expect(d.state.ackVerify).toBeNull();
  });

  it('ackFault on an unclassified board is refused: it cannot verify that the board stopped', () => {
    const d = connected({ ...EN_ANSWERS, fv: '{"r":{"fv":0.98},"f":[3,0,10]}' });
    d.line(EN_READY_BANNER);
    expect(d.intent({ intent: 'ackFault' })).toMatchObject({ allowed: false, remedy: 'Check the machine is stopped, then disconnect and connect again.' });
    expect(d.intent({ intent: 'disconnect' })).toEqual({ allowed: true });
  });

  it('ackFault without a FAULT is denied by the matrix', () => {
    const d = connected();
    expect(d.intent({ intent: 'ackFault' })).toMatchObject({ allowed: false, reason: 'There is no fault to acknowledge here.' });
  });
});

describe('LOST, STALE, NEEDS_REVIEW', () => {
  it('LOST closes the port; acknowledging it returns to NOT_CONNECTED and the next connect starts UNKNOWN', () => {
    const d = connected();
    d.feed({ type: 'linkLost', epoch: d.state.epoch, at: 0 });
    expect(d.state.overlays[0]).toBe('LOST');
    expect(d.last).toContainEqual({ kind: 'close', epoch: d.state.epoch });
    expect(d.intent({ intent: 'feedhold' }).allowed).toBe(false);
    expect(d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null }).allowed).toBe(false);
    expect(d.intent({ intent: 'acknowledgeLost' })).toEqual({ allowed: true });
    expect(d.state).toMatchObject({ base: 'NOT_CONNECTED', overlays: [], unknownOnNextConnect: true });
    d.open();
    expect(d.state.overlays).toEqual(['UNKNOWN']);
    expect(d.state.unknownOnNextConnect).toBe(false);
    d.answer(EN_ANSWERS);
    expect(d.state.overlays).toEqual(['UNKNOWN', 'READ_ONLY']);
  });

  it('acknowledgeLost without LOST is denied', () => {
    const d = connected();
    expect(d.intent({ intent: 'acknowledgeLost' }).allowed).toBe(false);
  });

  it('a read that goes unanswered is STALE; the next byte received clears it', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx', 'mpox'] });
    d.written();
    expect(d.last).toContainEqual({ kind: 'armTimer', id: 'answer', seq: expect.any(Number), ms: 2000 });
    d.fire('answer');
    expect(d.state.overlays).toContain('STALE');
    expect(d.state.queue).toEqual([]);
    d.line(EN_ANSWERS.posx as string);
    expect(d.state.overlays).not.toContain('STALE');
    expect(d.state.values).toEqual({});
  });

  it('a READING read that goes unanswered: STALE, and the board is not trusted as resting', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'stat');
    d.written();
    d.fire('answer');
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
    expect(d.state.overlays).toEqual(expect.arrayContaining(['ORPHANED_MOTION', 'STALE']));
  });

  it('a request read timing out while READING still has reads queued finishes READING', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'stat');
    d.intent({ intent: 'read', tokens: ['posx'] });
    // Answer stat, hold, vel, qr are queued; time out the first one.
    d.written();
    d.fire('answer');
    expect(d.state.base).toBe('CONNECTED_UNKNOWN');
  });

  it('a late answer is consumed; a late entry the board never answers is dropped when a later answer arrives', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx', 'mpox'] });
    d.written();
    d.fire('answer');
    d.intent({ intent: 'read', tokens: ['mpox'] });
    d.written();
    d.line(EN_ANSWERS.mpox as string);
    expect(d.state.values['mpox']).toMatchObject({ value: 2.5, status: 0 });
    expect(d.state.fault).toBeNull();
    expect(d.state.expected).toEqual([]);
  });

  it('an answer timer with nothing in flight does nothing', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx'] });
    d.written();
    d.state = { ...d.state, expected: [] };
    d.fire('answer');
    expect(d.state.overlays).toEqual(['READ_ONLY']);
  });

  it('driftDetected raises NEEDS_REVIEW, the lowest-precedence overlay', () => {
    const d = connected();
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    expect(d.state.overlays).toEqual(['READ_ONLY', 'NEEDS_REVIEW']);
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    expect(d.state.overlays).toEqual(['READ_ONLY', 'NEEDS_REVIEW']);
  });

  it('overlays are always kept in precedence order', () => {
    const d = connected();
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    d.line(EN_READY_BANNER);
    d.feed({ type: 'linkLost', epoch: d.state.epoch, at: 0 });
    expect(d.state.overlays).toEqual(OVERLAYS.filter((o) => d.state.overlays.includes(o)));
    expect(d.state.overlays).toEqual(['FAULT', 'LOST', 'UNKNOWN', 'READ_ONLY', 'NEEDS_REVIEW']);
  });
});

describe('intents through the allow-matrix (T-S3) and the Phase 1 session', () => {
  it('Pause, Stop job and Spindle off write only ! (Phase 1 / READ_ONLY: "Use your E-stop" for the last two)', () => {
    const d = connected(EN_ANSWERS, { manifest: EN_APPROVED });
    d.at = 42;
    expect(d.intent({ intent: 'feedhold' })).toEqual({ allowed: true });
    expect(d.state.notices).toEqual({ pauseRequestedAt: 42, adviseEstop: false });
    d.intent({ intent: 'stopJob' });
    d.intent({ intent: 'spindleOffNow' });
    d.intent({ intent: 'feedhold' });
    expect(d.realtime()).toEqual([BYTE.FEEDHOLD, BYTE.FEEDHOLD, BYTE.FEEDHOLD, BYTE.FEEDHOLD]);
    expect(d.state.notices.adviseEstop).toBe(true);
    expect(d.state.sent).toEqual({ lines: 17, realtime: 4 });
  });

  it('feedhold is the unclassified ! while identifying, and denied before the port opens', () => {
    const d = new Driver();
    expect(d.intent({ intent: 'feedhold' }).allowed).toBe(false);
    d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null });
    expect(d.intent({ intent: 'feedhold' }).allowed).toBe(false);
    d.feed({ type: 'transportAcquired', epoch: 1 });
    d.feed({ type: 'opened', epoch: 1, info: SIM_INFO });
    expect(d.intent({ intent: 'feedhold' })).toEqual({ allowed: true });
    expect(d.realtime()).toEqual([0x21]);
  });

  it('ENQ: only classified edge-next after a rev-2/3 footer, at most one outstanding; {"ack":true} clears it', () => {
    const d = new Driver({ manifest: EN_APPROVED });
    d.open();
    expect(d.intent({ intent: 'enq' }).allowed).toBe(false);
    d.answer(EN_ANSWERS);
    expect(enqAllowedNow(d.state)).toBe(true);
    expect(d.intent({ intent: 'enq' })).toEqual({ allowed: true });
    expect(d.realtime()).toEqual([BYTE.ENQ]);
    expect(d.intent({ intent: 'enq' })).toMatchObject({ allowed: false, reason: 'A liveness probe is already outstanding.' });
    d.at = 77;
    d.line('{"ack":true}');
    expect(d.state).toMatchObject({ enqOutstanding: false, lastAckAt: 77 });
    expect(d.intent({ intent: 'enq' })).toEqual({ allowed: true });
  });

  it('ENQ is never sent to 440.21 (no ENQ in its dialect, rev-1 footers)', () => {
    const d = connected(TG_ANSWERS);
    expect(d.intent({ intent: 'enq' }).allowed).toBe(false);
    expect(enqAllowedNow(d.state)).toBe(false);
    expect(d.realtime()).toEqual([]);
  });

  it('ENQ needs the rev-2/3 footer even on a classified edge-next state', () => {
    const d = connected(EN_ANSWERS, { manifest: EN_APPROVED });
    d.state = { ...d.state, footerRev: 1 };
    expect(enqAllowedNow(d.state)).toBe(false);
    expect(d.intent({ intent: 'enq' })).toMatchObject({ allowed: false, citation: 'SAFETY §4.1 Liveness probe row; T-S24b; PN §2.3' });
  });

  it('read: only classified, only allowlisted, bounded, de-duplicated; values land in state.values', () => {
    const d = connected();
    expect(d.intent({ intent: 'read', tokens: [] })).toMatchObject({ allowed: false, reason: 'Nothing to read.' });
    expect(d.intent({ intent: 'read', tokens: 'posx' as unknown as string[] })).toMatchObject({ allowed: false });
    expect(d.intent({ intent: 'read', tokens: ['posx', 'md', 7 as unknown as string] })).toMatchObject({ allowed: false, reason: 'Not on the tinyg-en read allowlist: "md", "7".' });
    expect(d.intent({ intent: 'read', tokens: ['posx', 'posx', 'mpox'] })).toEqual({ allowed: true });
    expect(d.intent({ intent: 'read', tokens: ['mpox'] })).toEqual({ allowed: true });
    d.answer(EN_ANSWERS);
    expect(d.lines().slice(-2)).toEqual(['{"posx":null}', '{"mpox":null}']);
    expect(d.state.values).toEqual({ posx: { value: 1.5, status: 0, at: 0 }, mpox: { value: 2.5, status: 0, at: 0 } });
    const many = Array.from({ length: MAX_QUEUED_READS + 1 }, (_, i) => ['posx', 'posy', 'posz', 'mpox', 'mpoy', 'mpoz'][i % 6] as string);
    expect(d.intent({ intent: 'read', tokens: many })).toEqual({ allowed: true });
    const allowlisted = ['xvm', 'yvm', 'zvm', 'avm', 'bvm', 'cvm', 'xfr', 'yfr', 'zfr', 'afr', 'bfr', 'cfr'].filter((t) => isReadAllowed('tinyg-en', t));
    const flood = [...allowlisted, ...['1ma', '2ma', '3ma', '4ma', '1sa', '2sa', '3sa', '4sa', '1tr', '2tr', '3tr', '4tr', '1mi', '2mi', '3mi', '4mi', '1po', '2po', '3po', '4po', '1pm', '2pm', '3pm', '4pm']];
    const d2 = connected();
    const first = flood.slice(0, MAX_QUEUED_READS - 2);
    expect(first.every((t) => isReadAllowed('tinyg-en', t))).toBe(true);
    void first;
    d2.state = { ...d2.state, queue: Array.from({ length: MAX_QUEUED_READS }, () => ({ token: 'posx', purpose: 'reading' as const })) };
    expect(d2.intent({ intent: 'read', tokens: ['mpox'] })).toMatchObject({ allowed: false, reason: 'Too many reads are waiting.' });
  });

  it('a read answered with an error status is recorded with its status and a null value; a damaged one with status -1', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx'] });
    d.written();
    d.line('{"r":{},"f":[3,100,10]}');
    expect(d.state.values['posx']).toEqual({ value: null, status: 100, at: 0 });
    d.intent({ intent: 'read', tokens: ['mpox'] });
    d.written();
    d.line('{"r":{"mpox":');
    expect(d.state.values['mpox']).toEqual({ value: null, status: -1, at: 0 });
  });

  it('reads are refused while identifying', () => {
    const d = new Driver();
    d.open();
    expect(d.intent({ intent: 'read', tokens: ['stat'] })).toMatchObject({ allowed: false, citation: 'SAFETY H37; PN §12.3' });
  });

  it('every other intent is denied: by the matrix, or by the session in this release', () => {
    for (const intent of INTENTS) {
      if (['connect', 'disconnect', 'feedhold', 'stopJob', 'spindleOffNow', 'ackFault', 'acknowledgeLost', 'enq', 'read'].includes(intent)) continue;
      for (const d of [new Driver(), connected()]) {
        const decision = d.intent({ intent } as SessionIntent);
        expect(decision.allowed, intent).toBe(false);
        expect(d.last.filter((e) => e.kind !== 'decision'), intent).toEqual([]);
      }
    }
    // Offline intents the matrix allows are still not the session's to carry out.
    expect(new Driver().intent({ intent: 'cloudSync' })).toMatchObject({ allowed: false, citation: 'ROADMAP P1-02 (Phase 1)' });
  });

  it('disconnect closes the port and starts a new epoch; disconnecting while the port is being found works too', () => {
    const d = connected();
    const epoch = d.state.epoch;
    expect(d.intent({ intent: 'disconnect' })).toEqual({ allowed: true });
    expect(d.last).toContainEqual({ kind: 'close', epoch });
    expect(d.state).toMatchObject({ base: 'NOT_CONNECTED', epoch: epoch + 1, overlays: [] });
    expect(d.intent({ intent: 'disconnect' }).allowed).toBe(false);
    d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null });
    expect(d.intent({ intent: 'disconnect' })).toEqual({ allowed: true });
    expect(d.state.base).toBe('NOT_CONNECTED');
  });

  it('disconnect cancels armed timers', () => {
    const d = new Driver();
    d.open();
    d.written();
    expect(d.state.timers.answer).toBeDefined();
    d.intent({ intent: 'disconnect' });
    expect(d.last).toContainEqual({ kind: 'cancelTimer', id: 'answer' });
    expect(d.state.timers).toEqual({});
  });

  it('with the Phase 0 release, connect is denied', () => {
    const d = new Driver({ release: CURRENT_RELEASE });
    expect(d.intent({ intent: 'connect', port: PORT, expectedDeviceId: null })).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
  });

  it('the matrix snapshot and readability follow the state', () => {
    const d = new Driver();
    d.open();
    expect(matrixSnapshot(d.state)).toEqual({ base: 'IDENTIFYING', overlays: [], classified: false, enqCapable: false });
    expect(readableNow(d.state, 'fbs')).toBe(true);
    expect(readableNow(d.state, 'posx')).toBe(false);
    d.answer(EN_ANSWERS);
    expect(matrixSnapshot(d.state)).toEqual({ base: 'CONNECTED_UNKNOWN', overlays: ['READ_ONLY'], classified: true, enqCapable: true });
    expect(readableNow(d.state, 'fbs')).toBe(false);
    expect(readableNow(d.state, 'posx')).toBe(true);
    const u = connected({ ...EN_ANSWERS, fv: '{"r":{"fv":0.98},"f":[3,0,10]}' });
    expect(readableNow(u.state, 'sr')).toBe(false);
  });
});

describe('inbound lines that change nothing', () => {
  it('flow signals track XOFF; queue, rx and text reports are recorded or ignored', () => {
    const d = connected();
    d.inbound({ kind: 'FlowSignal', signal: 'xoff' });
    expect(d.state.xoff).toBe(true);
    d.inbound({ kind: 'FlowSignal', signal: 'xon' });
    expect(d.state.xoff).toBe(false);
    d.line('{"qr":28}');
    expect(d.state.live.qr).toBe(28);
    d.line('{"rx":200}');
    d.line('tinyg [mm] ok>');
    d.line('{"ack":true}');
    expect(d.state.fault).toBeNull();
  });

  it('a damaged line with nothing asked is ignored', () => {
    const d = connected();
    d.line('{"r":');
    expect(d.state.fault).toBeNull();
  });

  it('after classification, a 440.21 response whose checksum field is missing is damaged (dialect footer rule)', () => {
    const d = connected(TG_ANSWERS);
    d.intent({ intent: 'read', tokens: ['posx'] });
    d.written();
    d.line('{"r":{"posx":1},"f":[1,0,12]}');
    expect(d.state.values['posx']).toMatchObject({ status: -1 });
  });
});

/** A random inbound line, from shapes the board can send and shapes it should not. */
const inboundArb: fc.Arbitrary<Inbound> = fc.oneof(
  fc.constantFrom(
    ...Object.values(EN_ANSWERS),
    ...Object.values(TG_ANSWERS),
    EN_READY_BANNER,
    EN_BOOT_BANNER,
    TG_READY_BANNER,
    '{"sr":{"vel":10,"stat":5}}',
    '{"sr":{"stat":1,"vel":0}}',
    '{"er":{"fb":450.01,"st":20,"msg":"x"}}',
    '{"ack":true}',
    '{"qr":12}',
    '{"r":{},"f":[3,101,10]}',
    '{"r":{},"f":[2,0,10]}',
    '{"r":{"x":1},"f":[3,0,10],"tid":3}',
    'garbage{',
    'ok>',
  ).map((line) => classifyLine(line)),
  fc.constantFrom<Inbound>({ kind: 'FlowSignal', signal: 'xoff' }, { kind: 'FlowSignal', signal: 'xon' }),
);

const intentArb: fc.Arbitrary<SessionIntent> = fc.oneof(
  fc.constant<SessionIntent>({ intent: 'connect', port: PORT, expectedDeviceId: null }),
  fc.constant<SessionIntent>({ intent: 'connect', port: PORT, expectedDeviceId: 'OTHER-MACHINE' }),
  fc.constantFrom<Intent>(...INTENTS).filter((i) => i !== 'connect' && i !== 'read').map((intent) => ({ intent }) as SessionIntent),
  fc.array(fc.oneof(fc.constantFrom('posx', 'md', 'clear', 'stat', 'qr', '1ma', 'adc3', 'jogx'), fc.string({ maxLength: 6 })), { maxLength: 4 }).map((tokens) => ({ intent: 'read', tokens }) as SessionIntent),
);

type Step =
  | { readonly kind: 'intent'; readonly request: SessionIntent }
  | { readonly kind: 'inbound'; readonly event: Inbound }
  | { readonly kind: 'link'; readonly what: 'transportAcquired' | 'opened' | 'openFailed' | 'transportUnavailable' | 'lineWritten' | 'lineDropped' | 'writeFailed' | 'writeRefused' | 'linkLost' | 'driftDetected' }
  | { readonly kind: 'timer'; readonly id: 'answer' | 'settle' | 'verify' }
  /** The board answers the line in flight correctly (edge-next or 440.21 script). */
  | { readonly kind: 'reply'; readonly answers: Readonly<Record<string, string>> };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: intentArb.map((request) => ({ kind: 'intent' as const, request })) },
  { weight: 6, arbitrary: inboundArb.map((event) => ({ kind: 'inbound' as const, event })) },
  {
    weight: 6,
    arbitrary: fc
      .constantFrom('transportAcquired', 'opened', 'opened', 'lineWritten', 'lineWritten', 'lineWritten', 'lineDropped', 'openFailed', 'transportUnavailable', 'writeFailed', 'writeRefused', 'linkLost', 'driftDetected')
      .map((what) => ({ kind: 'link' as const, what: what as Extract<Step, { kind: 'link' }>['what'] })),
  },
  { weight: 12, arbitrary: fc.constantFrom(EN_ANSWERS, EN_ANSWERS, TG_ANSWERS).map((answers) => ({ kind: 'reply' as const, answers })) },
  { weight: 2, arbitrary: fc.constantFrom('answer', 'settle', 'verify').map((id) => ({ kind: 'timer' as const, id: id as 'answer' | 'settle' | 'verify' })) },
);

function apply(d: Driver, step: Step): void {
  switch (step.kind) {
    case 'reply': {
      const token = d.writing;
      if (token === undefined) return;
      d.written();
      const reply = step.answers[token] ?? EN_ANSWERS[token];
      if (reply !== undefined) d.line(reply);
      return;
    }
    case 'intent':
      d.intent(step.request);
      return;
    case 'inbound':
      d.inbound(step.event);
      return;
    case 'timer': {
      const seq = d.state.timers[step.id];
      if (seq !== undefined) d.fire(step.id);
      return;
    }
    case 'link': {
      const epoch = d.state.epoch;
      switch (step.what) {
        case 'openFailed':
        case 'transportUnavailable':
          d.feed({ type: step.what, epoch, reason: 'x' });
          return;
        case 'writeFailed':
        case 'writeRefused':
          d.feed({ type: step.what, epoch, at: 0, detail: 'x' });
          return;
        case 'linkLost':
          d.feed({ type: 'linkLost', epoch, at: 0 });
          return;
        case 'lineWritten':
        case 'lineDropped':
          d.feed({ type: step.what, epoch, seq: d.state.writing?.seq ?? 0 });
          return;
        case 'opened':
          d.feed({ type: 'opened', epoch, info: SIM_INFO });
          return;
        default:
          d.feed({ type: step.what, epoch });
      }
    }
  }
}

describe('T-S26, T-S24a: generated over states × events (and every overlay reached on the way)', () => {
  it('no effect ever carries 0x18 or 0x04; realtime is only ! and ENQ; every line is a single-token GET readable at that moment', () => {
    const seenBases = new Set<string>();
    const seenOverlays = new Set<string>();
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 80 }),
        fc.boolean(),
        fc.integer({ min: -1, max: 20 }),
        fc.constantFrom(EN_ANSWERS, TG_ANSWERS),
        fc.constantFrom(null, 'EN-1', 'OTHER-MACHINE'),
        (steps, approved, prefix, answers, expected) => {
        const d = new Driver(approved ? { manifest: EN_APPROVED } : {});
        // Start part-way along the connection path, so deep states are reached as often as shallow ones.
        if (prefix >= 0) {
          d.open(expected);
          let n = 0;
          d.answer(answers, () => n++ >= prefix);
          seenBases.add(d.state.base);
        }
        for (const step of steps) {
          const before = d.state;
          apply(d, step);
          seenBases.add(d.state.base);
          for (const o of d.state.overlays) seenOverlays.add(o);
          for (const effect of d.last) {
            if (effect.kind === 'writeRealtime') {
              expect([BYTE.FEEDHOLD, BYTE.ENQ]).toContain(effect.byte);
              expect(effect.byte).not.toBe(BYTE.RESET);
              expect(effect.byte).not.toBe(BYTE.KILL);
              if (effect.byte === BYTE.ENQ) {
                expect(effect.name).toBe('enq');
                expect(enqAllowedNow(before) || enqAllowedNow(d.state)).toBe(true);
              }
            }
            if (effect.kind === 'writeLine') {
              const m = /^\{"?([a-z0-9_]+)"?:null\}$/.exec(effect.line);
              expect(m?.[1], effect.line).toBe(effect.token);
              expect(readableNow(d.state, effect.token), effect.line).toBe(true);
            }
          }
          expect(d.state.overlays).toEqual(OVERLAYS.filter((o) => d.state.overlays.includes(o)));
          // At most one line in flight.
          expect((d.state.writing === null ? 0 : 1) + d.state.expected.filter((e) => !e.late).length).toBeLessThanOrEqual(1);
        }
      },
      ),
      { numRuns: 3000, seed: 0x5e55 },
    );
    expect([...seenBases].sort()).toEqual(['BLOCKED', 'CONNECTED_UNKNOWN', 'IDENTIFYING', 'NOT_CONNECTED', 'OPENING', 'PORT_REQUEST', 'READING'].sort());
    expect([...seenOverlays].sort()).toEqual([...OVERLAYS].sort());
  });

  it('the dialect data agrees: the realtime bytes the session uses are the dialect feedhold and ENQ', () => {
    expect(TINYG_EN.realtime.feedhold.byte).toBe(BYTE.FEEDHOLD);
    expect(TINYG_EN.realtime.enq?.byte).toBe(BYTE.ENQ);
  });
});

describe('ordering of answers and writes', () => {
  it('an answer that arrives before the transport reports its write complete is still that line\'s answer', () => {
    const d = new Driver();
    d.open();
    const first = d.state.writing?.seq as number;
    // The board answers {sr:null} before lineWritten: the probe moves on to fb.
    d.line(EN_ANSWERS.sr as string);
    expect(d.writing).toBe('fb');
    expect(d.state.timers.answer).toBeUndefined();
    // The late completion of the first line is not taken for fb's.
    d.feed({ type: 'lineWritten', epoch: d.state.epoch, seq: first });
    expect(d.writing).toBe('fb');
    expect(d.state.expected).toEqual([]);
    d.written();
    expect(d.state.expected).toEqual([{ token: 'fb', purpose: 'probe', late: false }]);
  });

  it('a damaged answer before the write completes is the damaged answer of the line being written', () => {
    const d = new Driver();
    d.open();
    d.answer(EN_ANSWERS, (t) => t === 'fb');
    d.line('{"r":{"fb":');
    expect(d.state.classification).toMatchObject({ reason: 'probeFailed', detail: 'the answer to the fb probe arrived damaged' });
    expect(d.state.writing).toBeNull();
  });

  it('a lineDropped for another line changes nothing; for the line being written it frees the slot', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx'] });
    const seq = d.state.writing?.seq as number;
    d.feed({ type: 'lineDropped', epoch: d.state.epoch, seq: seq + 1 });
    expect(d.writing).toBe('posx');
    d.feed({ type: 'lineDropped', epoch: d.state.epoch, seq });
    expect(d.state.writing).toBeNull();
  });

  it('two reads timing out in turn: the older late entry stays late and is dropped when a newer answer arrives', () => {
    const d = connected();
    d.intent({ intent: 'read', tokens: ['posx'] });
    d.written();
    d.fire('answer');
    d.intent({ intent: 'read', tokens: ['mpox'] });
    d.written();
    d.fire('answer');
    expect(d.state.expected).toEqual([
      { token: 'posx', purpose: 'request', late: true },
      { token: 'mpox', purpose: 'request', late: true },
    ]);
    d.line(EN_ANSWERS.mpox as string);
    expect(d.state.expected).toEqual([]);
    expect(d.state.fault).toBeNull();
  });
});

describe('guards that only a broken invariant reaches (fabricated states)', () => {
  it('a settle timer without a probe does nothing', () => {
    const d = new Driver();
    d.open();
    d.line(EN_READY_BANNER);
    d.state = { ...d.state, probe: null };
    d.fire('settle');
    expect(d.state.base).toBe('IDENTIFYING');
    expect(d.state.queue).toEqual([]);
  });

  it('a queued read the matrix does not allow now is not written', () => {
    const d = connected();
    d.state = { ...d.state, overlays: ['ORPHANED_MOTION'], dialect: null, classification: null, queue: [{ token: 'sr', purpose: 'splice' }] };
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    expect(d.state.writing).toBeNull();
    expect(d.lines()).toEqual([...PROBE_LINES, ...READING_LINES]);
  });

  it('a queued token that is not readable in this state is never written: FAULT (writeRefused)', () => {
    const d = connected();
    d.state = { ...d.state, queue: [{ token: 'md', purpose: 'request' }] };
    d.feed({ type: 'driftDetected', epoch: d.state.epoch });
    expect(d.state.fault).toMatchObject({ cause: 'writeRefused', detail: 'no allowlisted GET for "md" in this state' });
    expect(d.lines()).not.toContain('{"md":null}');
    const probe = new Driver();
    probe.open();
    probe.state = { ...probe.state, writing: null, queue: [{ token: 'posx', purpose: 'probe' }] };
    probe.feed({ type: 'driftDetected', epoch: probe.state.epoch });
    expect(probe.state.fault?.cause).toBe('writeRefused');
  });

  it('a board that answers no id when a machine is selected is BLOCKED with no reported id', () => {
    const d = connected({ ...EN_ANSWERS, id: '{"r":{},"f":[3,100,10]}' }, {}, 'MACHINE-7');
    expect(d.state.base).toBe('BLOCKED');
    expect(d.state.blocked).toEqual({ expected: 'MACHINE-7', reported: null });
  });

  it('identity carries fbs when the board reports one', () => {
    const d = connected({ ...EN_ANSWERS, fbs: '{"r":{"fbs":"ead63997"},"f":[3,0,10]}' });
    expect(d.state.identity).toMatchObject({ fbs: 'ead63997' });
  });
});
