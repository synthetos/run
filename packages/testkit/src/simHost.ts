/**
 * A minimal line-oriented host for tests (ROADMAP P0-11).
 *
 * It writes bytes to a `SimEndpoint` and splits what comes back into lines,
 * keeping XON/XOFF bytes apart. It is deliberately dumb: it has no flow
 * control, no window and no safety logic, so tests of the models see the raw
 * firmware behaviour, and tests of the real host code (machine, P0-12 on)
 * use `MockSerialPort` or `ReplayTransport` instead.
 */
import { bytes } from './bytes.ts';
import { VirtualClock } from './clock.ts';
import type { SimDevice } from './device.ts';
import { SimEndpoint, type LinkOptions } from './endpoint.ts';
import type { FaultPlan } from './faults.ts';

export class SimHost {
  readonly endpoint: SimEndpoint;
  readonly #lines: { t: number; text: string }[] = [];
  readonly flow: { t: number; signal: 'xon' | 'xoff' }[] = [];
  #partial = '';
  #taken = 0;

  constructor(endpoint: SimEndpoint) {
    this.endpoint = endpoint;
    endpoint.onHostData((chunk) => this.#onData(chunk));
  }

  /** Write raw text (latin-1) to the link. */
  send(text: string): void {
    this.endpoint.hostWrite(bytes(text));
  }

  /** Write one line terminated by LF. */
  sendLine(line: string): void {
    this.send(`${line}\n`);
  }

  /** Every complete line received so far. */
  lines(): string[] {
    return this.#lines.map((l) => l.text);
  }

  /** Lines with their arrival times. */
  timedLines(): readonly { t: number; text: string }[] {
    return this.#lines;
  }

  /** Lines received since the previous `take()`. */
  take(): string[] {
    const out = this.#lines.slice(this.#taken).map((l) => l.text);
    this.#taken = this.#lines.length;
    return out;
  }

  /** Received lines parsed as JSON (lines that are not JSON are skipped). */
  json(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const l of this.lines()) {
      try {
        const v: unknown = JSON.parse(l);
        if (typeof v === 'object' && v !== null) out.push(v as Record<string, unknown>);
      } catch {
        // not JSON
      }
    }
    return out;
  }

  #onData(chunk: Uint8Array): void {
    const clock = this.endpoint.clock;
    for (const b of chunk) {
      if (b === 0x11 || b === 0x13) {
        this.flow.push({ t: clock.now(), signal: b === 0x11 ? 'xon' : 'xoff' });
        continue;
      }
      if (b === 0x0a || b === 0x0d) {
        if (this.#partial.length > 0) this.#lines.push({ t: clock.now(), text: this.#partial });
        this.#partial = '';
        continue;
      }
      this.#partial += String.fromCharCode(b);
    }
  }
}

export interface Sim<D extends SimDevice> {
  readonly clock: VirtualClock;
  readonly endpoint: SimEndpoint;
  readonly device: D;
  readonly host: SimHost;
}

/** Wire a device, a link and a host on a fresh virtual clock. */
export function createSim<D extends SimDevice>(
  device: D,
  options: { readonly faults?: FaultPlan; readonly seed?: number; readonly link?: LinkOptions; readonly clock?: VirtualClock } = {},
): Sim<D> {
  const clock = options.clock ?? new VirtualClock();
  const endpoint = new SimEndpoint({
    clock,
    device,
    ...(options.faults !== undefined ? { faults: options.faults } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.link !== undefined ? { link: options.link } : {}),
  });
  return { clock, endpoint, device, host: new SimHost(endpoint) };
}
