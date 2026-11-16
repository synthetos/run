import type { RotaryAxis } from '../types.ts';
import { AXES } from '../types.ts';

/** Modal groups: two codes of one group on a line is a modal conflict (EN E152). */
export const GROUP: Readonly<Record<string, string>> = Object.freeze({
  G0: 'motion', G1: 'motion', G2: 'motion', G3: 'motion', G80: 'cancel',
  G4: 'action', G10: 'action', G28: 'action', 'G28.1': 'action', 'G28.2': 'action', 'G28.3': 'action',
  'G28.4': 'action', G30: 'action', 'G30.1': 'action', 'G38.2': 'action', G92: 'action', 'G92.1': 'action',
  'G92.2': 'action', 'G92.3': 'action', M105: 'action', M114: 'action', M115: 'action', M400: 'action',
  'M201.3': 'action',
  G17: 'plane', G18: 'plane', G19: 'plane',
  G90: 'distance', G91: 'distance',
  'G90.1': 'arcDistance', 'G91.1': 'arcDistance',
  G93: 'feedMode', G94: 'feedMode',
  G20: 'units', G21: 'units',
  G54: 'wcs', G55: 'wcs', G56: 'wcs', G57: 'wcs', G58: 'wcs', G59: 'wcs',
  G61: 'path', 'G61.1': 'path', G64: 'path',
  'G43.1': 'toolOffset', G49: 'toolOffset',
  M0: 'program', M1: 'program', M2: 'program', M30: 'program', M60: 'program',
  M3: 'spindle', M4: 'spindle', M5: 'spindle',
  M7: 'coolant', M8: 'coolant', M9: 'coolant',
  M48: 'override', M49: 'override', M50: 'override', M51: 'override',
});

/** Group-0 codes whose axis words are not motion (NIST 3.4; @cite EN gcode_parser.c `_validate_gcode_block`). */
export const AXIS_ACTIONS: ReadonlySet<string> = new Set(['G10', 'G28', 'G30', 'G92']);

/** Codes executed after the motion of their block (program flow). They go on the last sub-segment. */
export const AFTER_MOTION: ReadonlySet<string> = new Set(['M0', 'M1', 'M2', 'M30', 'M60']);

export const MOTION_CODES: ReadonlySet<string> = new Set(['G0', 'G1', 'G2', 'G3']);

export const AXIS_LETTERS: ReadonlySet<string> = new Set(AXES);

export const ARC_LETTERS: ReadonlySet<string> = new Set(['I', 'J', 'K', 'R']);

export const INCH_MM = 25.4;

export const ROTARY_AXES: readonly RotaryAxis[] = ['A', 'B', 'C'];
