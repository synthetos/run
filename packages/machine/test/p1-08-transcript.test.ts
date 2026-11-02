/**
 * ROADMAP P1-08: the wire EventLog and its JSONL export. Acceptance:
 * "Transcripts replay byte-identically through `ReplayTransport`".
 *
 * A session runs against the test kit's firmware models; its exported
 * transcript is parsed by the test kit's strict `recordingFromJsonl` and
 * replayed to a fresh session. The replayed session must write exactly the
 * recorded bytes (any other write is a `ReplayDivergenceError`) and its own
 * transcript must be identical to the original, byte for byte.
 */
import { ReplayTransport, VirtualClock, recordingFromJsonl } from '@synthetos/testkit';
import { describe, expect, it } from 'vitest';
import { EventLog, EventLogTruncatedError, MachineSession, toHex, wireEventsToJsonl } from '../src/index.ts';
import { harness, type ModelName } from './sessionHarness.ts';
import { PORT, flush, microtasks, simSource } from './simTransport.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

async function runTo(clock: VirtualClock, ms: number): Promise<void> {
  const target = clock.now() + ms;
  await flush();
  for (;;) {
    const next = clock.nextAt();
    if (next === undefined || next > target) break;
    clock.advanceTo(next);
    await microtasks();
  }
  clock.advanceTo(target);
  await flush();
}

/** One scripted bench session: connect, settle, a read, a Pause, more time, disconnect. */
async function script(session: MachineSession, run: (ms: number) => Promise<void>): Promise<void> {
  void session.connect(PORT);
  await run(3000);
  session.read(['posx']);
  await run(500);
  session.feedhold();
  await run(1500);
  await session.disconnect();
  await run(10);
}

describe('P1-08 EventLog', () => {
  it('records tx and rx bytes with times from the open, and writes {t, dir, hex} JSONL', () => {
    const log = new EventLog(100);
    log.tx(100, enc('{"sr":null}\n'));
    log.rx(103.5, enc('{"r":{}'));
    log.rx(104, enc(',"f":[3,0,10]}\n'));
    log.tx(110, Uint8Array.of(0x21));
    expect(log.toJsonl()).toBe(
      [
        `{"t":0,"dir":"tx","hex":"${toHex(enc('{"sr":null}\n'))}"}`,
        `{"t":3.5,"dir":"rx","hex":"${toHex(enc('{"r":{}'))}"}`,
        `{"t":4,"dir":"rx","hex":"${toHex(enc(',"f":[3,0,10]}\n'))}"}`,
        '{"t":10,"dir":"tx","hex":"21"}',
        '',
      ].join('\n'),
    );
  });

  it('keeps its own copy of the bytes', () => {
    const log = new EventLog(0);
    const bytes = enc('{"fb":null}\n');
    log.tx(0, bytes);
    bytes.fill(0x18);
    expect(log.events()[0]?.bytes).toEqual(enc('{"fb":null}\n'));
  });

  it('never exports a partial transcript: past its bound it stops recording and refuses', () => {
    const log = new EventLog(0, { maxBytes: 16 });
    log.tx(0, enc('{"sr":null}\n'));
    expect(log.truncated).toBe(false);
    log.rx(1, enc('{"r":{"sr":{}}}\n'));
    expect(log.truncated).toBe(true);
    log.tx(2, Uint8Array.of(0x21));
    expect(log.events()).toHaveLength(1);
    expect(() => log.toJsonl()).toThrow(EventLogTruncatedError);
  });

  it('never writes a time earlier than the line before it (the parser refuses one)', () => {
    const log = new EventLog(50);
    log.tx(60, Uint8Array.of(0x21));
    log.rx(55, enc('x\n'));
    log.rx(40, enc('y\n'));
    expect(log.events().map((e) => e.t)).toEqual([10, 10, 10]);
    expect(() => recordingFromJsonl('t', wireEventsToJsonl(log.events()))).not.toThrow();
  });
});

describe('P1-08 transcript export from a MachineSession', () => {
  it('is refused before any port has opened', () => {
    const session = new MachineSession({ source: simSource(() => null), clock: new VirtualClock() });
    expect(session.exportTranscript()).toEqual({ ok: false, reason: 'no port has been opened in this session' });
  });

  it('is refused when the transcript passed its bound', async () => {
    const h = harness('en', { session: { transcriptMaxBytes: 64 } });
    void h.session.connect(PORT);
    await h.run(3000);
    const out = h.session.exportTranscript();
    expect(out.ok).toBe(false);
    expect(out.ok ? '' : out.reason).toMatch(/partial transcript is not exported/);
  });

  for (const model of ['en', '440'] as ModelName[]) {
    it(`${model}: the transcript holds every byte written and received, and replays byte-identically through ReplayTransport`, async () => {
      const h = harness(model);
      await script(h.session, (ms) => h.run(ms));
      const original = h.session.exportTranscript();
      if (!original.ok) throw new Error(original.reason);
      expect(original.events).toBeGreaterThan(10);

      // Every tx byte in the transcript is a byte the transport was asked to write, in order.
      const recording = recordingFromJsonl(`${model}-bench`, original.jsonl);
      const txRecorded = recording.steps.flatMap((s) => ('expect' in s ? [...s.expect] : []));
      const txWritten = (h.transports[0]?.writes ?? []).flatMap((w) => [...w]);
      expect(txRecorded).toEqual(txWritten);
      // The Pause and the first {"sr":null} are in it.
      expect(recording.steps.find((s) => 'expect' in s && s.expect.length === 1 && s.expect[0] === 0x21)).toBeDefined();
      expect(recording.steps[0]).toEqual({ expect: enc('{"sr":null}\n') });

      // Replay it to a fresh session on a fresh clock.
      const clock = new VirtualClock();
      const replays: ReplayTransport[] = [];
      const source = simSource(() => {
        const r = new ReplayTransport(recording, { clock });
        replays.push(r);
        return r;
      });
      const replayed = new MachineSession({ source, clock });
      await script(replayed, (ms) => runTo(clock, ms));
      const replay = replays[0] as ReplayTransport;
      expect(replay.divergence).toBeNull();
      expect(replay.finished).toBe(true);
      const again = replayed.exportTranscript();
      if (!again.ok) throw new Error(again.reason);
      expect(again.jsonl).toBe(original.jsonl);
    });
  }

  it('keeps the last link\'s transcript after a disconnect, and a new connect starts a new one', async () => {
    const h = harness('en');
    await script(h.session, (ms) => h.run(ms));
    const first = h.session.exportTranscript();
    void h.session.connect(PORT);
    await h.run(200);
    const second = h.session.exportTranscript();
    if (!first.ok || !second.ok) throw new Error('export refused');
    expect(second.jsonl).not.toBe(first.jsonl);
    expect(JSON.parse(second.jsonl.split('\n')[0] as string)).toEqual({ t: 0, dir: 'tx', hex: toHex(enc('{"sr":null}\n')) });
  });
});
