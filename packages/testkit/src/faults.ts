/**
 * Fault plans (ROADMAP P0-11, RUN_PLAN §8.1 "FaultPlan").
 *
 * A fault plan is plain data: a list of faults the simulated link and device
 * apply during a run. Byte faults select bytes either by exact index (counted
 * from 0 per direction, from the moment the endpoint is created) or by a
 * probability drawn from the run's seeded RNG. Probability draws happen once
 * per byte per probabilistic fault, in plan order, so the same seed and plan
 * always pick the same bytes (determinism acceptance).
 *
 * Times (`atMs`, `fromMs`, `toMs`) are virtual milliseconds relative to the
 * endpoint's creation.
 *
 * The list follows RUN_PLAN §8.1: byte drop, corruption, duplication;
 * latency; disconnect at byte N; alarm at T; report suppression; board reset;
 * XOFF bursts; banner delay; ring overrun.
 */

/** `toDevice`: host → controller. `toHost`: controller → host. */
export type Direction = 'toDevice' | 'toHost';

export type ByteSelector =
  /** Exactly these byte indices (0-based, per direction). */
  | { readonly at: readonly number[] }
  /** Each byte with this probability, optionally only within [fromByte, toByte). */
  | { readonly probability: number; readonly fromByte?: number; readonly toByte?: number };

export type Fault =
  | { readonly kind: 'drop'; readonly direction: Direction; readonly select: ByteSelector }
  /** XOR the byte with `xor` (1..255), or flip one random bit when `xor` is absent. */
  | { readonly kind: 'corrupt'; readonly direction: Direction; readonly select: ByteSelector; readonly xor?: number }
  | { readonly kind: 'duplicate'; readonly direction: Direction; readonly select: ByteSelector }
  /** Add `extraMs` to every byte sent in [fromMs, toMs). Delivery order is kept. */
  | { readonly kind: 'latency'; readonly direction: Direction; readonly fromMs: number; readonly toMs: number; readonly extraMs: number }
  /** The link goes down just before byte `atByte` of `direction` would cross. */
  | { readonly kind: 'disconnect'; readonly direction: Direction; readonly atByte: number }
  /** A limit switch closes at `atMs` (the firmware model decides what that means). */
  | { readonly kind: 'alarm'; readonly atMs: number; readonly cause: 'limitSwitch' }
  /** The device sends no status or queue reports in [fromMs, toMs). */
  | { readonly kind: 'suppressReports'; readonly fromMs: number; readonly toMs: number }
  /** The board resets at `atMs` (brown-out, watchdog): state is lost and the boot banner prints again. */
  | { readonly kind: 'boardReset'; readonly atMs: number }
  /**
   * Spurious flow control from the controller side: XOFF at `atMs`, XON
   * `holdMs` later, `repeat` times (default 1), `everyMs` apart.
   */
  | {
      readonly kind: 'xoffBurst';
      readonly atMs: number;
      readonly holdMs: number;
      readonly repeat?: number;
      readonly everyMs?: number;
    }
  /** Every boot banner of this run is delayed by `extraMs`. */
  | { readonly kind: 'bannerDelay'; readonly extraMs: number }
  /**
   * Host bytes `atByte` .. `atByte + count - 1` (toDevice indices) reach the
   * controller while its receive ring is full, so the ring loses them.
   */
  | { readonly kind: 'ringOverrun'; readonly atByte: number; readonly count?: number };

export interface FaultPlan {
  readonly faults: readonly Fault[];
}

export const NO_FAULTS: FaultPlan = Object.freeze({ faults: Object.freeze([]) });

const isIndex = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const isTime = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const isDirection = (d: unknown): d is Direction => d === 'toDevice' || d === 'toHost';

