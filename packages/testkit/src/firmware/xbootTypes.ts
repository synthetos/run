/** Timing, fault and host contracts for the simulated bootloader. */
export interface XbootTimings {
  /** Entry window after a power-on or reset (ms). Default 4800. */
  readonly windowMs: number;
  /** Entry window after a software reset ({"boot":1}) (ms). Default 60000. */
  readonly windowSwResetMs: number;
  /** Watchdog period (ms). Default 1000 (WDT_PER_1KCLK). */
  readonly watchdogMs: number;
  /** Busy time of one page erase-write (ms; model value). Default 6. */
  readonly pageWriteMs: number;
  /** Busy time of the application CRC (ms; model value). Default 40. */
  readonly crcMs: number;
}

export const XBOOT_TIMINGS: XbootTimings = Object.freeze({ windowMs: 4800, windowSwResetMs: 60000, watchdogMs: 1000, pageWriteMs: 6, crcMs: 40 });

export interface XbootFaults {
  /** Drop the Nth byte the bootloader receives in command mode (1-based), once each. */
  dropRx?: number[];
  /** Drop the Nth byte the bootloader sends (1-based), once each. */
  dropTx?: number[];
  /** Swallow the next command with this opcode (no reply), this many times. */
  swallow?: { readonly opcode: number; count: number };
  /** Report this signature instead of the x192a3's. */
  signature?: readonly [number, number, number];
  /** Corrupt the next N flash page writes at this byte address (a byte is flipped in flash). */
  corruptPage?: { readonly byteAddress: number; count: number };
  /** Answer `?` to block loads, starting at the Nth one (1-based). */
  refuseBlockLoadFrom?: number;
}

export interface XbootHost {
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly transmit: (bytes: Uint8Array) => void;
  readonly event: (note: string) => void;
  /** Milliseconds one byte takes on the wire (the reply's own transmit time keeps xboot busy). */
  readonly byteMs: () => number;
  /** Leave the bootloader: jump to address 0 (the board decides what runs there). */
  readonly jumpToApplication: () => void;
}


export interface XbootOptions extends Partial<XbootTimings> {
  /** tg-xboot e607778: T/P write arming and reset after two bad commands. */
  readonly hardened?: boolean;
}
