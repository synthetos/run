/**
 * `TinyGEdgeNextModel`: a behavioural model of TinyG edge-next (ROADMAP
 * P0-11, RUN_PLAN §8.1), the primary target.
 *
 * Every behaviour a safety claim depends on is tagged `@behaviour <id>` here
 * and listed, with its `@cite` (file:line at edge-next 93a723b8,
 * `vendor/firmware-pins.json`) and `@status`, in `behaviours.ts`, from which
 * STATUS.md is generated. Citations are `firmware/tinyg/<file>:<line>`.
 *
 * Structure follows the firmware so a reviewer can read the two side by side:
 * - `receive()` is the USB RX ISR (xio/xio_usb.c:193-276);
 * - `#pass()` is one pass of `_controller_HSM()` (controller.c:157-204);
 * - `#readline()` is `_readline_linemode()` / `_readline_charmode()` (xio.c);
 * - `#gets()` is `_gets_helper()` (xio/xio_usart.c:263-372);
 * - `#alarm()`, `#requestFeedhold()`, `#clear()` ... mirror canonical_machine.c.
 *
 * DEV ONLY. Nothing in a production bundle may import this (T-S40).
 */
import '../marker.ts';
import type { DeviceIo, SimDevice } from '../device.ts';
import {
  DEFAULT_BOOT_MS,
  DEFAULT_HOLD_DECEL_MS,
  ModelGapError,
  TICK_MS,
  type ModelSnapshot,
  type SideEffect,
  type TinyGModelOptions,
} from './common.ts';
import { normalizeBlock, readWords, type GcodeSyntax, type Word } from './gcode.ts';
import { parseHostJson, type HostPairs, type HostValue } from './hostJson.ts';
import { enComputeArc } from './arcs.ts';
import { AXIS_INHIBITED, axisModeTooLarge, modelTarget, softLimitEnds, softLimitExceeded } from './canonical.ts';
import { fpZERO } from './float32.ts';
import { AXES, Motion, distance, zeroVec, type ArcPath, type Block, type Path, type Vec } from './motion.ts';
import { fixed, serialize, type OutObject, type OutValue } from './output.ts';
import { RxRing } from './rxRing.ts';
import { Settings, type SettingValue } from './settings.ts';
import { EN_TABLE, groupMembers, statusCode, token } from './table.ts';

const T = EN_TABLE;
const ST = (name: string): number => statusCode(T, name);

const CHAR = { RESET: 0x18, FEEDHOLD: 0x21, KILL: 0x04, FLUSH: 0x25, END_HOLD: 0x7e, ENQ: 0x05, XON: 0x11, XOFF: 0x13, CR: 0x0d, LF: 0x0a } as const;

/** RX_BUFFER_SIZE (@cite EN xio/xio_usart.h:54). */
const RX_BUFFER_SIZE = 250;
/** XOFF above 30 %, XON below 15 % of the ring (@cite EN xio/xio_usart.h:68-69). */
const XOFF_HI = RX_BUFFER_SIZE * 0.3;
const XOFF_LO = RX_BUFFER_SIZE * 0.15;
/** Line mode: 12 headers in a 1000-byte pool; a new buffer needs more than 255 bytes free (@cite EN xio.h:215-217). */
const RX_HEADERS = 12;
const RX_POOL_SIZE = 1000;
const RX_REQUESTED_SIZE = 255;
/** Planner pool and the headroom a line needs (@cite EN planner.h:83-84). */
const PLANNER_POOL = 32;
const PLANNER_HEADROOM = 12;
/** @cite EN planner.c:78 */
const PLANNER_STARTUP_MS = 50;
/** TOOL_SELECT_MAX (@cite EN canonical_machine.h:326-330). */
const TOOL_MAX = 31;
/** OUTPUT_BUFFER_LEN: the serialized response must fit (@cite EN controller.h:32). */
const OUTPUT_BUFFER_LEN = 512;

/** hw_hard_reset() arms the watchdog at WDTO_15MS (@cite EN hardware.c:159). */
const WATCHDOG_RESET_MS = 15;
/** RT_HB_MAX: the longest rt heartbeat interval, seconds (@cite EN runtime.h:15). */
const RT_HB_MAX = 60;

const HOLD = { OFF: 0, REQUESTED: 1, SYNC: 2, DECEL_CONTINUE: 3, DECEL_TO_ZERO: 4, PENDING: 5, HOLD: 6 } as const;

/** Identity (@cite EN tinyg.h:52-57). */
const FW_BUILD = 450.01;
const FW_VERSION = 0.97;
const HW_PLATFORM = 1;
const HW_VERSION = 8;

/**
 * EN G-code syntax: E161 keeps invalid characters, E159 `E` is a word, a lone
 * `%` is a delimiter, and any other `%` stays in the line and fails it
 * (@behaviour EN-RT-PERCENT-MIDLINE).
 */
export const EN_GCODE_SYNTAX: GcodeSyntax = Object.freeze({
  keepInvalidChars: true,
  signChars: '-.+',
  exponentIsWord: true,
  lonePercentIsDelimiter: true,
});

/**
 * Defaults after an EEPROM erase. Values marked "settings_default.h" are
 * @cite EN settings/settings_default.h at the line given; the others are
 * model placeholders with no safety claim (STATUS.md, model limits).
 */
const EN_DEFAULTS: Readonly<Record<string, SettingValue>> = Object.freeze({
  jv: 3, // :71
  js: 1, // :72 strict
  rxm: 1, // :74 line mode
  ex: 1, // :75 XON/XOFF
  sv: 1, // :79 filtered
  si: 250, // :81
  qv: 0, // :88
  sl: 0, // :48
  mt: 2, // :61
  xvm: 800, // :156
  xfr: 800, // :157
  xtn: 0, // :158
  xtm: 150, // :159
  yvm: 800, // :171
  yfr: 800, // :172
  ytn: 0, // :173
  ytm: 150, // :174
  zvm: 800, // :186
  zfr: 800, // :187
  ztn: 0, // :188
  ztm: 75, // :189
  // Axis modes and rotary radii (@behaviour EN-AXIS-MODES): A is a radius axis, B and C are disabled
  xam: 1, // :155 AXIS_STANDARD
  yam: 1, // :170
  zam: 1, // :185
  aam: 3, // :201 AXIS_RADIUS
  atn: -1, // :204
  atm: -1, // :205 "same number means infinite"
  ara: 1.25 / (2 * Math.PI), // :209 M1_TRAVEL_PER_REV/(2*M_PI), M1_TRAVEL_PER_REV 1.25 (:107)
  bam: 0, // :217 AXIS_DISABLED
  btn: -1, // :220
  btm: -1, // :221
  bra: 1, // :225
  cam: 0, // :233 AXIS_DISABLED
  ctn: -1, // :236
  ctm: -1, // :237
  cra: 1, // :241
  // Motor map and drive settings (settings_default.h:105-134): motors 1-4 drive X, Y, Z and A
  '1ma': 0, // :105 AXIS_X
  '1sa': 1.8, // :106
  '1tr': 1.25, // :107
  '1mi': 8, // :108
  '1po': 0, // :109
  '1pm': 2, // :110 MOTOR_POWER_MODE = MOTOR_POWERED_IN_CYCLE (:63; stepper.h:266-269)
  '2ma': 1, // :113 AXIS_Y
  '2sa': 1.8, // :114
  '2tr': 1.25, // :115
  '2mi': 8, // :116
  '2po': 0, // :117
  '2pm': 2, // :118
  '3ma': 2, // :121 AXIS_Z
  '3sa': 1.8, // :122
  '3tr': 1.25, // :123
  '3mi': 8, // :124
  '3po': 0, // :125
  '3pm': 2, // :126
  '4ma': 3, // :129 AXIS_A
  '4sa': 1.8, // :130
  '4tr': 360, // :131
  '4mi': 8, // :132
  '4po': 0, // :133
  '4pm': 2, // :134
  avm: 800, // placeholder
  afr: 800, // placeholder
  ej: 1, // placeholder (JSON mode)
  spep: 1, // active-high (PN §12.2)
  spdp: 0, // placeholder
  prbp: 0, // placeholder
  os: 0, // session-only optional stop off (PN §9.2)
});

/** The default status report list (@cite EN settings/settings_default.h:84). */
const SR_DEFAULTS = ['line', 'posx', 'posy', 'posz', 'posa', 'feed', 'vel', 'unit', 'coor', 'dist', 'admo', 'frmo', 'momo', 'stat'] as const;

type MachineState = 'initializing' | 'ready' | 'alarm' | 'programStop' | 'programEnd' | 'cycle' | 'shutdown' | 'panic';
type CycleState = 'off' | 'machining';
type MotionState = 'stop' | 'run' | 'hold';
type MotionMode = 'g0' | 'g1' | 'g2' | 'g3' | 'cancel';

interface PoolLine {
  readonly text: string;
  readonly kind: 'ctrl' | 'data';
  readonly overflow: boolean;
  state: 'full' | 'processing';
}

type GetsResult = 'EAGAIN' | 'EOL' | 'DAMAGED' | 'OVERFLOW';
type ReadResult = { readonly line: string; readonly overflow: boolean } | 'damaged' | null;

interface GcodeModel {
  units: 'mm' | 'in';
  distance: 'abs' | 'inc';
  arcDistance: 'abs' | 'inc';
  plane: 17 | 18 | 19;
  coord: number; // 54..59
  motionMode: MotionMode;
  feed: number; // mm/min
  spindleSpeed: number;
  tool: number;
  linenum: number;
  /** cm.gmx.position: where the last queued move ends, machine coordinates. */
  position: Vec;
  g92: Vec;
  g92Enabled: boolean;
}

const ALL_AXES_UNHOMED = (): boolean[] => [false, false, false, false, false, false];

export class TinyGEdgeNextModel implements SimDevice {
  readonly usb = Object.freeze({ vendorId: 0x0403, productId: 0x6015 });
  readonly baudRate = 115200;
  readonly settings: Settings;
  readonly sideEffects: SideEffect[] = [];
  /** Bytes the board lost because they arrived while a persisted write was stalling it (EEPROM). */
  eepromLostBytes = 0;
  /** Persisted settings writes that changed EEPROM (each stalled the board). */
  eepromWrites = 0;
  #eepromBusyUntil = Number.NEGATIVE_INFINITY;
  #eepromTx: number[] = [];
  readonly #options: TinyGModelOptions;
  #io: DeviceIo | undefined;

  // ---- power and boot
  #booted = false;
  #bootTimer: number | undefined;
  #bannerDelayMs = 0;
  #tickTimer: number | undefined;

  // ---- RX ISR and reader state (xio)
  #ring = new RxRing(RX_BUFFER_SIZE);
  #rxInLine = false;
  #xoffSent = false;
  #hostXoff = false;
  #txHeld: number[] = [];
  #rxLost = false;
  #lostOpen = false;
  #lostFirst = -1;
  #lostLast = -1;
  #lineDamaged = false;
  #gapReport = false;
  #partial = '';
  #partialOverflow = false;
  #flushMarked = false;
  #flushMark = -1;
  #pool: PoolLine[] = [];
  #filling = false;
  #charHeld: { text: string } | null = null;
  #linelen = 0;

  // ---- controller flags
  #enquiryRequested = false;
  #jobKillRequested = false;
  #limitAsserted = 0;
  #commMode: 'json' | 'text' = 'json';
  #motionSync: { tid: number | undefined } | null = null;
  #motionSyncRequested: { tid: number | undefined } | null = null;

  // ---- canonical machine
  #machine: MachineState = 'ready';
  #cycle: CycleState = 'off';
  #motionState: MotionState = 'stop';
  #hold: number = HOLD.OFF;
  #programPaused = false;
  #queueFlushRequested = false;
  #queueFlushInput = false;
  #queueFlushInputDue = false;
  #endHoldRequested = false;
  #homed = ALL_AXES_UNHOMED();
  #gm: GcodeModel = EN_FRESH_GCODE();
  #spindle: 'off' | 'cw' | 'ccw' = 'off';
  /** Direction last driven (`spindle_out.ccw`): kept while the spindle is off. */
  #spindleCcw = false;
  #mist = false;
  #flood = false;
  #motorsEnergized = false;
  #motorOffTimer: number | undefined;
  #startupPending = false;
  #startupStarted = 0;
  #motion: Motion;
  #reportsSuppressed = false;
  #lastSr: Record<string, string> = {};
  /** A timed status report request is pending since this time (first request wins), or null. */
  #srRequestAt: number | null = null;
  /** The status report list (`sr_set`), EEPROM-backed: kept across reset and boot. */
  #srList: string[] = [...SR_DEFAULTS];
  /** Writes of the status report list (`{"sr":{...}}`) that changed it. */
  srListWrites = 0;
  /** rt heartbeat interval, whole seconds 1..60 (RAM only, 0 = off; @cite EN runtime.h:15, :28). */
  #hbS = 0;
  #hbTimer: number | undefined;
  /** When the board last went quiet for the heartbeat, or last beat (`rt.hb_quiet_since`, @cite EN runtime.h:29). */
  #hbQuietSince = 0;
  #bootAt = 0;
  /** A G28.2 homing cycle is queued or running (stat 9). */
  #homingCycle = false;
  #lastQr = PLANNER_POOL;

  constructor(options: TinyGModelOptions = {}) {
    this.#options = options;
    this.settings = new Settings(T, EN_DEFAULTS, options.eeprom ?? {});
    this.#motion = this.#newMotion();
  }

  // =====================================================================
  // SimDevice
  // =====================================================================

