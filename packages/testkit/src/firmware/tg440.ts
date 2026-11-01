/**
 * `TinyG440Model`: a behavioural model of stock TinyG master 440.21 (ROADMAP
 * P0-11, RUN_PLAN §8.1), the fallback dialect.
 *
 * "As OLD-TP §7, corrected": M0 does not pause; arcs are not soft-limited;
 * a host XON deadlocks the transmitter; ^X can be deferred. Every
 * `@behaviour <id>` here is listed with its `@cite` (file:line at master
 * d0418390, build 440.21) and `@status` in `behaviours.ts`.
 *
 * Structure follows the firmware:
 * - `receive()` is the USB RX ISR (xio/xio_usb.c:138-192);
 * - `#pass()` is one pass of `_controller_HSM()` (controller.c:151-190);
 * - `#commandDispatch()` is `_command_dispatch()` (controller.c:201-289);
 * - the canonical machine follows canonical_machine.c.
 *
 * DEV ONLY. Nothing in a production bundle may import this (T-S40).
 */
import '../marker.ts';
import type { DeviceIo, SimDevice } from '../device.ts';
import { DEFAULT_BOOT_MS, DEFAULT_HOLD_DECEL_MS, ModelGapError, TICK_MS, type ModelSnapshot, type SideEffect, type TinyGModelOptions } from './common.ts';
import { normalizeBlock, readWords, type GcodeSyntax, type Word } from './gcode.ts';
import { parseHostJson, type HostValue } from './hostJson.ts';
import { AXES, Motion, distance, zeroVec, type Block, type Path, type Vec } from './motion.ts';
import { arcPath } from './edgeNext.ts';
import { fixed, serialize, type OutObject, type OutValue } from './output.ts';
import { RxRing } from './rxRing.ts';
import { Settings, type SettingValue } from './settings.ts';
import { TG_TABLE, groupMembers, statusCode, token } from './table.ts';

const T = TG_TABLE;
const ST = (name: string): number => statusCode(T, name);

const CHAR = { RESET: 0x18, FEEDHOLD: 0x21, FLUSH: 0x25, CYCLE_START: 0x7e, XON: 0x11, XOFF: 0x13, CR: 0x0d, LF: 0x0a } as const;

/** RX_BUFFER_SIZE / TX_BUFFER_SIZE (@cite TG xio/xio_usart.h:54-55). */
const RX_BUFFER_SIZE = 254;
const TX_CAPACITY = 254 - 2;
/** XOFF above 80 %, XON below 10 % (@cite TG xio/xio_usart.h:68-69). */
const XOFF_HI = RX_BUFFER_SIZE * 0.8;
const XOFF_LO = RX_BUFFER_SIZE * 0.1;
/** INPUT_BUFFER_LEN: longest line read (@cite TG controller.h:35). */
const INPUT_BUFFER_LEN = 255;
/** @cite TG planner.h:103-104 */
const PLANNER_POOL = 32;
/** JV_MESSAGES: the lowest jv that echoes messages (@cite TG json_parser.h:48, json_parser.c:576). */
const JV_MESSAGES = 2;
const PLANNER_HEADROOM = 4;
/** hw_hard_reset(): the watchdog at WDTO_15MS (@cite TG hardware.c:161-167). */
const WATCHDOG_RESET_MS = 15;

const HOLD = { OFF: 0, SYNC: 1, PLAN: 2, DECEL: 3, HOLD: 4, END_HOLD: 5 } as const;

/** Identity (@cite TG tinyg.h:48-53). */
const FW_BUILD = 440.21;
const FW_VERSION = 0.97;
const HW_PLATFORM = 1;
const HW_VERSION = 8;

/** TG G-code syntax: invalid characters are deleted (E161 unfixed, @behaviour TG-GCODE-DROP-INVALID), `E` may be an exponent (E159 unfixed). */
export const TG_GCODE_SYNTAX: GcodeSyntax = Object.freeze({
  keepInvalidChars: false,
  signChars: '-.',
  exponentIsWord: false,
  lonePercentIsDelimiter: false,
});

/** Defaults: "settings" lines are @cite TG settings.h / settings/settings_default.h; others are model placeholders. */
const TG_DEFAULTS: Readonly<Record<string, SettingValue>> = Object.freeze({
  jv: 2, // settings.h:61 JV_MESSAGES
  js: 1, // settings.h:62 strict
  ex: 1, // settings.h:84 XON/XOFF
  sv: 1, // settings.h:65 filtered
  si: 500, // settings.h:67
  qv: 0, // settings.h:72
  sl: 0, // settings.h:45
  mt: 2, // placeholder
  xvm: 800, // settings_default.h:103
  xfr: 800, // settings_default.h:104
  xtn: 0, // placeholder
  xtm: 150, // settings_default.h:106
  yvm: 800, // placeholder
  yfr: 800, // placeholder
  ytn: 0, // placeholder
  ytm: 150, // settings_default.h:121
  zvm: 800, // placeholder
  zfr: 800, // placeholder
  ztn: 0, // placeholder
  ztm: 75, // settings_default.h:136
  avm: 800, // placeholder
  afr: 800, // placeholder
  ej: 1, // placeholder
});

/** Default status report list (@cite TG settings.h:68). */
const SR_DEFAULTS = ['posx', 'posy', 'posz', 'posa', 'feed', 'vel', 'unit', 'coor', 'dist', 'frmo', 'stat'] as const;

type MachineState = 'initializing' | 'ready' | 'alarm' | 'programStop' | 'programEnd' | 'cycle' | 'shutdown';
type MotionMode = 'g0' | 'g1' | 'g2' | 'g3' | 'cancel';

interface GcodeModel {
  units: 'mm' | 'in';
  distance: 'abs' | 'inc';
  plane: 17 | 18 | 19;
  coord: number;
  motionMode: MotionMode;
  feed: number;
  tool: number;
  linenum: number;
  position: Vec;
}

const fresh = (): GcodeModel => ({ units: 'mm', distance: 'abs', plane: 17, coord: 54, motionMode: 'cancel', feed: 0, tool: 0, linenum: 0, position: zeroVec() });
const unhomed = (): boolean[] => [false, false, false, false, false, false];

