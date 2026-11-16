import { createHash } from 'node:crypto';
import type { Bucket, StoredObject } from '../src/bucket.ts';

/**
 * An in-memory bucket with R2's digest check: a body whose SHA-256 differs from `options.sha256` is refused.
 * `hold` lets a test pause a put or a delete at the bucket boundary to interleave another operation.
 */
export class FakeBucket implements Bucket {
  readonly objects = new Map<string, Uint8Array>();
  /** When set, every put fails this way (the bucket "is down"). */
  failWith: Error | null = null;
  /** When set, every delete fails this way (puts still work). */
  deleteFailWith: Error | null = null;
  /** When set, the next put or delete waits for it before touching the objects. */
  hold: Promise<void> | null = null;

  async #wait(): Promise<void> { const h = this.hold; this.hold = null; if (h !== null) await h; }

  async put(key: string, body: ReadableStream<Uint8Array> | Uint8Array, options: { readonly sha256: string }) {
    const bytes = body instanceof Uint8Array ? body : await collect(body);
    await this.#wait();
    if (this.failWith !== null) throw this.failWith;
    if (createHash('sha256').update(bytes).digest('hex') !== options.sha256) throw new Error('The SHA-256 checksum you specified did not match what we received.');
    this.objects.set(key, bytes);
    return { size: bytes.byteLength };
  }

  async get(key: string): Promise<StoredObject | null> {
    const bytes = this.objects.get(key);
    return bytes === undefined ? null : { size: bytes.byteLength, body: stream(bytes) };
  }

  async delete(key: string): Promise<void> {
    await this.#wait();
    if (this.deleteFailWith !== null) throw this.deleteFailWith;
    this.objects.delete(key);
  }
}

export function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

export async function collect(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A promise a test resolves by hand. */
export function gate(): { readonly promise: Promise<void>; open(): void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}
