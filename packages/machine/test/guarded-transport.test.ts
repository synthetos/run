/**
 * `GuardedTransport` write rules (ROADMAP P0-12; SAFETY H2b; OLD-TP §4.2):
 * one complete line or realtime group per awaited write, strict ordering,
 * no line after a failed write, nothing before open, after close or after a
 * disconnect, and a close that never cuts a line.
 */
import { BYTE } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { GuardedTransport, TransportRefusedError, TransportWriteError } from '../src/guardedTransport.ts';
import { FakeTransport, SESSION_OPTIONS, enc, flush } from './fakeTransport.ts';

async function opened(inner = new FakeTransport()): Promise<{ inner: FakeTransport; t: GuardedTransport }> {
  const t = new GuardedTransport(inner);
  await t.open(SESSION_OPTIONS);
  return { inner, t };
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
}

async function refusedCode(promise: Promise<unknown>): Promise<string> {
  const e = await errorOf(promise);
  expect(e).toBeInstanceOf(TransportRefusedError);
  return (e as TransportRefusedError).code;
}

const FEEDHOLD = Uint8Array.of(BYTE.FEEDHOLD);
const FLUSH = Uint8Array.of(BYTE.FLUSH);

describe('line validation at the guard', () => {
  it('passes a valid line and a realtime byte through unchanged', async () => {
    const { inner, t } = await opened();
    await t.writeLine(enc('{"sr":null}\n'));
    await t.writeLine(FEEDHOLD);
    expect(inner.written()).toEqual(['{"sr":null}\n', '!']);
  });

  it('refuses an invalid write without sending anything, and names the rule', async () => {
    const { inner, t } = await opened();
    const e = await errorOf(t.writeLine(enc('G0 X1\nG0 X2\n')));
    expect(e).toBeInstanceOf(TransportRefusedError);
    expect((e as TransportRefusedError).code).toBe('invalid-write');
    expect((e as TransportRefusedError).rejection).toBe('embedded-lf');
    expect((e as Error).message).toContain('embedded-lf at byte 5');
    expect(await refusedCode(t.writeLine(enc('G1 X12.5')))).toBe('invalid-write');
    expect(await refusedCode(t.writeLine(new Uint8Array(0)))).toBe('invalid-write');
    expect(((await errorOf(t.writeLine(new Uint8Array(0)))) as Error).message).toMatch(/empty$/);
    expect(inner.written()).toEqual([]);
  });

  it('an invalid write is not a write failure: lines still go afterwards', async () => {
    const { inner, t } = await opened();
    await errorOf(t.writeLine(enc('bad')));
    expect(t.writeFailed).toBe(false);
    await t.writeLine(enc('G0 X0\n'));
    expect(inner.written()).toEqual(['G0 X0\n']);
  });

  it('refuses anything that is not a Uint8Array', async () => {
    const { inner, t } = await opened();
    for (const bad of ['G0 X0\n', [0x21], null, new Uint16Array([0x21])]) {
      expect(await refusedCode(t.writeLine(bad as unknown as Uint8Array))).toBe('invalid-write');
    }
    expect(inner.written()).toEqual([]);
  });

  it('copies the bytes before checking them, so changing the buffer afterwards changes nothing', async () => {
    const inner = new FakeTransport();
    inner.holdWrites = true;
    const { t } = await opened(inner);
    const first = t.writeLine(enc('G0 X1\n'));
    const buf = enc('G0 X2\n');
    const second = t.writeLine(buf);
    // While queued, rewrite the caller's buffer into two lines.
    buf.set(enc('\nG0X9\n'));
    await flush();
    inner.releaseWrite();
    await flush();
    inner.releaseWrite();
    await Promise.all([first, second]);
    expect(inner.written()).toEqual(['G0 X1\n', 'G0 X2\n']);
  });
});

