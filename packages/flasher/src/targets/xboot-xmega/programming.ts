import { REPLY, type Command } from './avr109.ts';
import { XbootError, hex } from './errors.ts';
import type { Part } from './part.ts';

export function expectAck(reply: Uint8Array, what: string): void {
  if (reply[0] === REPLY.ack) return;
  if (reply[0] === REPLY.error) throw new XbootError('refused', `xboot refused ${what}`);
  throw new XbootError('desync', `xboot answered ${what} with 0x${hex(reply)}, not an acknowledgement: the replies are out of step, so nothing more is sent`);
}

/** Caller holds the page-write lock across t/T/P: no keep-alive or address command may intervene. */
export async function armWrites(part: Part, send: (command: Command) => Promise<Uint8Array>): Promise<void> {
  const codes = await send({ op: 'deviceCodes' });
  // Both supported TinyG xboot versions return exactly one code followed by zero.
  if (codes[0] !== part.deviceCode || codes[1] !== 0) throw new XbootError('wrong-part', 'xboot did not advertise the configured AVR109 device code');
  expectAck(await send({ op: 'selectDevice', code: part.deviceCode }), 'the device selection');
  expectAck(await send({ op: 'enterProgramming' }), 'entering programming mode');
}
