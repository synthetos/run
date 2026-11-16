import { BYTE } from '@synthetos/protocol';
import { CURRENT_RELEASE, INTENTS } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import { describe, expect, it } from 'vitest';
import { MAX_QUEUED_READS, enqAllowedNow, matrixSnapshot, readableNow, type SessionIntent } from '../src/index.ts';
import { Driver, EN_ANSWERS, SIM_INFO, TG_ANSWERS } from './sessionDriver.ts';
import { EN_APPROVED, EN_CONNECT, connected, seedValues } from './sessionReducerFixtures.ts';
import { PORT } from './simTransport.ts';

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
    expect(d.state.sent).toEqual({ lines: EN_CONNECT.length, realtime: 4 });
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
});

describe('intents through the allow-matrix (T-S3) and the Phase 1 session', () => {


  it('read: only classified, only allowlisted, bounded, de-duplicated; values land in state.values', () => {
    const d = connected();
    expect(d.intent({ intent: 'read', tokens: [] })).toMatchObject({ allowed: false, reason: 'Nothing to read.' });
    expect(d.intent({ intent: 'read', tokens: 'posx' as unknown as string[] })).toMatchObject({ allowed: false });
    expect(d.intent({ intent: 'read', tokens: ['posx', 'md', 7 as unknown as string] })).toMatchObject({ allowed: false, reason: 'Not on the tinyg-en read allowlist: "md", "7".' });
    expect(d.intent({ intent: 'read', tokens: ['posx', 'posx', 'mpox'] })).toEqual({ allowed: true });
    expect(d.intent({ intent: 'read', tokens: ['mpox'] })).toEqual({ allowed: true });
    d.answer(EN_ANSWERS);
    expect(d.lines().slice(-2)).toEqual(['{"posx":null}', '{"mpox":null}']);
    expect(seedValues(d)).toEqual({ posx: { value: 1.5, status: 0, at: 0 }, mpox: { value: 2.5, status: 0, at: 0 } });
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
});

describe('intents through the allow-matrix (T-S3) and the Phase 1 session', () => {


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
