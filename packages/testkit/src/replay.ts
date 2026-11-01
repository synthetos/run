/**
 * `ReplayTransport` (ROADMAP P0-11; OLD-TP §9.1 item 4 "simulator
 * conformance: one suite runs against SimTransport and ReplayTransport").
 *
 * A recording is the exact exchange from a bench run (or from a simulator
 * transcript): what the host must write, in order, and what the controller
 * sent back and when. Replaying it to host code checks that the host still
 * writes exactly the recorded bytes in the recorded order, and feeds it the
 * recorded replies. Any write that differs, comes early, or comes after the
 * end is a divergence: the transport fails loudly and never guesses.
 *
 * The transport shape follows OLD-TP §4.2 (`writeLine`, an async-iterable
 * `readable`, no `abort()`). The canonical `Transport` interface arrives with
 * P0-12 in `machine`; `TransportLike` is the structural shape it is checked
 * against there.
 */
import { escapeBytes } from './bytes.ts';
import type { Clock } from './clock.ts';
import type { Transcript } from './transcript.ts';

export interface TransportLike {
  open(options: { readonly baudRate: number; readonly flowControl: 'none' | 'hardware'; readonly bufferSize: number }): Promise<void>;
  /** Exactly one complete line, or one realtime byte group. */
  writeLine(line: Uint8Array): Promise<void>;
  readonly readable: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
  onDisconnect(callback: () => void): void;
  info(): { readonly kind: 'serial' | 'sim' | 'replay'; readonly usbVendorId?: number; readonly usbProductId?: number };
}

export type RecordingStep =
  /** The host must write exactly these bytes next, in one `writeLine`. */
  | { readonly expect: Uint8Array }
  /** The controller sends these bytes, `afterMs` after the previous step completed. */
  | { readonly emit: Uint8Array; readonly afterMs?: number }
  /** The link drops. */
  | { readonly disconnect: true; readonly afterMs?: number };

export interface Recording {
  readonly name: string;
  readonly steps: readonly RecordingStep[];
}

export interface ReplayDivergence {
  readonly step: number;
  readonly reason: 'unexpected-bytes' | 'write-before-expected' | 'write-past-end' | 'write-after-disconnect' | 'write-while-closed';
  readonly expected?: string;
  readonly actual: string;
}

export class ReplayDivergenceError extends Error {
  readonly divergence: ReplayDivergence;
  constructor(d: ReplayDivergence) {
    super(`replay diverged at step ${d.step} (${d.reason}): expected ${d.expected ?? '(nothing)'}, host wrote ${d.actual}`);
    this.name = 'ReplayDivergenceError';
    this.divergence = d;
  }
}

/**
 * Turn a simulator transcript into a recording: every host write becomes an
 * `expect`, every host read an `emit` at the same relative time.
 */
export function recordingFromTranscript(name: string, transcript: Transcript): Recording {
  const steps: RecordingStep[] = [];
  let last = 0;
  for (const e of transcript.entries()) {
    if (e.kind === 'host-write') {
      steps.push({ expect: e.data.slice() });
      last = e.t;
    } else if (e.kind === 'host-read') {
      steps.push({ emit: e.data.slice(), afterMs: Math.max(0, e.t - last) });
      last = e.t;
    } else if (e.kind === 'link') {
      steps.push({ disconnect: true, afterMs: Math.max(0, e.t - last) });
      last = e.t;
    }
  }
  return Object.freeze({ name, steps: Object.freeze(steps) });
}

export class ReplayTransport implements TransportLike {
  readonly recording: Recording;
  readonly #clock: Clock;
  #index = 0;
  #open = false;
  #disconnected = false;
  #divergence: ReplayDivergence | null = null;
  #timer: number | undefined;
  readonly #queue: Uint8Array[] = [];
  #waiters: { resolve: (r: IteratorResult<Uint8Array>) => void; reject: (e: unknown) => void }[] = [];
  readonly #disconnectListeners: (() => void)[] = [];

  constructor(recording: Recording, options: { readonly clock: Clock }) {
    this.recording = recording;
    this.#clock = options.clock;
  }

  /** The first divergence, or null while the host matches the recording. */
  get divergence(): ReplayDivergence | null {
    return this.#divergence;
  }

  /** True once every step has been consumed. */
  get finished(): boolean {
    return this.#index >= this.recording.steps.length;
  }

  async open(): Promise<void> {
    if (this.#open) throw new Error('already open');
    this.#open = true;
    this.#advance();
  }

  async writeLine(line: Uint8Array): Promise<void> {
    if (this.#divergence !== null) throw new ReplayDivergenceError(this.#divergence);
    const actual = escapeBytes(line);
    // A write before open() or after close() never reaches a real port: it is a host bug, not a match.
    if (!this.#open) this.#diverge({ step: this.#index, reason: 'write-while-closed', actual });
    if (this.#disconnected) this.#diverge({ step: this.#index, reason: 'write-after-disconnect', actual });
    const step = this.recording.steps[this.#index];
    if (step === undefined) this.#diverge({ step: this.#index, reason: 'write-past-end', actual });
    else if (!('expect' in step)) this.#diverge({ step: this.#index, reason: 'write-before-expected', actual });
    else if (!equal(step.expect, line)) this.#diverge({ step: this.#index, reason: 'unexpected-bytes', expected: escapeBytes(step.expect), actual });
    else {
      this.#index++;
      this.#advance();
    }
  }

  get readable(): AsyncIterable<Uint8Array> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => this.#next(),
        return: async () => ({ done: true, value: undefined }),
      }),
    };
  }

  async close(): Promise<void> {
    this.#open = false;
    if (this.#timer !== undefined) this.#clock.clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#endReaders();
  }

  onDisconnect(callback: () => void): void {
    this.#disconnectListeners.push(callback);
  }

  info(): { readonly kind: 'replay' } {
    return { kind: 'replay' };
  }

  #diverge(d: ReplayDivergence): never {
    this.#divergence = d;
    const error = new ReplayDivergenceError(d);
    for (const w of this.#waiters) w.reject(error);
    this.#waiters = [];
    throw error;
  }

  /** Run emit and disconnect steps on the clock until the next expect (or the end). */
  #advance(): void {
    if (!this.#open || this.#timer !== undefined) return;
    const step = this.recording.steps[this.#index];
    if (step === undefined) return;
    if ('expect' in step) return;
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = undefined;
      this.#index++;
      if ('emit' in step) this.#push(step.emit.slice());
      else {
        this.#disconnected = true;
        for (const l of this.#disconnectListeners) l();
        this.#endReaders();
        return;
      }
      this.#advance();
    }, step.afterMs ?? 0);
  }

  #push(chunk: Uint8Array): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) waiter.resolve({ done: false, value: chunk });
    else this.#queue.push(chunk);
  }

  #next(): Promise<IteratorResult<Uint8Array>> {
    if (this.#divergence !== null) return Promise.reject(new ReplayDivergenceError(this.#divergence));
    const chunk = this.#queue.shift();
    if (chunk !== undefined) return Promise.resolve({ done: false, value: chunk });
    if (this.#disconnected || !this.#open) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
  }

  #endReaders(): void {
    for (const w of this.#waiters) w.resolve({ done: true, value: undefined });
    this.#waiters = [];
  }
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
