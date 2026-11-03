/**
 * The closed line grammar of the motion command kind (Phase 2, owner
 * 2026-11-02; SAFETY §4.5b, T-S94).
 *
 * The motion layer builds its lines here, and the session's write gate
 * (writePolicy.ts) admits a motion line only if it matches one of these
 * shapes exactly. Nothing else is a motion line: no other G or M word, no
 * comment, no N word, no second command, no JSON but the one `clear`.
 *
 * | Shape | Use |
 * |---|---|
 * | `G21 G91 G1 X<d> [Y<d>] [Z<d>] [A<d>] F<f>` | one jog piece (axes in XYZA order) |
 * | `G90` / `G90 G20` | restore absolute distance (and inches) after a jog |
 * | `G53 G0 Z<d>` | go to zero: raise Z in machine coordinates first |
 * | `G90 G0 X0 [Y0] [Z0] [A0]` | go to zero: rapid to work zero |
 * | `G10 L20 P<1-6> X0 [Y0] [Z0] [A0]` | set work zero in the active system (G54..G59), saved |
 * | `G28.2 X0 [Y0] [Z0] [A0]` | home the axes named (amendment 2026-11-02) |
 * | `G28.3 X0 [Y0] [Z0] [A0]` | set machine position 0 here, no motion (machines without switches) |
 * | `G92 X0 [Y0] [Z0] [A0]`, `G92.1` | temporary offset so the axes read 0 here; clear it (not saved) |
 * | `G54` .. `G59` | select the work coordinate system |
 * | `M3 S<rpm>`, `M4 S<rpm>`, `M5` | spindle CW, CCW, off |
 * | `M7`, `M8` | mist, flood |
 * | `M9` | coolant off |
 * | `{"clear":null}` | clear an alarm (C13) |
 *
 * Numbers: a distance is at most 5 integer and 4 decimal digits with an
 * optional minus, and |d| ≤ `MAX_MOTION_MM`; a feed is 1..`MAX_JOG_FEED`
 * mm/min in whole numbers; a speed 0..`MAX_RPM` in whole numbers.
 *
 * Pure: no imports, no state. A change to this file changes what the
 * session can make the machine do and needs safety review (SAFETY §8).
 */

/** Largest distance any motion line may name, mm (a 100 mm jog step plus margin; machine Z for safe height). */
export const MAX_MOTION_MM = 2000;
/** Fastest jog feed, mm/min (the firmware also caps it at the axis `fr`). */
export const MAX_JOG_FEED = 5000;
/** Highest spindle speed a line may name. */
export const MAX_RPM = 100000;

export type MotionAxisLetter = 'X' | 'Y' | 'Z' | 'A';
const ORDER: readonly MotionAxisLetter[] = ['X', 'Y', 'Z', 'A'];

const NUM = '-?\\d{1,5}(?:\\.\\d{1,4})?';

/** Each admitted shape, anchored. Axis words appear at most once each, in XYZA order. */
const SHAPES: readonly { readonly name: MotionLineKind; readonly re: RegExp }[] = [
  { name: 'jog', re: new RegExp(`^G21 G91 G1(?: X(${NUM}))?(?: Y(${NUM}))?(?: Z(${NUM}))?(?: A(${NUM}))? F(\\d{1,5})$`) },
  { name: 'restore', re: /^G90(?: G20)?$/ },
  { name: 'safeZ', re: new RegExp(`^G53 G0 Z(${NUM})$`) },
  { name: 'toZero', re: /^G90 G0(?: X0)?(?: Y0)?(?: Z0)?(?: A0)?$/ },
  { name: 'setZero', re: /^G10 L20 P[1-6](?: X0)?(?: Y0)?(?: Z0)?(?: A0)?$/ },
  { name: 'home', re: /^G28\.2(?: X0)?(?: Y0)?(?: Z0)?(?: A0)?$/ },
  { name: 'setPosition', re: /^G28\.3(?: X0)?(?: Y0)?(?: Z0)?(?: A0)?$/ },
  { name: 'tempOffset', re: /^G92(?: X0)?(?: Y0)?(?: Z0)?(?: A0)?$/ },
  { name: 'clearTempOffset', re: /^G92\.1$/ },
  { name: 'selectCoord', re: /^G5[4-9]$/ },
  { name: 'spindle', re: /^M[34] S(\d{1,6})$/ },
  { name: 'spindleOff', re: /^M5$/ },
  { name: 'coolant', re: /^M[78]$/ },
  { name: 'coolantOff', re: /^M9$/ },
  { name: 'clear', re: /^\{"clear":null\}$/ },
];

export type MotionLineKind =
  | 'jog'
  | 'restore'
  | 'safeZ'
  | 'toZero'
  | 'setZero'
  | 'home'
  | 'setPosition'
  | 'tempOffset'
  | 'clearTempOffset'
  | 'selectCoord'
  | 'spindle'
  | 'spindleOff'
  | 'coolant'
  | 'coolantOff'
  | 'clear';

