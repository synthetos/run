/**
 * P0 review fix pass (P0-12 LOW): GuardedTransport validates and sends its
 * own copy of a line. The copy must be made by the intrinsic Uint8Array
 * machinery, never by a method the caller's object can supply: Node's
 * Buffer.slice aliases memory, and any Uint8Array subclass can override
 * slice. A value that only pretends to be a Uint8Array is refused.
 *
 * The first case is the reviewer's reproduction: a queued Buffer is mutated
 * from `G1 X1\n` to `M3\nM8\n` after the guard validated it, and before the
 * inner write runs.
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { GuardedTransport, TransportRefusedError } from '../src/guardedTransport.ts';
import { FakeTransport, SESSION_OPTIONS, enc } from './fakeTransport.ts';

const written = (inner: FakeTransport): string[] =>
  inner.calls.flatMap((c) => (c.op === 'write' ? [c.bytes] : []));

async function openGuard(): Promise<{ inner: FakeTransport; guard: GuardedTransport }> {
  const inner = new FakeTransport();
  const guard = new GuardedTransport(inner);
  await guard.open(SESSION_OPTIONS);
  return { inner, guard };
}

describe('GuardedTransport defensive copy', () => {
  it('a queued Buffer mutated after writeLine still sends the validated bytes (reviewer reproduction)', async () => {
    const { inner, guard } = await openGuard();
    // Hold the first write so the second line waits in the queue.
    inner.holdWrites = true;
    const first = guard.writeLine(enc('G0 X0\n'));
    const buf = Buffer.from('G1 X1\n');
    const pending = guard.writeLine(buf);
    buf.set(Buffer.from('M3\nM8\n'));
    while (inner.inFlight === 0) await Promise.resolve();
    inner.holdWrites = false;
    inner.releaseWrite();
    await first;
    await pending;
    expect(written(inner)).toEqual(['G0 X0\n', 'G1 X1\n']);
  });

  it('an unqueued Buffer mutated straight after writeLine still sends the validated bytes', async () => {
    const { inner, guard } = await openGuard();
    const buf = Buffer.from('G1 X1\n');
    const pending = guard.writeLine(buf);
    buf.set(Buffer.from('M3\nM8\n'));
    await pending;
    expect(written(inner)).toEqual(['G1 X1\n']);
  });

  it('a subclass whose slice returns an alias (or anything else) is copied without calling slice', async () => {
    const { inner, guard } = await openGuard();
    let sliceCalls = 0;
    class Aliasing extends Uint8Array {}
    Object.defineProperty(Aliasing.prototype, 'slice', {
      value(this: Uint8Array): Uint8Array {
        sliceCalls++;
        return this;
      },
    });
    const line = new Aliasing(enc('G1 X1\n'));
    const pending = guard.writeLine(line);
    line.set(enc('M3\nM8\n'));
    await pending;
    expect(written(inner)).toEqual(['G1 X1\n']);
    expect(sliceCalls).toBe(0);
  });

  it('a subclass whose slice hands back a different line cannot swap what is validated for what is sent', async () => {
    const { inner, guard } = await openGuard();
    class Swapping extends Uint8Array {}
    Object.defineProperty(Swapping.prototype, 'slice', { value: (): Uint8Array => enc('M3\nM8\n') });
    await guard.writeLine(new Swapping(enc('G1 X1\n')));
    expect(written(inner)).toEqual(['G1 X1\n']);
  });

  it('a subclass that lies about its length or iteration is copied from its real bytes', async () => {
    const { inner, guard } = await openGuard();
    const lying = enc('G1 X1\n');
    Object.defineProperty(lying, 'length', { get: () => 3 });
    Object.defineProperty(lying, Symbol.iterator, { value: () => enc('M3\nM8\n')[Symbol.iterator]() });
    await guard.writeLine(lying);
    expect(written(inner)).toEqual(['G1 X1\n']);
  });

  it('refuses an object that only has Uint8Array on its prototype chain, without reading it', async () => {
    const { inner, guard } = await openGuard();
    let touched = false;
    const fake = Object.create(Uint8Array.prototype, {
      length: {
        get() {
          touched = true;
          return 6;
        },
      },
      [Symbol.iterator]: {
        value: function* () {
          touched = true;
          yield* enc('M3\nM8\n');
        },
      },
    }) as Uint8Array;
    expect(fake instanceof Uint8Array).toBe(true);
    await expect(guard.writeLine(fake)).rejects.toBeInstanceOf(TransportRefusedError);
    expect(touched).toBe(false);
    expect(written(inner)).toEqual([]);
  });

  it('refuses a Proxy around a real Uint8Array', async () => {
    const { inner, guard } = await openGuard();
    const proxy = new Proxy(enc('G1 X1\n'), {});
    await expect(guard.writeLine(proxy)).rejects.toBeInstanceOf(TransportRefusedError);
    expect(written(inner)).toEqual([]);
  });

  it('refuses other typed arrays, which are not Uint8Array bytes', async () => {
    const { guard } = await openGuard();
    await expect(guard.writeLine(new Uint16Array([0x4731, 0x0a]) as unknown as Uint8Array)).rejects.toBeInstanceOf(TransportRefusedError);
    await expect(guard.writeLine(new Uint8ClampedArray(enc('G0\n')) as unknown as Uint8Array)).rejects.toBeInstanceOf(TransportRefusedError);
  });

  it('copies only the viewed bytes of a Uint8Array over a larger buffer', async () => {
    const { inner, guard } = await openGuard();
    const backing = enc('M3\nG1 X1\nM8\n');
    const view = new Uint8Array(backing.buffer, 3, 6);
    const pending = guard.writeLine(view);
    backing.fill(0x4d);
    await pending;
    expect(written(inner)).toEqual(['G1 X1\n']);
  });

  it('refuses a Uint8Array over a detached buffer', async () => {
    const { inner, guard } = await openGuard();
    const line = enc('G1 X1\n');
    structuredClone(line.buffer, { transfer: [line.buffer] });
    await expect(guard.writeLine(line)).rejects.toBeInstanceOf(TransportRefusedError);
    expect(written(inner)).toEqual([]);
  });
});

describe('the copy the inner Transport receives', () => {
  it('is a plain Uint8Array, not the caller object or its species, even when the subclass sets one', async () => {
    const received: Uint8Array[] = [];
    const inner = new FakeTransport();
    const original = inner.writeLine.bind(inner);
    inner.writeLine = async (b: Uint8Array) => {
      received.push(b);
      await original(b);
    };
    const guard = new GuardedTransport(inner);
    await guard.open(SESSION_OPTIONS);
    class WithSpecies extends Uint8Array {}
    Object.defineProperty(WithSpecies, Symbol.species, { get: () => class extends Uint8Array {} });
    const buf = Buffer.from('G1 X1\n');
    const sub = new WithSpecies(enc('G0 X0\n'));
    await guard.writeLine(buf);
    await guard.writeLine(sub);
    expect(received).toHaveLength(2);
    for (const r of received) expect(Object.getPrototypeOf(r)).toBe(Uint8Array.prototype);
    expect(received[0]).not.toBe(buf);
    expect(received[1]).not.toBe(sub);
    expect(written(inner)).toEqual(['G1 X1\n', 'G0 X0\n']);
  });
});
