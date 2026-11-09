/**
 * DEV ONLY. A simulated TinyG v8 that can be flashed: the xboot bootloader
 * model (xboot.ts) plus the edge-next model running whatever image the
 * application section holds (simFirmware.ts). One board, kept across port
 * opens, the way the FTDI port stays the same across `{"boot":1}`.
 *
 * - `{"boot":1}` from the running firmware resets the board into xboot with
 *   the software-reset flag: a 60 s entry window.
 * - A power cycle (`powerCycle`, what unplugging and replugging USB does on
 *   the bench) or a reset (`resetBoard`) enters xboot with the 4.8 s window.
 * - When xboot jumps to address 0 (the window ended, or `E`):
 *   - the stub page 0 (`jmp 0x30000`) jumps straight back into xboot, so a
 *     board whose flash was interrupted stays in the bootloader (4.8 s
 *     windows, forever) — "no application";
 *   - a complete simulated image starts the edge-next model with that image's
 *     build (fb, fv, hv, EEPROM layout), which prints its banners; a layout
 *     other than the one in EEPROM loads the defaults;
 *   - anything else is a broken application: the board says nothing until it
 *     is power-cycled.
 * - The EEPROM is kept across everything except `e` (chip erase), which
 *   empties it; xboot reads it as raw bytes (the model's image as JSON).
 * - `inputs` are the eight switch inputs; a test closes and opens them
 *   (`setInput`), and the firmware reads them (`in1`..`in8`).
 * - `line` models what a real bench may do between the host and xboot, which
 *   the ideal link above never shows (`BoardLineFaults`).
 */
import '../marker.ts';
import type { DeviceIo, SimDevice } from '../device.ts';
import { TinyGEdgeNextModel } from './edgeNext.ts';
import type { TinyGModelOptions } from './common.ts';
import type { EepromImage } from './settings.ts';
import { SIM_APP_BYTES, readSimBuild, simImage, type SimBuild } from './simFirmware.ts';
import { XB_BOOT_BYTES, XB_EEPROM_BYTES, XbootModel, type XbootFaults, type XbootTimings } from './xboot.ts';

/**
 * Bench conditions on the way into xboot. Both make the bootloader never answer; they differ in what the host sees.
 */
export interface BoardLineFaults {
  /**
   * The USB bridge holds every byte from the host while xboot runs; xboot's replies would still reach the host. On
   * TinyG v8 the FT230X's CTS# input is wired to PC0, the firmware's RTS output, which the firmware drives and
   * xboot leaves undriven: a bridge that honours CTS# then stops sending as soon as the board resets into xboot.
   */
  readonly bridgeHoldsHostBytesInBootloader?: boolean;
  /** `{"boot":1}` restarts the application (banners and all) instead of entering xboot. */
  readonly softwareResetRunsApplication?: boolean;
}

export interface FlashableBoardOptions {
  /** The application section the board starts with (default: the simulated edge-next 450.01). */
  readonly flash?: Uint8Array;
  /** The EEPROM settings image (shared by reference across boots). */
  readonly eeprom?: EepromImage;
  /** Options for every edge-next model the board starts (build, onBootRequest and inputs are the board's). */
  readonly model?: Omit<TinyGModelOptions, 'eeprom' | 'build' | 'onBootRequest' | 'inputs' | 'start'>;
  /** `app` (default): the firmware is already running when the host connects. `boot`: it boots now. `bootloader`: xboot's power-on window. */
  readonly start?: 'app' | 'boot' | 'bootloader';
  readonly xboot?: Partial<XbootTimings>;
  readonly faults?: XbootFaults;
  readonly id?: string;
  /**
   * The link's line rate for xboot's own timing (a reply keeps it busy while it is sent). Default 115200; the
   * fake-serial board runs its link faster so a whole flash takes seconds, not a minute.
   */
  readonly linkBaud?: number;
  readonly line?: BoardLineFaults;
}

export type BoardState = 'app' | 'bootloader' | 'dead';

/** jmp 0x30000: the page-0 stub the flasher writes first. */
const STUB = [0x0d, 0x94, 0x00, 0x80];

export class FlashableBoard implements SimDevice {
  readonly usb = Object.freeze({ vendorId: 0x0403, productId: 0x6015 });
  readonly baudRate = 115200;
  /** Application section and boot section. */
  readonly memory: Uint8Array;
  readonly eepromBytes: Uint8Array;
  readonly xboot: XbootModel;
  eeprom: EepromImage;
  readonly inputs: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  /** Every state change, in order (tests). */
  readonly history: string[] = [];
  #options: FlashableBoardOptions;
  #io: DeviceIo | null = null;
  #state: BoardState = 'dead';
  #app: TinyGEdgeNextModel | null = null;
  #bannerDelay = 0;

  constructor(options: FlashableBoardOptions = {}) {
    this.#options = options;
    this.memory = new Uint8Array(SIM_APP_BYTES + XB_BOOT_BYTES).fill(0xff);
    this.memory.set(options.flash ?? simImage('current'), 0);
    // The boot section holds xboot: a fixed pattern, so its CRC is stable.
    for (let i = 0; i < XB_BOOT_BYTES; i++) this.memory[SIM_APP_BYTES + i] = (i * 7 + 3) & 0xff;
    this.eeprom = options.eeprom ?? {};
    this.eepromBytes = new Uint8Array(XB_EEPROM_BYTES).fill(0xff);
    this.xboot = new XbootModel(this.memory, this.eepromBytes, options.xboot ?? {}, options.faults ?? {});
    this.#syncEepromBytes();
  }