  attach(io: DeviceIo): void {
    if (this.#io !== undefined) throw new Error('model already attached');
    this.#io = io;
    if ((this.#options.start ?? 'ready') === 'boot') {
      this.#powerUp(true);
    } else {
      this.#powerUp(false);
    }
  }

  /**
   * The USB RX ISR (@cite EN xio/xio_usb.c:193-276). Realtime characters are
   * trapped before the ring-full test, so they act even when the ring is full.
   */
  receive(byte: number, overrun: boolean): void {
    if (!this.#booted) return; // the UART is not initialised yet (model limit: bytes during boot are lost)
    // Any byte in, realtime characters too, restarts the heartbeat interval (@cite EN xio/xio_usb.c:197; runtime.c:57-60).
    this.#hbQuietSince = this.#now();
    if (this.#eepromBusy()) {
      // @behaviour EN-EEPROM-STALL (model): a persisted write stalls the board; bytes sent meanwhile are lost.
      this.eepromLostBytes++;
      this.#event(`byte 0x${byte.toString(16).padStart(2, '0')} lost: EEPROM write in progress`);
      return;
    }
    // @behaviour EN-RT-TRAP
    if (byte === CHAR.RESET) {
      // @behaviour EN-RT-RESET: hw_hard_reset() straight from the ISR (:201-204): interrupts off, the
      // watchdog resets the chip ~15 ms later (@cite EN hardware.c:155-162). A stalled main loop cannot defer it.
      this.#event('^X: hard reset from the RX ISR');
      this.#freezeThenReset();
      return;
    }
    if (byte === CHAR.FEEDHOLD) {
      this.#requestFeedhold(); // :205-208
      this.#wake();
      return;
    }
    if (byte === CHAR.KILL) {
      this.#jobKillRequested = true; // :168-171, raised from the main loop (canonical_machine.c:1879-1882)
      this.#wake();
      return;
    }
    if (!this.#rxInLine && byte === CHAR.FLUSH) {
      // @behaviour EN-RT-FLUSH: line boundary only (:217-225)
      this.#requestQueueFlush();
      if (this.#queueFlushInput) {
        this.#flushMarked = true;
        this.#flushMark = this.#ring.lastStoredSeq;
      }
      this.#wake();
      return;
    }
    if (!this.#rxInLine && byte === CHAR.END_HOLD) {
      this.#requestEndHold(); // :222-225
      this.#wake();
      return;
    }
    if (byte === CHAR.ENQ) {
      this.#enquiryRequested = true; // :226-229
      this.#wake();
      return;
    }
    if (this.settings.num('ex') === 1) {
      // Host flow control toward us (:230-240). EN re-enables TX on XON: no deadlock.
      if (byte === CHAR.XOFF) {
        this.#hostXoff = true;
        return;
      }
      if (byte === CHAR.XON) {
        this.#hostXoff = false;
        this.#drainTx();
        return;
      }
    }
    if (byte === CHAR.CR || byte === CHAR.LF) this.#rxInLine = false;
    else if (byte !== 0x20 && byte !== 0x09) this.#rxInLine = true; // :248-253

    // @behaviour EN-RX-RING
    if (this.#ring.push(byte, overrun)) {
      // @behaviour EN-RX-XOFF (:262-264)
      if (this.settings.num('ex') === 1 && !this.#xoffSent && this.#ring.count > XOFF_HI) {
        this.#xoffSent = true;
        this.#transmit([CHAR.XOFF]);
      }
    } else {
      // @behaviour EN-E162: remember where input was lost (:265-271, :173-189)
      if (!this.#rxLost) {
        this.#rxLost = true;
        this.#lostFirst = this.#ring.lastStoredSeq;
      }
      this.#lostLast = this.#ring.lastStoredSeq;
      if (this.#ring.count === 0) this.#lossAtReader();
    }
    this.#wake();
  }

  injectLimitSwitch(input: number): void {
    // controller_assert_limit_condition() (@cite EN controller.c:487-490)
    this.#limitAsserted = input;
    this.#wake();
  }

  setReportSuppression(on: boolean): void {
    this.#reportsSuppressed = on;
    if (!on) this.#wake();
  }

  resetBoard(): void {
    this.#event('board reset');
    this.#powerUp(true);
  }

  setBannerDelay(extraMs: number): void {
    this.#bannerDelayMs = extraMs;
  }

  // =====================================================================
  // Test-facing inspection and controls
  // =====================================================================

  snapshot(): ModelSnapshot {
    const now = this.#now();
    this.#motion.advance(now);
    return {
      stat: this.#stat(),
      hold: this.#hold,
      machineState: this.#machine,
      cycleState: this.#cycle,
      motionState: this.#motionState,
      spindle: this.#spindle,
      coolant: { mist: this.#mist, flood: this.#flood },
      motorsEnergized: this.#motorsEnergized,
      plannerAvailable: this.#motion.available(),
      rxCount: this.#ring.count,
      homed: [...this.#homed],
      position: this.#motion.position(now),
      motors: this.#motion.motorPosition(now),
      velocity: this.#motion.velocity(now),
      booted: this.#booted,
      srList: [...this.#srList],
    };
  }

  /**
   * Test hook: the machine now stands at `p` (machine coordinates, mm), as
   * if another program had moved it while idle (HIL-1.6 in the test kit).
   * Only an idle model can be moved: a queued or running move would make
   * the jump meaningless.
   */
  setMachinePosition(p: Partial<Record<'x' | 'y' | 'z' | 'a' | 'b' | 'c', number>>): void {
    const now = this.#now();
    if (!this.#motion.runtimeIdle()) throw new Error('setMachinePosition: the model is moving');
    const next = this.#motion.position(now);
    for (const [axis, v] of Object.entries(p)) next[AXES.indexOf(axis as (typeof AXES)[number])] = v;
    this.#motion.setPosition(next);
    this.#gm.position = [...next];
  }

  /** Test hook: mark axes homed at their current position, as a completed G28.2 would (homing is not modelled). */
  setHomed(axes: readonly ('x' | 'y' | 'z' | 'a' | 'b' | 'c')[]): void {
    for (const a of axes) this.#homed[AXES.indexOf(a)] = true;
  }

  // =====================================================================
  // Power, boot, reset
  // =====================================================================

  #powerUp(printBanners: boolean): void {
    const clock = this.#clock();
    if (this.#bootTimer !== undefined) clock.clearTimeout(this.#bootTimer);
    if (this.#tickTimer !== undefined) clock.clearTimeout(this.#tickTimer);
    if (this.#motorOffTimer !== undefined) clock.clearTimeout(this.#motorOffTimer);
    if (this.#hbTimer !== undefined) clock.clearTimeout(this.#hbTimer);
    this.#bootTimer = undefined;
    this.#tickTimer = undefined;
    this.#motorOffTimer = undefined;
    this.#hbTimer = undefined;
    this.#bootAt = this.#now();
    this.#resetRam();
    // EEPROM: a record-0 layout marker other than layout 2 means "not set up": write the defaults
    // (@behaviour EN-EEPROM; @cite EN config.c:214-221, :264-282).
    const fresh = this.settings.eeprom['__layout'] !== 10002;
    if (fresh) {
      this.settings.resetToDefaults();
      this.settings.eeprom['__layout'] = 10002;
      this.#storeSrList(this.#options.srList ?? SR_DEFAULTS);
    } else {
      this.settings.load();
      this.#loadSrList();
    }
    if (!printBanners) {
      this.#booted = true;
      this.#machine = 'ready';
      this.#snapshotSr();
      return;
    }
    this.#booted = false;
    this.#machine = 'initializing';
    const delay = (this.#options.bootMs ?? DEFAULT_BOOT_MS) + this.#bannerDelayMs;
    this.#bootTimer = clock.setTimeout(() => {
      this.#bootTimer = undefined;
      // @behaviour EN-BANNER: bare `sr` banners, always strict (@cite EN report.c:68-100; config.c:233, :281; controller.c:212-216)
      this.#banner(fresh ? 'Initializing configs to default settings' : 'Loading configs from EEPROM');
      this.#machine = 'ready';
      this.#banner('SYSTEM READY');
      this.#booted = true;
      this.#snapshotSr();
    }, delay);
  }

  /** Interrupts off (no motion, no reports, no RX), then the watchdog reset (WDTO_15MS). */
  #freezeThenReset(): void {
    const clock = this.#clock();
    this.#motion.halt(this.#now());
    this.#booted = false;
    if (this.#tickTimer !== undefined) clock.clearTimeout(this.#tickTimer);
    this.#tickTimer = undefined;
    if (this.#hbTimer !== undefined) clock.clearTimeout(this.#hbTimer);
    this.#hbTimer = undefined;
    this.#hbS = 0;
    if (this.#bootTimer !== undefined) clock.clearTimeout(this.#bootTimer);
    this.#bootTimer = clock.setTimeout(() => this.#powerUp(true), WATCHDOG_RESET_MS);
  }

  #resetRam(): void {
    this.#ring = new RxRing(RX_BUFFER_SIZE);
    this.#rxInLine = false;
    this.#xoffSent = false;
    this.#hostXoff = false;
    this.#txHeld = [];
    this.#rxLost = false;
    this.#lostOpen = false;
    this.#lineDamaged = false;
    this.#gapReport = false;
    this.#partial = '';
    this.#partialOverflow = false;
    this.#flushMarked = false;
    this.#pool = [];
    this.#filling = false;
    this.#charHeld = null;
    this.#linelen = 0;
    this.#enquiryRequested = false;
    this.#jobKillRequested = false;
    this.#limitAsserted = 0;
    this.#commMode = 'json';
    this.#motionSync = null;
    this.#motionSyncRequested = null;
    this.#cycle = 'off';
    this.#motionState = 'stop';
    this.#hold = HOLD.OFF;
    this.#programPaused = false;
    this.#queueFlushRequested = false;
    this.#queueFlushInput = false;
    this.#queueFlushInputDue = false;
    this.#endHoldRequested = false;
    this.#homed = ALL_AXES_UNHOMED();
    this.#gm = EN_FRESH_GCODE();
    this.#spindle = 'off';
    this.#spindleCcw = false;
    this.#mist = false;
    this.#flood = false;
    this.#motorsEnergized = false;
    this.#startupPending = false;
    this.#motion = this.#newMotion();
    this.#srRequestAt = null;
    this.#hbS = 0;
    this.#homingCycle = false;
    this.#lastQr = PLANNER_POOL;
  }

  // =====================================================================
  // Scheduling: the main loop runs while there is work
  // =====================================================================

  #wake(): void {
    if (this.#tickTimer !== undefined || !this.#booted) return;
    this.#tickTimer = this.#clock().setTimeout(() => this.#tick(), 0);
  }

  #tick(): void {
    this.#tickTimer = undefined;
    if (!this.#booted) return;
    if (this.#eepromBusy()) {
      // The main loop is stalled until the EEPROM write ends.
      this.#tickTimer = this.#clock().setTimeout(() => this.#tick(), Math.max(0, this.#eepromBusyUntil - this.#now()));
      return;
    }
    for (let i = 0; i < 256; i++) {
      if (!this.#pass()) break;
    }
    if (this.#busy()) this.#tickTimer = this.#clock().setTimeout(() => this.#tick(), TICK_MS);
    else this.#scheduleHeartbeat();
  }

  /** While idle with a heartbeat on, wake the loop when the next `{"hb":...}` line is due. */
  #scheduleHeartbeat(): void {
    if (this.#hbS <= 0) return;
    const clock = this.#clock();
    if (this.#hbTimer !== undefined) clock.clearTimeout(this.#hbTimer);
    const due = Math.max(0, this.#hbQuietSince + this.#hbS * 1000 - this.#now());
    this.#hbTimer = clock.setTimeout(() => {
      this.#hbTimer = undefined;
      this.#wake();
    }, due);
  }

  /** Anything that needs the loop to keep running. */
  #busy(): boolean {
    return (
      this.#ring.count > 0 ||
      this.#pool.length > 0 ||
      this.#charHeld !== null ||
      this.#gapReport ||
      this.#motion.queue.length > 0 ||
      this.#motion.current() !== null ||
      (this.#hold !== HOLD.OFF && this.#hold !== HOLD.HOLD) ||
      this.#queueFlushRequested ||
      this.#queueFlushInput ||
      this.#queueFlushInputDue ||
      this.#endHoldRequested ||
      this.#jobKillRequested ||
      this.#enquiryRequested ||
      this.#limitAsserted !== 0 ||
      this.#motionSync !== null ||
      this.#startupPending ||
      this.#srRequestAt !== null ||
      this.#srDiffers()
    );
  }

  /**
   * One pass of `_controller_HSM()` (@cite EN controller.c:157-204). A
   * routine returning EAGAIN ends the pass, so lower routines wait. Returns
   * true if anything happened.
   */
  #pass(): boolean {
    const before = this.#progress;
    const now = this.#now();
    this.#motion.advance(now);
    this.#enquiryHandler();
    this.#limitSwitchHandler();
    this.#startupCallback(now);
    this.#dispatchControl();
    this.#heartbeatCallback(now);
    this.#statusReportCallback(now);
    this.#queueReportCallback();
    this.#feedholdSequencing(now);
    this.#motion.advance(now);
    if (!this.#syncToMotion()) return this.#progress !== before;
    // @behaviour EN-PLANNER: a line is read only with 12 free buffers (@cite EN controller.c:619-625)
    if (this.#motion.available() < PLANNER_HEADROOM) return this.#progress !== before;
    this.#dispatchCommand();
    return this.#progress !== before;
  }

  #progress = 0;

  // =====================================================================
  // Controller routines
  // =====================================================================

  #enquiryHandler(): void {
    if (!this.#enquiryRequested) return;
    this.#enquiryRequested = false;
    // @behaviour EN-RT-ENQ: answered from the main loop (@cite EN controller.c:541-547)
    this.#println('{"ack":true}');
  }

  #limitSwitchHandler(): void {
    // @behaviour EN-LIMIT (@cite EN controller.c:492-513)
    if (this.#machine === 'alarm' || this.#machine === 'panic' || this.#machine === 'shutdown') return;
    if (this.#limitAsserted === 0) return;
    const input = this.#limitAsserted;
    this.#limitAsserted = 0;
    this.#alarm(ST('LIMIT_SWITCH_HIT'), `input ${input}`);
    this.#homed = ALL_AXES_UNHOMED();
    this.#progress++;
  }

  #startupCallback(now: number): void {
    // @behaviour EN-STARTUP-DELAY (@cite EN planner.c:471-486)
    if (this.#startupPending && this.#isAlarmed() === 0 && this.#hold === HOLD.OFF && now - this.#startupStarted >= PLANNER_STARTUP_MS) {
      this.#startupPending = false;
      this.#motion.advance(now);
      this.#progress++;
    }
  }

  #dispatchControl(): void {
    if (this.#queueFlushInput || this.#queueFlushInputDue) return; // :312-314 (E146)
    this.#dispatchFrom(this.#readline('ctrl'));
  }

  #dispatchCommand(): void {
    if (this.#queueFlushInput || this.#queueFlushInputDue) return; // :288-290
    this.#dispatchFrom(this.#readline('both'));
  }

  #dispatchFrom(read: ReadResult): void {
    if (read === null) return;
    this.#progress++;
    if (read === 'damaged') {
      // @behaviour EN-E162: a line that lost bytes never runs; the first raises ALARM 13 (@cite EN controller.c:261-271)
      this.#alarm(ST('BUFFER_FULL'), 'input lost');
      this.#respond(ST('BUFFER_FULL'), {}, undefined);
      return;
    }
    if (read.overflow) {
      // @behaviour EN-OVERLONG: one error, never run, no alarm (@cite EN controller.c:244-253)
      this.#respond(ST('INPUT_EXCEEDS_MAX_LENGTH'), {}, undefined);
      return;
    }
    this.#dispatchKernel(read.line);
  }

  /** `_dispatch_kernel()` (@cite EN controller.c:358-421). */
  #dispatchKernel(raw: string): void {
    let line = raw.replace(/^[ \t"]+/, '');
    // @behaviour EN-TEXT-MODE: a stray leading `?` is stripped and the rest runs (E053, :367-371)
    if (line.startsWith('?') && line.length > 1) line = line.slice(1);
    const c = line[0];
    if (c === undefined) {
      if (this.#commMode === 'text') this.#textPrompt();
      return;
    }
    if (c === '!') this.#requestFeedhold();
    else if (c === '~') this.#requestEndHold();
    else if (c === '%') this.#requestQueueFlush();
    else if (c === '\x05') this.#enquiryRequested = true;
    else if (c === '{') {
      this.#commMode = 'json';
      this.#jsonParser(line);
    } else if ('$?Hh'.includes(c)) {
      // @behaviour EN-TEXT-MODE: `$ ? H h` switch to text mode (:390-393)
      this.#commMode = 'text';
      this.#textPrompt(); // the text command itself is not executed (LIM-TEXT)
    } else if (this.#commMode === 'text') {
      this.#gcodeParser(line);
      this.#textPrompt();
    } else {
      const status = this.#gcodeParser(line);
      // controller_defer_motion_response(): an accepted M400 answers when drained (@cite EN controller.c:575-584)
      if (this.#motionSyncRequested !== null && status !== 0) this.#motionSyncRequested = null;
      if (this.#motionSyncRequested === null) this.#respondGcode(status, line);
    }
    if (this.#motionSyncRequested !== null) {
      this.#motionSync = this.#motionSyncRequested;
      this.#motionSyncRequested = null;
    }
  }

  /** `_sync_to_motion()`: M400 holds the next data line until drained (@cite EN controller.c:586-617). */
  #syncToMotion(): boolean {
    if (this.#motionSync === null) return true;
    const alarmed = this.#isAlarmed();
    const busy = this.#motion.queue.length > 0 || !this.#motion.runtimeIdle();
    if (alarmed === 0 && busy) return false;
    // @behaviour EN-M400
    const sync = this.#motionSync;
    this.#motionSync = null;
    this.#respond(alarmed, { gc: 'M400' }, sync.tid, true);
    this.#progress++;
    return true;
  }

  // =====================================================================
  // Line reading (xio)
  // =====================================================================

  /** `readline()`: line mode or character mode by `rxm` (@cite EN xio.c:342-385). */
  #readline(flags: 'ctrl' | 'both'): ReadResult {
    if (this.settings.num('rxm') === 1) return this.#readlineLineMode(flags);
    return this.#readlineCharMode(flags);
  }

  /**
   * @behaviour EN-RX-LINEMODE: `_readline_linemode()` (@cite EN xio.c:862-921).
   * Control lines are served before data lines (@cite EN xio.c:735-771).
   */
  #readlineLineMode(flags: 'ctrl' | 'both'): ReadResult {
    // 1. free the PROCESSING buffer
    const processing = this.#pool.findIndex((l) => l.state === 'processing');
    if (processing >= 0) this.#pool.splice(processing, 1);
    // 2. resume a filling buffer (no more characters: go straight to step 6)
    let fill = true;
    if (this.#filling) {
      const status = this.#gets();
      if (status === 'EAGAIN') fill = false;
      else {
        this.#filling = false;
        if (status === 'DAMAGED') return 'damaged';
        this.#postLine(this.#takePartial(), status === 'OVERFLOW');
      }
    }
    // 3-5. take a free buffer and fill it
    if (fill && this.#allocateBuffer()) {
      this.#filling = true;
      const status = this.#gets();
      if (status !== 'EAGAIN') {
        this.#filling = false;
        if (status === 'DAMAGED') return 'damaged';
        this.#postLine(this.#takePartial(), status === 'OVERFLOW');
      }
    }
    // 6. next buffer to process: control first, then data
    const ctrl = this.#pool.find((l) => l.state === 'full' && l.kind === 'ctrl');
    const pick = ctrl ?? (flags === 'both' ? this.#pool.find((l) => l.state === 'full' && l.kind === 'data') : undefined);
    if (pick === undefined) return null;
    pick.state = 'processing';
    return { line: pick.text, overflow: pick.overflow };
  }

  #allocateBuffer(): boolean {
    const used = this.#pool.length;
    if (used >= RX_HEADERS) return false;
    const bytes = this.#pool.reduce((n, l) => n + l.text.length + 1, 0);
    return RX_POOL_SIZE - bytes > RX_REQUESTED_SIZE;
  }

  /** Free line headers, as footer revision 3 reports them (@cite EN xio.c:502). */
  #freeHeaders(): number {
    return RX_HEADERS - this.#pool.length - (this.#filling ? 1 : 0);
  }

  #postLine(text: string, overflow: boolean): void {
    // _post_buffer() drops blank lines; an overlong line is posted flagged (@cite EN xio.c:599-629, :723-733)
    const trimmed = text.replace(/^[\x00-\x20]+/, '');
    if (trimmed === '' && !overflow) return;
    this.#pool.push({ text: trimmed, kind: classifyLine(trimmed), overflow, state: 'full' });
  }

  /** `_readline_charmode()` (@cite EN xio.c:971-1020): a data line read while only control is wanted is held. */
  #readlineCharMode(flags: 'ctrl' | 'both'): ReadResult {
    // E164: character-mode footers report every byte read since the previous reply, blank lines included
    // (@cite EN controller.c:280-287). A line counts when readline hands it over.
    if (this.#charHeld !== null) {
      if (flags !== 'both') return null;
      const held = this.#charHeld;
      this.#charHeld = null;
      this.#linelen += held.text.length + 1;
      return { line: held.text, overflow: false };
    }
    const status = this.#gets();
    if (status === 'EAGAIN') return null;
    if (status === 'DAMAGED') return 'damaged'; // a damaged line has no length (@cite EN xio.c:987-991)
    const text = this.#takePartial();
    if (status === 'OVERFLOW') {
      this.#linelen += text.length + 1;
      return { line: text, overflow: true };
    }
    if (text === '' || classifyLine(text) === 'ctrl' || flags === 'both') {
      this.#linelen += text.length + 1;
      return text === '' ? null : { line: text, overflow: false }; // a blank line is counted and gets no reply
    }
    this.#charHeld = { text };
    return null;
  }

  #takePartial(): string {
    const t = this.#partial;
    this.#partial = '';
    this.#partialOverflow = false;
    return t;
  }

  /**
   * `_gets_helper()` (@cite EN xio/xio_usart.c:263-372): read characters
   * until a line end, marking lines that lost bytes (E162).
   */
  #gets(): GetsResult {
    for (;;) {
      if (this.#gapReport) {
        this.#gapReport = false;
        this.#partial = '';
        return 'DAMAGED';
      }
      const atMark = this.#flushMarked && this.#ring.headSeq() !== undefined && (this.#ring.headSeq() as number) > this.#flushMark;
      if (atMark || this.#ring.count === 0) return 'EAGAIN';
      const { byte, seq } = this.#ring.shift() as { byte: number; seq: number };
      this.#flow();
      let lostOpenNow = false;
      let lostCloseNow = false;
      let lostInside = false;
      if (this.#rxLost && !this.#lostOpen && seq === this.#lostFirst) {
        this.#lostOpen = true;
        lostOpenNow = true;
      }
      if (this.#lostOpen) {
        lostInside = true;
        if (seq === this.#lostLast) {
          this.#lostOpen = false;
          this.#rxLost = false;
          lostCloseNow = true;
        }
      }
      const eol = byte === CHAR.CR || byte === CHAR.LF;
      const gap = lostOpenNow || lostCloseNow;
      if (lostInside && (!lostOpenNow || !eol)) this.#lineDamaged = true;
      if (gap && !eol) {
        this.#partial = '';
        this.#lineDamaged = true;
        return 'DAMAGED';
      }
      const damaged = this.#lineDamaged;
      if (this.#partialOverflow || this.#partial.length >= RX_REQUESTED_SIZE) {
        this.#partialOverflow = true;
        if (!eol) continue; // drain the rest of an overlong line (E087)
        this.#partial = this.#partial.slice(0, RX_REQUESTED_SIZE - 1);
        this.#lineDamaged = gap;
        this.#gapReport = gap && !damaged;
        return damaged ? 'DAMAGED' : 'OVERFLOW';
      }
      if (eol) {
        this.#lineDamaged = gap;
        this.#gapReport = gap && !damaged;
        return damaged ? 'DAMAGED' : 'EOL';
      }
      this.#partial += String.fromCharCode(byte);
    }
  }

  /**
   * A loss with nothing left in the ring (only a forced-overrun fault can do
   * this; a real overrun needs a full ring): the reader is told at once, as
   * the firmware would be at the last kept byte.
   */
  #lossAtReader(): void {
    this.#rxLost = false;
    if (this.#partial.length > 0 || this.#filling) {
      this.#gapReport = true;
      this.#lineDamaged = true;
    } else {
      this.#gapReport = !this.#lineDamaged;
      this.#lineDamaged = true;
    }
  }

  /** XON once the ring drains below the low-water mark (x_flow). */
  #flow(): void {
    if (this.#xoffSent && this.#ring.count < XOFF_LO) {
      this.#xoffSent = false;
      this.#transmit([CHAR.XON]);
    }
  }

  // =====================================================================
  // Canonical machine
  // =====================================================================

  /** `cm_get_combined_state()` (@cite EN canonical_machine.c:184-220); @behaviour EN-STAT */
  #stat(): number {
    switch (this.#machine) {
      case 'initializing':
        return 0;
      case 'ready':
        return 1;
      case 'alarm':
        return 2;
      case 'programStop':
        return 3;
      case 'programEnd':
        return 4;
      case 'shutdown':
        return 12;
      case 'panic':
        return 13;
      case 'cycle':
        // COMBINED_HOMING while a homing cycle runs (model limit LIM-EN-HOMING)
        return this.#motionState === 'hold' ? 6 : this.#homingCycle ? 9 : 5;
    }
  }

  /** `cm_is_alarmed()` (@cite EN canonical_machine.c:746-752). */
  #isAlarmed(): number {
    if (this.#machine === 'alarm') return ST('COMMAND_REJECTED_BY_ALARM');
    if (this.#machine === 'panic') return ST('COMMAND_REJECTED_BY_PANIC');
    if (this.#machine === 'shutdown') return ST('COMMAND_REJECTED_BY_SHUTDOWN');
    return 0;
  }

  /**
   * `cm_alarm()` (@cite EN canonical_machine.c:810-855). @behaviour EN-ALARM
   * Idle (nothing moving, incl. a dwell): HOLD at once and a stepper reset
   * stops the dwell (E044). Moving: feedhold plus planner flush. Either way
   * the spindle and coolant go off immediately (E019) and host input is kept
   * to be rejected line by line (E145).
   */
  #alarm(status: number, msg: string): void {
    if (this.#machine === 'alarm' || this.#machine === 'panic' || this.#machine === 'shutdown') return;
    this.#machine = 'alarm';
    this.#homingCycle = false;
    const now = this.#now();
    this.#motion.advance(now);
    const idle = this.#motionState === 'stop' && this.#hold === HOLD.OFF;
    if (idle) {
      const segmentInFlight = this.#motion.executingMove();
      this.#motionState = 'hold';
      this.#hold = HOLD.HOLD;
      if (!segmentInFlight) this.#motion.halt(now);
      this.#queueFlushRequested = true;
    } else {
      this.#requestFeedhold();
      this.#requestPlannerFlush();
    }
    this.#spindleReset();
    this.#coolantOff();
    this.#exception(status, msg);
    this.#progress++;
  }

  /** `cm_clear()` (@cite EN canonical_machine.c:711-740). */
  #clear(): void {
    if (this.#machine === 'alarm') {
      this.#machine = 'programStop';
      const drained = this.#motion.queue.length === 0 && this.#motion.runtimeIdle();
      if (drained) {
        if (this.#hold !== HOLD.OFF) {
          this.#endHoldRequested = false;
          this.#exitHoldState();
        }
        this.#cycleEnd();
      }
      this.#sideEffect('alarm-cleared', 'clear');
    } else if (this.#machine === 'shutdown') {
      // @behaviour EN-SHUTDOWN: {clear} exits SHUTDOWN (E045)
      this.#machine = 'ready';
      this.#sideEffect('alarm-cleared', 'clear');
    }
  }

  /** `cm_shutdown()` (@cite EN canonical_machine.c:874-892). */
  #shutdown(status: number, msg: string): void {
    if (this.#machine === 'shutdown' || this.#machine === 'panic') return;
    this.#haltMotion();
    this.#spindleReset();
    this.#coolantOff();
    this.#queueFlush();
    this.#homed = ALL_AXES_UNHOMED();
    this.#machine = 'shutdown';
    this.#exception(status, msg);
  }

  /** `cm_panic()` (@cite EN canonical_machine.c:912-923). @behaviour EN-PANIC: only ^X leaves it. */
  #panic(status: number, msg: string): void {
    if (this.#machine === 'panic') return;
    this.#haltMotion();
    this.#spindleReset();
    this.#coolantOff();
    this.#queueFlush();
    this.#machine = 'panic';
    this.#exception(status, msg);
  }

  /** `cm_halt_motion()` (@cite EN canonical_machine.c:770-777). */
  #haltMotion(): void {
    this.#homingCycle = false;
    this.#motion.halt(this.#now());
    this.#cycle = 'off';
    this.#motionState = 'stop';
    this.#hold = HOLD.OFF;
  }

  /**
   * @behaviour EN-RT-FEEDHOLD: `cm_request_feedhold()` honours `!` only while
   * moving; during the 50 ms startup delay it holds at once
   * (@cite EN canonical_machine.c:1789-1795; planner.c:453-469).
   */
  #requestFeedhold(): void {
    if (this.#startupPending) {
      this.#startupPending = false;
      this.#motionState = 'hold';
      this.#hold = HOLD.HOLD;
      this.#progress++;
      return;
    }
    if (this.#hold === HOLD.OFF && this.#motionState !== 'stop') {
      this.#hold = HOLD.REQUESTED;
      this.#progress++;
    }
  }

  #requestEndHold(): void {
    if (this.#hold !== HOLD.OFF) this.#endHoldRequested = true; // @cite EN canonical_machine.c:1797-1802
  }

  /** `cm_request_queue_flush()` (@cite EN canonical_machine.c:1804-1819). */
  #requestQueueFlush(): void {
    this.#requestPlannerFlush();
    if (this.#queueFlushRequested) {
      this.#queueFlushInput = true;
      this.#sideEffect('queue-flush', '%');
    }
  }

  #requestPlannerFlush(): void {
    if (this.#hold !== HOLD.OFF && !this.#queueFlushRequested) this.#queueFlushRequested = true;
  }

  /** `cm_feedhold_sequencing_callback()` (@cite EN canonical_machine.c:1877-1896). */
  #feedholdSequencing(now: number): void {
    if (this.#jobKillRequested) {
      this.#jobKillRequested = false;
      // @behaviour EN-RT-KILL: ^D is ALARM 207 (@cite EN canonical_machine.c:1879-1882)
      this.#alarm(ST('KILL_JOB'), 'job kill');
    }
    if (this.#hold === HOLD.REQUESTED || this.#hold === HOLD.SYNC) this.#startHold(now);
    if (this.#queueFlushRequested) this.#runRequestedQueueFlush(now);
    this.#serviceInputFlush();
    if (this.#endHoldRequested && !this.#queueFlushRequested) this.#endHold(now);
  }

  /** `cm_start_hold()` (@cite EN canonical_machine.c:1904-1926). */
  #startHold(now: number): void {
    const runnable = this.#motion.queue.length > 0;
    if (this.#hold === HOLD.REQUESTED && runnable) {
      this.#motionState = 'hold';
      this.#hold = HOLD.SYNC;
      const how = this.#motion.startHold(now, this.#options.holdDecelMs ?? DEFAULT_HOLD_DECEL_MS);
      if (how === 'decel') this.#hold = HOLD.DECEL_TO_ZERO;
      else if (how === 'idle') this.#hold = HOLD.HOLD;
      this.#progress++;
    } else if (!runnable && this.#motion.runtimeIdle()) {
      this.#motionState = 'hold';
      this.#hold = HOLD.HOLD;
      this.#progress++;
    }
  }

  /** `_run_requested_queue_flush()` (@cite EN canonical_machine.c:1861-1875). */
  #runRequestedQueueFlush(now: number): void {
    if (!this.#motion.runtimeIdle() || (this.#hold !== HOLD.OFF && this.#hold !== HOLD.REQUESTED && this.#hold !== HOLD.HOLD)) return;
    if (this.#queueFlushInput) {
      this.#queueFlushInput = false;
      this.#queueFlushInputDue = true;
    }
    this.#serviceInputFlush();
    this.#queueFlush(now);
    if (this.#hold === HOLD.REQUESTED) {
      this.#hold = HOLD.OFF;
      this.#endHoldRequested = false;
    }
  }

  /** `cm_queue_flush()` (@cite EN canonical_machine.c:2000-2025). */
  #queueFlush(now = this.#now()): void {
    if (!this.#motion.runtimeIdle()) return;
    this.#motion.flush(now);
    // A flushed homing cycle ends: axes not yet homed stay unhomed (model limit LIM-EN-HOMING).
    this.#homingCycle = false;
    this.#startupPending = false; // mp_init_buffers() (@cite EN planner.c:400-401)
    this.#motionState = 'stop'; // mp_flush_planner() (@cite EN planner.c:154-160)
    this.#gm.position = this.#motion.position(now);
    if (this.#hold === HOLD.HOLD) this.#endHold(now);
    if (this.#queueFlushInput) {
      this.#queueFlushInput = false;
      this.#queueFlushInputDue = true;
    }
    this.#queueFlushRequested = false;
    this.#progress++;
  }

  /** `_service_input_flush()`: drop the host input that came before the `%` (E146, @cite EN xio/xio_usb.c:373-400). */
  #serviceInputFlush(): void {
    if (!this.#queueFlushInputDue) return;
    this.#queueFlushInputDue = false;
    if (this.#flushMarked) this.#ring.dropThrough(this.#flushMark);
    else this.#ring.clear();
    this.#flushMarked = false;
    this.#pool = [];
    this.#filling = false;
    this.#charHeld = null;
    this.#partial = '';
    this.#partialOverflow = false;
    this.#lineDamaged = false;
    this.#gapReport = false;
    this.#rxLost = false;
    this.#lostOpen = false;
    this.#progress++;
  }

  /** `cm_end_hold()` (@cite EN canonical_machine.c:1928-1955). */
  #endHold(now: number): void {
    if (this.#hold !== HOLD.HOLD) return;
    this.#programPaused = false;
    this.#endHoldRequested = false;
    this.#motion.resume(now);
    this.#exitHoldState();
    if (this.#machine === 'alarm') {
      // nothing: outputs stay off
    } else if (this.#motionState === 'stop') {
      this.#cycleEnd();
    } else {
      this.#cycleStart();
    }
    this.#progress++;
  }

  /** `mp_exit_hold_state()` (@cite EN plan_exec.c:388-398). */
  #exitHoldState(): void {
    this.#hold = HOLD.OFF;
    this.#motionState = this.#motion.queue.length > 0 ? 'run' : 'stop';
  }

  /** `cm_cycle_start()` (@cite EN canonical_machine.c:2097-2113). */
  #cycleStart(): void {
    if (this.#programPaused) return;
    this.#machine = 'cycle';
    if (this.#cycle === 'off') this.#cycle = 'machining';
    this.#energizeMotors();
  }

  /**
   * `cm_cycle_end()` (@cite EN canonical_machine.c:2115-2131). No alarm guard:
   * a cycle that ends while ALARM is set finalizes to PROGRAM_STOP
   * (@behaviour EN-CYCLE-END-ALARM).
   */
  #cycleEnd(): void {
    if (this.#programPaused) return;
    if (this.#cycle !== 'off') this.#programFinalize('programStop');
  }

  /** `_exec_program_finalize()` (@cite EN canonical_machine.c:2079-2095). */
  #programFinalize(state: 'programStop' | 'programEnd'): void {
    this.#machine = state;
    this.#motionState = 'stop';
    if (this.#cycle === 'machining') this.#cycle = 'off';
    this.#hold = HOLD.OFF;
    this.#endHoldRequested = false;
    this.#scheduleMotorTimeout();
  }

  #spindleReset(): void {
    this.#spindle = 'off'; // spindle_reset(): immediate, S kept
  }

  /**
   * `sps`: the S in use after the p1csl..p1csh (CW) or p1wsl..p1wsh (CCW) clamp, 0 while off
   * (@cite EN spindle.c:165-166, :223). The model applies S at parse time, not queued (LIM-EN-REPIN).
   */
  #spindleSpeedInUse(): number {
    if (this.#spindle === 'off') return 0;
    const [lo, hi] = this.#spindle === 'cw' ? ['p1csl', 'p1csh'] : ['p1wsl', 'p1wsh'];
    const l = this.settings.get(lo);
    const h = this.settings.get(hi);
    let speed = this.#gm.spindleSpeed;
    if (typeof l === 'number' && speed < l) speed = l;
    if (typeof h === 'number' && speed > h) speed = h;
    return speed;
  }

  #coolantOff(): void {
    this.#mist = false;
    this.#flood = false;
  }

  /** `cm_outputs_inhibited()` (@cite EN canonical_machine.c:1596-1601). @behaviour EN-OUTPUTS-INHIBITED */
  #outputsInhibited(): boolean {
    return this.#machine === 'alarm' || this.#machine === 'shutdown' || this.#machine === 'panic';
  }

  #energizeMotors(): void {
    this.#motorsEnergized = true;
    if (this.#motorOffTimer !== undefined) this.#clock().clearTimeout(this.#motorOffTimer);
    this.#motorOffTimer = undefined;
  }

  /** Motors idle off `mt` seconds after the cycle (model of st_motor_power_callback, powered-in-cycle mode). */
  #scheduleMotorTimeout(): void {
    if (this.#motorOffTimer !== undefined) this.#clock().clearTimeout(this.#motorOffTimer);
    this.#motorOffTimer = this.#clock().setTimeout(() => {
      this.#motorOffTimer = undefined;
      if (this.#cycle === 'off') this.#motorsEnergized = false;
    }, this.settings.num('mt') * 1000);
  }

  #newMotion(): Motion {
    return new Motion(PLANNER_POOL, {
      earliestStart: (block, t) => {
        // A program stop also blocks queued dwells and outputs (@cite EN plan_exec.c:58-62)
        if (this.#programPaused) return null;
        if (this.#hold === HOLD.HOLD) return null;
        if (this.#hold !== HOLD.OFF) {
          // A pending hold is planned by the line executor: dwells and commands still run, and the
          // next move holds before it starts (model of _exec_aline; LIM-HOLD-DWELL).
          if (block.kind !== 'move') return t;
          this.#hold = HOLD.HOLD;
          this.#motionState = 'hold';
          this.#progress++;
          return null;
        }
        if (this.#startupPending) {
          if (this.#isAlarmed() !== 0) return null;
          return Math.max(t, this.#startupStarted + PLANNER_STARTUP_MS);
        }
        return t;
      },
      onStart: (block, t) => {
        if (block.kind === 'move' && this.#startupPending && t >= this.#startupStarted + PLANNER_STARTUP_MS) this.#startupPending = false;
        // Only ALINE blocks set MOTION_RUN (@cite EN plan_exec.c:70-74)
        if (block.kind === 'move' && this.#motionState !== 'run' && this.#motionState !== 'hold') this.#motionState = 'run';
        if (block.kind === 'move') this.#energizeMotors();
      },
      onFree: (_block, empty) => {
        // Every block type frees its buffer and ends the cycle when the planner is empty
        // (@cite EN planner.c:252-259, :283-290)
        if (empty) this.#cycleEnd();
        this.#progress++;
      },
      onHoldReached: () => {
        if (this.#hold === HOLD.OFF) return; // the cycle ended with the last block
        this.#hold = HOLD.HOLD;
        this.#progress++;
      },
      // @behaviour EN-INHIBITED-JOINT: an inhibited axis's joint is 0 on every segment (@cite EN kinematics.c:59)
      inhibited: (axis) => this.settings.num(`${AXES[axis] as string}am`) === AXIS_INHIBITED,
    });
  }

  // =====================================================================
  // G-code
  // =====================================================================

  /** `gc_gcode_parser()` (@cite EN gcode_parser.c:58-89). */
  #gcodeParser(line: string): number {
    const norm = normalizeBlock(line, EN_GCODE_SYNTAX);
    if (norm.block === '') return 0;
    this.#parseClear(norm.block);
    const alarmed = this.#isAlarmed();
    if (alarmed !== 0) return alarmed;
    if (norm.blockDelete) return ST('NOOP');
    const words = readWords(norm.block, EN_GCODE_SYNTAX);
    if (!words.ok) return ST(words.status);
    return this.#parseAndExecute(words.words, norm.block);
  }

  /**
   * `_parse_clear()`: only a standalone M2, M02, M30 (optionally after N<k>)
   * clears ALARM (@cite EN gcode_parser.c:193-206). @behaviour EN-M2-CLEARS-ALARM
   */
  #parseClear(block: string): void {
    if (this.#machine !== 'alarm') return;
    let s = block;
    if (s.startsWith('N')) {
      const m = /^N(\d+)/.exec(s);
      if (m === null) return;
      s = s.slice(m[0].length);
    }
    if (s === 'M2' || s === 'M02' || s === 'M30') this.#clear();
  }

  /** `_parse_gcode_block()` + `_validate_gcode_block()` + `_execute_gcode_block()` (@cite EN gcode_parser.c:292-724). */
  #parseAndExecute(words: readonly Word[], block: string): number {
    const g: GcodeInput = { target: [undefined, undefined, undefined, undefined, undefined, undefined], offsets: [undefined, undefined, undefined] };
    const modal = new Set<string>();
    const setModal = (group: string): boolean => {
      if (modal.has(group)) return false;
      modal.add(group);
      return true;
    };
    for (const w of words) {
      const v = w.value;
      switch (w.letter) {
        case 'G': {
          if (!(v >= 0 && v <= 999)) return ST('GCODE_COMMAND_UNSUPPORTED');
          const int = Math.trunc(v);
          const sub = Math.round((v - int) * 10);
          if (w.decimals > 1 || (w.decimals === 1 && ![28, 30, 38, 43, 61, 90, 91, 92].includes(int))) return ST('GCODE_COMMAND_UNSUPPORTED'); // E150
          const code = w.decimals === 1 ? `${int}.${sub}` : `${int}`;
          const motion: Record<string, MotionMode> = { '0': 'g0', '1': 'g1', '2': 'g2', '3': 'g3' };
          if (code in motion) {
            if (!setModal('G1')) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.motion = motion[code] as MotionMode;
          } else if (code === '4') {
            if (g.nextAction !== undefined) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.nextAction = 'dwell';
          } else if (code === '17' || code === '18' || code === '19') {
            if (!setModal('G2')) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.plane = Number(code) as 17 | 18 | 19;
          } else if (code === '20' || code === '21') {
            if (!setModal('G6')) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.units = code === '20' ? 'in' : 'mm';
          } else if (code === '40' || code === '49' || code === '61' || code === '61.1' || code === '64' || code === '94') {
            // modal state the coarse model does not act on (cutter comp off, path control, feed mode G94)
          } else if (code === '53') {
            g.absoluteOverride = true;
          } else if (['54', '55', '56', '57', '58', '59'].includes(code)) {
            if (!setModal('G12')) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.coord = Number(code);
          } else if (code === '80') {
            g.cancel = true;
          } else if (code === '90' || code === '91') {
            if (!setModal('G3')) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.distance = code === '90' ? 'abs' : 'inc';
          } else if (code === '90.1' || code === '91.1') {
            if (g.arcDistance !== undefined) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.arcDistance = code === '90.1' ? 'abs' : 'inc';
          } else if (code === '92') {
            if (g.nextAction !== undefined) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.nextAction = 'setOrigin';
          } else if (code === '92.1') {
            if (g.nextAction !== undefined) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.nextAction = 'resetOrigin';
          } else if (code === '10') {
            // G10 L2 / L20 Pn: set a coordinate system's offset (model limit LIM-EN-G10)
            if (g.nextAction !== undefined) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.nextAction = 'setCoord';
          } else if (code === '28.2' || code === '28.3') {
            if (g.nextAction !== undefined) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.nextAction = code === '28.2' ? 'homing' : 'setAbsoluteOrigin';
          } else if (['28', '28.1', '28.4', '30', '30.1', '38.2', '43.1', '92.2', '92.3', '93'].includes(code)) {
            throw new ModelGapError(`edge-next G${code}`);
          } else {
            return ST('GCODE_COMMAND_UNSUPPORTED');
          }
          break;
        }
        case 'M': {
          if (!(v >= 0 && v <= 999)) return ST('MCODE_COMMAND_UNSUPPORTED');
          const int = Math.trunc(v);
          if (w.decimals > 1 || (w.decimals === 1 && int !== 201)) return ST('MCODE_COMMAND_UNSUPPORTED');
          if (int === 0 || int === 60 || int === 1 || int === 2 || int === 30) {
            if (!setModal('M4')) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.programFlow = int === 1 ? 'optionalStop' : int === 2 || int === 30 ? 'end' : 'stop';
          } else if (int === 3 || int === 4 || int === 5) {
            if (!setModal('M7')) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.spindle = int === 3 ? 'cw' : int === 4 ? 'ccw' : 'off';
          } else if (int === 6) {
            g.toolChange = true;
          } else if (int === 7 || int === 8) {
            const key = int === 7 ? 'mist' : 'flood';
            if (g[key] === true || g.flood === false) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g[key] = true;
          } else if (int === 9) {
            if (!setModal('M8') || g.mist === true || g.flood === true) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.flood = false;
          } else if (int >= 48 && int <= 51) {
            return ST('MCODE_COMMAND_UNSUPPORTED'); // @cite EN gcode_parser.c:503-506
          } else if (int === 400) {
            // M400 must be alone on the line, an N prefix allowed (@cite EN gcode_parser.c:510-523)
            if (!/^(N\d+)?M400$/.test(block)) return ST('COMMAND_NOT_ACCEPTED');
            if (g.nextAction !== undefined) return ST('GCODE_MODAL_GROUP_VIOLATION');
            g.nextAction = 'motionSync';
          } else if (int === 105 || int === 114 || int === 115 || int === 201) {
            throw new ModelGapError(`edge-next M${int}`);
          } else {
            return ST('MCODE_COMMAND_UNSUPPORTED');
          }
          break;
        }
        case 'T':
          if (!(v >= 0) || v > TOOL_MAX || v !== Math.trunc(v)) return ST('T_WORD_IS_INVALID'); // E154
          g.tool = v;
          break;
        case 'F':
          if (!(v >= 0)) return ST('INPUT_LESS_THAN_MIN_VALUE');
          g.feed = v;
          break;
        case 'P':
          g.p = v;
          break;
        case 'S':
          if (!(v >= 0)) return ST('S_WORD_IS_INVALID');
          g.s = v;
          break;
        case 'X':
        case 'Y':
        case 'Z':
        case 'A':
        case 'B':
        case 'C':
          g.target['XYZABC'.indexOf(w.letter)] = v;
          break;
        case 'I':
        case 'J':
        case 'K':
          g.offsets['IJK'.indexOf(w.letter)] = v;
          break;
        case 'L':
          if (!(v >= 0) || v > 255 || v !== Math.trunc(v)) return ST('L_WORD_IS_INVALID');
          g.l = v;
          break;
        case 'R':
          throw new ModelGapError('edge-next arc radius (R) format');
        case 'N':
          g.linenum = v;
          break;
        default:
          return ST('GCODE_COMMAND_UNSUPPORTED'); // an error for this block, not an alarm (E042)
      }
    }
    return this.#executeBlock(g);
  }

  #executeBlock(g: GcodeInput): number {
    const gm = this.#gm;
    const hasAxes = g.target.some((t) => t !== undefined);
    if (g.cancel === true && g.motion === undefined) g.motion = 'cancel';
    const motionMode = g.motion ?? gm.motionMode;
    if (g.absoluteOverride === true && g.nextAction === undefined && motionMode !== 'g0' && motionMode !== 'g1') return ST('GCODE_G53_WITHOUT_G0_OR_G1');
    if (hasAxes && g.nextAction === undefined && motionMode === 'cancel') return ST('GCODE_AXIS_CANNOT_BE_PRESENT');
    if (g.linenum !== undefined) gm.linenum = g.linenum;
    // @behaviour EN-FEED-UNITS-ORDER: cm_set_feed_rate() runs before cm_set_units_mode(), and _to_millimeters()
    // reads the model's units, so F in a block that also changes G20/G21 is in the PREVIOUS units
    // (@cite EN gcode_parser.c:634-636, :656; canonical_machine.c:1368-1377; canonical_machine.h:42)
    if (g.feed !== undefined) gm.feed = g.feed * this.#unitFactor(undefined);
    if (g.s !== undefined) gm.spindleSpeed = g.s;
    if (g.tool !== undefined) gm.tool = g.tool;
    if (g.toolChange === true) this.#queueCommand('M6 tool change', () => undefined); // stores the tool only (PN §9.3)
    if (g.spindle !== undefined) {
      const mode = g.spindle;
      // Spindle M-codes are queued and run in order; outputs stay off while inhibited (@cite EN spindle.c:182-193)
      this.#queueCommand(`spindle ${mode}`, () => {
        // @behaviour EN-SPINDLE-QUEUED
        this.#spindle = this.#outputsInhibited() ? 'off' : mode;
        if (this.#spindle !== 'off') this.#spindleCcw = this.#spindle === 'ccw';
      });
    }
    if (g.mist !== undefined || g.flood !== undefined) {
      const mist = g.mist;
      const flood = g.flood;
      this.#queueCommand('coolant', () => {
        if (mist === true) this.#mist = !this.#outputsInhibited();
        if (flood === true) this.#flood = !this.#outputsInhibited();
        if (flood === false) {
          this.#flood = false;
          this.#mist = false;
        }
      });
    }
    if (g.nextAction === 'dwell') {
      const p = g.p ?? 0;
      if (p < 0) return ST('P_WORD_IS_NEGATIVE');
      this.#queueBlock({ kind: 'dwell', ms: p * 1000, line: gm.linenum });
    }
    if (g.plane !== undefined) gm.plane = g.plane;
    if (g.units !== undefined) gm.units = g.units;
    if (g.coord !== undefined) gm.coord = g.coord;
    if (g.distance !== undefined) gm.distance = g.distance;
    if (g.arcDistance !== undefined) gm.arcDistance = g.arcDistance;
    let status = 0;
    switch (g.nextAction) {
      case 'motionSync':
        // controller_request_motion_sync() (@cite EN controller.c:562-573)
        if (this.#motionSync !== null) return ST('COMMAND_NOT_ACCEPTED');
        this.#motionSyncRequested = { tid: this.#currentTid };
        break;
      case 'setOrigin': {
        const pos = gm.position;
        for (let i = 0; i < 6; i++) {
          const t = g.target[i];
          if (t !== undefined) gm.g92[i] = (pos[i] as number) - (this.#coordOffset(gm.coord)[i] as number) - t * this.#unitFactor(undefined, i);
        }
        gm.g92Enabled = true;
        break;
      }
      case 'resetOrigin':
        gm.g92 = zeroVec();
        gm.g92Enabled = false;
        break;
      case 'homing':
        status = this.#homing(g);
        break;
      case 'setAbsoluteOrigin':
        this.#setAbsoluteOrigin(g);
        break;
      case 'setCoord': {
        // Model limit LIM-EN-G10 (uncited): L2 sets the offset to the value given; L20 so that the current position reads
        // the value given (EN allows L2 and L20 only, SAFETY §4.7). P1..P6 select G54..G59. Persisted.
        const p = g.p;
        if (g.l !== 2 && g.l !== 20) return ST('GCODE_COMMAND_UNSUPPORTED');
        if (p === undefined || p !== Math.trunc(p) || p < 1 || p > 6) return ST('P_WORD_IS_INVALID');
        const coord = 53 + p;
        const pos = gm.position;
        for (let i = 0; i < 6; i++) {
          const t = g.target[i];
          if (t === undefined) continue;
          const name = `g${coord}${AXES[i] as string}`;
          const value = g.l === 2 ? t * this.#unitFactor(undefined, i) : (pos[i] as number) - t * this.#unitFactor(undefined, i) - (gm.g92Enabled ? (gm.g92[i] as number) : 0);
          this.settings.setRam(name, value);
          this.settings.persist(name);
        }
        break;
      }
      case undefined:
        if (g.motion !== undefined) gm.motionMode = g.motion;
        if (gm.motionMode === 'g2' || gm.motionMode === 'g3') status = this.#arc(g);
        else if (hasAxes && (gm.motionMode === 'g0' || gm.motionMode === 'g1')) status = this.#straight(g, gm.motionMode === 'g0');
        break;
      default:
        break;
    }
    if (status !== 0) return status;
    if (g.programFlow === 'stop') this.#programStop();
    else if (g.programFlow === 'optionalStop') {
      // @behaviour EN-M1-OS: M1 stops only with `os`=1 (@cite EN canonical_machine.c:2147-2150)
      if (this.settings.num('os') === 1) this.#programStop();
    } else if (g.programFlow === 'end') this.#programEnd();
    return 0;
  }

  #unitFactor(units: 'mm' | 'in' | undefined, axis = 0): number {
    if (axis >= 3) return 1; // rotary values in offsets and reports are degrees (E155); targets use modelTarget()
    return (units ?? this.#gm.units) === 'in' ? 25.4 : 1;
  }

  #coordOffset(coord: number): Vec {
    return AXES.map((a) => this.settings.num(`g${coord}${a}`)) as Vec;
  }

  #workOffset(): Vec {
    const c = this.#coordOffset(this.#gm.coord);
    return c.map((v, i) => v + (this.#gm.g92Enabled ? (this.#gm.g92[i] as number) : 0)) as Vec;
  }

  /**
   * `cm_set_model_target()` (@cite EN canonical_machine.c:495-536) with axis modes and rotary radius mode
   * (@behaviour EN-AXIS-MODES). G53 only zeroes the offset (cm_get_active_coord_offset, :314-324);
   * the distance mode still applies, as on the board.
   */
  #resolveTarget(g: GcodeInput): Vec {
    const gm = this.#gm;
    return modelTarget(g.target, {
      units: gm.units,
      distance: gm.distance,
      position: gm.position,
      offset: g.absoluteOverride === true ? zeroVec() : this.#workOffset(),
      num: (k) => this.settings.num(k),
      model: 'edge-next',
    });
  }

  /**
   * Soft limits when `sl`=1 (@cite EN canonical_machine.c:549-567). @behaviour EN-SOFT-LIMITS: every homed
   * axis X..C; an axis whose ends are fp_EQ is skipped; an end at or below DISABLE_SOFT_LIMIT is not tested.
   */
  #testSoftLimits(target: Vec): number {
    if (this.settings.num('sl') !== 1) return 0;
    return softLimitExceeded(target, this.#homed, (k) => this.settings.num(k)) ? ST('SOFT_LIMIT_EXCEEDED') : 0;
  }

  #straight(g: GcodeInput, rapid: boolean): number {
    const gm = this.#gm;
    if (!rapid && !(gm.feed > 0)) return ST('GCODE_FEEDRATE_NOT_SPECIFIED');
    const target = this.#resolveTarget(g);
    const soft = this.#testSoftLimits(target);
    if (soft !== 0) {
      this.#alarm(soft, 'soft limit'); // cm_alarm on a soft limit (@cite EN canonical_machine.c:1240-1243, :1448-1451)
      return soft;
    }
    const from = gm.position;
    const length = distance(from, target);
    if (length === 0) return 0;
    const path: Path = { kind: 'line', from, to: target, length };
    this.#queueMove(path, this.#moveFeed(from, target, rapid));
    return 0;
  }

  /**
   * `cm_arc_feed()` for a G17 center-format arc (@cite EN plan_arc.c:112-271). Called for every block in
   * G2/G3 motion mode with no other next action, as the executor does (@cite EN gcode_parser.c:692-707).
   * @behaviour EN-ARC-COINCIDENT: end points fp_EQ to the start in both plane axes are a full circle; an
   * fp_ZERO angular travel is an alarm (arcs.ts, @cite EN plan_arc.c:324-350).
   * @behaviour EN-ARC-SOFT-LIMITS: the endpoint and the plane extremes the arc actually sweeps are checked,
   * and a violation is an ALARM (@cite EN plan_arc.c:256-265, :577-618).
   */
  #arc(g: GcodeInput): number {
    const gm = this.#gm;
    const g1Word = g.motion !== undefined;
    const offsetWord = g.offsets.some((o) => o !== undefined);
    const pWord = g.p !== undefined;
    // F, P or another non-modal with no offsets in a block without G2/G3: STAT_OK, no motion (@cite EN plan_arc.c:133-137)
    if (!g1Word && !offsetWord) return 0;
    // 'G2 F100': a G2/G3 word with no XYZ axis, offset or P only sets the mode (@cite EN plan_arc.c:139-145)
    if (!(g.target.slice(0, 3).some((t) => t !== undefined) || offsetWord || pWord)) return 0;
    if (fpZERO(gm.feed)) return ST('GCODE_FEEDRATE_NOT_SPECIFIED'); // @cite EN plan_arc.c:153-155
    if (gm.plane !== 17) throw new ModelGapError('edge-next arcs outside G17');
    if (gm.arcDistance === 'abs') throw new ModelGapError('edge-next G90.1 arc centres');
    const fullCircle = g.target[0] === undefined && g.target[1] === undefined; // @cite EN plan_arc.c:176-183
    let rotations = fullCircle ? 1 : 0;
    if (pWord) {
      const p = g.p as number;
      if (p < 0) return ST('P_WORD_IS_NEGATIVE');
      // `floor(P) - P > 0` is never true, so a fractional P is used as given (@cite EN plan_arc.c:201-209)
      rotations = p;
    }
    const from = gm.position;
    const target = this.#resolveTarget(g);
    const f = this.#unitFactor(undefined);
    const i = (g.offsets[0] ?? 0) * f;
    const j = (g.offsets[1] ?? 0) * f;
    const k = (g.offsets[2] ?? 0) * f;
    if (fpZERO(i) && fpZERO(j) && fpZERO(k)) {
      const status = ST('ARC_OFFSETS_MISSING_FOR_SELECTED_PLANE'); // @cite EN plan_arc.c:249-253
      this.#alarm(status, 'arc offsets missing or zero');
      return status;
    }
    if (fpZERO(Math.hypot(i, j))) throw new ModelGapError('edge-next G17 arc with zero I/J radius (K only)');
    const result = enComputeArc({ from, to: target, i, j, clockwise: gm.motionMode === 'g2', fullCircle, rotations });
    if (!result.ok) {
      const status = ST(result.status);
      this.#alarm(status, result.status); // ritorno(_compute_arc()) returns a cm_alarm_P status (@cite EN plan_arc.c:257)
      return status;
    }
    const path = result.path;
    if (this.settings.num('sl') === 1) {
      const end = this.#testSoftLimits(target);
      const ext = end !== 0 ? end : this.#arcExtentViolation(path);
      if (ext !== 0) {
        gm.motionMode = 'cancel';
        this.#alarm(ext, 'arc soft_limits');
        return ext;
      }
    }
    this.#queueMove(path, Math.min(gm.feed, this.settings.num('xfr'), this.settings.num('yfr')));
    return 0;
  }

  /** `_test_arc_soft_limit_plane_axis()` (@cite EN plan_arc.c:589-603): the same skips as cm_test_soft_limits(). */
  #arcExtentViolation(p: ArcPath): number {
    const check = (center: number, axis: number, maxAngle: number): number => {
      const ends = softLimitEnds(axis, this.#homed, (key) => this.settings.num(key));
      if (ends === null) return 0;
      if (ends.max !== null && arcSweeps(p, maxAngle) && center + p.radius > ends.max) return ST('SOFT_LIMIT_EXCEEDED');
      if (ends.min !== null && arcSweeps(p, maxAngle + Math.PI) && center - p.radius < ends.min) return ST('SOFT_LIMIT_EXCEEDED');
      return 0;
    };
    const s0 = check(p.center0, p.axis0, Math.PI / 2);
    return s0 !== 0 ? s0 : check(p.center1, p.axis1, 0);
  }

  #moveFeed(from: Vec, to: Vec, rapid: boolean): number {
    // Coarse: the slowest axis limit (vm for G0, fr for G1) bounds the move's speed.
    const length = distance(from, to);
    let v = rapid ? Infinity : this.#gm.feed;
    for (let i = 0; i < 6; i++) {
      const d = Math.abs((to[i] as number) - (from[i] as number));
      if (d === 0) continue;
      const a = AXES[i] as string;
      const limit = this.settings.num(rapid ? `${a}vm` : `${a}fr`);
      if (limit > 0) v = Math.min(v, (limit * length) / d);
    }
    return Number.isFinite(v) ? v : 1;
  }

  #queueMove(path: Path, feed: number): void {
    // _queue_line(): the cycle starts before the move is queued (@cite EN canonical_machine.c:1192-1212)
    this.#cycleStart();
    const block: Block = { kind: 'move', path, feed, line: this.#gm.linenum };
    // The startup gate opens when the first ALINE meets an empty, idle planner (@cite EN planner.c:494-501)
    if (this.#motion.queue.length === 0 && this.#motion.runtimeIdle() && this.#hold === HOLD.OFF && this.#cycle === 'machining') {
      this.#startupPending = true;
      this.#startupStarted = this.#now();
    }
    this.#queueBlock(block);
    this.#gm.position = [...path.to];
  }

  #queueBlock(block: Block): void {
    this.#motion.push(block);
    // A committed successor ends the startup delay early (@cite EN planner.c:508-511)
    if (this.#startupPending && this.#motion.queue.length >= 2) this.#startupPending = false;
  }

  #queueCommand(label: string, run: () => void): void {
    this.#queueBlock({ kind: 'command', label, line: this.#gm.linenum, run });
  }

  /** `cm_program_stop()` queues `_exec_program_stop` (@cite EN canonical_machine.c:2133-2145). @behaviour EN-M0 */
  #programStop(): void {
    this.#queueCommand('program stop', () => {
      this.#programFinalize('programStop');
      this.#programPaused = true;
      this.#hold = HOLD.HOLD;
      this.#motionState = 'hold';
    });
  }

