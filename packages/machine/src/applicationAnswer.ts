/**
 * The answer to the marked-board application probe (bootloaderLink.ts `probeApplication`; owner report 2026-11-21).
 *
 * A running TinyG answers a line end in a way xboot never does:
 * - JSON mode: a reply with a footer (`{"r":…,"f":[…]}`), a banner, or a status report;
 * - text mode: the prompt `tinyg [mm]` or `tinyg [in]`, which carries no line end.
 * xboot in command mode answers a line end with `?` (not an AVR109 command, XB src/xboot.c:816-829); in its entry
 * window it ignores it. Neither proves anything, and neither does silence.
 */
import { classifyLine } from '@synthetos/protocol';

/** The most bytes kept. Past this without proof, the answer proves nothing (a proven answer ends the probe at once). */
const MAX_BYTES = 4096;
const MAX_LINE = 2048;
const PROVING_KINDS: ReadonlySet<string> = new Set(['Response', 'Banner', 'StatusReport']);
const TEXT_PROMPT = /tinyg \[(mm|in)\]/;

export class ApplicationAnswer {
  #bytes: number[] = [];
  #line = '';
  #proven = false;
  #overflow = false;

  /** A TinyG answered. */
  get proven(): boolean {
    return this.#proven;
  }

  push(chunk: Uint8Array): void {
    for (const byte of chunk) {
      this.#keep(byte);
      if (!this.#proven && !this.#overflow) this.#scan(byte);
    }
  }

  /** Every byte received, in order (the session gets them all once proven; unproven, at most MAX_BYTES). */
  bytes(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }

  #keep(byte: number): void {
    if (this.#proven || this.#bytes.length < MAX_BYTES) this.#bytes.push(byte);
    else this.#overflow = true;
  }

  #scan(byte: number): void {
    if (byte === 10 || byte === 13) {
      this.#proven = PROVING_KINDS.has(classifyLine(this.#line).kind);
      this.#line = '';
      return;
    }
    this.#line = this.#line.length >= MAX_LINE ? '' : this.#line + String.fromCharCode(byte);
    this.#proven = byte === 0x5d && TEXT_PROMPT.test(this.#line);
  }
}