function checkSelector(s: ByteSelector, where: string): void {
  if (typeof s !== 'object' || s === null) throw new TypeError(`${where}: select must be an object`);
  if ('at' in s) {
    if (!Array.isArray(s.at) || s.at.length === 0 || !s.at.every(isIndex)) throw new TypeError(`${where}: select.at must be a non-empty list of byte indices`);
    return;
  }
  if (!(typeof s.probability === 'number' && s.probability >= 0 && s.probability <= 1)) {
    throw new RangeError(`${where}: select.probability must be in [0, 1]`);
  }
  if (s.fromByte !== undefined && !isIndex(s.fromByte)) throw new TypeError(`${where}: fromByte must be a byte index`);
  if (s.toByte !== undefined && !isIndex(s.toByte)) throw new TypeError(`${where}: toByte must be a byte index`);
  if (s.fromByte !== undefined && s.toByte !== undefined && s.toByte <= s.fromByte) throw new RangeError(`${where}: toByte must be after fromByte`);
}

/**
 * Check a plan and return a deep-frozen copy. Every malformed field is an
 * error: a typo in a fault plan must never silently become "no fault".
 */
export function validateFaultPlan(plan: FaultPlan): FaultPlan {
  if (typeof plan !== 'object' || plan === null || !Array.isArray(plan.faults)) throw new TypeError('a fault plan is { faults: Fault[] }');
  const faults = plan.faults.map((f, i): Fault => {
    const where = `fault ${i} (${String((f as { kind?: unknown }).kind)})`;
    switch (f.kind) {
      case 'drop':
      case 'duplicate':
        if (!isDirection(f.direction)) throw new TypeError(`${where}: direction must be toDevice or toHost`);
        checkSelector(f.select, where);
        return Object.freeze({ ...f, select: Object.freeze({ ...f.select }) });
      case 'corrupt':
        if (!isDirection(f.direction)) throw new TypeError(`${where}: direction must be toDevice or toHost`);
        checkSelector(f.select, where);
        if (f.xor !== undefined && !(Number.isInteger(f.xor) && f.xor >= 1 && f.xor <= 255)) throw new RangeError(`${where}: xor must be 1..255`);
        return Object.freeze({ ...f, select: Object.freeze({ ...f.select }) });
      case 'latency':
        if (!isDirection(f.direction)) throw new TypeError(`${where}: direction must be toDevice or toHost`);
        if (!isTime(f.fromMs) || !isTime(f.toMs) || f.toMs <= f.fromMs) throw new RangeError(`${where}: needs 0 <= fromMs < toMs`);
        if (!isTime(f.extraMs)) throw new RangeError(`${where}: extraMs must be >= 0`);
        return Object.freeze({ ...f });
      case 'disconnect':
        if (!isDirection(f.direction)) throw new TypeError(`${where}: direction must be toDevice or toHost`);
        if (!isIndex(f.atByte)) throw new TypeError(`${where}: atByte must be a byte index`);
        return Object.freeze({ ...f });
      case 'alarm':
        if (!isTime(f.atMs)) throw new RangeError(`${where}: atMs must be >= 0`);
        if (f.cause !== 'limitSwitch') throw new TypeError(`${where}: cause must be limitSwitch`);
        return Object.freeze({ ...f });
      case 'suppressReports':
        if (!isTime(f.fromMs) || !isTime(f.toMs) || f.toMs <= f.fromMs) throw new RangeError(`${where}: needs 0 <= fromMs < toMs`);
        return Object.freeze({ ...f });
      case 'boardReset':
        if (!isTime(f.atMs)) throw new RangeError(`${where}: atMs must be >= 0`);
        return Object.freeze({ ...f });
      case 'xoffBurst': {
        if (!isTime(f.atMs) || !(isTime(f.holdMs) && f.holdMs > 0)) throw new RangeError(`${where}: needs atMs >= 0 and holdMs > 0`);
        const repeat = f.repeat ?? 1;
        if (!(Number.isInteger(repeat) && repeat >= 1)) throw new RangeError(`${where}: repeat must be an integer >= 1`);
        if (repeat > 1 && !(isTime(f.everyMs) && (f.everyMs as number) > f.holdMs)) throw new RangeError(`${where}: everyMs must exceed holdMs when repeating`);
        return Object.freeze({ ...f });
      }
      case 'bannerDelay':
        if (!isTime(f.extraMs)) throw new RangeError(`${where}: extraMs must be >= 0`);
        return Object.freeze({ ...f });
      case 'ringOverrun': {
        if (!isIndex(f.atByte)) throw new TypeError(`${where}: atByte must be a byte index`);
        const count = f.count ?? 1;
        if (!(Number.isInteger(count) && count >= 1)) throw new RangeError(`${where}: count must be an integer >= 1`);
        return Object.freeze({ ...f });
      }
      default:
        throw new TypeError(`${where}: unknown fault kind`);
    }
  });
  return Object.freeze({ faults: Object.freeze(faults) });
}