  /** `cm_program_end()` (@cite EN canonical_machine.c:2152-2193): spindle and coolant off at runtime (@behaviour EN-PROGRAM-END). */
  #programEnd(): void {
    this.#gm.g92Enabled = false;
    this.#gm.g92 = zeroVec();
    this.#gm.motionMode = 'cancel';
    this.#gm.distance = 'abs';
    this.#queueCommand('program end', () => {
      this.#spindleReset();
      this.#coolantOff();
      this.#programFinalize('programEnd');
    });
  }

  // =====================================================================
  // JSON
  // =====================================================================

  #currentTid: number | undefined;

  /** `json_parser()` (@cite EN json_parser.c:239-346). @behaviour EN-JSON-PAIRS: every pair executes. */
  #jsonParser(line: string): void {
    // @behaviour EN-TID: a top-level unsigned `tid` is echoed at the top level, on errors too (@cite EN json_parser.c:107-157, :947-957)
    const tid = scanTid(line);
    this.#currentTid = tid;
    const parsed = parseHostJson(line);
    if (!parsed.ok) {
      this.#respond(ST('JSON_SYNTAX_ERROR'), { err: line }, tid);
      return;
    }
    const body: Record<string, OutValue> = {};
    let status = 0;
    if (parsed.pairs.some(([k]) => k === 'rt')) {
      status = this.#runtime(parsed.pairs.filter(([k]) => k !== 'tid'), body);
      this.#currentTid = undefined;
      this.#respond(status, body, tid);
      return;
    }
    let first = true;
    this.#ramLine = false;
    for (const [key, value] of parsed.pairs) {
      if (key === 'tid') continue;
      const isFirst = first;
      first = false;
      if (key === 'ram') {
        // RAM-only writes (proposed firmware capability, option `ramWrites`; model limit LIM-EN-RAM-WRITES):
        // `ram:1` as the FIRST pair applies the rest of the line without persisting. Anywhere else, or on a
        // build without it, 100; pairs before it have already run.
        if (this.#options.ramWrites === true && isFirst && value === 1) {
          this.#ramLine = true;
          body['ram'] = 1;
          continue;
        }
        status = ST('UNRECOGNIZED_NAME');
        break;
      }
      const r = value === null ? this.#jsonGet(key, body) : this.#jsonSet(key, value, body);
      if (r !== 0) {
        status = r;
        break;
      }
    }
    this.#currentTid = undefined;
    this.#ramLine = false;
    if (this.#motionSyncRequested !== null) {
      // {"gc":"M400"}: an accepted request answers when drained; a failed one now (@cite EN controller.c:575-584)
      if (status === 0) return;
      this.#motionSyncRequested = null;
    }
    this.#respond(status, body, tid);
  }

  /**
   * The rt family (model limit LIM-EN-RT-HB): only as the single pair of a line (a pure envelope).
   * `{"rt":null}` reads hb, qt and up (seconds since power-up, @cite EN runtime.c:179-185); `{"rt":{"hb":N}}`
   * sets the RAM heartbeat interval in whole seconds, 0 off, at most RT_HB_MAX 60 (@cite EN runtime.h:6, :15).
   * An integer above 60 is 110 INPUT_VALUE_RANGE_ERROR and changes nothing, never clamped (@cite EN
   * runtime.c:107-118; error.h:202); a negative is 110 in the number parser (@cite EN util.c:224). A
   * non-integer (1.5, a string) is modelled as 110 too, as the firmware maintainer stated (2026-11-02); read at
   * 93a723b8 the typesafe parser looks to answer 116 VALUE_TYPE_ERROR for those before rt_set_hb runs
   * (@cite EN json_parser.c:678-684; util.c:270), unverified on hardware (the HIL suite only asserts non-zero),
   * see LIM-EN-RT-HB. Setting it restarts the interval (runtime.c:115).
   * A build without it (option `rt: false`) answers 100 (UNRECOGNIZED_NAME).
   */
  #runtime(pairs: readonly (readonly [string, HostValue])[], body: Record<string, OutValue>): number {
    if (this.#options.rt === false || pairs.length !== 1) return ST('UNRECOGNIZED_NAME');
    const value = (pairs[0] as readonly [string, HostValue])[1];
    if (value === null) {
      body['rt'] = { hb: this.#hbS, qt: '', up: this.#uptime() };
      return 0;
    }
    if (typeof value !== 'object') return ST('VALUE_TYPE_ERROR');
    const set: Record<string, OutValue> = {};
    for (const [k, v] of value.pairs) {
      // `unsaved`: the RAM-write capability probe (option `ramWrites`); 100 on a build without it.
      if (k === 'unsaved' && v === null && this.#options.ramWrites === true) {
        set[k] = 0;
        continue;
      }
      if (k !== 'hb') return ST('UNRECOGNIZED_NAME');
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > RT_HB_MAX) return ST('INPUT_VALUE_RANGE_ERROR');
      this.#hbS = v;
      this.#hbQuietSince = this.#now();
      set[k] = v;
    }
    body['rt'] = set;
    return 0;
  }

  /** The line being parsed started with `ram:1` (RAM-only writes). */
  #ramLine = false;

  #jsonGet(key: string, body: Record<string, OutValue>): number {
    const info = token(T, key);
    if (info === undefined) return ST('UNRECOGNIZED_NAME');
    // @behaviour EN-E138: GETs whose getter acts (@cite EN config_app.c:464-505; vendored den.json getters)
    switch (info.get) {
      case 'cm_alrm':
        this.#sideEffect('alarm', `GET ${key}`);
        this.#alarm(ST('ALARM'), 'sent by host');
        return 0;
      case 'cm_shutd':
        this.#sideEffect('shutdown', `GET ${key}`);
        this.#shutdown(ST('SHUTDOWN'), 'sent by host');
        return 0;
      case 'cm_pnic':
        this.#sideEffect('panic', `GET ${key}`);
        this.#panic(ST('PANIC'), 'sent by host');
        return 0;
      case 'cm_clr':
        this.#clear();
        body[key] = null;
        return 0;
      case 'st_set_md':
        // @cite EN stepper.c:1466-1478: NULL de-energizes every motor; Z can fall
        this.#motorsEnergized = false;
        this.#sideEffect('motors-deenergized', `GET ${key}`);
        body[key] = null;
        return 0;
      case 'st_set_me':
        this.#motorsEnergized = true;
        this.#sideEffect('motors-energized', `GET ${key}`);
        body[key] = null;
        return 0;
      case 'rpt_er':
        this.#sideEffect('fake-exception', `GET ${key}`);
        return this.#exception(ST('GENERIC_EXCEPTION_REPORT'), 'bogus exception report'); // @cite EN report.c:162-165
      case 'hw_get_adc3':
        this.#sideEffect('adc-conversion', `GET ${key}`);
        body[key] = fixed(0, 0);
        return 0;
      case 'help_config':
      case 'help_boot':
      case 'help_defa':
      case 'help_test':
        this.#sideEffect('help-text', `GET ${key}`);
        return 0;
      case '_reserved_hold_setting':
        return ST('FUNCTION_IS_STUBBED'); // @behaviour EN-SPPH-STUB (@cite EN config_app.c:65-69)
      case 'sr_get':
        body[key] = this.#srValues(true);
        return 0;
      case 'get_grp':
        body[key] = this.#groupValues(key);
        return 0;
      default: {
        const v = this.#value(key);
        if (v === undefined) throw new ModelGapError(`edge-next GET ${key} (${info.get})`);
        body[key] = v;
        return 0;
      }
    }
  }

  #jsonSet(key: string, value: HostValue, body: Record<string, OutValue>): number {
    const info = token(T, key);
    if (info === undefined) return ST('UNRECOGNIZED_NAME');
    // @behaviour EN-SET-ALARMED: SETs are rejected while alarmed; GETs stay available (@cite EN json_parser.c:335-339)
    const alarmed = this.#isAlarmed();
    if (alarmed !== 0) {
      body[key] = echo(value);
      return alarmed;
    }
    if (info.set === 'gc_run_gc') {
      if (typeof value !== 'string') return ST('VALUE_TYPE_ERROR');
      const status = this.#gcodeParser(value);
      // The gc echo is NV_TYPE_GCODE: dropped below jv=5 on success AND on error (@cite EN json_parser.c:916-930).
      if (this.settings.num('jv') >= 5) body[key] = value;
      return status;
    }
    if (key === 'sr' && typeof value === 'object' && value !== null) return this.#setSrList(value, body);
    if (typeof value === 'object' && value !== null) throw new ModelGapError(`edge-next group SET ${key}`);
    switch (info.set) {
      case 'set_nul':
        body[key] = echo(value);
        return ST('PARAMETER_IS_READ_ONLY');
      case 'set_not':
        return 0;
      case 'cm_clr':
        this.#clear();
        return 0;
      case 'st_set_md':
        this.#motorsEnergized = false;
        this.#sideEffect('motors-deenergized', `SET ${key}`);
        return 0;
      case 'st_set_me':
        this.#motorsEnergized = true;
        this.#sideEffect('motors-energized', `SET ${key}`);
        return 0;
      case 'cm_alrm':
        this.#alarm(ST('ALARM'), 'sent by host');
        return 0;
      case 'cm_shutd':
        this.#shutdown(ST('SHUTDOWN'), 'sent by host');
        return 0;
      case 'cm_pnic':
        this.#panic(ST('PANIC'), 'sent by host');
        return 0;
      case '_reserved_hold_setting':
        return ST('FUNCTION_IS_STUBBED');
      case 'set_baud':
      case 'hw_run_boot':
      case 'set_defaults':
      case 'run_test':
      case 'cm_run_qf':
      case 'cm_run_home':
      case 'sr_set':
      case 'srs_set':
        throw new ModelGapError(`edge-next SET ${key} (${info.set})`);
      default:
        break;
    }
    const n = typeof value === 'number' ? value : typeof value === 'boolean' ? (value ? 1 : 0) : NaN;
    if (Number.isNaN(n)) return ST('VALUE_TYPE_ERROR');
    if (info.set === 'cm_set_am') {
      // Linear axes accept up to AXIS_INHIBITED, rotary up to AXIS_RADIUS (@cite EN canonical_machine.c:2616-2629)
      if (axisModeTooLarge(key, n)) {
        body[key] = echo(value);
        return ST('INPUT_EXCEEDS_MAX_VALUE');
      }
      if (!Number.isInteger(n) || n < 0) throw new ModelGapError(`edge-next SET ${key}=${n} (set_ui8 conversion)`);
    }
    const limit = { set_01: 1, set_012: 2, set_0123: 3, json_set_jv: 5, spindle_set_polarity: 1 }[info.set];
    if (limit !== undefined && n > limit) {
      body[key] = echo(value);
      return ST('INPUT_VALUE_RANGE_ERROR');
    }
    if (info.set === 'spindle_set_polarity') {
      // Refused unless the spindle is off and the planner idle (@cite EN spindle.c:62-81)
      const busy = this.#spindle !== 'off' || this.#motion.queue.length > 0 || !this.#motion.runtimeIdle();
      if (busy) {
        body[key] = echo(value);
        return ST('COMMAND_NOT_ACCEPTED');
      }
    }
    let stored = n;
    if (info.set === 'sr_set_si') stored = Math.max(n, 100); // STATUS_REPORT_MIN_MS (@cite EN settings/settings_default.h:80)
    if (info.set === 'set_flu' && this.#gm.units === 'in') stored = n * 25.4; // @cite EN config_app.c:827-836
    this.settings.setRam(key, stored);
    body[key] = fixed(stored, info.precision);
    // @behaviour EN-SETTINGS-GATE: the RAM value is set, then persisting refuses while a cycle runs: 106 plus an `er`
    // (@cite EN json_parser.c:339-342; persistence.c:88-92)
    if (info.persist && !this.#ramLine) {
      if (this.#cycle !== 'off') return this.#exception(ST('COMMAND_NOT_ACCEPTED'), "Can't save when moving");
      if (this.settings.persist(key)) this.#eepromStall(key);
    }
    return 0;
  }

  /** A readable value, formatted with the token's precision, or undefined when not modelled. */
  #value(key: string): OutValue | undefined {
    const info = token(T, key);
    if (info === undefined) return undefined;
    const now = this.#now();
    this.#motion.advance(now);
    const p = info.precision;
    const axis = AXES.indexOf(key.slice(-1) as 'x');
    switch (info.get) {
      case 'cm_get_stat':
        return this.#stat();
      case 'cm_get_hold':
        return this.#hold;
      case 'cm_get_macs':
        return ['initializing', 'ready', 'alarm', 'programStop', 'programEnd', 'cycle', 'interlock', 'shutdown', 'panic'].indexOf(this.#machine);
      case 'cm_get_cycs':
        return this.#cycle === 'off' ? 0 : 1;
      case 'cm_get_mots':
        return ['stop', 'run', 'hold'].indexOf(this.#motionState);
      case 'cm_get_vel':
        return fixed(this.#motion.velocity(now) / this.#unitFactor(undefined), p);
      case 'cm_get_feed':
        return fixed(this.#gm.feed / this.#unitFactor(undefined), p);
      case 'cm_get_line':
        return this.#motion.line();
      case 'cm_get_pos': {
        const pos = this.#motion.position(now);
        return fixed(((pos[axis] as number) - (this.#workOffset()[axis] as number)) / this.#unitFactor(undefined, axis), p);
      }
      case 'cm_get_mpo':
        return fixed(this.#motion.position(now)[axis] as number, p);
      case 'cm_get_ofs':
        return fixed(this.#workOffset()[axis] as number, p);
      case 'cm_get_unit':
        return this.#gm.units === 'in' ? 0 : 1;
      case 'cm_get_coor':
        return this.#gm.coord - 53;
      case 'cm_get_dist':
        return this.#gm.distance === 'abs' ? 0 : 1;
      case 'cm_get_admo':
        return this.#gm.arcDistance === 'abs' ? 0 : 1;
      case 'cm_get_frmo':
        return 1;
      case 'cm_get_momo':
        return ['g0', 'g1', 'g2', 'g3', 'cancel'].indexOf(this.#gm.motionMode);
      case 'cm_get_toolv':
        return this.#gm.tool;
      case 'cm_get_home':
        return this.#homed.slice(0, 3).every(Boolean) ? 1 : 0;
      case 'qr_get':
        return this.#motion.available();
      case 'get_rx':
        return this.#ring.free;
      // @behaviour EN-SPINDLE-READOUTS: the outputs as last driven by the queued executors, not the model
      // (@cite EN spindle.c:115-117, :219-223; canonical_machine.c:1564-1565, :1570, :1619)
      case 'spindle_get_spe':
        return this.#spindle === 'off' ? 0 : 1;
      case 'spindle_get_spc':
        return this.#spindle === 'off' ? 0 : this.#spindle === 'cw' ? 1 : 2;
      case 'spindle_get_spd':
        return this.#spindleCcw ? 1 : 0;
      case 'spindle_get_sps':
        return fixed(this.#spindleSpeedInUse(), p);
      case 'coolant_get_cof':
        return this.#flood ? 1 : 0;
      case 'coolant_get_com':
        return this.#mist ? 1 : 0;
      case 'hw_get_id':
        return this.#options.id ?? 'SIM-EN-0001';
      case 'hw_get_fstk':
        return 1000; // model placeholder for free stack
      case 'get_legacy_zero':
        return 0;
      default:
        break;
    }
    if (key === 'fb') return fixed(FW_BUILD, p);
    if (key === 'fv') return fixed(FW_VERSION, p);
    if (key === 'hp') return HW_PLATFORM;
    if (key === 'hv') return fixed(HW_VERSION, p);
    if (info.group === 'hom' && axis >= 0) return this.#homed[axis] ? 1 : 0;
    // The active G92 offset, mm (0 while G92 is off); g28/g30 read their (unset, 0) stored positions below.
    if (info.group === 'g92' && axis >= 0) return fixed(this.#gm.g92Enabled ? (this.#gm.g92[axis] as number) : 0, p);
    if (['get_flt', 'get_ui8', 'get_int', 'get_u32', 'get_data', 'cm_get_am'].includes(info.get)) {
      const v = this.settings.get(key);
      if (typeof v === 'number') return fixed(v, p);
      return fixed(0, p);
    }
    return undefined;
  }

  #groupValues(group: string): OutObject {
    const out: Record<string, OutValue> = {};
    for (const name of groupMembers(T, group)) {
      const v = this.#value(name);
      if (v === undefined) continue;
      const k = group !== 'sys' && name.startsWith(group) ? name.slice(group.length) : name;
      out[k] = v;
    }
    return out;
  }

  // =====================================================================
  // Reports
  // =====================================================================

  #srValues(all: boolean): OutObject {
    const out: Record<string, OutValue> = {};
    for (const key of this.#srList) {
      const v = this.#value(key);
      if (v === undefined) continue;
      const rendered = serialize(v);
      if (all || this.#lastSr[key] !== rendered) out[key] = v;
    }
    return out;
  }

  #snapshotSr(): void {
    this.#lastSr = {};
    for (const key of this.#srList) {
      const v = this.#value(key);
      if (v !== undefined) this.#lastSr[key] = serialize(v);
    }
  }

  #srDiffers(): boolean {
    if (this.settings.num('sv') === 0 || this.#reportsSuppressed) return false;
    return Object.keys(this.#srValues(false)).length > 0;
  }

  /**
   * @behaviour EN-SR: filtered status reports (@cite EN settings/settings_default.h:79-84). A change against
   * the values last SENT records one timed request (first request wins: later changes do not move it); the
   * report prints `si` ms after that request and samples the values when it prints, so a state that comes and
   * goes in between never appears (report.c facts, firmware maintainer 2026-11-02; model limit LIM-EN-SR-TIMING).
   */
  #statusReportCallback(now: number): void {
    const sv = this.settings.num('sv');
    if (sv === 0 || this.#reportsSuppressed) {
      this.#srRequestAt = null;
      return;
    }
    if (this.#srRequestAt === null) {
      if (!this.#srDiffers()) return;
      this.#srRequestAt = now;
    }
    if (now < this.#srRequestAt + this.settings.num('si')) return;
    this.#srRequestAt = null;
    const changed = this.#srValues(sv === 2);
    if (Object.keys(changed).length === 0) return;
    for (const [k, v] of Object.entries(changed)) this.#lastSr[k] = serialize(v);
    this.#println(serialize({ sr: changed }, this.#relaxed()));
    this.#progress++;
  }

  /**
   * `{"hb":{...}}` every `hb` seconds while the link and the machine are quiet (model limit LIM-EN-RT-HB;
   * @cite EN runtime.c:54-93). Quiet: JSON mode, no byte in or out (receive and println restart the interval),
   * nothing unread, and the machine stopped with nothing held, flushing or queued (`_machine_quiet`, runtime.c:33-52).
   * Any activity restarts the interval; skipped beats are never made up.
   */
  #heartbeatCallback(now: number): void {
    if (this.#hbS <= 0 || this.#commMode !== 'json' || this.#ring.count > 0 || this.#partial !== '' || !this.#machineQuiet()) {
      this.#hbQuietSince = now;
      return;
    }
    // A small tolerance: the wake timer is due exactly at quietSince + hb, and float rounding must not make the
    // pass see it a hair early and reschedule forever.
    if (now - this.#hbQuietSince < this.#hbS * 1000 - 1e-6) return;
    this.#println(serialize({ hb: { stat: this.#stat(), hold: this.#hold, up: this.#uptime(), qt: '' } }, false));
  }

  /** `_machine_quiet()` (@cite EN runtime.c:37-52): nothing moving, held, flushing or queued. */
  #machineQuiet(): boolean {
    return (
      this.#cycle === 'off' &&
      this.#motionState === 'stop' &&
      this.#hold === HOLD.OFF &&
      !this.#queueFlushRequested &&
      !this.#endHoldRequested &&
      !this.#jobKillRequested &&
      this.#motion.queue.length === 0 &&
      this.#motion.current() === null
    );
  }

  /** Whole seconds since power-up (`SysTickTimer_getValue() / RT_TICKS_PER_SECOND`, @cite EN runtime.c:90, :182). */
  #uptime(): number {
    return Math.max(0, Math.floor((this.#now() - this.#bootAt) / 1000));
  }

  // ---- status report list (EEPROM)

  static readonly #TOKEN_NAMES: readonly string[] = Object.keys(T.tokens);

  #storeSrList(list: readonly string[]): void {
    this.#srList = [...list];
    const ee = this.settings.eeprom;
    for (const k of Object.keys(ee)) if (k.startsWith('__sr')) delete ee[k];
    ee['__srn'] = list.length;
    list.forEach((name, i) => {
      ee[`__sr${i}`] = TinyGEdgeNextModel.#TOKEN_NAMES.indexOf(name);
    });
  }

  #loadSrList(): void {
    const ee = this.settings.eeprom;
    const n = ee['__srn'];
    if (n === undefined) {
      this.#storeSrList(this.#options.srList ?? SR_DEFAULTS);
      return;
    }
    const list: string[] = [];
    for (let i = 0; i < n; i++) {
      const name = TinyGEdgeNextModel.#TOKEN_NAMES[ee[`__sr${i}`] ?? -1];
      if (name !== undefined) list.push(name);
    }
    this.#srList = list;
  }

  /** `sr_set()`: the list is replaced by the keys whose value is true, in order, and persisted (TinyG report.c sr_set; LIM-EN-SR-LIST). */
  #setSrList(value: HostPairs, body: Record<string, OutValue>): number {
    // More than NV_STATUS_REPORT_LEN (30) entries: the closest EN status is INPUT_EXCEEDS_MAX_LENGTH.
    if (value.pairs.length > 30) return ST('INPUT_EXCEEDS_MAX_LENGTH');
    const list: string[] = [];
    for (const [k, v] of value.pairs) {
      if (v !== true || token(T, k) === undefined) return ST('UNRECOGNIZED_NAME');
      list.push(k);
    }
    if (list.length === 0) return ST('INVALID_OR_MALFORMED_COMMAND');
    this.srListWrites++;
    if (this.#ramLine) {
      this.#srList = list; // RAM only: the next reset loads the persisted list again
    } else {
      this.#storeSrList(list);
      this.#eepromStall('sr');
    }
    body['sr'] = this.#srValues(true);
    return 0;
  }

  // ---- homing (model limit LIM-EN-HOMING)

  /**
   * G28.2: every named axis must have exactly one homing switch (mode 1 or 3), a search velocity and a mode
   * other than disabled, else the block fails with HOMING_ERROR_HOMING_INPUT_MISCONFIGURED (246) and nothing
   * moves. No axis named: HOMING_ERROR_BAD_OR_NO_AXIS. Axes home in the firmware order Z, X, Y, A.
   */
  #homing(g: GcodeInput): number {
    const named = [2, 0, 1, 3].filter((i) => g.target[i] !== undefined);
    if (named.length === 0) return ST('HOMING_ERROR_BAD_OR_NO_AXIS');
    const homingBit = (m: number): boolean => (m & 1) === 1 && m !== 4;
    for (const i of named) {
      const a = AXES[i] as string;
      const sn = homingBit(this.settings.num(`${a}sn`));
      const sx = homingBit(this.settings.num(`${a}sx`));
      if (this.settings.num(`${a}am`) === 0 || sn === sx || !(this.settings.num(`${a}sv`) > 0)) return ST('HOMING_ERROR_HOMING_INPUT_MISCONFIGURED');
    }
    this.#homingCycle = true;
    let cur: Vec = [...this.#gm.position];
    for (const i of named) {
      const a = AXES[i] as string;
      const toMin = homingBit(this.settings.num(`${a}sn`));
      const tn = this.settings.num(`${a}tn`);
      const tm = this.settings.num(`${a}tm`);
      const end = toMin ? tn : tm;
      const sign = toMin ? -1 : 1;
      const bound = Math.abs(tm - tn) + Math.max(0, this.settings.num(`${a}lb`));
      const search = Math.min(bound, Math.max(0, sign * (end - (cur[i] as number))));
      if (search > 0) {
        const to = [...cur] as Vec;
        to[i] = (cur[i] as number) + sign * search;
        this.#queueMove({ kind: 'line', from: cur, to, length: search }, this.settings.num(`${a}sv`));
      }
      const homedAt = [...cur] as Vec;
      homedAt[i] = end;
      const last = i === named[named.length - 1];
      this.#queueCommand(`homing ${a}`, () => {
        this.#motion.setPosition(homedAt);
        this.#homed[i] = true;
        if (last) this.#homingCycle = false;
      });
      cur = homedAt;
    }
    this.#gm.position = [...cur];
    return 0;
  }

  /** G28.3: the named axes' machine position is set to the given values and they are marked homed; no motion. */
  #setAbsoluteOrigin(g: GcodeInput): void {
    const values: (number | undefined)[] = g.target.map((t, i) => (t === undefined ? undefined : t * this.#unitFactor(undefined, i)));
    values.forEach((v, i) => {
      if (v !== undefined) this.#gm.position[i] = v;
    });
    this.#queueCommand('set absolute origin', () => {
      const pos = this.#motion.position(this.#now());
      values.forEach((v, i) => {
        if (v === undefined) return;
        pos[i] = v;
        this.#homed[i] = true;
      });
      this.#motion.setPosition(pos);
    });
  }

  #queueReportCallback(): void {
    const qv = this.settings.num('qv');
    if (qv === 0 || this.#reportsSuppressed) return;
    const qr = this.#motion.available();
    if (qr === this.#lastQr) return;
    this.#lastQr = qr;
    this.#println(serialize({ qr }, this.#relaxed()));
    this.#progress++;
  }

  // =====================================================================
  // Output
  // =====================================================================

  #relaxed(): boolean {
    return this.settings.num('js') === 0;
  }

  /**
   * A response line (@cite EN json_parser.c:890-983). @behaviour EN-FOOTER:
   * line mode prints `[3,status,free line headers]`; character mode
   * `[2,status,bytes read since the previous reply]` (E164).
   */
  #respond(status: number, body: OutObject, tid: number | undefined, forceBody = false): void {
    const jv = this.settings.num('jv');
    if (jv === 0) {
      this.#linelen = 0;
      return;
    }
    let shown: OutObject = body;
    if (!forceBody && status === 0 && jv < 3) shown = {};
    const charMode = this.settings.num('rxm') === 0;
    const rev = charMode ? 2 : 3;
    const field3 = charMode ? this.#linelen : this.#freeHeaders();
    if (charMode) this.#linelen = 0;
    const relaxed = this.#relaxed();
    const q = (k: string): string => (relaxed ? k : `"${k}"`);
    const tidPart = tid !== undefined ? `,${q('tid')}:${tid}` : '';
    const line = `{${q('r')}:${serialize(shown, relaxed)}${tidPart},${q('f')}:[${rev},${status},${field3}]}`;
    // @behaviour EN-REPLY-OVERFLOW: a reply that does not fit the 512-byte output buffer loses its body; the
    // line still gets `{"r":{},..}` with its tid and footer, and an OK becomes 13 (@cite EN json_parser.c:973-979,
    // controller.h:32). The command has already run. Model approximation: the line plus LF and NUL must fit.
    if (line.length + 2 > OUTPUT_BUFFER_LEN) {
      const lost = status === 0 ? ST('BUFFER_FULL') : status;
      this.#println(`{${q('r')}:{}${tidPart},${q('f')}:[${rev},${lost},${field3}]}`);
      return;
    }
    this.#println(line);
  }

  #respondGcode(status: number, line: string): void {
    // @behaviour EN-GC-ECHO: the gc echo is NV_TYPE_GCODE, dropped unless jv=5 whatever the status: the filter
    // runs for every response once the machine is not INITIALIZING, and for every error (@cite EN json_parser.c:916-930).
    const jv = this.settings.num('jv');
    const body: Record<string, OutValue> = {};
    if (jv >= 5) body['gc'] = line;
    if (jv >= 4 && this.#gm.linenum > 0 && status === 0) body['n'] = this.#gm.linenum;
    this.#respond(status, body, undefined, true);
  }

  /** `rpt_exception()` (@cite EN report.c:144-159). Returns the status. */
  #exception(status: number, msg: string): number {
    const name = Object.entries(T.status).find(([, c]) => c === status)?.[0] ?? 'ERROR';
    this.#println(serialize({ er: { fb: fixed(FW_BUILD, 2), st: status, msg: `${name} - ${msg}` } }, this.#relaxed()));
    return status;
  }

  #banner(msg: string): void {
    const sr: OutObject = {
      fv: fixed(FW_VERSION, 3),
      fb: fixed(FW_BUILD, 2),
      hp: HW_PLATFORM,
      hv: HW_VERSION,
      id: this.#options.id ?? 'SIM-EN-0001',
      msg,
    };
    this.#println(serialize({ sr }, false));
  }

  #textPrompt(): void {
    // Text-mode output is a model approximation: only "this is text, not JSON" is claimed.
    this.#println(`tinyg [${this.#gm.units}] ok>`);
  }

  #println(s: string): void {
    this.#hbQuietSince = this.#now(); // a byte out restarts the heartbeat interval (@cite EN runtime.c:57-60)
    this.#transmit(Array.from(s + '\n', (ch) => ch.charCodeAt(0)));
    this.#progress++;
  }

  #eepromBusy(): boolean {
    return this.#now() < this.#eepromBusyUntil;
  }

  /** A persisted write changed EEPROM: the board stalls; its answer goes out when the stall ends. */
  #eepromStall(key: string): void {
    const ms = this.#options.eepromWriteMs ?? 0;
    if (ms <= 0) return;
    this.eepromWrites++;
    this.#eepromBusyUntil = this.#now() + ms;
    this.#event(`EEPROM write of ${key}: stalled for ${ms} ms`);
    this.#clock().setTimeout(() => {
      const held = this.#eepromTx;
      this.#eepromTx = [];
      if (held.length > 0) this.#transmit(held);
      this.#wake();
    }, ms);
  }

  #transmit(bytes: number[]): void {
    const io = this.#io;
    if (io === undefined) return;
    if (this.#eepromBusy()) {
      this.#eepromTx.push(...bytes);
      return;
    }
    if (this.#hostXoff && !(bytes.length === 1 && (bytes[0] === CHAR.XON || bytes[0] === CHAR.XOFF))) {
      this.#txHeld.push(...bytes);
      return;
    }
    io.transmit(Uint8Array.from(bytes));
  }

  #drainTx(): void {
    if (this.#txHeld.length === 0) return;
    const held = this.#txHeld;
    this.#txHeld = [];
    this.#transmit(held);
  }

  #sideEffect(what: SideEffect['what'], via: string): void {
    this.sideEffects.push({ t: this.#now(), what, via });
    this.#event(`${what} via ${via}`);
  }

  #event(note: string): void {
    this.#io?.event(note);
  }

  #clock(): DeviceIo['clock'] {
    if (this.#io === undefined) throw new Error('model is not attached to an endpoint');
    return this.#io.clock;
  }

  #now(): number {
    return this.#io?.clock.now() ?? 0;
  }
}

