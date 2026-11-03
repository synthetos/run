import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../src/clock.ts';
import type { DeviceIo, SimDevice } from '../src/device.ts';
import { SimEndpoint } from '../src/endpoint.ts';
import type { FaultPlan } from '../src/faults.ts';
import { bytes, text } from '../src/bytes.ts';

/** A device that records what it receives and echoes on request. */
class Probe implements SimDevice {
  readonly usb = { vendorId: 0x1234, productId: 0x5678 };
  readonly baudRate = 115200;
  readonly received: { t: number; byte: number; overrun: boolean }[] = [];
  readonly events: string[] = [];
  io!: DeviceIo;
  attach(io: DeviceIo): void {
    this.io = io;
  }
  receive(byte: number, overrun: boolean): void {
    this.received.push({ t: this.io.clock.now(), byte, overrun });
  }
  injectLimitSwitch(input: number): void {
    this.events.push(`limit ${input} @${this.io.clock.now()}`);
  }
  setReportSuppression(on: boolean): void {
    this.events.push(`suppress ${on} @${this.io.clock.now()}`);
  }
  resetBoard(): void {
    this.events.push(`reset @${this.io.clock.now()}`);
  }
  setBannerDelay(extraMs: number): void {
    this.events.push(`banner +${extraMs}`);
  }
}

function link(faults?: FaultPlan, seed?: number): { clock: VirtualClock; probe: Probe; ep: SimEndpoint; got: string[] } {
  const clock = new VirtualClock();
  const probe = new Probe();
  const ep = new SimEndpoint({ clock, device: probe, ...(faults ? { faults } : {}), ...(seed !== undefined ? { seed } : {}) });
  const got: string[] = [];
  ep.onHostData((c) => got.push(text(c)));
  return { clock, probe, ep, got };
}

const BYTE_MS = 10_000 / 115200;

describe('SimEndpoint', () => {
  it('serialises host bytes at the baud rate and adds the bridge latency', () => {
    const { clock, probe, ep } = link();
    ep.hostWrite(bytes('abc'));
    clock.advance(5);
    expect(probe.received.map((r) => r.byte)).toEqual([0x61, 0x62, 0x63]);
    expect(probe.received[0]?.t).toBeCloseTo(BYTE_MS + 1, 9);
    expect((probe.received[2]?.t ?? 0) - (probe.received[0]?.t ?? 0)).toBeCloseTo(2 * BYTE_MS, 9);
  });

  it('delivers device output in chunks one latency after the first byte leaves the UART', () => {
    const { clock, probe, ep, got } = link();
    probe.io.transmit(bytes('hello\n'));
    clock.advance(1);
    expect(got).toEqual([]);
    clock.advance(1);
    expect(got.join('')).toBe('hello\n');
    expect(ep.transcript.render()).toMatch(/H< hello\\n$/);
  });

  it('applies byte faults in both directions and records them', () => {
    const { clock, probe, ep, got } = link({
      faults: [
        { kind: 'drop', direction: 'toDevice', select: { at: [1] } },
        { kind: 'corrupt', direction: 'toHost', select: { at: [0] }, xor: 0x20 },
      ],
    });
    ep.hostWrite(bytes('xyz'));
    probe.io.transmit(bytes('ok\n'));
    clock.advance(10);
    expect(text(probe.received.map((r) => r.byte))).toBe('xz');
    expect(got.join('')).toBe('Ok\n');
    const notes = ep.transcript.entries().filter((e) => e.kind === 'fault').map((e) => e.note);
    expect(notes).toEqual(['drop toDevice byte 1 (0x79)', 'corrupt toHost byte 0 0x6f -> 0x4f']);
  });

  it('marks forced ring-overrun bytes for the device', () => {
    const { clock, probe, ep } = link({ faults: [{ kind: 'ringOverrun', atByte: 1 }] });
    ep.hostWrite(bytes('ab'));
    clock.advance(5);
    expect(probe.received.map((r) => r.overrun)).toEqual([false, true]);
  });

  it('disconnects before the chosen byte: the device keeps the earlier bytes, later writes throw', () => {
    const { clock, probe, ep } = link({ faults: [{ kind: 'disconnect', direction: 'toDevice', atByte: 2 }] });
    const reasons: string[] = [];
    ep.onDisconnect((r) => reasons.push(r));
    ep.hostWrite(bytes('abcd'));
    clock.advance(5);
    expect(text(probe.received.map((r) => r.byte))).toBe('ab');
    expect(ep.connected).toBe(false);
    expect(reasons).toEqual(['fault plan: disconnect']);
    expect(() => ep.hostWrite(bytes('x'))).toThrow(/disconnected/);
    probe.io.transmit(bytes('lost'));
    clock.advance(5);
    expect(ep.transcript.bytesOf('host-read')).toHaveLength(0);
    ep.disconnect('again'); // idempotent
    expect(reasons).toHaveLength(1);
  });

  it('a toHost disconnect delivers what came before it and nothing after', () => {
    const { clock, probe, ep, got } = link({ faults: [{ kind: 'disconnect', direction: 'toHost', atByte: 3 }] });
    probe.io.transmit(bytes('abcdef'));
    clock.advance(5);
    expect(got.join('')).toBe('abc');
    expect(ep.connected).toBe(false);
  });

  it('adds latency spikes without reordering bytes', () => {
    const { clock, probe, ep } = link({ faults: [{ kind: 'latency', direction: 'toDevice', fromMs: 0, toMs: 1, extraMs: 20 }] });
    ep.hostWrite(bytes('a'));
    clock.advance(2);
    ep.hostWrite(bytes('b'));
    clock.advance(30);
    expect(probe.received.map((r) => r.byte)).toEqual([0x61, 0x62]);
    expect(probe.received[0]?.t).toBeGreaterThan(20);
    expect(probe.received[1]?.t).toBeGreaterThanOrEqual(probe.received[0]?.t ?? 0);
  });

  it('schedules device faults and XOFF bursts at their times', () => {
    const { clock, probe, got } = link({
      faults: [
        { kind: 'alarm', atMs: 5, cause: 'limitSwitch' },
        { kind: 'suppressReports', fromMs: 2, toMs: 4 },
        { kind: 'boardReset', atMs: 9 },
        { kind: 'bannerDelay', extraMs: 300 },
        { kind: 'xoffBurst', atMs: 1, holdMs: 3, repeat: 2, everyMs: 10 },
      ],
    });
    clock.advance(30);
    expect(probe.events).toEqual(['banner +300', 'suppress true @2', 'suppress false @4', 'limit 1 @5', 'reset @9']);
    expect(got.join('')).toBe('\x13\x11\x13\x11');
  });

  it('garbles every byte when the host opens at the wrong baud rate', () => {
    const { clock, probe, ep } = link();
    ep.setHostBaud(9600);
    ep.hostWrite(bytes('{'));
    clock.advance(5);
    expect(probe.received[0]?.byte).not.toBe(0x7b);
  });

  it('rejects impossible link settings', () => {
    const clock = new VirtualClock();
    expect(() => new SimEndpoint({ clock, device: new Probe(), link: { baudRate: 0 } })).toThrow(RangeError);
    expect(() => new SimEndpoint({ clock, device: new Probe(), link: { latencyMs: -1 } })).toThrow(RangeError);
  });
});

