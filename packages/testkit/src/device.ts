/**
 * The contract between the simulated link (`SimEndpoint`) and a device model
 * behind it (ROADMAP P0-11). A device sees only bytes arriving at its UART
 * and transmits bytes back; it never sees the host's objects. Device-level
 * faults from a fault plan reach it through `FaultTarget`.
 */
import './marker.ts';
import type { Clock } from './clock.ts';

export interface DeviceIo {
  readonly clock: Clock;
  /** Transmit bytes toward the host (serialised at the link's baud rate). */
  transmit(data: Uint8Array): void;
  /** Note a device event in the transcript (a reset, a side effect, ...). */
  event(note: string): void;
}

/** Device-level faults a fault plan can inject (RUN_PLAN §8.1). */
export interface FaultTarget {
  /** A limit switch input closes. */
  injectLimitSwitch(input: number): void;
  /** Suppress (true) or restore (false) status and queue reports. */
  setReportSuppression(on: boolean): void;
  /** The board resets: all RAM state is lost; persisted settings survive; the boot banner prints again. */
  resetBoard(): void;
  /** Delay every boot banner by this much more. */
  setBannerDelay(extraMs: number): void;
}

export interface SimDevice extends FaultTarget {
  /** USB identity of the serial bridge (what `SerialPort.getInfo()` reports). */
  readonly usb: { readonly vendorId: number; readonly productId: number };
  /** The UART baud rate the firmware runs at. */
  readonly baudRate: number;
  /** Called once by the endpoint before any traffic. */
  attach(io: DeviceIo): void;
  /**
   * One byte arrives at the UART. `overrun` is true when a fault plan forces
   * the receive ring to be full for this byte (RUN_PLAN §8.1 "ring overrun").
   */
  receive(byte: number, overrun: boolean): void;
}