interface GcodeInput {
  motion?: MotionMode;
  cancel?: boolean;
  nextAction?: 'dwell' | 'motionSync' | 'setOrigin' | 'resetOrigin' | 'setCoord' | 'homing' | 'setAbsoluteOrigin';
  l?: number;
  plane?: 17 | 18 | 19;
  units?: 'mm' | 'in';
  coord?: number;
  distance?: 'abs' | 'inc';
  arcDistance?: 'abs' | 'inc';
  absoluteOverride?: boolean;
  programFlow?: 'stop' | 'optionalStop' | 'end';
  spindle?: 'cw' | 'ccw' | 'off';
  mist?: boolean;
  flood?: boolean;
  toolChange?: boolean;
  tool?: number;
  feed?: number;
  p?: number;
  s?: number;
  linenum?: number;
  target: (number | undefined)[];
  offsets: (number | undefined)[];
}

function EN_FRESH_GCODE(): GcodeModel {
  return {
    units: 'mm',
    distance: 'abs',
    arcDistance: 'inc',
    plane: 17,
    coord: 54,
    motionMode: 'cancel', // never start a machine in a motion mode (@cite EN canonical_machine.c:638)
    feed: 0,
    spindleSpeed: 0,
    tool: 0,
    linenum: 0,
    position: zeroVec(),
    g92: zeroVec(),
    g92Enabled: false,
  };
}

