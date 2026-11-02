/**
 * The wire EventLog (ROADMAP P1-08): every byte the session wrote to the
 * port and every chunk the port delivered, in order, with the time it
 * happened. One log per link (one connect), starting when the port opened.
 *
 * It is the bench transcript: `toJsonl()` writes it as one `{t, dir, hex}`
 * object per line, the format the test kit's `recordingFromJsonl` reads, so
 * a bench transcript replays through `ReplayTransport` byte for byte. `t`
 * is milliseconds since the port opened; `dir` is from the host's view
 * (`tx` written, `rx` received).
 *
 * The log is bounded. A transcript with its start cut off would not replay
 * (the replay would start mid-exchange), so once the bound is passed the log
 * stops recording and `toJsonl()` refuses with `EventLogTruncatedError`
 * instead of exporting a partial transcript.
 */

export type WireDirection = 'tx' | 'rx';

export interface WireEvent {
  /** Milliseconds since the port opened. */
  readonly t: number;
  readonly dir: WireDirection;
  readonly bytes: Uint8Array;
}

/** Default bound: 8 MiB of payload, far more than a Phase 1 read-only session produces. */
export const EVENT_LOG_MAX_BYTES = 8 * 1024 * 1024;

export class EventLogTruncatedError extends Error {
  constructor(maxBytes: number) {
    super(`the transcript passed ${maxBytes} bytes and stopped recording; a partial transcript is not exported because it would not replay`);
    this.name = 'EventLogTruncatedError';
  }
}

export class EventLog {
  readonly #origin: number;
  readonly #maxBytes: number;
  readonly #events: WireEvent[] = [];
  #bytes = 0;
  #truncated = false;

  /** `origin` is the clock reading when the port opened. */
  constructor(origin: number, options: { readonly maxBytes?: number } = {}) {
    this.#origin = origin;
    this.#maxBytes = options.maxBytes ?? EVENT_LOG_MAX_BYTES;
  }

  /** True once the bound was passed: nothing more is recorded and the log cannot be exported. */
  get truncated(): boolean {
    return this.#truncated;
  }

  /** Bytes the host wrote (one `writeLine`), at clock reading `at`. */
  tx(at: number, bytes: Uint8Array): void {
    this.#record(at, 'tx', bytes);
  }

  /** One chunk the port delivered, at clock reading `at`. */
  rx(at: number, bytes: Uint8Array): void {
    this.#record(at, 'rx', bytes);
  }

  /** A copy of the events, oldest first. */
  events(): readonly WireEvent[] {
    return this.#events.map((e) => Object.freeze({ t: e.t, dir: e.dir, bytes: e.bytes.slice() }));
  }

  /** The transcript as JSONL (`{t, dir, hex}` per line, newline-terminated). Throws when truncated. */
  toJsonl(): string {
    if (this.#truncated) throw new EventLogTruncatedError(this.#maxBytes);
    return wireEventsToJsonl(this.#events);
  }

  #record(at: number, dir: WireDirection, bytes: Uint8Array): void {
    if (this.#truncated || bytes.length === 0) return;
    if (this.#bytes + bytes.length > this.#maxBytes) {
      this.#truncated = true;
      return;
    }
    const last = this.#events.at(-1);
    // A clock that steps back (it should not) never produces a transcript the parser refuses.
    const t = Math.max(at - this.#origin, last === undefined ? 0 : last.t, 0);
    this.#bytes += bytes.length;
    this.#events.push(Object.freeze({ t, dir, bytes: bytes.slice() }));
  }
}

/** Lower-case hex of `bytes`. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Events as JSONL, one `{"t":…,"dir":…,"hex":…}` per line, each line ending in `\n`. */
export function wireEventsToJsonl(events: readonly WireEvent[]): string {
  let out = '';
  for (const e of events) out += `${JSON.stringify({ t: e.t, dir: e.dir, hex: toHex(e.bytes) })}\n`;
  return out;
}
