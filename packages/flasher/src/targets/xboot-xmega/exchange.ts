import { encodeCommand, replyLength, type Command } from './avr109.ts';
import type { ByteLink } from '../../core/link.ts';
import type { ClientTimings } from './timings.ts';
import { XbootError, toXbootError } from './errors.ts';
import type { Part } from './part.ts';
import { armWrites, expectAck } from './programming.ts';
import { assertQuiet } from './quiet.ts';

/** Serial command ownership and the programming-mode lease. A page owns t/T/P/H/B as a unit. */
export class XbootExchange {
  unsynced = false;
  entering = false;
  armed = false;
  sent = 0;
  #busy = false;
  #writing = false;
  readonly link: ByteLink;
  constructor(link: ByteLink) { this.link = link; }

  get active(): boolean { return this.#busy || this.#writing; }

  command(command: Command, timeoutMs: number): Promise<Uint8Array> {
    if (this.#writing) return Promise.reject(new XbootError('unexpected', 'a page write is in progress'));
    return this.#send(command, timeoutMs);
  }

  async #send(command: Command, timeoutMs: number): Promise<Uint8Array> {
    if (this.#busy) throw new XbootError('unexpected', 'one command at a time');
    if (this.unsynced && !this.entering) throw new XbootError('desync', 'a reply failed or came out of step: nothing is sent before a new bootloader entry');
    this.#busy = true;
    try {
      if (['sync', 'selectDevice', 'leaveProgramming', 'exit'].includes(command.op)) this.armed = false;
      const frame = encodeCommand(command);
      assertQuiet(this.link, `\`${String.fromCharCode(frame[0] as number)}\``);
      await this.link.write(frame);
      this.sent++;
      return await this.link.read(replyLength(command), timeoutMs);
    } catch (error) {
      const e = toXbootError(error);
      if (e.code !== 'unexpected') { this.unsynced = true; this.armed = false; }
      throw e;
    } finally { this.#busy = false; }
  }

  async ack(command: Command, timeoutMs: number, what: string): Promise<void> {
    const reply = await this.command(command, timeoutMs);
    try { expectAck(reply, what); }
    catch (error) { this.unsynced = true; this.armed = false; throw error; }
  }

  async writePage(part: Part, address: number, data: Uint8Array, timings: ClientTimings): Promise<void> {
    if (this.active || this.entering) throw new XbootError('unexpected', 'one page at a time');
    this.#writing = true;
    try {
      if (!this.armed) {
        await armWrites(part, (c) => this.#send(c, timings.replyMs));
        this.armed = true;
      }
      expectAck(await this.#send({ op: 'setAddress', value: address / 2 }, timings.replyMs), 'the address');
      expectAck(await this.#send({ op: 'writeFlashBlock', data }, timings.blockWriteMs), `the page at 0x${address.toString(16)}`);
    } catch (error) {
      this.armed = false;
      this.unsynced = true;
      throw error;
    } finally { this.#writing = false; }
  }

  async leave(timeoutMs: number): Promise<void> {
    if (this.armed) await this.ack({ op: 'leaveProgramming' }, timeoutMs, 'leaving programming mode');
  }
}
