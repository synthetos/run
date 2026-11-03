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
  /**
   * Model timing: how long a persisted settings write stalls the board while EEPROM is written
   * (edge-next model). Default 0 (no stall), so existing transcripts are unchanged; tests that model it pass a value. During the stall the board neither reads nor answers: bytes
   * received are lost, and the write's own answer is sent when the stall ends (firmware maintainer,
   * 2026-11-02: "a persisted write stalls the board while EEPROM writes, and bytes sent meanwhile are
   * lost"). The duration is not a measured firmware fact.
   */
  readonly eepromWriteMs?: number;
  /**
   * Edge-next model: the status report list on a fresh EEPROM (default: the firmware default list). Kept in
   * the EEPROM image afterwards, so a `{"sr":{...}}` write survives reset and boot.
   */
  readonly srList?: readonly string[];
  /** Edge-next model: the build has the rt family (`{"rt":...}`, the heartbeat). Default true; false answers 100. */
  readonly rt?: boolean;
  /**
   * Edge-next model: the proposed RAM-only write capability (not in any firmware yet). Default false. When true,
   * `{"rt":{"unsaved":null}}` answers `{"rt":{"unsaved":0}}`, and a line whose first pair is `ram:1` applies the
   * rest of the line in RAM without persisting (echoing `"ram":1` first). When false any `ram` key answers 100.
   */
  readonly ramWrites?: boolean;
  /**
   * Edge-next model: `rxm` on a fresh EEPROM (default: line mode, 1, @cite EN settings/settings_default.h:74). 0 is a
   * board another sender left in character mode (footer revision 2), the case run's job preparation switches.
   */
  readonly rxm?: 0 | 1;
  /**
   * Edge-next model: the feed-limit push (`{"rt":{"fi":N}}`, pushed `fs` lines; @cite EN runtime.c:296-563). Default
   * false, so existing transcripts are unchanged; edge-next 93a723b8 has it. The model's summary counters are a
   * model limit (LIM-EN-FEED-LIMIT): cutting time and distance are modelled, the per-cause counters stay 0.
   */
  readonly feedLimit?: boolean;
  /**
   * Edge-next model: the job flag `{"rt":{"job":N}}` (feed-limit step 3: designed, NOT in any firmware yet). Default
   * false. For the tests of run's capability seam only.
   */
  readonly jobFlag?: boolean;
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
  /** Edge-next model: the status report list in force (tokens, in order). Absent on 440.21. */
  readonly srList?: readonly string[];
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
