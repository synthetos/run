/**
 * Small pieces both firmware models share: options, the snapshot a test
 * inspects, the side-effect log, and the error a model throws when a host
 * reaches a firmware feature the model does not implement.
 */
import '../marker.ts';
import type { EepromImage } from './settings.ts';
import type { Vec } from './motion.ts';

export interface TinyGModelOptions {
  /**
   * The EEPROM image. Pass the same object to a new model to keep settings
   * across a power cycle, or an image another build wrote. Default: empty
   * (first boot writes the defaults).
   */
  readonly eeprom?: EepromImage;
  /**
   * `ready` (default): the board was already powered when the host
   * connected, so no banner is printed (the FT230X has no DTR→RESET path,
   * PN §2.3 step 1). `boot`: the board boots now and prints its banners.
   */
  readonly start?: 'ready' | 'boot';
  /** Hardware id string the board reports. */
  readonly id?: string;
  /** Model kinematics: feedhold deceleration time. Default 100 ms. Not a firmware fact. */
  readonly holdDecelMs?: number;
  /** Model timing: boot time before the first banner. Default 1000 ms. Not a firmware fact. */
  readonly bootMs?: number;
}

/** What a test can inspect without going through the wire. */
export interface ModelSnapshot {
  /** The `stat` value the board would report now. */
  readonly stat: number;
  /** The `hold` value the board would report now. */
  readonly hold: number;
  readonly machineState: string;
  readonly cycleState: string;
  readonly motionState: string;
  /** Spindle output pins: what the spindle relay sees. */
  readonly spindle: 'off' | 'cw' | 'ccw';
  readonly coolant: { readonly mist: boolean; readonly flood: boolean };
  readonly motorsEnergized: boolean;
  /** Free planner buffers (what `qr` reports). */
  readonly plannerAvailable: number;
  /** Bytes waiting in the receive ring. */
  readonly rxCount: number;
  readonly homed: readonly boolean[];
  /** Machine position, mm. */
  readonly position: Vec;
  /**
   * Physical motor positions, axis units, relative to power-up (motion.ts
   * `motorPosition`). They differ from `position` on an inhibited axis, and
   * on an axis that was inhibited while it moved (finding: inhibited axis).
   */
  readonly motors: Vec;
  /** Velocity, mm/min. */
  readonly velocity: number;
  readonly booted: boolean;
}

/**
 * A host reached firmware behaviour the model does not implement. Thrown
 * loudly (it surfaces from `clock.advance`) so no test silently relies on a
 * guess. STATUS.md lists the gaps.
 */
export class ModelGapError extends Error {
  constructor(what: string) {
    super(`test-kit model gap: ${what} is not modelled (see packages/testkit/STATUS.md)`);
    this.name = 'ModelGapError';
  }
}

/** One GET or SET that acted on the machine instead of only reading (E138), or another notable side effect. */
export interface SideEffect {
  readonly t: number;
  readonly what:
    | 'alarm'
    | 'panic'
    | 'shutdown'
    | 'motors-deenergized'
    | 'motors-energized'
    | 'fake-exception'
    | 'alarm-cleared'
    | 'adc-conversion'
    | 'help-text'
    | 'queue-flush';
  readonly via: string;
}

export const DEFAULT_HOLD_DECEL_MS = 100;
export const DEFAULT_BOOT_MS = 1000;
/** Main loop granularity of the models while they have work. */
export const TICK_MS = 1;