describe('one write at a time, in order', () => {
  it('never lets two writes overlap at the port, and keeps call order', async () => {
    const inner = new FakeTransport();
    inner.holdWrites = true;
    const { t } = await opened(inner);
    const writes = [t.writeLine(enc('G0 X1\n')), t.writeLine(enc('G0 X2\n')), t.writeLine(FEEDHOLD), t.writeLine(enc('G0 X3\n'))];
    await flush();
    expect(inner.written()).toEqual(['G0 X1\n']);
    for (let i = 0; i < 4; i++) {
      inner.releaseWrite();
      await flush();
    }
    await Promise.all(writes);
    expect(inner.maxInFlight).toBe(1);
    expect(inner.written()).toEqual(['G0 X1\n', 'G0 X2\n', '!', 'G0 X3\n']);
  });

  it('a STOP issued during a line write is sent after that line completes, never inside it', async () => {
    const inner = new FakeTransport();
    inner.holdWrites = true;
    const { t } = await opened(inner);
    const line = t.writeLine(enc('G1 X12.5 F100\n'));
    const stop = t.writeLine(FEEDHOLD);
    await flush();
    expect(inner.calls.map((c) => c.op)).toEqual(['open', 'write']);
    inner.releaseWrite();
    await flush();
    inner.releaseWrite();
    await Promise.all([line, stop]);
    expect(inner.calls.slice(1)).toEqual([
      { op: 'write', bytes: 'G1 X12.5 F100\n' },
      { op: 'write-done', bytes: 'G1 X12.5 F100\n' },
      { op: 'write', bytes: '!' },
      { op: 'write-done', bytes: '!' },
    ]);
  });
});

describe('SAFETY H2b: no line after a failed write', () => {
  it('latches on a failed write and refuses every later line, but still sends realtime bytes', async () => {
    const inner = new FakeTransport();
    inner.writeError = new Error('NetworkError');
    const { t } = await opened(inner);
    const e = await errorOf(t.writeLine(enc('G1 X12.5\n')));
    expect(e).toBeInstanceOf(TransportWriteError);
    expect((e as Error).cause).toBe(inner.writeError);
    expect(t.writeFailed).toBe(true);

    inner.writeError = undefined;
    for (const line of ['\n', 'G0 X0\n', '{"sr":null}\n']) {
      expect(await refusedCode(t.writeLine(enc(line)))).toMatch(/line-after-write-failure|invalid-write/);
    }
    expect(await refusedCode(t.writeLine(enc('G0 X0\n')))).toBe('line-after-write-failure');
    // The stop path still works: TinyG's `!` then `%`.
    await t.writeLine(FEEDHOLD);
    await t.writeLine(FLUSH);
    expect(inner.written()).toEqual(['G1 X12.5\n', '!', '%']);
  });

  it('refuses a line that was queued behind the write that failed, without sending it', async () => {
    const inner = new FakeTransport();
    inner.holdWrites = true;
    const { t } = await opened(inner);
    const failing = errorOf(t.writeLine(enc('G1 X12.5\n')));
    const queuedLine = errorOf(t.writeLine(enc('G1 X20\n')));
    const queuedStop = t.writeLine(FEEDHOLD);
    await flush();
    inner.failWrite();
    expect(await failing).toBeInstanceOf(TransportWriteError);
    expect(((await queuedLine) as TransportRefusedError).code).toBe('line-after-write-failure');
    await flush();
    inner.releaseWrite();
    await queuedStop;
    expect(inner.written()).toEqual(['G1 X12.5\n', '!']);
  });

  it('a failed realtime write latches too', async () => {
    const inner = new FakeTransport();
    const { t } = await opened(inner);
    inner.writeError = new Error('lost');
    expect(await errorOf(t.writeLine(FEEDHOLD))).toBeInstanceOf(TransportWriteError);
    inner.writeError = undefined;
    expect(await refusedCode(t.writeLine(enc('G0 X0\n')))).toBe('line-after-write-failure');
  });

  it('the latch lasts for the life of the transport (one instance is one connection)', async () => {
    const inner = new FakeTransport();
    const { t } = await opened(inner);
    inner.writeError = new Error('lost');
    await errorOf(t.writeLine(enc('G0 X1\n')));
    await t.close();
    expect(await refusedCode(t.open(SESSION_OPTIONS))).toBe('already-opened');
    expect(t.writeFailed).toBe(true);
  });
});

