/**
 * The bytes a `BootloaderLink` keeps for the normal session after a handoff (bootloaderLink.ts): what arrived from
 * the proof (a ready banner, or the answer to a pre-check line end) on, in order, bounded.
 */

/** The most bytes held for a session that does not read them. Past this the link ends. */
export const APPLICATION_QUEUE_LIMIT = 65536;

export class ApplicationQueue {
  readonly #overflow: () => void;
  #chunks: Uint8Array[] = [];
  #bytes = 0;
  #wake: (() => void) | null = null;

  /** `overflow` runs once the bound is passed (the link ends itself). */
  constructor(overflow: () => void) {
    this.#overflow = overflow;
  }

  push(bytes: Uint8Array): void {
    this.#bytes += bytes.length;
    if (this.#bytes > APPLICATION_QUEUE_LIMIT) {
      this.#overflow();
      return;
    }
    if (bytes.length > 0) this.#chunks.push(bytes.slice());
    this.wake();
  }

  /** Forget everything held: what came before a fresh proof is not for the session. */
  clear(): void {
    this.#chunks = [];
    this.#bytes = 0;
  }

  /** Wake a pending `next` (new bytes, or the link closed). */
  wake(): void {
    this.#wake?.();
    this.#wake = null;
  }

  /** The next chunk, waiting for one while `closed()` is false; done once it is. */
  async next(closed: () => boolean): Promise<IteratorResult<Uint8Array>> {
    while (!closed()) {
      const chunk = this.#chunks.shift();
      if (chunk !== undefined) {
        this.#bytes -= chunk.length;
        return { done: false, value: chunk };
      }
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
    return { done: true, value: undefined };
  }
}
