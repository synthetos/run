/**
 * The test kit's `ReplayTransport` against the machine `Transport` contract
 * (ROADMAP P0-12 "ReplayTransport"; P0-11 left `TransportLike` to be checked
 * here). A replay is a `Transport`, it runs behind `GuardedTransport`, and a
 * JSONL bench recording (`{t, dir, hex}`) replays through the guard byte for
 * byte. The guard's refusals never reach the recording, so a replay test
 * cannot pass by accident on bytes the guard would have stopped.
 */
import { BYTE } from '@synthetos/protocol';
import { ReplayTransport, VirtualClock, recordingFromJsonl, type Recording } from '@synthetos/testkit';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { GuardedTransport, TransportRefusedError } from '../src/guardedTransport.ts';
import type { Transport } from '../src/transport.ts';
import { SESSION_OPTIONS, enc } from './fakeTransport.ts';

const hex = (s: string): string => Array.from(enc(s), (b) => b.toString(16).padStart(2, '0')).join('');

const JSONL = [
  { t: 0, dir: 'tx', hex: hex('{"sr":null}\n') },
  { t: 3, dir: 'rx', hex: hex('{"r":{"sr":{"stat":1}},"f":[3,0,10]}\n') },
  { t: 5, dir: 'tx', hex: hex('{"fb":null}\n') },
  { t: 7, dir: 'rx', hex: hex('{"r":{"fb":450.01},"f":[3,0,10]}\n') },
  { t: 9, dir: 'tx', hex: '21' },
]
  .map((l) => JSON.stringify(l))
  .join('\n');

async function drain(t: Transport, out: string[]): Promise<void> {
  for await (const chunk of t.readable) out.push(new TextDecoder().decode(chunk));
}

describe('ReplayTransport is a Transport', () => {
  it('type-checks as one', () => {
    expectTypeOf<ReplayTransport>().toMatchTypeOf<Transport>();
  });

  it('replays a JSONL bench recording through the guard byte for byte', async () => {
    const clock = new VirtualClock();
    const recording = recordingFromJsonl('probe-start', JSONL);
    const replay = new ReplayTransport(recording, { clock });
    const t: Transport = new GuardedTransport(replay);
    const got: string[] = [];
    await t.open(SESSION_OPTIONS);
    const reading = drain(t, got);
    await t.writeLine(enc('{"sr":null}\n'));
    await clock.advanceAsync(5);
    await t.writeLine(enc('{"fb":null}\n'));
    await clock.advanceAsync(5);
    await t.writeLine(Uint8Array.of(BYTE.FEEDHOLD));
    expect(replay.finished).toBe(true);
    expect(replay.divergence).toBeNull();
    expect(got.join('')).toBe('{"r":{"sr":{"stat":1}},"f":[3,0,10]}\n{"r":{"fb":450.01},"f":[3,0,10]}\n');
    await t.close();
    await reading;
  });

  it('a write the guard refuses never reaches the recording, so it cannot be mistaken for a match', async () => {
    const clock = new VirtualClock();
    // A recording that itself contains a damaged line: the guard stops the host before the replay sees it.
    const bad: Recording = { name: 'two-lines', steps: [{ expect: enc('G0 X1\nG0 X2\n') }] };
    const replay = new ReplayTransport(bad, { clock });
    const t = new GuardedTransport(replay);
    await t.open(SESSION_OPTIONS);
    await expect(t.writeLine(enc('G0 X1\nG0 X2\n'))).rejects.toBeInstanceOf(TransportRefusedError);
    expect(replay.finished).toBe(false);
    expect(replay.divergence).toBeNull();
  });

  it('a divergence from the recording is a failed write: the guard latches and refuses further lines', async () => {
    const clock = new VirtualClock();
    const replay = new ReplayTransport(recordingFromJsonl('one', JSONL), { clock });
    const t = new GuardedTransport(replay);
    await t.open(SESSION_OPTIONS);
    await expect(t.writeLine(enc('{"xx":null}\n'))).rejects.toThrow(/write failed/);
    expect(t.writeFailed).toBe(true);
    await expect(t.writeLine(enc('{"sr":null}\n'))).rejects.toMatchObject({ code: 'line-after-write-failure' });
  });

  it('a replay link drop is seen by the guard', async () => {
    const clock = new VirtualClock();
    const replay = new ReplayTransport({ name: 'drop', steps: [{ disconnect: true, afterMs: 1 }] }, { clock });
    const t = new GuardedTransport(replay);
    let dropped = false;
    t.onDisconnect(() => {
      dropped = true;
    });
    await t.open(SESSION_OPTIONS);
    await clock.advanceAsync(2);
    expect(dropped).toBe(true);
    await expect(t.writeLine(Uint8Array.of(BYTE.FEEDHOLD))).rejects.toMatchObject({ code: 'disconnected' });
  });
});