/**
 * The allow-matrix intents that may issue each kind of line (amendment 2026-11-02, T-S94): the write gate
 * refuses a motion line issued by any other intent, so a bug cannot, say, send G28.2 as a jog.
 */
export const LINE_INTENTS: Readonly<Record<MotionLineKind, readonly string[]>> = Object.freeze({
  jog: ['jog'],
  restore: ['jog', 'stopJob'],
  safeZ: ['goToZero'],
  toZero: ['goToZero'],
  setZero: ['setWorkZero'],
  home: ['home'],
  setPosition: ['setMachinePosition'],
  tempOffset: ['tempOffset'],
  clearTempOffset: ['tempOffset'],
  selectCoord: ['selectCoordSystem'],
  spindle: ['spindleOn'],
  spindleOff: ['spindleOffNow', 'stopJob'],
  coolant: ['spindleOn'],
  coolantOff: ['spindleOffNow', 'stopJob'],
  clear: ['clearAlarm'],
});

/** The kind of a motion line, or undefined when it is not exactly one of the admitted shapes. */
export function motionLineKind(line: string): MotionLineKind | undefined {
  for (const { name, re } of SHAPES) {
    const m = re.exec(line);
    if (m === null) continue;
    if (name === 'jog') {
      const distances = m.slice(1, 5).filter((v): v is string => v !== undefined).map(Number);
      const feed = Number(m[5]);
      if (distances.length === 0 || distances.some((d) => Math.abs(d) > MAX_MOTION_MM || d === 0)) return undefined;
      if (!(feed >= 1 && feed <= MAX_JOG_FEED)) return undefined;
      return name;
    }
    if (name === 'safeZ' && Math.abs(Number(m[1])) > MAX_MOTION_MM) return undefined;
    if ((name === 'toZero' || name === 'setZero' || name === 'home' || name === 'setPosition' || name === 'tempOffset') && !/ [XYZA]0/.test(line)) return undefined;
    if (name === 'spindle' && Number(m[1]) > MAX_RPM) return undefined;
    return name;
  }
  return undefined;
}

/** A distance as the grammar writes it: at most 4 decimals, no trailing zeros, no `-0`. */
export function mm(value: number): string {
  // toFixed never writes "-0" for a negative zero, and a negative value rounds to at least -0.0001.
  return (Math.round(value * 10000) / 10000).toFixed(4).replace(/\.?0+$/, '');
}

/** `G21 G91 G1 X.. Y.. F..`: one jog piece. Axes with a zero distance are left out. */
export function jogLine(move: Readonly<Partial<Record<MotionAxisLetter, number>>>, feed: number): string {
  const words = ORDER.filter((a) => move[a] !== undefined && mm(move[a] as number) !== '0').map((a) => `${a}${mm(move[a] as number)}`);
  return `G21 G91 G1 ${words.join(' ')} F${Math.round(feed)}`;
}

/** `G90`, plus `G20` when the board was in inches before the motion (`unit` 0). */
export function restoreLine(units: number | undefined): string {
  return units === 0 ? 'G90 G20' : 'G90';
}

export function safeZLine(machineZ: number): string {
  return `G53 G0 Z${mm(machineZ)}`;
}

function zeroWords(axes: readonly MotionAxisLetter[]): string {
  return ORDER.filter((a) => axes.includes(a))
    .map((a) => `${a}0`)
    .join(' ');
}

export function toZeroLine(axes: readonly MotionAxisLetter[]): string {
  return `G90 G0 ${zeroWords(axes)}`;
}

/** `G10 L20 P<system> ...`: `system` 1 = G54 .. 6 = G59. */
export function setZeroLine(axes: readonly MotionAxisLetter[], system = 1): string {
  return `G10 L20 P${system} ${zeroWords(axes)}`;
}

export function homeLine(axes: readonly MotionAxisLetter[]): string {
  return `G28.2 ${zeroWords(axes)}`;
}

export function setPositionLine(axes: readonly MotionAxisLetter[]): string {
  return `G28.3 ${zeroWords(axes)}`;
}

export function tempOffsetLine(axes: readonly MotionAxisLetter[]): string {
  return `G92 ${zeroWords(axes)}`;
}

export const CLEAR_TEMP_OFFSET_LINE = 'G92.1';

/** `G54`..`G59` for `system` 1..6. */
export function selectCoordLine(system: number): string {
  return `G${53 + system}`;
}

export function spindleLine(direction: 'cw' | 'ccw', rpm: number): string {
  return `${direction === 'cw' ? 'M3' : 'M4'} S${Math.round(rpm)}`;
}

export const CLEAR_LINE = '{"clear":null}';