/** `_classify_line()` (@cite EN xio.c:698-710): control lines may run while the planner is full. */
export function classifyLine(line: string): 'ctrl' | 'data' {
  let s = line.replace(/^[\x01-\x20\x7f]+/, '');
  if (s === '') return 'ctrl';
  if (s[0] === '?' && s.length > 1) s = s.slice(1);
  if (s[0] === '{') return jsonWrapsGcode(s) ? 'data' : 'ctrl';
  return '$?!~%Hh'.includes(s[0] as string) ? 'ctrl' : 'data';
}

/** `_json_wraps_gcode()` (@cite EN xio.c:640-692), simplified to its top-level `gc` / `txt` test. */
function jsonWrapsGcode(line: string): boolean {
  const parsed = parseHostJson(line);
  if (!parsed.ok) return false;
  return parsed.pairs.some(([k, v]) => (k === 'gc' && v !== null) || (k === 'txt' && typeof v === 'string' && v.startsWith('{')));
}

/** `_scan_tid()` (@cite EN json_parser.c:107-157): a top-level `tid` with a plain uint32 value. */
export function scanTid(line: string): number | undefined {
  const parsed = parseHostJson(line);
  if (!parsed.ok) return undefined;
  for (const [k, v] of parsed.pairs) {
    if (k === 'tid' && typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff) return v;
  }
  return undefined;
}

function echo(v: HostValue): OutValue {
  return typeof v === 'object' && v !== null ? null : v;
}

/**
 * The edge-next G17 center-format arc from the start, end and I/J offsets (mm), with no P word and both
 * plane end points given: `enComputeArc()` (arcs.ts). Throws when the firmware would alarm instead.
 */
export function arcPath(from: Vec, to: Vec, i: number, j: number, clockwise: boolean): ArcPath {
  const result = enComputeArc({ from, to, i, j, clockwise, fullCircle: false, rotations: 0 });
  if (!result.ok) throw new Error(`edge-next would alarm: ${result.status}`);
  return result.path;
}

/** `_arc_sweeps()` (@cite EN plan_arc.c:578-587). */
export function arcSweeps(p: ArcPath, angle: number): boolean {
  const travel = Math.abs(p.sweep);
  if (travel >= 2 * Math.PI) return true;
  const low = p.sweep >= 0 ? p.theta : p.theta + p.sweep;
  let d = angle - low;
  while (d < 0) d += 2 * Math.PI;
  while (d >= 2 * Math.PI) d -= 2 * Math.PI;
  return d <= travel;
}
