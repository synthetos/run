/**
 * The Transport contract (ROADMAP P0-12; RUN_PLAN §5.1 rules 1 and 5, §5.5;
 * OLD-TP §4.2; SAFETY H2b, §3 OPENING, T-S16).
 *
 * A Transport is the byte link between `MachineSession` (the single writer,
 * RUN_PLAN §5.1 rule 1) and a controller. It is controller-neutral: TinyG's
 * FTDI bridge and g2core's native USB CDC are both just a Transport, and
 * which USB identities and baud rates are allowed comes from dialect data
 * (`Dialect.transport`), never from code here.
 *
 * Rules every implementation and caller relies on (SAFETY H2b):
 * - There is no way to cancel a write in progress. Cancelling a stream
 *   writer discards queued bytes and can cut a line in half: on TinyG the
 *   tail merges with the next line, on g2 the fragment executes
 *   (`G1 X12.5` becomes `G1 X1`). The interface simply has no such member,
 *   and lint bans the name in this package (P0-02 `run/no-writer-abort`).
 * - `writeLine` carries exactly one complete line (ending in `\n`) or one
 *   realtime byte group, and is awaited before the next write.
 * - After a failed write nothing that ends a line is ever written: a
 *   newline would "finish" whatever fragment reached the controller.
 * - `open` refuses 1200 baud and bootloader ports without a
 *   `BootloaderCapability`, and refuses the Due programming port (2341:003D)
 *   always, before the port is opened.
 *
 * `GuardedTransport` (guardedTransport.ts) enforces all of these around any
 * inner Transport. The session only ever writes through a guarded one.
 */
import type { BootloaderCapability } from '@synthetos/flasher';

/** Options for `open`, as Web Serial's `SerialOptions` subset run uses. */
export interface TransportOpenOptions {
  readonly baudRate: number;
  /** Only `'none'` is ever accepted (PN §7.4; SAFETY §3 OPENING). `'hardware'` is refused until B-FC-1. */
  readonly flowControl: 'none' | 'hardware';
  readonly bufferSize: number;
}

/** What kind of link this is, and the USB identity when there is one (known before open). */
export interface TransportInfo {
  readonly kind: 'serial' | 'sim' | 'replay';
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
}

export interface Transport {
  /**
   * Open the link. `capability` is required for 1200 baud and for a
   * bootloader-role port, and is refused anywhere else.
   */
  open(options: TransportOpenOptions, capability?: BootloaderCapability): Promise<void>;
  /** Exactly one complete line (ends in `\n`), or one realtime byte group. */
  writeLine(line: Uint8Array): Promise<void>;
  /** Bytes from the controller, in arrival order. Ends when the link closes or drops. */
  readonly readable: AsyncIterable<Uint8Array>;
  /** Close the link. A write already in progress finishes first. */
  close(): Promise<void>;
  onDisconnect(callback: () => void): void;
  /** Identity of the link. Available before `open`, so a port can be refused before it is opened. */
  info(): TransportInfo;
}

/**
 * Which granted port the user chose (RUN_PLAN §5.4). `requestPort()` exists
 * only on Window, so the window shows the chooser; the worker, where only
 * `navigator.serial.getPorts()` is available, finds the same port among the
 * ports this origin was ever granted. The window describes its choice with
 * what it can read from the chosen `SerialPort`: its USB identity
 * (`getInfo()`) and its index in the window's own `getPorts()` list, which
 * the worker's `getPorts()` returns in the same order.
 *
 * A source must refuse (resolve null) rather than guess: no granted port
 * matches, or the identity matches a port other than the one at
 * `grantIndex`. It must never pick "the first matching" port, which could
 * be another machine.
 */
export interface PortSelector {
  readonly usbVendorId: number;
  readonly usbProductId: number;
  /** Index of the chosen port in the window's `navigator.serial.getPorts()`. */
  readonly grantIndex: number;
}

/** True when `value` is a well-formed `PortSelector` (integers in range, no other keys). */
export function isPortSelector(value: unknown): value is PortSelector {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'grantIndex,usbProductId,usbVendorId') return false;
  const { usbVendorId, usbProductId, grantIndex } = value as Record<string, unknown>;
  const u16 = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffff;
  return u16(usbVendorId) && u16(usbProductId) && Number.isInteger(grantIndex) && (grantIndex as number) >= 0 && (grantIndex as number) < 256;
}

/**
 * Where `machine.worker` gets its Transport (ROADMAP P0-14). The web app's
 * transport seam (apps/web/src/machine-worker/transport.ts) is the only
 * production implementation; the fake-serial test build swaps it.
 */
export interface TransportSource {
  /**
   * `none`: this build cannot reach a controller (production, Phase 0).
   * `serial`: Web Serial (P1-01). `fake`: the test build's mock port only.
   */
  readonly kind: 'none' | 'serial' | 'fake';
  /**
   * A new, unopened Transport for the port `selector` names, or null when
   * there is none (no granted port matches unambiguously, or this build has
   * none). Never a different port than the one named.
   */
  request(selector: PortSelector): Promise<Transport | null>;
}
