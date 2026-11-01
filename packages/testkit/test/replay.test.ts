import { describe, expect, it } from 'vitest';
import { VirtualClock, settle } from '../src/clock.ts';
import { RecordingFormatError, ReplayTransport, ReplayDivergenceError, recordingFromJsonl, recordingFromTranscript, type Recording } from '../src/replay.ts';
import { bytes, text } from '../src/bytes.ts';
import { enSim } from './helpers.ts';

const rec: Recording = {
  name: 'probe-start',
  steps: [
    { expect: bytes('{"sr":null}\n') },
    { emit: bytes('{"r":{"sr":{"stat":1}},"f":[3,0,10]}\n'), afterMs: 3 },
    { expect: bytes('{"fb":null}\n') },
    { emit: bytes('{"r":{"fb":450.01},'), afterMs: 2 },
    { emit: bytes('"f":[3,0,10]}\n'), afterMs: 1 },
  ],
};

async function collect(t: ReplayTransport, out: string[]): Promise<void> {
  for await (const chunk of t.readable) out.push(text(chunk));
}

describe('ReplayTransport', () => {
  it('feeds the recorded replies when the host writes exactly the recorded lines', async () => {
    const clock = new VirtualClock();
    const t = new ReplayTransport(rec, { clock });
    const got: string[] = [];
    await t.open();
    const reading = collect(t, got);
    await t.writeLine(bytes('{"sr":null}\n'));
    await clock.advanceAsync(5);
    expect(got).toEqual(['{"r":{"sr":{"stat":1}},"f":[3,0,10]}\n']);
    await t.writeLine(bytes('{"fb":null}\n'));
    await clock.advanceAsync(5);
    expect(got.join('')).toContain('"fb":450.01},"f":[3,0,10]}\n');
    expect(t.finished).toBe(true);
    expect(t.divergence).toBeNull();
    expect(t.info()).toEqual({ kind: 'replay' });
    await t.close();
    await reading;
  });

  it('fails loudly on a different line and stays failed', async () => {
    const t = new ReplayTransport(rec, { clock: new VirtualClock() });
    await t.open();
    await expect(t.writeLine(bytes('{"fv":null}\n'))).rejects.toBeInstanceOf(ReplayDivergenceError);
    expect(t.divergence).toMatchObject({ step: 0, reason: 'unexpected-bytes', expected: '{"sr":null}\\n', actual: '{"fv":null}\\n' });
    await expect(t.writeLine(bytes('{"sr":null}\n'))).rejects.toBeInstanceOf(ReplayDivergenceError);
    await expect(t.readable[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(ReplayDivergenceError);
  });

  it('refuses a write that comes before the recorded replies, and one past the end', async () => {
    const clock = new VirtualClock();
    const early = new ReplayTransport(rec, { clock });
    await early.open();
    await early.writeLine(bytes('{"sr":null}\n'));
    await expect(early.writeLine(bytes('{"fb":null}\n'))).rejects.toMatchObject({ divergence: { reason: 'write-before-expected', step: 1 } });

    const done = new ReplayTransport({ name: 'one', steps: [{ expect: bytes('!') }] }, { clock });
    await done.open();
    await done.writeLine(bytes('!'));
    await expect(done.writeLine(bytes('!'))).rejects.toMatchObject({ divergence: { reason: 'write-past-end' } });
  });

  it('refuses a write before open() and after close(), even one that matches the recording', async () => {
    const before = new ReplayTransport(rec, { clock: new VirtualClock() });
    await expect(before.writeLine(bytes('{"sr":null}\n'))).rejects.toMatchObject({ divergence: { reason: 'write-while-closed', step: 0 } });
    expect(before.finished).toBe(false);

    const after = new ReplayTransport(rec, { clock: new VirtualClock() });
    await after.open();
    await after.close();
    await expect(after.writeLine(bytes('{"sr":null}\n'))).rejects.toMatchObject({ divergence: { reason: 'write-while-closed', step: 0 } });
  });

  it('replays a recorded disconnect: listeners fire and the readable ends', async () => {
    const clock = new VirtualClock();
    const t = new ReplayTransport({ name: 'pull', steps: [{ emit: bytes('x'), afterMs: 1 }, { disconnect: true, afterMs: 5 }] }, { clock });
    const fired: string[] = [];
    t.onDisconnect(() => fired.push('gone'));
    await t.open();
    const got: string[] = [];
    const reading = collect(t, got);
    await settle();
    await clock.advanceAsync(10);
    await reading;
    expect(got).toEqual(['x']);
    expect(fired).toEqual(['gone']);
    await expect(t.writeLine(bytes('!'))).rejects.toMatchObject({ divergence: { reason: 'write-after-disconnect' } });
  });

  it('turns a simulator transcript into a recording that replays byte for byte', async () => {
    const sim = enSim();
    sim.host.sendLine('{"sr":null}');
    sim.clock.advance(20);
    sim.host.sendLine('G1 X1 F600');
    sim.clock.advance(400);
    const recording = recordingFromTranscript('en-session', sim.endpoint.transcript);
    expect(recording.steps.filter((s) => 'expect' in s)).toHaveLength(2);

    const clock = new VirtualClock();
    const t = new ReplayTransport(recording, { clock });
    const got: string[] = [];
    await t.open();
    const reading = collect(t, got);
    await t.writeLine(bytes('{"sr":null}\n'));
    await clock.advanceAsync(20);
    await t.writeLine(bytes('G1 X1 F600\n'));
    await clock.advanceAsync(400);
    expect(t.finished).toBe(true);
    expect(got.join('')).toBe(text(sim.endpoint.transcript.bytesOf('host-read')));
    await t.close();
    await reading;
  });
});

describe('recordingFromJsonl (JSONL bench recordings, {t, dir, hex})', () => {
  const line = (o: unknown): string => JSON.stringify(o);

  it('turns tx lines into expects and rx lines into emits timed by the gap to the previous line', () => {
    const r = recordingFromJsonl(
      'bench',
      [line({ t: 0, dir: 'tx', hex: '7b7d0a' }), '', line({ t: 2.5, dir: 'rx', hex: '4F4b' }), line({ t: 4, dir: 'tx', hex: '21' }), line({ t: 10, dir: 'rx', hex: '0a' }), ''].join('\n'),
    );
    expect(r.name).toBe('bench');
    expect(r.steps).toEqual([{ expect: bytes('{}\n') }, { emit: bytes('OK'), afterMs: 2.5 }, { expect: bytes('!') }, { emit: bytes('\n'), afterMs: 6 }]);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.steps)).toBe(true);
  });

  it('an empty file is an empty recording', () => {
    expect(recordingFromJsonl('empty', '\n \n').steps).toEqual([]);
  });

  it.each([
    ['not JSON', '{t:0}', /line 1: not JSON/],
    ['an array', '[1]', /line 1: not an object/],
    ['null', 'null', /line 1: not an object/],
    ['a number', '5', /line 1: not an object/],
    ['a missing key', line({ t: 0, dir: 'tx' }), /keys must be exactly t, dir, hex \(got dir,t\)/],
    ['an extra key', line({ t: 0, dir: 'tx', hex: '21', note: 'x' }), /keys must be exactly/],
    ['a string time', line({ t: '0', dir: 'tx', hex: '21' }), /t must be a finite number/],
    ['a negative time', line({ t: -1, dir: 'tx', hex: '21' }), /t must be a finite number/],
    ['an odd-length hex', line({ t: 0, dir: 'tx', hex: '213' }), /hex must be/],
    ['an empty hex', line({ t: 0, dir: 'tx', hex: '' }), /hex must be/],
    ['a non-hex payload', line({ t: 0, dir: 'tx', hex: 'zz' }), /hex must be/],
    ['a numeric payload', line({ t: 0, dir: 'tx', hex: 21 }), /hex must be/],
    ['an unknown direction', line({ t: 0, dir: 'link', hex: '21' }), /dir must be "tx" or "rx" \(got "link"\)/],
  ])('refuses %s', (_name, text, message) => {
    expect(() => recordingFromJsonl('bad', text)).toThrow(RecordingFormatError);
    expect(() => recordingFromJsonl('bad', text)).toThrow(message);
  });

  it('refuses time going backwards and reports the line number', () => {
    const text = [line({ t: 5, dir: 'tx', hex: '21' }), line({ t: 4, dir: 'rx', hex: '21' })].join('\n');
    let error: unknown;
    try {
      recordingFromJsonl('bad', text);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RecordingFormatError);
    expect((error as RecordingFormatError).line).toBe(2);
    expect((error as Error).message).toContain('earlier than the previous line');
  });

  it('a JSONL recording drives ReplayTransport like any other', async () => {
    const clock = new VirtualClock();
    const t = new ReplayTransport(
      recordingFromJsonl('j', [line({ t: 0, dir: 'tx', hex: '7b7d0a' }), line({ t: 1, dir: 'rx', hex: '4f4b0a' })].join('\n')),
      { clock },
    );
    const got: string[] = [];
    await t.open();
    const reading = collect(t, got);
    await t.writeLine(bytes('{}\n'));
    await clock.advanceAsync(2);
    expect(got).toEqual(['OK\n']);
    expect(t.finished).toBe(true);
    await t.close();
    await reading;
  });
});
