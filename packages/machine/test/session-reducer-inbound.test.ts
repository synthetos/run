import { describe, expect, it } from 'vitest';
import { Driver, EN_ANSWERS, EN_READY_BANNER, TG_ANSWERS } from './sessionDriver.ts';
import { EN_CONNECT, connected } from './sessionReducerFixtures.ts';

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
    expect(d.lines()).toEqual(EN_CONNECT);
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
