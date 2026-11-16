/** Extracted model inputs and validation. */
import '../marker.ts';
import { EN_TABLE, statusCode } from './table.ts';
export type MotionMode = 'g0' | 'g1' | 'g2' | 'g3' | 'cancel';
export interface GcodeInput {
  override?: number;
  motion?: MotionMode;
  cancel?: boolean;
  nextAction?: 'dwell' | 'motionSync' | 'setOrigin' | 'resetOrigin' | 'setCoord' | 'homing' | 'setAbsoluteOrigin' | 'probe';
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

/** Motion prerequisites are checked before a block queues any command. */
export function motionInputStatus(g: GcodeInput, mode: MotionMode): number | null {
  if (g.cancel === true && g.motion === undefined) g.motion = 'cancel';
  const motion = g.motion ?? mode;
  if (g.absoluteOverride === true && g.nextAction === undefined && motion !== 'g0' && motion !== 'g1') return statusCode(EN_TABLE, 'GCODE_G53_WITHOUT_G0_OR_G1');
  if (g.target.some(t => t !== undefined) && g.nextAction === undefined && motion === 'cancel') return statusCode(EN_TABLE, 'GCODE_AXIS_CANNOT_BE_PRESENT');
  return null;
}
