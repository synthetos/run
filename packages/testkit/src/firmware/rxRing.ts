/**
 * The TinyG USB receive ring (both builds share its shape).
 *
 * A circular buffer of `RX_BUFFER_SIZE` slots where slot 0 is never used and
 * head == tail means empty, so it holds `RX_BUFFER_SIZE - 2` bytes ("Must
 * reserve 2 bytes for buffer management", @cite EN xio/xio_usart.h:53-54;
 * @cite TG xio/xio_usart.h:53-54). When it is full the ISR tosses the
 * incoming byte (@cite EN xio/xio_usb.c:265-271; @cite TG xio/xio_usb.c:186-191).
 *
 * Bytes carry a sequence number so the edge-next model can mark where input
 * was lost exactly as EN does (E162): `lostFirst` / `lostLast` are the
 * sequence numbers of the last byte kept before the first and the latest
 * loss (@cite EN xio/xio_usb.c:176-180).
 */

import '../marker.ts';
export class RxRing {
  readonly capacity: number;
  readonly #bytes: number[] = [];
  readonly #seqs: number[] = [];
  #nextSeq = 0;
  /** Sequence number of the last byte stored, or -1 before any. */
  lastStoredSeq = -1;

  constructor(bufferSize: number) {
    this.capacity = bufferSize - 2;
  }

  get count(): number {
    return this.#bytes.length;
  }

  get free(): number {
    return this.capacity - this.#bytes.length;
  }

  /** Store a byte; returns false (and stores nothing) when the ring is full or `forceFull` is set. */
  push(byte: number, forceFull = false): boolean {
    if (forceFull || this.#bytes.length >= this.capacity) return false;
    this.#bytes.push(byte);
    this.#seqs.push(this.#nextSeq);
    this.lastStoredSeq = this.#nextSeq++;
    return true;
  }

  /** Oldest byte and its sequence number, or undefined when empty. */
  shift(): { byte: number; seq: number } | undefined {
    const byte = this.#bytes.shift();
    const seq = this.#seqs.shift();
    if (byte === undefined || seq === undefined) return undefined;
    return { byte, seq };
  }

  /** Sequence number of the oldest byte, or undefined when empty. */
  headSeq(): number | undefined {
    return this.#seqs[0];
  }

  /** Drop every byte with a sequence number <= `seq` (the E146 flush mark). */
  dropThrough(seq: number): void {
    while (this.#seqs.length > 0 && (this.#seqs[0] as number) <= seq) {
      this.#bytes.shift();
      this.#seqs.shift();
    }
  }

  clear(): void {
    this.#bytes.length = 0;
    this.#seqs.length = 0;
  }
}
