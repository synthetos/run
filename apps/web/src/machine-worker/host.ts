/**
 * What `machine.worker` does with each request (ROADMAP P0-14; RUN_PLAN
 * §5.1 rule 1, §5.4). Kept apart from the worker entry so it is unit-tested
 * without a worker.
 *
 * - Requests run strictly one at a time, in arrival order, so an `open` and
 *   a `close` can never interleave.
 * - `open` takes a new Transport for the chosen port from the build's
 *   transport source (transport.ts) and opens it only through
 *   `GuardedTransport`, with the session options derived from dialect data
 *   (`SESSION_OPEN_OPTIONS`: the shared baud rate, flowControl 'none',
 *   bufferSize 256; SAFETY §3 OPENING). The guard, not this file, decides
 *   whether a port may be opened.
 * - While a link is open, every byte read is counted (the link is drained,
 *   so the port's buffer never fills). Nothing is ever written: Phase 0 has
 *   no write path at all.
 * - The link is gone, and the worker returns to idle, on a disconnect
 *   (including one that happened while the port was still opening: the
 *   guard records it from construction) and whenever `readable` ends or
 *   fails without a `close` in progress.
 *
 * It holds no session, account or network state (DECISIONS D1).
 */
import { GuardedTransport, SESSION_OPEN_OPTIONS, TransportRefusedError, type PortSelector, type TransportSource } from '@synthetos/machine';
import { RPC_VERSION, parseRequest, refusal, type MachineReply, type WorkerState } from './rpc.ts';

interface Link {
  readonly transport: GuardedTransport;
  bytesReceived: number;
}

export class MachineWorkerHost {
  readonly #source: TransportSource;
  #state: WorkerState = 'idle';
  #link: Link | null = null;
  /** Settles when the previous request has been answered; never rejects. */
  #tail: Promise<unknown> = Promise.resolve();

  constructor(source: TransportSource) {
    this.#source = source;
  }

  /** Answers one message. Never rejects: every failure is a refusal reply. */
  handle(data: unknown): Promise<MachineReply> {
    const run = this.#tail.then(() => this.#dispatch(data));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #dispatch(data: unknown): Promise<MachineReply> {
    const request = parseRequest(data);
    if (request === null) return refusal('invalid', 'invalid-request', 'not a machine worker request');
    switch (request.kind) {
      case 'open':
        return this.#open(request.port);
      case 'close':
        return this.#close();
      case 'status':
        return Object.freeze({
          v: RPC_VERSION,
          ok: true,
          kind: 'status',
          status: Object.freeze({ source: this.#source.kind, state: this.#state, bytesReceived: this.#link?.bytesReceived ?? 0 }),
        });
    }
  }

  async #open(port: PortSelector): Promise<MachineReply> {
    if (this.#state !== 'idle') return refusal('open', 'busy', `a link is already ${this.#state}`);
    this.#state = 'opening';
    let inner;
    try {
      inner = await this.#source.request(port);
    } catch (error) {
      this.#state = 'idle';
      return refusal('open', 'unavailable', `the transport source failed: ${describe(error)}`);
    }
    if (inner === null) {
      this.#state = 'idle';
      const why = this.#source.kind === 'none' ? 'this build cannot connect to a controller' : 'no port was chosen';
      return refusal('open', 'unavailable', why);
    }
    const transport = new GuardedTransport(inner);
    try {
      await transport.open(SESSION_OPEN_OPTIONS);
    } catch (error) {
      this.#state = 'idle';
      const code = error instanceof TransportRefusedError ? ` (${error.code})` : '';
      return refusal('open', 'open-failed', `the port was not opened${code}: ${describe(error)}`);
    }
    // A disconnect during the open fired before any callback of ours could be registered; the guard
    // recorded it from construction, so check it before reporting the link open.
    if (transport.disconnected) {
      this.#state = 'idle';
      await transport.close().catch(() => undefined);
      return refusal('open', 'open-failed', 'the link dropped while the port was opening');
    }
    const link: Link = { transport, bytesReceived: 0 };
    this.#link = link;
    this.#state = 'open';
    transport.onDisconnect(() => this.#drop(link));
    void this.#drain(link);
    return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'open', info: Object.freeze({ ...transport.info() }) });
  }

  async #close(): Promise<MachineReply> {
    const link = this.#link;
    if (this.#state !== 'open' || link === null) return refusal('close', 'not-open', 'no link is open');
    this.#state = 'closing';
    try {
      await link.transport.close();
    } catch (error) {
      // The guard is closed whatever the port said: this link is never used again.
      return refusal('close', 'close-failed', `the port reported an error while closing: ${describe(error)}`);
    } finally {
      this.#drop(link);
    }
    return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'close' });
  }

  /**
   * Reads the link until it ends, counting bytes. When `readable` ends or
   * fails and no close is in progress, the link is gone even if no
   * disconnect event came: the worker returns to idle and the guard is
   * closed, so it never reports `open` on a dead link.
   */
  async #drain(link: Link): Promise<void> {
    try {
      for await (const chunk of link.transport.readable) link.bytesReceived += chunk.byteLength;
    } catch {
      // The link failed (a disconnect errors the stream).
    }
    if (this.#link !== link || this.#state === 'closing') return;
    this.#drop(link);
    await link.transport.close().catch(() => undefined);
  }

  #drop(link: Link): void {
    if (this.#link !== link) return;
    this.#link = null;
    this.#state = 'idle';
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
