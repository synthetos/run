import {
  ROTARY
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import type { Axis } from '../types.ts';
import { AXES, AXIS_MODE_INHIBITED, AXIS_MODE_RADIUS, AXIS_MODE_STANDARD } from '../types.ts';
import { jointRiskFinding, linearModeFinding, modeOf, rotaryUnknown } from './axisModes.ts';
import { type ModelContext } from './context.ts';
import { block, type Finding } from './contract.ts';
import { ROTARY_AXES } from './tables.ts';
import { unitScale } from './units.ts';

export function deriveFeed(ctx: ModelContext, { F, isArcMove, isLinearMove, motionMode, findings }: DeriveFeedInput): { feed: number | null } {

  // F is converted with the units in force BEFORE this line's G20/G21: both firmwares set the feed
  // rate before they apply the line's units mode (@cite EN gcode_parser.c:627-633 vs :659,
  // canonical_machine.c:1447; TG gcode_parser.c:455 vs :474). `G20 G1 X4 F2` on a G21 board runs
  // at 2 mm/min, not 50.8.
  const feedScale = unitScale(ctx.units);
  const feed = F === undefined ? ctx.feed : F.value > 0 && feedScale !== null ? F.value * feedScale : null;
  const feedMove = isArcMove || (isLinearMove && motionMode === 'G1');
  if (feedMove && F !== undefined && F.value > 0 && feedScale === null) {
    findings.push(block('unknown-state', 'the units in force before this line are not known, and the firmware converts F with them; set G20 or G21 on an earlier line'));
  } else if (feedMove && feed === null) {
    findings.push(block('feed-not-set', 'a feed move needs a feed rate: set F before the first G1, G2 or G3'));
  }
  return { feed };
}

export function checkMoveModes(ctx: ModelContext, { isLinearMove, axisWords, findings, isArcMove }: CheckMoveModesInput): void {

  // A move word on a rotary axis needs its axis mode (and radius in radius mode) to be modelled.
  // (Arcs refuse rotary words outright; G28/G30 are covered below.)
  if (isLinearMove) {
    for (const w of axisWords) {
      const f = rotaryUnknown(ctx, w.letter as Axis);
      if (f !== null) findings.push(f);
    }
  }
  // A move word on a linear axis needs it to be a length the firmware moves (finding: inhibited axis, am on X/Y/Z).
  if (isLinearMove || isArcMove) {
    for (const w of axisWords) {
      const f = linearModeFinding(ctx, w.letter as Axis);
      if (f !== null) findings.push(f);
    }
  }
}

export function checkStoredAxes(ctx: ModelContext, { action, findings }: CheckStoredAxesInput): void {

  // G28/G30 also move every axis to the stored position. 440.21 passes that stored position through
  // `_calc_ABC` again (@cite TG canonical_machine.c:907-914 via cm_set_model_target), so a radius-mode
  // rotary axis would turn by a different amount than modelled; an unknown mode could be radius.
  if (action === 'G28' || action === 'G30') {
    const risky = ROTARY_AXES.filter((a) => {
      const mode = ctx._motion.rotary[a]?.mode;
      return mode === undefined || mode === AXIS_MODE_RADIUS;
    });
    if (risky.length > 0) {
      findings.push(block('rotary-radius', `${action} cannot be modelled while ${risky.join(', ')} ${risky.length === 1 ? 'is' : 'are'} in radius mode or of unknown axis mode`));
    }
    // The stored-position leg skips a disabled axis on both firmwares, but EN moves a linear axis that
    // reads radius mode while 440.21 does not (@cite EN canonical_machine.c:1293-1300; TG via cm_set_model_target).
    const linearOdd = AXES.filter((a) => !ROTARY.has(a)).filter((a) => {
      const mode = modeOf(ctx, a);
      return mode !== AXIS_MODE_STANDARD && mode !== AXIS_MODE_INHIBITED;
    });
    if (linearOdd.length > 0) {
      findings.push(block('axis-mode', `${action} cannot be modelled while ${linearOdd.join(', ')} ${linearOdd.length === 1 ? 'is' : 'are'} disabled, in radius mode or of unknown axis mode`));
    }
  }
}

export function checkJointRisk(ctx: ModelContext, { isLinearMove, isArcMove, action, findings }: CheckJointRiskInput): void {

  // Finding: inhibited axis. Any executed segment can drive an inhibited axis's motor to step 0.
  if (isLinearMove || isArcMove || action === 'G28' || action === 'G30') {
    const f = jointRiskFinding(ctx);
    if (f !== null) findings.push(f);
  }
}

interface DeriveFeedInput {
  F: Word | undefined;
  isArcMove: boolean;
  isLinearMove: boolean;
  motionMode: "G0" | "G1" | "G2" | "G3" | "G80" | null;
  findings: Finding[]
}

interface CheckMoveModesInput {
  isLinearMove: boolean;
  axisWords: Word[];
  findings: Finding[];
  isArcMove: boolean
}

interface CheckStoredAxesInput {
  action: string | undefined;
  findings: Finding[]
}

interface CheckJointRiskInput {
  isLinearMove: boolean;
  isArcMove: boolean;
  action: string | undefined;
  findings: Finding[]
}
