/**
 * `GuardedTransport`: the Transport rules, enforced in one place around any
 * inner Transport (ROADMAP P0-12; SAFETY H2b, §3 OPENING, T-S16; OLD-TP
 * §4.2). Phase 1 wraps `WebSerialTransport` in it; tests wrap the test kit's
 * `ReplayTransport` and fakes. `MachineSession` writes only through one.
 *
 * Opening:
 * - Everything is decided before the inner port is touched: the USB identity
 *   (the Due programming port 2341:003D is always refused), the baud rate
 *   (1200 needs the flasher's `BootloaderCapability`), `flowControl` and
 *   `bufferSize` (openPolicy.ts). A refused open never calls the inner
 *   `open`.
 * - A capability is consumed when presented, valid or not, so it is single
 *   use. A forged or reused one is refused outright.
 * - One instance is one connection: it opens at most once.
 *
 * Writing:
 * - The bytes are copied first, then validated (writeShape.ts), so a caller
 *   that changes its buffer afterwards cannot change what is sent.
 * - Writes reach the inner Transport strictly one at a time, in call order:
 *   each waits until the previous one settled. A STOP's `!` issued during a
 *   line write is therefore sent right after that line, never inside it.
 * - After any failed write, the transport refuses every further line for
 *   the rest of its life: an LF would "finish" whatever fragment reached the
 *   controller (SAFETY H2b). Realtime groups are still sent, because the
 *   stop path (`!`, TinyG's `%`) must keep working.
 * - Nothing is written before open, after close or after the link dropped.
 *
 * Closing waits for the write in progress to finish, so a close never cuts a
 * line either; writes still queued behind it are refused, not sent.
 */
import { consumeBootloaderCapability, type BootloaderCapability } from '@synthetos/flasher';
import { decideOpen, type OpenRefusalReason } from './openPolicy.ts';
import type { Transport, TransportInfo, TransportOpenOptions } from './transport.ts';
import { classifyWrite, type WriteRejectionReason, type WriteShape } from './writeShape.ts';

export type TransportRefusalCode =
  | OpenRefusalReason
  | 'invalid-capability'
  | 'already-opened'
  | 'invalid-write'
  | 'not-open'
  | 'disconnected'
  | 'line-after-write-failure';

/** The guard refused a call. Nothing reached the inner Transport. */
export class TransportRefusedError extends Error {
  readonly code: TransportRefusalCode;
  /** For `invalid-write`: which shape rule the bytes broke. */
  readonly rejection: WriteRejectionReason | undefined;

  constructor(code: TransportRefusalCode, detail: string, rejection?: WriteRejectionReason) {
    super(`transport refused (${code}): ${detail}`);
    this.name = 'TransportRefusedError';
    this.code = code;
    this.rejection = rejection;
  }
}

/** The inner Transport failed a write. The guard is now latched: no further lines. */
export class TransportWriteError extends Error {
  constructor(cause: unknown) {
    super('transport write failed; no further line will be written on this connection', { cause });
    this.name = 'TransportWriteError';
  }
}

export type GuardedTransportState = 'new' | 'opening' | 'open' | 'closed';

export class GuardedTransport implements Transport {
  readonly #inner: Transport;
  #state: GuardedTransportState = 'new';
  #opening: Promise<void> | undefined;
  #disconnected = false;
  #writeFailed = false;
  /** Settles when the last queued write has settled; never rejects. */
  #tail: Promise<void> = Promise.resolve();

  constructor(inner: Transport) {
    this.#inner = inner;
    inner.onDisconnect(() => {
      this.#disconnected = true;
    });
  }

  get state(): GuardedTransportState {
    return this.#state;
  }

  /** True once any write failed. Lines are refused from then on. */
  get writeFailed(): boolean {
    return this.#writeFailed;
  }

  async open(options: TransportOpenOptions, capability?: BootloaderCapability): Promise<void> {
    if (this.#state !== 'new') throw new TransportRefusedError('already-opened', `open() called in state ${this.#state}`);
    // Consume first: a presented token is used up whatever happens next.
    const presented = capability !== undefined;
    const valid = presented && consumeBootloaderCapability(capability);
    if (presented && !valid) throw new TransportRefusedError('invalid-capability', 'the bootloader capability is forged or already used');
    // Read each option once, so a getter cannot answer differently to the check and to the port.
    const snapshot: TransportOpenOptions = Object.freeze({
      baudRate: options.baudRate,
      flowControl: options.flowControl,
      bufferSize: options.bufferSize,
    });
    const info: TransportInfo = this.#inner.info();
    const decision = decideOpen(info, snapshot, valid);
    if (!decision.ok) throw new TransportRefusedError(decision.reason, decision.detail);

    this.#state = 'opening';
    this.#opening = this.#inner.open(snapshot);
    try {
      await this.#opening;
    } catch (error) {
      this.#state = 'closed';
      throw error;
    }
    // close() may have run while the port was opening; it wins.
    if (this.#state === 'opening') this.#state = 'open';
  }

  writeLine(line: Uint8Array): Promise<void> {
    if (!(line instanceof Uint8Array)) {
      return Promise.reject(new TransportRefusedError('invalid-write', 'writeLine takes a Uint8Array'));
    }
    const bytes = line.slice();
    const shape = classifyWrite(bytes);
    if (shape.kind === 'rejected') {
      const at = shape.at === undefined ? '' : ` at byte ${shape.at}`;
      return Promise.reject(new TransportRefusedError('invalid-write', `${shape.reason}${at}`, shape.reason));
    }
    const refusal = this.#refusal(shape);
    if (refusal !== undefined) return Promise.reject(refusal);
    const run = this.#tail.then(() => this.#perform(bytes, shape));
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  get readable(): AsyncIterable<Uint8Array> {
    return this.#inner.readable;
  }

  async close(): Promise<void> {
    const previous = this.#state;
    if (previous === 'closed') return;
    this.#state = 'closed';
    if (previous === 'new') return;
    // 'opening' or 'open': the inner open was started, so #opening is set.
    try {
      await this.#opening;
    } catch {
      // open() reports its own failure; there is nothing to close.
      return;
    }
    await this.#tail;
    await this.#inner.close();
  }

  onDisconnect(callback: () => void): void {
    this.#inner.onDisconnect(callback);
  }

  info(): TransportInfo {
    return this.#inner.info();
  }

  /** Why a write of this shape may not go out now, or undefined if it may. */
  #refusal(shape: WriteShape): TransportRefusedError | undefined {
    if (this.#state !== 'open') return new TransportRefusedError('not-open', `write in state ${this.#state}`);
    if (this.#disconnected) return new TransportRefusedError('disconnected', 'the link dropped');
    if (shape.kind === 'line' && this.#writeFailed) {
      return new TransportRefusedError('line-after-write-failure', 'a previous write failed; no line may follow it (SAFETY H2b)');
    }
    return undefined;
  }

  async #perform(bytes: Uint8Array, shape: WriteShape): Promise<void> {
    // Checked again: a failure, a close or a disconnect may have happened while this write waited.
    const refusal = this.#refusal(shape);
    if (refusal !== undefined) throw refusal;
    try {
      await this.#inner.writeLine(bytes);
    } catch (error) {
      this.#writeFailed = true;
      throw new TransportWriteError(error);
    }
  }
}
