/**
 * `SimEndpoint`: the simulated serial link between a host and a device model
 * (ROADMAP P0-11, RUN_PLAN §8.1).
 *
 * - Bytes are serialised at the link's baud rate (10 bits per byte, 8N1), so
 *   a burst from the host reaches the device byte by byte, as through a real
 *   UART. That is what makes receive-ring fill, XOFF and overrun behave.
 * - Device output reaches the host in chunks, like a USB serial bridge: a
 *   chunk is flushed `latencyMs` after its first byte left the UART (an FTDI
 *   latency timer of 16 ms is configurable; the default is 1 ms).
 * - A fault plan acts on bytes in both directions and on the device.
 * - Everything the host wrote and read is recorded in a `Transcript`.
 *
 * The endpoint never opens a real port; it is the in-memory stand-in that
 * `MockSerialPort` and test hosts talk to.
 */
import './marker.ts';
import type { Clock } from './clock.ts';
import type { SimDevice } from './device.ts';
import { ByteFaults, NO_FAULTS, validateFaultPlan, type FaultPlan } from './faults.ts';
import { SeededRng } from './rng.ts';
import { Transcript } from './transcript.ts';

export interface LinkOptions {
  /** Line rate of the UART on both ends. Default: the device's own rate. */
  readonly baudRate?: number;
  /** USB bridge latency added to every byte, both directions. Default 1 ms. */
  readonly latencyMs?: number;
}

export interface SimEndpointOptions {
  readonly clock: Clock;
  readonly device: SimDevice;
  readonly faults?: FaultPlan;
  /** Seed for probabilistic faults. Default 1. */
  readonly seed?: number;
  readonly link?: LinkOptions;
}

type DataListener = (chunk: Uint8Array) => void;
type DisconnectListener = (reason: string) => void;

const XOFF = 0x13;
const XON = 0x11;

export class SimEndpoint {
  readonly clock: Clock;
  readonly device: SimDevice;
  readonly transcript = new Transcript();
  readonly plan: FaultPlan;
  readonly #origin: number;
  readonly #byteMs: number;
  readonly #latencyMs: number;
  readonly #toDevice: ByteFaults;
  readonly #toHost: ByteFaults;
  #connected = true;
  #hostBaud: number;
  #toDeviceWireFree = 0;
  #toDeviceLastArrival = 0;
  /** Bytes on their way to the device, in wire order, each with its arrival time (delivered by one timer at a time). */
  #toDevicePending: { byte: number; arrival: number; overrun: boolean; disconnect: boolean }[] = [];
  #toDeviceTimer: number | undefined;
  #toHostWireFree = 0;
  #toHostPending: { byte: number; readyAt: number }[] = [];
  #toHostFlushTimer: number | undefined;
  readonly #dataListeners = new Set<DataListener>();
  readonly #disconnectListeners = new Set<DisconnectListener>();

