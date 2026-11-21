/**
 * The xboot client's one error type, and how link and command failures map
 * onto it.
 *
 * `desync`: a byte came back that no command asked for, or a reply was not
 * the byte its command must answer. AVR109 has no framing: the host pairs
 * replies with commands only by counting bytes, so after one such byte every
 * later reply may belong to another command, and xboot may be reading page
 * bytes as commands (where `e` erases the application and EEPROM). It is a
 * hard stop: never retried, and nothing more is sent but a fresh entry.
 */
import { CommandError } from './avr109.ts';
import { LinkClosed, LinkTimeout } from '../../core/link.ts';

export type XbootErrorCode = 'refused' | 'unexpected' | 'desync' | 'wrong-part' | 'wrong-bootloader' | 'block-size' | 'no-entry' | 'timeout' | 'closed';

export class XbootError extends Error {
  override readonly name = 'XbootError';
  readonly code: XbootErrorCode;
  constructor(code: XbootErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Link and command failures as `XbootError`. */
export function toXbootError(error: unknown): XbootError {
  if (error instanceof XbootError) return error;
  if (error instanceof LinkTimeout) return new XbootError('timeout', error.message);
  if (error instanceof LinkClosed) return new XbootError('closed', error.message);
  if (error instanceof CommandError) return new XbootError('unexpected', error.message);
  return new XbootError('closed', error instanceof Error ? error.message : String(error));
}

export const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
