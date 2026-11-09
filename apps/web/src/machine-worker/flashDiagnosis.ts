/**
 * What crossed the bootloader link when the bootloader did not answer, in one
 * sentence for the user and the report (the flash transcript has the bytes).
 *
 * The flasher sends ESC and `S` until xboot answers `XBoot++` (packages/flasher
 * client.ts). When it never does, the cases a bench can tell apart are:
 * - nothing came back at all: the board's bytes, or run's, did not cross the
 *   USB link, or the board is not running anything that answers;
 * - bytes came back, but not the bootloader's answer: something else is
 *   running, most likely the firmware itself (it never reset, or it reset
 *   straight back into the application).
 */
import type { WireEvent } from '@synthetos/machine';

const ESC = 0x1b;
const PROGRAM_ID = 0x53;
const SHOWN = 24;

export interface EntryTraffic {
  /** ESC frames sent. */
  readonly escapes: number;
  /** `S` frames sent. */
  readonly ids: number;
  /** Bytes received. */
  readonly received: number;
  /** The first bytes received (at most 24). */
  readonly head: Uint8Array;
  /** Milliseconds from the first frame sent to the last event. */
  readonly spanMs: number;
}

export function entryTraffic(events: readonly WireEvent[]): EntryTraffic {
  let escapes = 0;
  let ids = 0;
  let received = 0;
  const head: number[] = [];
  let first: number | null = null;
  let last = 0;
  for (const e of events) {
    last = e.t;
    if (e.dir === 'tx') {
      first ??= e.t;
      if (e.bytes.length === 1 && e.bytes[0] === ESC) escapes++;
      if (e.bytes.length === 1 && e.bytes[0] === PROGRAM_ID) ids++;
    } else {
      received += e.bytes.length;
      for (const b of e.bytes) if (head.length < SHOWN) head.push(b);
    }
  }
  return Object.freeze({ escapes, ids, received, head: Uint8Array.from(head), spanMs: first === null ? 0 : last - first });
}

/** Printable ASCII as is, anything else as \xNN. */
function shown(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`;
  return out;
}

/** One sentence on what came back while run tried to enter the bootloader. */
export function entryDiagnosis(events: readonly WireEvent[]): string {
  const t = entryTraffic(events);
  const times = (n: number): string => (n === 1 ? 'once' : `${n} times`);
  const tried = `run sent ESC ${times(t.escapes)} and S ${times(t.ids)} over ${(t.spanMs / 1000).toFixed(1)} s`;
  if (t.received === 0) return `Nothing came back: ${tried} and the board sent no byte at all.`;
  return `The board sent ${t.received} bytes, none of them the bootloader's answer ("${shown(t.head)}"${t.received > t.head.length ? '…' : ''}), while ${tried}: the firmware may still be running.`;
}
