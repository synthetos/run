import { createHash } from 'node:crypto';
export function digestRuntime() {
  class DigestStream extends WritableStream {
    constructor() {
      const hash = createHash('sha256'); let resolve, reject;
      const digest = new Promise((yes, no) => { resolve = yes; reject = no; });
      super({ write: bytes => { hash.update(bytes); }, close: () => { const bytes = hash.digest(); resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }, abort: error => reject(error) });
      this.digest = digest;
    }
  }
  Object.defineProperty(crypto, 'DigestStream', { configurable: true, value: DigestStream });
}
