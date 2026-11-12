/** One reply to the unmarked-port ESC/S newline. Anything except a single error footer stays visible to the probe. */
import { classifyLine } from '@synthetos/protocol';

export class PrecheckReply {
  #pending: number[] = [];
  done = false;
  push(bytes: Uint8Array): Uint8Array {
    if (this.done) return bytes;
    const out: number[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i] as number;
      this.#pending.push(b);
      if (b === 10 || b === 13 || this.#pending.length > 2048) {
        const overflow = this.#pending.length > 2048;
        const line = Uint8Array.from(this.#pending);
        this.#pending = [];
        const parsed = classifyLine(new TextDecoder().decode(line).trim());
        const discard = 'footer' in parsed && parsed.footer !== undefined && parsed.footer.status !== 0;
        if (discard || overflow) {
          this.done = true;
          return Uint8Array.from([...out, ...(discard ? [] : line), ...bytes.subarray(i + 1)]);
        }
        out.push(...line);
      }
    }
    return Uint8Array.from(out);
  }
  /** Silence or a partial line is never proof: preserve it for the normal probe's framing/splice guard. */
  finish(): Uint8Array {
    this.done = true;
    const bytes = Uint8Array.from(this.#pending);
    this.#pending = [];
    return bytes;
  }
}