  get state(): BoardState {
    return this.#state;
  }

  /** The running edge-next model, while the firmware runs. */
  get app(): TinyGEdgeNextModel | null {
    return this.#app;
  }

  /** The build the application section holds, or null when it is not a complete image. */
  get build(): SimBuild | null {
    return readSimBuild(this.memory.subarray(0, SIM_APP_BYTES));
  }

  attach(io: DeviceIo): void {
    if (this.#io !== null) throw new Error('board already attached');
    this.#io = io;
    const start = this.#options.start ?? 'app';
    if (start === 'bootloader') this.#enterBootloader(false);
    else this.#startApplication(start === 'boot');
  }

  receive(byte: number, overrun: boolean): void {
    if (this.#state === 'app') this.#app?.receive(byte, overrun);
    else if (this.#state === 'bootloader' && this.#options.line?.bridgeHoldsHostBytesInBootloader !== true) this.xboot.receive(byte);
  }

  // --- FaultTarget ------------------------------------------------------------

  injectLimitSwitch(input: number): void {
    this.#app?.injectLimitSwitch(input);
  }

  setReportSuppression(on: boolean): void {
    this.#app?.setReportSuppression(on);
  }

  /** The reset button: xboot's 4.8 s window, then the application. */
  resetBoard(): void {
    this.#note('reset');
    this.#enterBootloader(false);
  }

  setBannerDelay(extraMs: number): void {
    this.#bannerDelay = extraMs;
  }

  // --- Test controls ----------------------------------------------------------

  /** Power off and on (USB unplugged and plugged back in on a USB-powered bench board). */
  powerCycle(): void {
    this.#note('power cycle');
    this.#enterBootloader(false);
  }

  /** Close (true) or open (false) switch input 1..8. */
  setInput(input: number, closed: boolean): void {
    if (!Number.isInteger(input) || input < 1 || input > 8) throw new RangeError('inputs are 1..8');
    this.inputs[input] = closed ? 1 : 0;
  }

  // --- Internals --------------------------------------------------------------

  #note(text: string): void {
    this.history.push(text);
    this.#io?.event(`board: ${text}`);
  }

  #enterBootloader(softwareReset: boolean): void {
    const io = this.#io as DeviceIo;
    this.#app = null;
    this.#state = 'bootloader';
    this.#syncEepromBytes();
    this.#note(softwareReset ? 'bootloader (software reset, 60 s window)' : 'bootloader (reset, short window)');
    this.xboot.start(
      {
        now: () => io.clock.now(),
        setTimeout: (fn, ms) => io.clock.setTimeout(fn, ms),
        clearTimeout: (id) => io.clock.clearTimeout(id),
        transmit: (bytes) => {
          if (this.#state === 'bootloader') io.transmit(bytes);
        },
        event: (note) => io.event(note),
        byteMs: () => 10_000 / (this.#options.linkBaud ?? this.baudRate),
        jumpToApplication: () => this.#startApplication(true),
      },
      softwareReset,
    );
  }

  #startApplication(printBanners: boolean): void {
    const io = this.#io as DeviceIo;
    this.xboot.stop();
    this.#app = null;
    this.#loadEepromBytes();
    const app = this.memory.subarray(0, SIM_APP_BYTES);
    if (STUB.every((b, i) => app[i] === b)) {
      // The stub jumps to the bootloader's reset vector: back into xboot (no software-reset flag).
      this.#note('page 0 is the bootloader stub: back into the bootloader (no application)');
      this.#enterBootloader(false);
      return;
    }
    const build = readSimBuild(app);
    if (build === null) {
      this.#state = 'dead';
      this.#note('the application section holds no complete image: the board runs nothing useful');
      return;
    }
    this.#state = 'app';
    const model = new TinyGEdgeNextModel({
      ...this.#options.model,
      ...(this.#options.id === undefined ? {} : { id: this.#options.id }),
      eeprom: this.eeprom,
      build,
      start: printBanners ? 'boot' : 'ready',
      onBootRequest: () => {
        if (this.#app !== model) return;
        if (this.#options.line?.softwareResetRunsApplication === true) {
          this.#note('software reset: the application starts again (no bootloader answered)');
          this.#startApplication(true);
        } else {
          this.#enterBootloader(true);
        }
      },
      inputs: (n) => this.inputs[n] ?? 0,
    });
    this.#app = model;
    this.#note(`application ${build.fb} (layout ${build.layout})`);
    model.attach({
      clock: io.clock,
      transmit: (data) => {
        if (this.#app === model && this.#state === 'app') io.transmit(data);
      },
      event: (note) => io.event(note),
    });
    if (this.#bannerDelay > 0) model.setBannerDelay(this.#bannerDelay);
  }

  /** The settings image as raw EEPROM bytes (what xboot's EEPROM read returns): JSON, then 0xFF. */
  #syncEepromBytes(): void {
    const text = new TextEncoder().encode(JSON.stringify(this.eeprom));
    this.eepromBytes.fill(0xff);
    this.eepromBytes.set(text.subarray(0, XB_EEPROM_BYTES), 0);
  }

  /** Back from the bootloader: an erased EEPROM (all 0xFF, after `e`) is an empty image (defaults on boot). */
  #loadEepromBytes(): void {
    if (this.eepromBytes.every((b) => b === 0xff)) {
      for (const k of Object.keys(this.eeprom)) delete this.eeprom[k];
    }
  }
}
