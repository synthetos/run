import { BYTE, classifyLine } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { type SessionIntent } from '../src/index.ts';
import { Driver, EN_ANSWERS, EN_BOOT_BANNER, EN_READY_BANNER, SIM_INFO, TG_ANSWERS, TG_READY_BANNER, tg } from './sessionDriver.ts';
import { EN_APPROVED, EN_CONNECT, PROBE_LINES, READING_LINES, connected, seedLines } from './sessionReducerFixtures.ts';
import { PORT } from './simTransport.ts';

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
    // Then the full state is read once (amendment 2026-11-02); a read-only board is not configured.
    expect(d.lines()).toEqual(EN_CONNECT);
    expect(d.state.reports.phase).toBe('off');
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
    expect(d.lines()).toEqual([...PROBE_LINES, ...READING_LINES, ...seedLines('tinyg-440')]);
    expect(d.state.footerRev).toBe(1);
  });


  it('a manifest approval makes the session full (no READ_ONLY); Phase 1 still allows no motion or write', () => {
    const d = connected(EN_ANSWERS, { manifest: EN_APPROVED });
    expect(d.state.classification).toMatchObject({ mode: 'full', reason: 'en-approved', buildIdentity: 'fbOnly' });
    expect(d.state.overlays).toEqual([]);
    for (const intent of ['jog', 'home', 'start', 'settingsWrite', 'resetController', 'spindleOn', 'setWorkZero'] as const) {
      expect(d.intent({ intent } as unknown as SessionIntent), intent).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
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
});

describe('the connection path', () => {


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