describe('open and close lifecycle', () => {
  it('refuses writes before open, during opening and after close', async () => {
    const inner = new FakeTransport();
    const t = new GuardedTransport(inner);
    expect(await refusedCode(t.writeLine(enc('G0 X0\n')))).toBe('not-open');
    const opening = t.open(SESSION_OPTIONS);
    expect(t.state).toBe('opening');
    expect(await refusedCode(t.writeLine(FEEDHOLD))).toBe('not-open');
    await opening;
    await t.close();
    expect(t.state).toBe('closed');
    expect(await refusedCode(t.writeLine(FEEDHOLD))).toBe('not-open');
    expect(inner.written()).toEqual([]);
  });

  it('opens at most once', async () => {
    const { inner, t } = await opened();
    expect(await refusedCode(t.open(SESSION_OPTIONS))).toBe('already-opened');
    expect(inner.opens()).toBe(1);
  });

  it('a failed inner open leaves the transport closed and reports the port error', async () => {
    const inner = new FakeTransport();
    inner.openError = new Error('port busy');
    const t = new GuardedTransport(inner);
    expect(await errorOf(t.open(SESSION_OPTIONS))).toBe(inner.openError);
    expect(t.state).toBe('closed');
    expect(await refusedCode(t.writeLine(FEEDHOLD))).toBe('not-open');
  });

  it('close waits for the write in progress, refuses writes still queued, then closes the port', async () => {
    const inner = new FakeTransport();
    inner.holdWrites = true;
    const { t } = await opened(inner);
    const inProgress = t.writeLine(enc('G1 X12.5\n'));
    const queued = errorOf(t.writeLine(enc('G1 X20\n')));
    await flush();
    const closing = t.close();
    await flush();
    expect(inner.calls.some((c) => c.op === 'close')).toBe(false);
    inner.releaseWrite();
    await inProgress;
    await closing;
    expect(((await queued) as TransportRefusedError).code).toBe('not-open');
    expect(inner.calls.map((c) => c.op)).toEqual(['open', 'write', 'write-done', 'close']);
  });

  it('close is idempotent and closing a never-opened transport touches nothing', async () => {
    const inner = new FakeTransport();
    const t = new GuardedTransport(inner);
    await t.close();
    await t.close();
    expect(inner.calls).toEqual([]);
    expect(await refusedCode(t.open(SESSION_OPTIONS))).toBe('already-opened');
  });

  it('close during opening waits for the open, then closes, and the transport stays closed', async () => {
    const inner = new FakeTransport();
    const t = new GuardedTransport(inner);
    const opening = t.open(SESSION_OPTIONS);
    const closing = t.close();
    await opening;
    await closing;
    expect(t.state).toBe('closed');
    expect(inner.calls.map((c) => c.op)).toEqual(['open', 'close']);
    expect(await refusedCode(t.writeLine(FEEDHOLD))).toBe('not-open');
  });

  it('close during a failing open does not close a port that never opened', async () => {
    const inner = new FakeTransport();
    inner.openError = new Error('port busy');
    const t = new GuardedTransport(inner);
    const opening = errorOf(t.open(SESSION_OPTIONS));
    await t.close();
    expect(await opening).toBe(inner.openError);
    expect(inner.calls.map((c) => c.op)).toEqual(['open']);
  });
});

describe('disconnect', () => {
  it('refuses every write after the link drops, and tells the caller', async () => {
    const inner = new FakeTransport();
    const { t } = await opened(inner);
    let told = 0;
    t.onDisconnect(() => told++);
    inner.drop();
    expect(told).toBe(1);
    expect(await refusedCode(t.writeLine(FEEDHOLD))).toBe('disconnected');
    expect(await refusedCode(t.writeLine(enc('G0 X0\n')))).toBe('disconnected');
    expect(inner.written()).toEqual([]);
  });

  it('a write queued when the link drops is refused, not sent', async () => {
    const inner = new FakeTransport();
    inner.holdWrites = true;
    const { t } = await opened(inner);
    const first = t.writeLine(enc('G0 X1\n'));
    const second = errorOf(t.writeLine(enc('G0 X2\n')));
    await flush();
    inner.drop();
    inner.releaseWrite();
    await first;
    expect(((await second) as TransportRefusedError).code).toBe('disconnected');
    expect(inner.written()).toEqual(['G0 X1\n']);
  });
});

describe('pass-through members', () => {
  it('readable and info come from the inner transport', async () => {
    const inner = new FakeTransport({ kind: 'replay' });
    const t = new GuardedTransport(inner);
    expect(t.readable).toBe(inner.readable);
    expect(t.info()).toEqual({ kind: 'replay' });
  });
});