/**
 * A clock whose timers fire by whole milliseconds, as Node and Chromium do with a fractional `setTimeout` delay
 * (the fake-serial build runs the endpoint on the host's real timers): the delay is truncated, the order of two
 * timers whose due times are under a millisecond apart is then the order of their truncated due times.
 */
class TruncatingClock extends VirtualClock {
  override setTimeout(callback: () => void, delayMs: number): number {
    return super.setTimeout(callback, Math.trunc(delayMs));
  }
}

describe('SimEndpoint: host bytes reach the device in wire order on a clock with whole-millisecond timers (independent review 2026-11-03, R9)', () => {
  it('two writes under a millisecond apart arrive as written, not shuffled into each other', () => {
    const clock = new TruncatingClock();
    const probe = new Probe();
    const ep = new SimEndpoint({ clock, device: probe });
    // One burst of job lines, as the streamer writes them when the board has free line slots.
    const a = 'N13 G1 X0 Y4.5 F800\n';
    const b = 'N14 G1 X5 Y5.0 F800\n';
    ep.hostWrite(bytes(a));
    clock.advance(0.9);
    ep.hostWrite(bytes(b));
    clock.advance(20);
    expect(text(probe.received.map((r) => r.byte))).toBe(a + b);
    const times = probe.received.map((r) => r.t);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });

  it('a toDevice disconnect fault still cuts the cable at its byte, and a disconnect drops the bytes still on the wire', () => {
    const clock = new TruncatingClock();
    const probe = new Probe();
    const ep = new SimEndpoint({ clock, device: probe, faults: { faults: [{ kind: 'disconnect', direction: 'toDevice', atByte: 3 }] } });
    ep.hostWrite(bytes('abcdef'));
    clock.advance(10);
    expect(text(probe.received.map((r) => r.byte))).toBe('abc');
    expect(ep.connected).toBe(false);
    const again = link();
    again.ep.hostWrite(bytes('xyz'));
    again.ep.disconnect('pulled');
    again.clock.advance(10);
    expect(again.probe.received).toEqual([]);
  });
});