  constructor(options: SimEndpointOptions) {
    this.clock = options.clock;
    this.device = options.device;
    this.plan = validateFaultPlan(options.faults ?? NO_FAULTS);
    const rng = new SeededRng(options.seed ?? 1);
    this.#toDevice = new ByteFaults(this.plan, 'toDevice', rng);
    this.#toHost = new ByteFaults(this.plan, 'toHost', rng);
    const baud = options.link?.baudRate ?? options.device.baudRate;
    if (!(Number.isFinite(baud) && baud > 0)) throw new RangeError(`baud rate must be > 0, got ${baud}`);
    this.#byteMs = 10_000 / baud;
    const latency = options.link?.latencyMs ?? 1;
    if (!(Number.isFinite(latency) && latency >= 0)) throw new RangeError(`latency must be >= 0, got ${latency}`);
    this.#latencyMs = latency;
    this.#hostBaud = options.device.baudRate;
    this.#origin = this.clock.now();
    this.device.attach({
      clock: this.clock,
      transmit: (data) => this.#deviceTransmit(data),
      event: (note) => this.transcript.record({ t: this.#rel(), kind: 'device', note }),
    });
    this.#scheduleDeviceFaults();
  }

  get connected(): boolean {
    return this.#connected;
  }

  /** The rate the host opened its side at. A mismatch garbles every byte both ways. */
  setHostBaud(baud: number): void {
    this.#hostBaud = baud;
  }

  /** The host writes bytes. Throws when the link is down. */
  hostWrite(data: Uint8Array): void {
    if (!this.#connected) throw new Error('link is disconnected');
    const now = this.clock.now();
    this.transcript.record({ t: this.#rel(), kind: 'host-write', data: data.slice() });
    let wire = Math.max(now, this.#toDeviceWireFree);
    for (const raw of data) {
      wire += this.#byteMs;
      const fate = this.#toDevice.next(this.#garble(raw));
      for (const note of fate.notes) this.transcript.record({ t: this.#rel(), kind: 'fault', note });
      const arrival = Math.max(wire + this.#latencyMs + this.#toDevice.latencyAt(now - this.#origin), this.#toDeviceLastArrival);
      this.#toDeviceLastArrival = arrival;
      if (fate.disconnect) {
        // The cable goes when this byte would have arrived: everything before it got through.
        this.#toDevicePending.push({ byte: raw, arrival, overrun: false, disconnect: true });
        break;
      }
      for (const b of fate.deliver) this.#toDevicePending.push({ byte: b, arrival, overrun: fate.overrun, disconnect: false });
    }
    this.#toDeviceWireFree = wire;
    // One timer for the oldest byte, then the next: never a timer per byte. A host clock that truncates a timer's
    // delay to whole milliseconds (Node and Chromium both do; VirtualClock does not) would otherwise fire a byte of
    // a later write before a byte of an earlier one whose arrival is under 1 ms ahead, and the device would read
    // the two lines shuffled together (seen as refused job lines in the fake-serial suite under load,
    // independent review 2026-11-03, R9).
    if (this.#toDeviceTimer === undefined) this.#armToDevice();
  }

  /**
   * Arms the timer for the oldest byte on its way to the device. `firedEarly`: the timer that just ran found
   * nothing due yet, because the clock rounds its delays down (whole milliseconds on the host's timers): wait at
   * least one, so that it cannot spin.
   */
  #armToDevice(firedEarly = false): void {
    const first = this.#toDevicePending[0];
    if (first === undefined) return;
    const wait = Math.max(0, first.arrival - this.clock.now());
    this.#toDeviceTimer = this.clock.setTimeout(() => this.#flushToDevice(), firedEarly && wait < 1 ? 1 : wait);
  }

  /** Delivers every byte whose arrival time has come, in wire order, then waits for the next one. */
  #flushToDevice(): void {
    this.#toDeviceTimer = undefined;
    const now = this.clock.now();
    let delivered = 0;
    while (this.#toDevicePending.length > 0 && (this.#toDevicePending[0] as { arrival: number }).arrival <= now) {
      const next = this.#toDevicePending.shift() as { byte: number; overrun: boolean; disconnect: boolean };
      delivered++;
      if (next.disconnect) {
        this.#toDevicePending = [];
        this.disconnect('fault plan: disconnect');
        return;
      }
      if (this.#connected) this.device.receive(next.byte, next.overrun);
    }
    if (this.#toDevicePending.length > 0) this.#armToDevice(delivered === 0);
  }

  /** Subscribe to bytes delivered to the host. Returns an unsubscribe function. */
  onHostData(listener: DataListener): () => void {
    this.#dataListeners.add(listener);
    return () => this.#dataListeners.delete(listener);
  }

  onDisconnect(listener: DisconnectListener): () => void {
    this.#disconnectListeners.add(listener);
    return () => this.#disconnectListeners.delete(listener);
  }

  /** Unplug the cable. The device keeps running (TinyG logic is powered from Vmot, PN §3.1). */
  disconnect(reason = 'unplugged'): void {
    if (!this.#connected) return;
    this.#connected = false;
    this.#toHostPending = [];
    if (this.#toHostFlushTimer !== undefined) this.clock.clearTimeout(this.#toHostFlushTimer);
    this.#toHostFlushTimer = undefined;
    this.#toDevicePending = [];
    if (this.#toDeviceTimer !== undefined) this.clock.clearTimeout(this.#toDeviceTimer);
    this.#toDeviceTimer = undefined;
    this.transcript.record({ t: this.#rel(), kind: 'link', note: `disconnected: ${reason}` });
    for (const l of [...this.#disconnectListeners]) l(reason);
  }

  #rel(): number {
    return this.clock.now() - this.#origin;
  }

  #schedule(delay: number, fn: () => void): void {
    this.clock.setTimeout(fn, Math.max(0, delay));
  }

  /** Deterministic stand-in for framing garbage when the two ends disagree on baud rate. */
  #garble(b: number): number {
    return this.#hostBaud === this.device.baudRate ? b : (b ^ 0xa5) & 0xff;
  }

  #deviceTransmit(data: Uint8Array): void {
    if (!this.#connected) return;
    const now = this.clock.now();
    let wire = Math.max(now, this.#toHostWireFree);
    for (const b of data) {
      wire += this.#byteMs;
      this.#queueToHost(this.#garble(b), wire);
    }
    this.#toHostWireFree = wire;
  }

  #queueToHost(byte: number, leftUartAt: number): void {
    const readyAt = leftUartAt + this.#toHost.latencyAt(leftUartAt - this.#origin);
    this.#toHostPending.push({ byte, readyAt });
    if (this.#toHostFlushTimer === undefined) this.#armFlush();
  }

  /** As `#armToDevice`: one timer for the oldest byte on its way to the host; at least a millisecond after an early fire. */
  #armFlush(firedEarly = false): void {
    const first = this.#toHostPending[0];
    if (first === undefined) return;
    const at = first.readyAt + this.#latencyMs;
    const wait = Math.max(0, at - this.clock.now());
    this.#toHostFlushTimer = this.clock.setTimeout(() => this.#flushToHost(), firedEarly && wait < 1 ? 1 : wait);
  }

  #flushToHost(): void {
    this.#toHostFlushTimer = undefined;
    if (!this.#connected) return;
    const now = this.clock.now();
    const out: number[] = [];
    while (this.#toHostPending.length > 0 && (this.#toHostPending[0] as { readyAt: number }).readyAt <= now) {
      const { byte } = this.#toHostPending.shift() as { byte: number };
      const fate = this.#toHost.next(byte);
      for (const note of fate.notes) this.transcript.record({ t: this.#rel(), kind: 'fault', note });
      if (fate.disconnect) {
        this.#deliver(out);
        this.disconnect('fault plan: disconnect');
        return;
      }
      out.push(...fate.deliver);
    }
    this.#deliver(out);
    if (this.#toHostPending.length > 0) this.#armFlush(out.length === 0);
  }

  #deliver(out: number[]): void {
    if (out.length === 0) return;
    const chunk = Uint8Array.from(out);
    this.transcript.record({ t: this.#rel(), kind: 'host-read', data: chunk.slice() });
    for (const l of [...this.#dataListeners]) l(chunk.slice());
  }

  #scheduleDeviceFaults(): void {
    for (const f of this.plan.faults) {
      switch (f.kind) {
        case 'alarm':
          this.#schedule(f.atMs, () => {
            this.transcript.record({ t: this.#rel(), kind: 'fault', note: 'limit switch closes' });
            this.device.injectLimitSwitch(1);
          });
          break;
        case 'suppressReports':
          this.#schedule(f.fromMs, () => {
            this.transcript.record({ t: this.#rel(), kind: 'fault', note: 'reports suppressed' });
            this.device.setReportSuppression(true);
          });
          this.#schedule(f.toMs, () => {
            this.transcript.record({ t: this.#rel(), kind: 'fault', note: 'reports restored' });
            this.device.setReportSuppression(false);
          });
          break;
        case 'boardReset':
          this.#schedule(f.atMs, () => {
            this.transcript.record({ t: this.#rel(), kind: 'fault', note: 'board reset' });
            this.device.resetBoard();
          });
          break;
        case 'bannerDelay':
          this.device.setBannerDelay(f.extraMs);
          break;
        case 'xoffBurst': {
          const repeat = f.repeat ?? 1;
          for (let k = 0; k < repeat; k++) {
            const at = f.atMs + k * (f.everyMs ?? 0);
            this.#schedule(at, () => {
              this.transcript.record({ t: this.#rel(), kind: 'fault', note: 'spurious XOFF' });
              this.#deviceTransmit(Uint8Array.of(XOFF));
            });
            this.#schedule(at + f.holdMs, () => {
              this.transcript.record({ t: this.#rel(), kind: 'fault', note: 'spurious XON' });
              this.#deviceTransmit(Uint8Array.of(XON));
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }
}
