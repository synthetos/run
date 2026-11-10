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
 * | `G21` | millimetres, on its own answered line before the first jog piece: the firmware reads F before G20/G21 in the same block (independent review 2026-11-03, R2) |
 * | `G21 G91 G1 X<d> [Y<d>] [Z<d>] [A<d>] F<f>` | one jog piece (axes in XYZA order) |
 * | `G90 G21` | explicit absolute millimetres, on its own answered line before a `G53` move: G53 zeroes offsets but keeps G91 and G20 (independent review 2026-11-03, R1) |
 * | `G90` / `G91`, with `G20` or `G21` | restore the distance mode and the units after a jog, go to zero or a tool-change return |
 * | `G53 G0 X<d> Y<d>` | back to where a job stopped for a tool change, at a safe height (Phase 3) |
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
 * | `[G90] [G21] G17 [G91.1]`, `[G90] [G21] G91.1` | a job's start modes, the ones the preview assumes, before its first line (OD-19); `G21`, `G90` and `G90 G21` alone are the `units` and `restore` shapes, admitted for the same use |
 * | `G91 G38.2 Z-<n> F<f>` | Probe Z: the one probe move, n ≤ 15 mm, f ≤ 100 mm/min (SAFETY §4.5c, H90) |
 * | `G10 L20 P<1-6> Z<n>` | Probe Z: the zero it sets, |n| ≤ 50 mm, always written with 4 decimals (never `Z0`, set zero's shape) |
 * | a typed move | H91: one G0/G1/G2/G3/G4 line of the typed grammar (safety typedLine.ts), admitted only from `typedMove` and only as the exact line the session is sending now (no shape here) |
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
/** Probe Z (SAFETY §4.5c): the deepest probe move, mm, the fastest probe feed, mm/min, and the largest zero, mm. */
export const MAX_PROBE_DEPTH_MM = 15;
export const MAX_PROBE_FEED = 100;
export const MAX_PROBE_ZERO_MM = 50;

export type MotionAxisLetter = 'X' | 'Y' | 'Z' | 'A';
const ORDER: readonly MotionAxisLetter[] = ['X', 'Y', 'Z', 'A'];

const NUM = '-?\\d{1,5}(?:\\.\\d{1,4})?';

/** Each admitted shape, anchored. Axis words appear at most once each, in XYZA order. */
const SHAPES: readonly { readonly name: MotionLineKind; readonly re: RegExp }[] = [
  { name: 'units', re: /^G21$/ },
  { name: 'jog', re: new RegExp(`^G21 G91 G1(?: X(${NUM}))?(?: Y(${NUM}))?(?: Z(${NUM}))?(?: A(${NUM}))? F(\\d{1,5})$`) },
  { name: 'restore', re: /^G9[01](?: G2[01])?$/ },
  { name: 'safeZ', re: new RegExp(`^G53 G0 Z(${NUM})$`) },
  { name: 'returnXY', re: new RegExp(`^G53 G0 X(${NUM}) Y(${NUM})$`) },
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
  // OD-19: a job's start modes with the plane or the arc distance mode (the subsets without them are units and restore).
  { name: 'jobModes', re: /^(?:G90 )?(?:G21 )?(?:G17|G91\.1|G17 G91\.1)$/ },
  // After setZero, so `G10 L20 P1 Z0` stays a set-zero line; the probe's zero always carries decimals.
  { name: 'probe', re: new RegExp(`^G91 G38\\.2 Z-(${NUM}) F(\\d{1,3})$`) },
  { name: 'probeZero', re: new RegExp(`^G10 L20 P[1-6] Z(${NUM})$`) },
];

export type MotionLineKind =
  | 'units'
  | 'jog'
  | 'restore'
  | 'safeZ'
  | 'returnXY'
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
  | 'clear'
  | 'jobModes'
  | 'probe'
  | 'probeZero'
  /** H91: a typed move. Never matched by a shape here: the write gate admits only the exact line being sent (typedMove.ts). */
  | 'typed';

/**
 * The allow-matrix intents that may issue each kind of line (amendment 2026-11-02, T-S94): the write gate
 * refuses a motion line issued by any other intent, so a bug cannot, say, send G28.2 as a jog.
 */
export const LINE_INTENTS: Readonly<Record<MotionLineKind, readonly string[]>> = Object.freeze({
  // Probe Z writes `G21` on its own answered line before its probe move, and puts the modes back after its zero.
  units: ['jog', 'probeZ', 'jobModes'],
  jog: ['jog'],
  // Go to zero and a tool-change return establish `G90 G21` first and put the modes back after (R1).
  // OD-19: a job's start modes (`G90`, `G90 G21`) and the G90 after a Clear alarm that ended a motion of run's.
  restore: ['jog', 'stopJob', 'goToZero', 'resume', 'probeZ', 'jobModes', 'alarmRestore'],
  safeZ: ['goToZero', 'resume'],
  returnXY: ['resume'],
  toZero: ['goToZero'],
  setZero: ['setWorkZero'],
  home: ['home'],
  setPosition: ['setMachinePosition'],
  tempOffset: ['tempOffset'],
  clearTempOffset: ['tempOffset'],
  selectCoord: ['selectCoordSystem'],
  spindle: ['spindleOn', 'resume'],
  spindleOff: ['spindleOffNow', 'stopJob'],
  coolant: ['spindleOn', 'resume'],
  coolantOff: ['spindleOffNow', 'stopJob'],
  clear: ['clearAlarm'],
  jobModes: ['jobModes'],
  probe: ['probeZ'],
  probeZero: ['probeZ'],
  typed: ['typedMove'],
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
    if (name === 'returnXY' && (Math.abs(Number(m[1])) > MAX_MOTION_MM || Math.abs(Number(m[2])) > MAX_MOTION_MM)) return undefined;
    if ((name === 'toZero' || name === 'setZero' || name === 'home' || name === 'setPosition' || name === 'tempOffset') && !/ [XYZA]0/.test(line)) return undefined;
    if (name === 'spindle' && Number(m[1]) > MAX_RPM) return undefined;
    if (name === 'probe' && !(Number(m[1]) > 0 && Number(m[1]) <= MAX_PROBE_DEPTH_MM && Number(m[2]) >= 1 && Number(m[2]) <= MAX_PROBE_FEED)) return undefined;
    if (name === 'probeZero' && Math.abs(Number(m[1])) > MAX_PROBE_ZERO_MM) return undefined;
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

/**
 * `G90` (or `G91` when the board was incremental, `dist` 1), plus `G20` when it was in inches (`unit` 0). The
 * units word is left out when they were millimetres or are not known: every sequence this restores has already
 * put the board in millimetres (`G21`, or `G90 G21`).
 */
export function restoreLine(units: number | undefined, dist?: number): string {
  return `${dist === 1 ? 'G91' : 'G90'}${units === 0 ? ' G20' : ''}`;
}

/**
 * Millimetres, written on its own and answered before the first jog piece (independent review 2026-11-03, R2):
 * the firmware sets F before it changes units in the same block (gcode_parser.c order, firmware-semantics
 * EN-FEED-UNITS-ORDER), so a piece sent while the board is in inches would run at 25.4 times the feed.
 */
export const UNITS_LINE = 'G21';

/**
 * Explicit absolute millimetres, written on its own and answered before any `G53 G0` move (independent review
 * 2026-11-03, R1): G53 only zeroes the offsets; under G91 the Z word is still a distance and under G20 it is
 * inches (firmware-semantics EN-AXIS-MODES), so a "safe" Z could go down or 25.4 times too far.
 */
export const ABSOLUTE_MM_LINE = 'G90 G21';

export function safeZLine(machineZ: number): string {
  return `G53 G0 Z${mm(machineZ)}`;
}

/** `G53 G0 X<x> Y<y>`: back to where a job stopped for a tool change (Phase 3, H74), after `ABSOLUTE_MM_LINE`. */
export function returnXYLine(x: number, y: number): string {
  return `G53 G0 X${mm(x)} Y${mm(y)}`;
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

/** Probe Z: `G91 G38.2 Z-<depth> F<feed>`, the one probe move (SAFETY §4.5c). `feed` is a whole number. */
export function probeLine(depthMm: number, feed: number): string {
  return `G91 G38.2 Z-${mm(depthMm)} F${Math.round(feed)}`;
}

/** Probe Z: `G10 L20 P<system> Z<z>` with exactly 4 decimals, so it is never set zero's `Z0` (SAFETY §4.5c). */
export function probeZeroLine(system: number, z: number): string {
  return `G10 L20 P${system} Z${(Math.round(z * 10000) / 10000 + 0).toFixed(4)}`;
}
