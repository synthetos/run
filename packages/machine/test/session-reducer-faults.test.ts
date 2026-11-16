import { BYTE, classifyLine } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { EN_ANSWERS, EN_READY_BANNER } from './sessionDriver.ts';
import { connected, realtime } from './sessionReducerFixtures.ts';

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
});

describe('FAULT triggers and ackFault (SAFETY §3)', () => {


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
});

describe('FAULT triggers and ackFault (SAFETY §3)', () => {


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