export class TinyG440Model implements SimDevice {
  readonly usb = Object.freeze({ vendorId: 0x0403, productId: 0x6015 });
  readonly baudRate = 115200;
  readonly settings: Settings;
  readonly sideEffects: SideEffect[] = [];
  readonly #options: TinyGModelOptions;
  #io: DeviceIo | undefined;

  #booted = false;
  #bootTimer: number | undefined;
  #bannerDelayMs = 0;
  #tickTimer: number | undefined;

  // xio
  #ring = new RxRing(RX_BUFFER_SIZE);
  #partial = '';
  #partialOverflow = false;
  #xoffSent = false;
  #hostXoff = false;
  #txStalled = false;
  #txHeld: number[] = [];

  // controller flags (set by the ISR, serviced by the main loop)
  #resetRequested = false;
  #feedholdRequested = false;
  #queueFlushRequested = false;
  #cycleStartRequested = false;
  #limitThrown = false;
  #commMode: 'json' | 'text' = 'json';
  #linelen = 0;

  // canonical machine
  #machine: MachineState = 'ready';
  #cycle: 'off' | 'machining' = 'off';
  #motionState: 'stop' | 'run' | 'hold' = 'stop';
  #hold: number = HOLD.OFF;
  #combined = 1;
  #homed = unhomed();
  #gm: GcodeModel = fresh();
  #spindle: 'off' | 'cw' | 'ccw' = 'off';
  #mist = false;
  #flood = false;
  #motorsEnergized = false;
  #motion: Motion;
  #reportsSuppressed = false;
  #lastSr: Record<string, string> = {};
  #lastSrAt = -Infinity;
  #progress = 0;

  constructor(options: TinyGModelOptions = {}) {
    this.#options = options;
    this.settings = new Settings(T, TG_DEFAULTS, options.eeprom ?? {});
    this.#motion = this.#newMotion();
  }

  // ---------------------------------------------------------------- SimDevice

  attach(io: DeviceIo): void {
    if (this.#io !== undefined) throw new Error('model already attached');
    this.#io = io;
    this.#powerUp((this.#options.start ?? 'ready') === 'boot');
  }

  /** The USB RX ISR (@cite TG xio/xio_usb.c:138-192). @behaviour TG-RT-TRAP: four bytes are trapped anywhere. */
  receive(byte: number, overrun: boolean): void {
    if (!this.#booted) return;
    if (byte === CHAR.RESET) {
      // @behaviour TG-RESET-DEFERRED: only a flag; the main loop resets (@cite TG xio/xio_usb.c:146-149)
      this.#resetRequested = true;
      this.#wake();
      return;
    }
    if (byte === CHAR.FEEDHOLD) {
      this.#feedholdRequested = true; // @cite TG canonical_machine.c:1259
      this.#wake();
      return;
    }
    if (byte === CHAR.FLUSH) {
      // @behaviour TG-RT-FLUSH-LATCHED: trapped anywhere, even inside a comment like `(50%)` (@cite TG xio/xio_usb.c:154-157)
      this.#queueFlushRequested = true;
      this.#wake();
      return;
    }
    if (byte === CHAR.CYCLE_START) {
      this.#cycleStartRequested = true;
      this.#wake();
      return;
    }
    if (this.settings.num('ex') === 1) {
      if (byte === CHAR.XOFF) {
        this.#hostXoff = true;
        return;
      }
      if (byte === CHAR.XON) {
        // @behaviour TG-HOST-XON-DEADLOCK: CTRLA_RXON_TXOFF turns the TX interrupt off (E142, @cite TG xio/xio_usb.c:167-171)
        this.#txStalled = true;
        this.#event('host XON: transmitter stalled (E142)');
        return;
      }
    }
    // @behaviour TG-NO-KILL-ENQ: 0x04 and 0x05 are not trapped; they enter the ring as data.
    // @behaviour TG-RX-RING: a full ring tosses the byte silently (@cite TG xio/xio_usb.c:178-191)
    if (this.#ring.push(byte, overrun)) {
      // @behaviour TG-RX-XOFF
      if (this.settings.num('ex') === 1 && !this.#xoffSent && this.#ring.count > XOFF_HI) {
        this.#xoffSent = true;
        this.#transmit([CHAR.XOFF]);
      }
    } else {
      // @behaviour TG-OVERRUN-SPLICE: nothing records the loss, so the reader joins what is left.
      this.#event('RX ring full: byte tossed');
    }
    this.#wake();
  }

  injectLimitSwitch(input: number): void {
    void input;
    this.#limitThrown = true;
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

  // ---------------------------------------------------------------- inspection

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
      velocity: this.#motion.velocity(now),
      booted: this.#booted,
    };
  }

  /** Test hook: mark axes homed (homing is not modelled). */
  setHomed(axes: readonly ('x' | 'y' | 'z' | 'a' | 'b' | 'c')[]): void {
    for (const a of axes) this.#homed[AXES.indexOf(a)] = true;
  }

  /** True while a full, stalled transmit buffer blocks the main loop (the E128 class). */
  loopBlocked(): boolean {
    return this.#txStalled && this.#txHeld.length >= TX_CAPACITY;
  }

  // ---------------------------------------------------------------- power

  #powerUp(printBanners: boolean): void {
    const clock = this.#clock();
    if (this.#bootTimer !== undefined) clock.clearTimeout(this.#bootTimer);
    if (this.#tickTimer !== undefined) clock.clearTimeout(this.#tickTimer);
    this.#bootTimer = undefined;
    this.#tickTimer = undefined;
    this.#resetRam();
    // @behaviour TG-EEPROM: record 0 holds the build; any other build resets every setting (@cite TG config.c:129-165)
    const freshEeprom = this.settings.eeprom['__build'] !== FW_BUILD;
    if (freshEeprom) {
      this.settings.resetToDefaults();
      this.settings.eeprom['__build'] = FW_BUILD;
    } else {
      this.settings.load();
    }
    if (!printBanners) {
      this.#booted = true;
      this.#machine = 'ready';
      this.#combined = 1;
      this.#snapshotSr();
      return;
    }
    this.#booted = false;
    this.#machine = 'initializing';
    const delay = (this.#options.bootMs ?? DEFAULT_BOOT_MS) + this.#bannerDelayMs;
    this.#bootTimer = clock.setTimeout(() => {
      this.#bootTimer = undefined;
      // @behaviour TG-BANNER: an `r` with footer revision 1, through json_print_response (@cite TG report.c:88-118).
      // A fresh EEPROM prints "Initializing" after the defaults (jv 2) are set, while INITIALIZING, so in full
      // (@cite TG config.c:164). An EEPROM boot prints no "Loading configs" line: it is printed while jv is
      // still 0 (JV_SILENT) in RAM, before the stored jv is read (@cite TG config.c:134; json_parser.c:485).
      if (freshEeprom) this.#banner(ST('INITIALIZING'), 'Initializing configs to default settings', false);
      this.#machine = 'ready';
      this.#combined = 1;
      // SYSTEM READY comes after the machine is READY (@cite TG main.c:131-143), so the jv filter applies: at jv=1
      // `msg` is dropped and only fv, fb, hp, hv and id remain; at jv=0 nothing is printed (@behaviour TG-BANNER-JV).
      this.#banner(0, 'SYSTEM READY', true);
      this.#booted = true;
      this.#snapshotSr();
    }, delay);
  }

  #resetRam(): void {
    this.#ring = new RxRing(RX_BUFFER_SIZE);
    this.#partial = '';
    this.#partialOverflow = false;
    this.#xoffSent = false;
    this.#hostXoff = false;
    this.#txStalled = false;
    this.#txHeld = [];
    this.#resetRequested = false;
    this.#feedholdRequested = false;
    this.#queueFlushRequested = false;
    this.#cycleStartRequested = false;
    this.#limitThrown = false;
    this.#commMode = 'json';
    this.#linelen = 0;
    this.#cycle = 'off';
    this.#motionState = 'stop';
    this.#hold = HOLD.OFF;
    this.#homed = unhomed();
    this.#gm = fresh();
    this.#spindle = 'off';
    this.#mist = false;
    this.#flood = false;
    this.#motorsEnergized = false;
    this.#motion = this.#newMotion();
    this.#lastSrAt = -Infinity;
  }