/** What happens to one byte crossing the link. */
export interface ByteFate {
  /** Bytes actually delivered (empty when dropped, two when duplicated). */
  readonly deliver: readonly number[];
  /** The link must go down before this byte. */
  readonly disconnect: boolean;
  /** Toward the device only: the ring loses this byte (forced overrun). */
  readonly overrun: boolean;
  /** Transcript notes for the faults that acted. */
  readonly notes: readonly string[];
}

/** Selects and applies the byte faults of one direction. */
export class ByteFaults {
  readonly #faults: readonly Fault[];
  readonly #direction: Direction;
  readonly #rng: { chance(p: number): boolean; int(n: number): number };
  #index = 0;

  constructor(plan: FaultPlan, direction: Direction, rng: { chance(p: number): boolean; int(n: number): number }) {
    this.#faults = plan.faults;
    this.#direction = direction;
    this.#rng = rng;
  }

  /** Index the next byte will get. */
  get index(): number {
    return this.#index;
  }

  /** Extra latency for a byte sent at `t` (relative ms). */
  latencyAt(t: number): number {
    let extra = 0;
    for (const f of this.#faults) {
      if (f.kind === 'latency' && f.direction === this.#direction && t >= f.fromMs && t < f.toMs) extra += f.extraMs;
    }
    return extra;
  }

  /** Decide the fate of the next byte. Advances the byte index and the RNG deterministically. */
  next(byte: number): ByteFate {
    const i = this.#index++;
    const notes: string[] = [];
    let disconnect = false;
    let overrun = false;
    let dropped = false;
    let duplicated = false;
    let value = byte;
    for (const f of this.#faults) {
      switch (f.kind) {
        case 'disconnect':
          if (f.direction === this.#direction && f.atByte === i) {
            disconnect = true;
            notes.push(`disconnect before ${this.#direction} byte ${i}`);
          }
          break;
        case 'drop':
          if (f.direction === this.#direction && this.#selected(f.select, i)) {
            dropped = true;
            notes.push(`drop ${this.#direction} byte ${i} (0x${hex(byte)})`);
          }
          break;
        case 'corrupt':
          if (f.direction === this.#direction && this.#selected(f.select, i)) {
            const mask = f.xor ?? 1 << this.#rng.int(8);
            value ^= mask;
            notes.push(`corrupt ${this.#direction} byte ${i} 0x${hex(byte)} -> 0x${hex(value)}`);
          }
          break;
        case 'duplicate':
          if (f.direction === this.#direction && this.#selected(f.select, i)) {
            duplicated = true;
            notes.push(`duplicate ${this.#direction} byte ${i} (0x${hex(byte)})`);
          }
          break;
        case 'ringOverrun':
          if (this.#direction === 'toDevice' && i >= f.atByte && i < f.atByte + (f.count ?? 1)) {
            overrun = true;
            notes.push(`ring overrun loses toDevice byte ${i} (0x${hex(byte)})`);
          }
          break;
        default:
          break;
      }
    }
    const deliver = dropped || disconnect ? [] : duplicated ? [value, value] : [value];
    return { deliver, disconnect, overrun, notes };
  }

  #selected(s: ByteSelector, i: number): boolean {
    if ('at' in s) return s.at.includes(i);
    const inWindow = (s.fromByte === undefined || i >= s.fromByte) && (s.toByte === undefined || i < s.toByte);
    // Only bytes inside the window consume a draw, so a window never shifts the draws of other bytes.
    return inWindow && this.#rng.chance(s.probability);
  }
}

function hex(b: number): string {
  return b.toString(16).padStart(2, '0');
}
