/**
 * The rig the xboot suites share: a flashable board on a simulated link, the
 * host end of that link as the flasher's `ByteLink` (with its frame guard in
 * front, as the machine package does), and a driver that runs a promise to
 * completion on virtual time.
 */
import {
  ByteBuffer,
  FrameGuard,
  X192A3,
  XbootClient,
  parseIntelHex,
  planFlash,
  runFlash,
  type ByteLink,
  type FlashOutcome,
  type FlashProgress,
} from '@synthetos/flasher';
import { FlashableBoard, SimEndpoint, VirtualClock, simHex, simImage, type FaultPlan, type FlashableBoardOptions } from '../src/index.ts';

/** The host end of the simulated link as a ByteLink, with the flasher's frame guard in front, as the machine package does. */
export class SimByteLink implements ByteLink {
  readonly buffer: ByteBuffer;
  readonly guard = new FrameGuard(X192A3);
  readonly frames: Uint8Array[] = [];
  closed = false;
  readonly #endpoint: SimEndpoint;
  constructor(endpoint: SimEndpoint, clock: VirtualClock) {
    this.#endpoint = endpoint;
    this.buffer = new ByteBuffer(clock);
    endpoint.onHostData((c) => this.buffer.push(c));
    endpoint.onDisconnect(() => {
      this.closed = true;
      this.buffer.end();
    });
  }
  write(frame: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error('closed'));
    const v = this.guard.check(frame);
    if (!v.ok) return Promise.reject(new Error(`guard: ${v.reason}`));
    this.frames.push(frame.slice());
    this.#endpoint.hostWrite(frame);
    return Promise.resolve();
  }
  read(n: number, timeoutMs: number): Promise<Uint8Array> {
    return this.buffer.read(n, timeoutMs);
  }
  discardInput(): Uint8Array {
    return this.buffer.discard();
  }
}

async function microtasks(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

/** Run `p` to completion, advancing virtual time from timer to timer. */
export async function drive<T>(clock: VirtualClock, p: Promise<T>, maxMs = 900_000): Promise<T> {
  let done = false;
  let value: T | undefined;
  let error: unknown;
  let failed = false;
  p.then(
    (v) => {
      done = true;
      value = v;
    },
    (e: unknown) => {
      done = true;
      failed = true;
      error = e;
    },
  );
  const end = clock.now() + maxMs;
  for (;;) {
    await microtasks();
    if (done) break;
    const next = clock.nextAt();
    if (next === undefined || next > end) throw new Error(`stalled at ${clock.now()} ms`);
    clock.advanceTo(next);
  }
  if (failed) throw error;
  return value as T;
}

/** A board, its link and a client. `faults` act on the link's bytes (the endpoint's fault plan). */
export function rig(options: FlashableBoardOptions = {}, faults?: FaultPlan) {
  const clock = new VirtualClock();
  const board = new FlashableBoard({ model: { bootMs: 50 }, linkBaud: 2_000_000, ...options });
  const endpoint = new SimEndpoint({ clock, device: board, link: { baudRate: 2_000_000, latencyMs: 0.2, coalesceMs: 2 }, ...(faults === undefined ? {} : { faults }) });
  const link = new SimByteLink(endpoint, clock);
  const client = new XbootClient(link, clock, X192A3);
  return { clock, board, endpoint, link, client };
}

export type Rig = ReturnType<typeof rig>;

/** Bytes the host wrote, as one string of printable characters (for the app's `{"boot":1}`). */
export function sendLine(endpoint: SimEndpoint, line: string): void {
  endpoint.hostWrite(new TextEncoder().encode(`${line}\n`));
}

export function plan(name: Parameters<typeof simImage>[0]) {
  const parsed = parseIntelHex(simHex(simImage(name)), X192A3);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.image;
}

/** One flash run of the named simulated image, driven to its end. */
export async function flash(r: Rig, name: Parameters<typeof simImage>[0], hooks: Partial<Parameters<typeof runFlash>[2]> = {}): Promise<{ outcome: FlashOutcome; progress: FlashProgress[] }> {
  const progress: FlashProgress[] = [];
  const image = plan(name);
  const outcome = await drive(r.clock, runFlash(r.client, planFlash(image, null), { onProgress: (p) => progress.push(p), backupsReady: () => Promise.resolve(), ...hooks }, { entryMs: 5000 }));
  return { outcome, progress };
}