  // ---------------------------------------------------------------- scheduling

  #wake(): void {
    if (this.#tickTimer !== undefined || !this.#booted) return;
    this.#tickTimer = this.#clock().setTimeout(() => this.#tick(), 0);
  }

  #tick(): void {
    this.#tickTimer = undefined;
    if (!this.#booted) return;
    for (let i = 0; i < 256; i++) {
      if (!this.#pass()) break;
    }
    if (this.#busy()) this.#tickTimer = this.#clock().setTimeout(() => this.#tick(), TICK_MS);
  }

  #busy(): boolean {
    if (this.loopBlocked()) return false;
    return (
      this.#ring.count > 0 ||
      this.#resetRequested ||
      this.#feedholdRequested ||
      this.#queueFlushRequested ||
      this.#cycleStartRequested ||
      this.#limitThrown ||
      this.#motion.queue.length > 0 ||
      this.#motion.current() !== null ||
      (this.#hold !== HOLD.OFF && this.#hold !== HOLD.HOLD) ||
      this.#srDiffers()
    );
  }

  /** One pass of `_controller_HSM()` (@cite TG controller.c:151-190). */
  #pass(): boolean {
    // A print that waits for TX room never returns: nothing in the loop runs, not even the reset handler.
    if (this.loopBlocked()) return false;
    const before = this.#progress;
    const now = this.#now();
    this.#motion.advance(now);
    if (this.#resetRequested) {
      this.#resetRequested = false;
      this.#event('^X serviced by the main loop: watchdog reset');
      this.#freezeThenReset();
      return true;
    }
    // _shutdown_idler(): EAGAIN in SHUTDOWN blocks everything below (@cite TG controller.c:303-312)
    if (this.#machine === 'shutdown') return this.#progress !== before;
    this.#limitSwitchHandler();
    this.#feedholdSequencing(now);
    this.#motion.advance(now);
    this.#statusReportCallback(now);
    // @behaviour TG-PLANNER: a line is read only with 4 free buffers; JSON waits too (@cite TG controller.c:183-188)
    if (this.#motion.available() < PLANNER_HEADROOM) return this.#progress !== before;
    this.#commandDispatch();
    return this.#progress !== before;
  }

  #freezeThenReset(): void {
    const clock = this.#clock();
    this.#motion.halt(this.#now());
    this.#booted = false;
    if (this.#tickTimer !== undefined) clock.clearTimeout(this.#tickTimer);
    this.#tickTimer = undefined;
    if (this.#bootTimer !== undefined) clock.clearTimeout(this.#bootTimer);
    this.#bootTimer = clock.setTimeout(() => this.#powerUp(true), WATCHDOG_RESET_MS);
  }

  // ---------------------------------------------------------------- controller

  /** @behaviour TG-HARD-ALARM: a limit switch is a hard alarm, not ignored in a soft alarm only (@cite TG controller.c:427-434). */
  #limitSwitchHandler(): void {
    if (this.#machine === 'alarm' || !this.#limitThrown) return;
    this.#limitThrown = false;
    this.#hardAlarm(ST('LIMIT_SWITCH_HIT'));
  }

  /** `_command_dispatch()` (@cite TG controller.c:201-289). */
  #commandDispatch(): void {
    const line = this.#gets();
    if (line === null) return;
    this.#progress++;
    this.#linelen = line.length + 1; // @cite TG controller.c:251
    const c = line[0]?.toUpperCase();
    if (c === '!') this.#feedholdRequested = true;
    else if (c === '%') this.#queueFlushRequested = true;
    else if (c === '~') this.#cycleStartRequested = true;
    else if (c === undefined) {
      if (this.#commMode !== 'json') this.#textPrompt();
    } else if (c === '$' || c === '?' || c === 'H') {
      this.#commMode = 'text';
      this.#textPrompt();
    } else if (c === '{') {
      this.#commMode = 'json';
      this.#jsonParser(line);
    } else if (this.#commMode === 'json') {
      this.#runGcodeAsJson(line);
    } else {
      this.#gcodeParser(line);
      this.#textPrompt();
    }
  }

  /** `xio_gets()` in character mode: one line from the ring; an overlong line is cut (model: rejected 107). */
  #gets(): string | null {
    for (;;) {
      const next = this.#ring.shift();
      if (next === undefined) return null;
      if (this.#xoffSent && this.#ring.count < XOFF_LO) {
        this.#xoffSent = false;
        this.#transmit([CHAR.XON]);
      }
      if (next.byte === CHAR.CR || next.byte === CHAR.LF) {
        const line = this.#partial;
        const overflow = this.#partialOverflow;
        this.#partial = '';
        this.#partialOverflow = false;
        if (overflow) throw new ModelGapError('440.21 overlong-line handling');
        return line;
      }
      if (this.#partial.length >= INPUT_BUFFER_LEN - 1) this.#partialOverflow = true;
      else this.#partial += String.fromCharCode(next.byte);
    }
  }

  // ---------------------------------------------------------------- canonical machine

  /** `cm_get_combined_state()` (@cite TG canonical_machine.c:150-163): note the stale value with motion stopped in a cycle (@behaviour TG-STAT). */
  #stat(): number {
    const machineCode: Record<MachineState, number> = { initializing: 0, ready: 1, alarm: 2, programStop: 3, programEnd: 4, cycle: 5, shutdown: 11 };
    if (this.#cycle === 'off') this.#combined = machineCode[this.#machine];
    else if (this.#motionState === 'run') this.#combined = 5;
    else if (this.#motionState === 'hold') this.#combined = 6;
    if (this.#machine === 'shutdown') this.#combined = 11;
    return this.#combined;
  }

  /**
   * @behaviour TG-SOFT-ALARM: `cm_soft_alarm()` only reports and sets ALARM;
   * queued moves and the spindle keep running (@cite TG canonical_machine.c:583-588).
   */
  #softAlarm(status: number): number {
    this.#exception(status);
    this.#machine = 'alarm';
    return status;
  }

  /**
   * `cm_hard_alarm()` (@cite TG canonical_machine.c:600-616): hard stop, a
   * QUEUED spindle off, SHUTDOWN. With the runtime stopped the queued spindle
   * off never runs in the model (@behaviour TG-HARD-ALARM-SPINDLE, UNVERIFIED).
   */
  #hardAlarm(status: number): void {
    this.#motion.halt(this.#now());
    this.#queueCommand('spindle off (hard alarm)', () => {
      this.#spindle = 'off';
    });
    this.#exception(status);
    this.#machine = 'shutdown';
    this.#homed = unhomed();
    this.#progress++;
  }

  /** `cm_clear()` (@cite TG canonical_machine.c:590-598). */
  #clear(): void {
    if (this.#machine !== 'alarm') return;
    this.#machine = this.#cycle === 'off' ? 'programStop' : 'cycle';
    this.sideEffects.push({ t: this.#now(), what: 'alarm-cleared', via: 'clear' });
  }

  /** `cm_feedhold_sequencing_callback()` (@cite TG canonical_machine.c:1263-1291). */
  #feedholdSequencing(now: number): void {
    if (this.#feedholdRequested) {
      // @behaviour TG-RT-FEEDHOLD: honoured only in MOTION_RUN with no hold
      if (this.#motionState === 'run' && this.#hold === HOLD.OFF) {
        this.#motionState = 'hold';
        this.#hold = HOLD.SYNC;
        const how = this.#motion.startHold(now, this.#options.holdDecelMs ?? DEFAULT_HOLD_DECEL_MS);
        this.#hold = how === 'decel' ? HOLD.DECEL : HOLD.SYNC;
      }
      this.#feedholdRequested = false;
      this.#progress++;
    }
    if (this.#queueFlushRequested) {
      const stopped = this.#motionState === 'stop' || (this.#motionState === 'hold' && this.#hold === HOLD.HOLD);
      if (stopped && this.#motion.runtimeIdle()) {
        this.#queueFlushRequested = false;
        this.#queueFlush(now);
      }
    }
    const processing = this.#hold === HOLD.SYNC || this.#hold === HOLD.PLAN || this.#hold === HOLD.DECEL;
    if (this.#cycleStartRequested && !this.#queueFlushRequested && !processing) {
      this.#cycleStartRequested = false;
      this.#hold = HOLD.END_HOLD;
      this.#cycleStart();
      // mp_end_hold(): restart the held move
      this.#motion.resume(now);
      this.#hold = HOLD.OFF;
      this.#motionState = this.#motion.queue.length > 0 ? 'run' : 'stop';
      this.#progress++;
    }
  }

  /** `cm_queue_flush()` (@cite TG canonical_machine.c:1293-1313): RX buffers, planner, then finalize now. */
  #queueFlush(now: number): void {
    this.#ring.clear();
    this.#partial = '';
    this.#partialOverflow = false;
    this.#motion.flush(now);
    // @behaviour TG-FLUSH-REPORTS: the flush requests a queue report and an rx report (@cite TG
    // canonical_machine.c:1302-1303). The main loop prints the qr report (only when qv is not 0, in the js
    // syntax) and then `{"rx":n}`, always strict, whatever jv, js or qv (@cite TG controller.c:173-174;
    // report.c:489-528, :541-548). n is the free USB RX space, captured right after the reset.
    const rxFree = RX_BUFFER_SIZE - this.#ring.count; // xio_get_usb_rx_free() (@cite TG xio/xio_usb.c:199-202)
    this.#gm.position = this.#motion.position(now);
    this.#programFinalize('programStop');
    this.sideEffects.push({ t: now, what: 'queue-flush', via: '%' });
    const qv = this.settings.num('qv');
    if (qv !== 0) {
      const qr = this.#motion.available();
      this.#println(serialize(qv === 1 ? { qr } : { qr, qi: 0, qo: 0 }, this.settings.num('js') === 0));
    }
    this.#println(`{"rx":${rxFree}}`);
    this.#progress++;
  }

  #cycleStart(): void {
    this.#machine = 'cycle'; // @cite TG canonical_machine.c:1379-1386
    if (this.#cycle === 'off') this.#cycle = 'machining';
    this.#motorsEnergized = true;
  }

  /**
   * `_exec_program_finalize()` (@cite TG canonical_machine.c:1351-1377). It
   * overwrites the machine state, so a queued finalize clears a soft alarm
   * (@behaviour TG-QUEUED-END-CLEARS). At program END the spindle and coolant
   * off are themselves queued commands (@cite TG spindle.c:91-96; @behaviour TG-PROGRAM-END-SPINDLE).
   */
  #programFinalize(state: 'programStop' | 'programEnd'): void {
    this.#machine = state;
    this.#motionState = 'stop';
    if (this.#cycle === 'machining') this.#cycle = 'off';
    this.#hold = HOLD.OFF;
    this.#cycleStartRequested = false;
    if (state === 'programEnd') {
      this.#gm.motionMode = 'cancel';
      this.#gm.distance = 'abs';
      this.#queueCommand('spindle off (program end)', () => {
        this.#spindle = 'off';
      });
      this.#queueCommand('coolant off (program end)', () => {
        this.#flood = false;
        this.#mist = false;
      });
    }
  }

  #newMotion(): Motion {
    return new Motion(PLANNER_POOL, {
      earliestStart: (block, t) => {
        if (this.#machine === 'shutdown' || this.#hold === HOLD.HOLD || this.#hold === HOLD.END_HOLD) return null;
        if (this.#hold !== HOLD.OFF) {
          // The hold is planned from line execution (mp_plan_hold_callback): non-moves still run (LIM-HOLD-DWELL).
          if (block.kind !== 'move') return t;
          this.#hold = HOLD.HOLD;
          this.#progress++;
          return null;
        }
        return t;
      },
      onStart: (block) => {
        // Only lines set MOTION_RUN, and only from STOP (@cite TG plan_exec.c:67-70)
        if (block.kind === 'move' && this.#motionState === 'stop') this.#motionState = 'run';
      },
      onFree: (_block, empty) => {
        if (empty && this.#cycle !== 'off') this.#programFinalize('programStop'); // cm_cycle_end() (@cite TG canonical_machine.c:1388-1394)
        this.#progress++;
      },
      onHoldReached: () => {
        if (this.#hold === HOLD.OFF) return;
        this.#hold = HOLD.HOLD;
        this.#progress++;
      },
    });
  }

  // ---------------------------------------------------------------- G-code

  /** `gc_gcode_parser()` (@cite TG gcode_parser.c:53-79): an alarmed machine refuses every block with 203. */
  #gcodeParser(line: string): number {
    if (this.#machine === 'alarm') return ST('MACHINE_ALARMED');
    const norm = normalizeBlock(line, TG_GCODE_SYNTAX);
    if (norm.blockDelete) return ST('NOOP');
    if (norm.block === '') return 0;
    const words = readWords(norm.block, TG_GCODE_SYNTAX);
    if (!words.ok) return ST(words.status);
    return this.#execute(words.words);
  }

  #execute(words: readonly Word[]): number {
    const gm = this.#gm;
    const target: (number | undefined)[] = [undefined, undefined, undefined, undefined, undefined, undefined];
    const ij: (number | undefined)[] = [undefined, undefined];
    let motion: MotionMode | undefined;
    let dwell = false;
    let p = 0;
    let feed: number | undefined;
    let flow: 'stop' | 'end' | undefined;
    let spindle: 'cw' | 'ccw' | 'off' | undefined;
    for (const w of words) {
      const v = w.value;
      switch (w.letter) {
        case 'G': {
          // @behaviour TG-DOTTED-CODES: `switch((uint8_t)value)`: a decimal is dropped unless the code reads
          // a sub-code, so G59.1 runs as G59 (@cite TG gcode_parser.c:258-259; E150 unfixed)
          const int = Math.trunc(v) & 0xff;
          const point = Math.round((v - Math.trunc(v)) * 10);
          if (int <= 3) motion = (['g0', 'g1', 'g2', 'g3'] as const)[int];
          else if (int === 4) dwell = true;
          else if (int === 17 || int === 18 || int === 19) gm.plane = int;
          else if (int === 20 || int === 21) gm.units = int === 20 ? 'in' : 'mm';
          else if ((int === 90 || int === 91) && point === 0) gm.distance = int === 90 ? 'abs' : 'inc';
          else if ([40, 49, 61, 64, 94].includes(int)) {
            // modal state the coarse model does not act on
          } else if (int === 80) motion = 'cancel';
          else if (int >= 54 && int <= 59) gm.coord = int;
          else if ([10, 28, 30, 38, 43, 53, 90, 91, 92, 93].includes(int)) throw new ModelGapError(`440.21 G${v}`);
          else return ST('GCODE_COMMAND_UNSUPPORTED');
          break;
        }
        case 'M': {
          const int = Math.trunc(v) & 0xffff; // `switch((uint16_t)value)`: M3.1 runs as M3 (@cite TG gcode_parser.c:351-352)
          if (int === 0 || int === 1 || int === 60) flow = 'stop';
          else if (int === 2 || int === 30) flow = 'end';
          else if (int === 3 || int === 4 || int === 5) spindle = int === 3 ? 'cw' : int === 4 ? 'ccw' : 'off';
          else if (int === 6 || (int >= 48 && int <= 51)) {
            // M6 stores the tool only (PN §9.3); M48-M51 set override flags nothing uses (PN §9.3 "ignored")
          } else if (int === 7 || int === 8 || int === 9) {
            const on = int !== 9;
            const mist = int === 7;
            this.#queueCommand('coolant', () => {
              if (!on) {
                this.#mist = false;
                this.#flood = false;
              } else if (mist) this.#mist = true;
              else this.#flood = true;
            });
          } else if (int === 114 || int === 115 || int === 201 || int === 400) throw new ModelGapError(`440.21 M${int}`);
          else return ST('MCODE_COMMAND_UNSUPPORTED');
          break;
        }
        case 'F':
          feed = v;
          break;
        case 'P':
          p = v;
          break;
        case 'T':
          gm.tool = Math.trunc(v) & 0xff; // `(uint8_t)trunc(value)`: T256 is tool 0 (@cite TG gcode_parser.c:382; E154)
          break;
        case 'S':
          break;
        case 'N':
          gm.linenum = v;
          break;
        case 'L':
          break; // `case 'L': break;` (@cite TG gcode_parser.c:400)
        case 'X':
        case 'Y':
        case 'Z':
        case 'A':
        case 'B':
        case 'C':
          target['XYZABC'.indexOf(w.letter)] = v;
          break;
        case 'I':
        case 'J':
          ij['IJ'.indexOf(w.letter)] = v;
          break;
        case 'K':
        case 'R':
          throw new ModelGapError(`440.21 ${w.letter} word`);
        default:
          return ST('GCODE_COMMAND_UNSUPPORTED');
      }
    }
    if (feed !== undefined) gm.feed = feed * (gm.units === 'in' ? 25.4 : 1);
    if (spindle !== undefined) {
      const mode = spindle;
      this.#queueCommand(`spindle ${mode}`, () => {
        this.#spindle = mode; // no output inhibit on 440.21 (@behaviour TG-SPINDLE-NOT-INHIBITED)
      });
    }
    if (dwell) this.#queueBlock({ kind: 'dwell', ms: p * 1000, line: gm.linenum });
    if (motion !== undefined) gm.motionMode = motion;
    const hasAxes = target.some((t) => t !== undefined);
    if (hasAxes || motion === 'g2' || motion === 'g3') {
      const status =
        gm.motionMode === 'g0' || gm.motionMode === 'g1'
          ? this.#straight(target, gm.motionMode === 'g0')
          : gm.motionMode === 'g2' || gm.motionMode === 'g3'
            ? this.#arc(target, ij)
            : ST('GCODE_AXIS_IS_MISSING');
      if (status !== 0) return status;
    }
    if (flow !== undefined) {
      // @behaviour TG-M0-NO-PAUSE: M0/M1/M60 only queue a finalize; the next move runs without `~` (@cite TG canonical_machine.c:1396-1412)
      const state = flow === 'stop' ? 'programStop' : 'programEnd';
      this.#queueCommand(`program ${flow}`, () => this.#programFinalize(state));
    }
    return 0;
  }

  #resolve(target: (number | undefined)[]): Vec {
    const gm = this.#gm;
    const f = gm.units === 'in' ? 25.4 : 1;
    const off = AXES.map((a) => this.settings.num(`g${gm.coord}${a}`));
    return gm.position.map((pos, i) => {
      const v = target[i];
      if (v === undefined) return pos;
      const mm = i < 3 ? v * f : v;
      return gm.distance === 'inc' ? pos + mm : mm + (off[i] as number);
    }) as Vec;
  }

  /** `cm_test_soft_limits()` (@cite TG canonical_machine.c:480-498). */
  #testSoftLimits(target: Vec): number {
    if (this.settings.num('sl') !== 1) return 0;
    for (let i = 0; i < 3; i++) {
      if (!this.#homed[i]) continue;
      const a = AXES[i] as string;
      const min = this.settings.num(`${a}tn`);
      const max = this.settings.num(`${a}tm`);
      if (min === max) continue;
      if ((target[i] as number) < min || (target[i] as number) > max) return ST('SOFT_LIMIT_EXCEEDED');
    }
    return 0;
  }

  #straight(t: (number | undefined)[], rapid: boolean): number {
    const gm = this.#gm;
    if (!rapid && !(gm.feed > 0)) return ST('GCODE_FEEDRATE_NOT_SPECIFIED'); // @cite TG canonical_machine.c:996-999
    const target = this.#resolve(t);
    const soft = this.#testSoftLimits(target);
    if (soft !== 0) return this.#softAlarm(soft); // @cite TG canonical_machine.c:882-884, :1003-1005
    this.#cycleStart();
    const from = gm.position;
    const length = distance(from, target);
    if (length === 0) return 0;
    const path: Path = { kind: 'line', from, to: target, length };
    this.#queueBlock({ kind: 'move', path, feed: this.#feedFor(from, target, rapid), line: gm.linenum });
    gm.position = target;
    return 0;
  }

  /** @behaviour TG-ARC-NO-SOFT-LIMIT: the arc soft-limit test is commented out (@cite TG plan_arc.c:170-177). */
  #arc(t: (number | undefined)[], ij: (number | undefined)[]): number {
    const gm = this.#gm;
    if (gm.plane !== 17) throw new ModelGapError('440.21 arcs outside G17');
    if (!(gm.feed > 0)) return ST('GCODE_FEEDRATE_NOT_SPECIFIED');
    const f = gm.units === 'in' ? 25.4 : 1;
    const i = (ij[0] ?? 0) * f;
    const j = (ij[1] ?? 0) * f;
    if (i === 0 && j === 0) throw new ModelGapError('440.21 arc without I/J');
    const target = this.#resolve(t);
    const path = arcPath(gm.position, target, i, j, gm.motionMode === 'g2');
    this.#cycleStart();
    this.#queueBlock({ kind: 'move', path, feed: Math.min(gm.feed, this.settings.num('xfr'), this.settings.num('yfr')), line: gm.linenum });
    gm.position = target;
    return 0;
  }

  #feedFor(from: Vec, to: Vec, rapid: boolean): number {
    const length = distance(from, to);
    let v = rapid ? Infinity : this.#gm.feed;
    for (let i = 0; i < 6; i++) {
      const d = Math.abs((to[i] as number) - (from[i] as number));
      if (d === 0) continue;
      const limit = this.settings.num(`${AXES[i] as string}${rapid ? 'vm' : 'fr'}`);
      if (limit > 0) v = Math.min(v, (limit * length) / d);
    }
    return Number.isFinite(v) ? v : 1;
  }

  #queueBlock(block: Block): void {
    this.#motion.push(block);
  }

  #queueCommand(label: string, run: () => void): void {
    this.#motion.push({ kind: 'command', label, line: this.#gm.linenum, run });
  }

  // ---------------------------------------------------------------- JSON

  /** G-code in JSON mode is run as `{"gc":"..."}` (@cite TG controller.c:277-286). */
  #runGcodeAsJson(line: string): void {
    const status = this.#gcodeParser(line);
    this.#respond(status, {});
  }

  /**
   * `_json_parser_kernal()` (@cite TG json_parser.c:97-145).
   * @behaviour TG-JSON-FIRST-PAIR: only the first pair executes (EN-HIL
   * test_identity.py:44-47); there is no `tid` token.
   */
  #jsonParser(line: string): void {
    const parsed = parseHostJson(line);
    if (!parsed.ok || parsed.pairs.length === 0) {
      this.#respond(ST('JSON_SYNTAX_ERROR'), { err: line });
      return;
    }
    // Every pair is parsed and its token validated first (@cite TG json_parser.c:107-132) ...
    if (parsed.pairs.some(([k]) => token(T, k) === undefined)) {
      this.#respond(ST('UNRECOGNIZED_NAME'), {});
      return;
    }
    const [key, value] = parsed.pairs[0] as readonly [string, HostValue];
    const body: Record<string, OutValue> = {};
    let status = 0;
    // ... but only the first executes (@cite TG json_parser.c:134-144)
    if (value === null) status = this.#get(key, body);
    else if (this.#machine === 'alarm') status = ST('MACHINE_ALARMED');
    else status = this.#set(key, value, body);
    // The rest are serialized as parsed: a GET pair echoes null (EN-HIL test_identity.py:44-47)
    for (const [k, v] of parsed.pairs.slice(1)) body[k] = v === null ? null : typeof v === 'object' ? null : v;
    this.#respond(status, body);
  }

  #get(key: string, body: Record<string, OutValue>): number {
    const info = token(T, key);
    if (info === undefined) return ST('UNRECOGNIZED_NAME');
    switch (info.get) {
      case 'st_set_md':
        // @behaviour TG-E138: GET md de-energizes the motors (@cite TG config_app.c:468-469)
        this.#motorsEnergized = false;
        this.#sideEffect('motors-deenergized', `GET ${key}`);
        body[key] = null;
        return 0;
      case 'st_set_me':
        this.#motorsEnergized = true;
        this.#sideEffect('motors-energized', `GET ${key}`);
        body[key] = null;
        return 0;
      case 'cm_clear':
        this.#clear();
        body[key] = null;
        return 0;
      case 'rpt_er':
        this.#sideEffect('fake-exception', `GET ${key}`);
        this.#exception(ST('GENERIC_EXCEPTION_REPORT')); // @cite TG report.c:74-77
        return ST('GENERIC_EXCEPTION_REPORT');
      case 'help_config':
      case 'help_boot_loader':
      case 'help_defa':
      case 'help_test':
        this.#sideEffect('help-text', `GET ${key}`);
        return 0;
      case 'sr_get':
        body[key] = this.#srValues(true);
        return 0;
      case 'get_grp': {
        const out: Record<string, OutValue> = {};
        for (const name of groupMembers(T, key)) {
          const v = this.#value(name);
          if (v !== undefined) out[key !== 'sys' && name.startsWith(key) ? name.slice(key.length) : name] = v;
        }
        body[key] = out;
        return 0;
      }
      default: {
        const v = this.#value(key);
        if (v === undefined) throw new ModelGapError(`440.21 GET ${key} (${info.get})`);
        body[key] = v;
        return 0;
      }
    }
  }

  #set(key: string, value: HostValue, body: Record<string, OutValue>): number {
    const info = token(T, key);
    if (info === undefined) return ST('UNRECOGNIZED_NAME');
    if (info.set === 'gc_run_gc') return typeof value === 'string' ? this.#gcodeParser(value) : ST('UNSUPPORTED_TYPE');
    if (typeof value === 'object' && value !== null) throw new ModelGapError(`440.21 group SET ${key}`);
    if (info.set === 'set_nul') return ST('PARAMETER_IS_READ_ONLY');
    if (info.set === 'st_set_md' || info.set === 'st_set_me' || info.set === 'cm_clear') {
      if (info.set === 'cm_clear') this.#clear();
      else this.#motorsEnergized = info.set === 'st_set_me';
      return 0;
    }
    if (['set_baud', 'hw_run_boot', 'set_defaults', 'run_test', 'cm_run_qf', 'cm_run_home', 'sr_set'].includes(info.set)) {
      throw new ModelGapError(`440.21 SET ${key} (${info.set})`);
    }
    const n = typeof value === 'number' ? value : typeof value === 'boolean' ? (value ? 1 : 0) : NaN;
    if (Number.isNaN(n)) return ST('UNSUPPORTED_TYPE');
    this.settings.setRam(key, n);
    body[key] = fixed(n, info.precision);
    if (info.persist) {
      // @behaviour TG-SETTINGS-GATE: refused with an `er` 9 while moving; the response itself is still OK because
      // `nv_persist()`'s status is ignored (@cite TG persistence.c:87-90; json_parser.c:141-142)
      if (this.#cycle !== 'off') this.#exception(ST('FILE_NOT_OPEN'));
      else this.settings.persist(key);
    }
    return 0;
  }

  #value(key: string): OutValue | undefined {
    const info = token(T, key);
    if (info === undefined) return undefined;
    const now = this.#now();
    this.#motion.advance(now);
    const p = info.precision;
    const axis = AXES.indexOf(key.slice(-1) as 'x');
    const f = this.#gm.units === 'in' ? 25.4 : 1;
    switch (info.get) {
      case 'cm_get_stat':
        return this.#stat();
      case 'cm_get_hold':
        return this.#hold;
      case 'cm_get_vel':
        return fixed(this.#motion.velocity(now) / f, p);
      case 'cm_get_feed':
        return fixed(this.#gm.feed / f, p);
      case 'cm_get_line':
        return this.#motion.line();
      case 'cm_get_pos': {
        const off = this.settings.num(`g${this.#gm.coord}${AXES[axis] as string}`);
        return fixed(((this.#motion.position(now)[axis] as number) - off) / (axis < 3 ? f : 1), p);
      }
      case 'cm_get_mpo':
        return fixed(this.#motion.position(now)[axis] as number, p);
      case 'cm_get_unit':
        return this.#gm.units === 'in' ? 0 : 1;
      case 'cm_get_coor':
        return this.#gm.coord - 53;
      case 'cm_get_dist':
        return this.#gm.distance === 'abs' ? 0 : 1;
      case 'cm_get_frmo':
        return 1;
      case 'cm_get_momo':
        return ['g0', 'g1', 'g2', 'g3', 'cancel'].indexOf(this.#gm.motionMode);
      case 'qr_get':
        return this.#motion.available();
      case 'get_rx':
        return this.#ring.free;
      case 'hw_get_id':
        return this.#options.id ?? 'SIM-TG-0001';
      default:
        break;
    }
    if (key === 'fb') return fixed(FW_BUILD, p);
    if (key === 'fv') return fixed(FW_VERSION, p);
    if (key === 'hp') return fixed(HW_PLATFORM, p);
    if (key === 'hv') return fixed(HW_VERSION, p);
    if (info.group === 'hom' && axis >= 0) return this.#homed[axis] ? 1 : 0;
    if (['get_flt', 'get_ui8', 'get_int', 'get_u32', 'get_data'].includes(info.get)) {
      const v = this.settings.get(key);
      return fixed(typeof v === 'number' ? v : 0, p);
    }
    return undefined;
  }

  // ---------------------------------------------------------------- reports and output

  #srValues(all: boolean): OutObject {
    const out: Record<string, OutValue> = {};
    for (const key of SR_DEFAULTS) {
      const v = this.#value(key);
      if (v === undefined) continue;
      if (all || this.#lastSr[key] !== serialize(v)) out[key] = v;
    }
    return out;
  }

  #snapshotSr(): void {
    this.#lastSr = {};
    for (const key of SR_DEFAULTS) {
      const v = this.#value(key);
      if (v !== undefined) this.#lastSr[key] = serialize(v);
    }
  }

  #srDiffers(): boolean {
    if (this.settings.num('sv') === 0 || this.#reportsSuppressed) return false;
    return Object.keys(this.#srValues(false)).length > 0;
  }

  #statusReportCallback(now: number): void {
    const sv = this.settings.num('sv');
    if (sv === 0 || this.#reportsSuppressed || now - this.#lastSrAt < this.settings.num('si')) return;
    const changed = this.#srValues(sv === 2);
    if (Object.keys(changed).length === 0) return;
    for (const [k, v] of Object.entries(changed)) this.#lastSr[k] = serialize(v);
    this.#lastSrAt = now;
    this.#println(serialize({ sr: changed }, this.settings.num('js') === 0));
    this.#progress++;
  }

  /**
   * `json_print_response()` (@cite TG json_parser.c:479-552).
   * @behaviour TG-FOOTER: `[1,status,line length + 1,checksum]`, the checksum
   * a 31× rolling hash mod 9999 of the output up to the last comma (@cite TG util.c:255-266).
   */
  #respond(status: number, body: OutObject): void {
    const jv = this.settings.num('jv');
    if (jv === 0) return;
    const relaxed = this.settings.num('js') === 0;
    const q = (k: string): string => (relaxed ? k : `"${k}"`);
    const head = `{${q('r')}:${serialize(body, relaxed)},${q('f')}:[1,${status},${this.#linelen},`;
    this.#linelen = 0;
    this.#println(`${head}${checksum440(head.slice(0, -1))}]}`);
  }

  /**
   * `_startup_helper()` (@cite TG report.c:88-103): fv, fb, hp, hv, id and msg
   * through `json_print_response`, so `jv` and `js` apply. `filtered` is true
   * once the machine is past INITIALIZING: then `msg` (NV_TYPE_MESSAGE) is
   * dropped below jv=2 (JV_MESSAGES), while the config values stay (the config
   * filter is commented out, @cite TG json_parser.c:490-511).
   */
  #banner(status: number, msg: string, filtered: boolean): void {
    const identity: OutObject = { fv: fixed(FW_VERSION, 3), fb: fixed(FW_BUILD, 2), hp: HW_PLATFORM, hv: HW_VERSION, id: this.#options.id ?? 'SIM-TG-0001' };
    const body: OutObject = filtered && this.settings.num('jv') < JV_MESSAGES ? identity : { ...identity, msg };
    this.#linelen = 0;
    this.#respond(status, body);
  }

  /** `rpt_exception()` (@cite TG report.c:57-69). */
  #exception(status: number): void {
    const name = Object.entries(T.status).find(([, c]) => c === status)?.[0] ?? 'ERROR';
    this.#println(serialize({ er: { fb: fixed(FW_BUILD, 2), st: status, msg: name } }, this.settings.num('js') === 0));
  }

  #textPrompt(): void {
    this.#println(`tinyg [${this.#gm.units}] ok>`);
  }

  #println(s: string): void {
    this.#transmit(Array.from(s + '\n', (ch) => ch.charCodeAt(0)));
    this.#progress++;
  }

  #transmit(bytes: number[]): void {
    const io = this.#io;
    if (io === undefined) return;
    if (this.#txStalled || this.#hostXoff) {
      // Held in the TX buffer; beyond its capacity the print blocks the main loop (loopBlocked()).
      this.#txHeld.push(...bytes.slice(0, Math.max(0, TX_CAPACITY - this.#txHeld.length)));
      return;
    }
    io.transmit(Uint8Array.from(bytes));
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

/** `compute_checksum()` (@cite TG util.c:255-266): Java-style 31× hash of the string, mod 9999. */
export function checksum440(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
  return h % 9999;
}
