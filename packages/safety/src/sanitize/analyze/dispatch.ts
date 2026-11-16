import {
  type Segment
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import { runAction } from './actions.ts';
import { arc } from './arc.ts';
import { type ModelContext } from './context.ts';
import { type Finding, type LineAnalysis } from './contract.ts';
import { linear } from './linear.ts';

export function dispatchMotion(ctx: ModelContext, { action, axisWords, units, distance, params, findings, isLinearMove, codes, motionMode, g53, isArcMove, arcDistance, plane }: DispatchMotionInput): { motion: { readonly kind: "single"; readonly plannerLength: number; readonly boundMm: number | null; readonly seconds: number; } | { readonly kind: "split"; readonly bodies: readonly string[]; readonly segments: readonly Segment[]; readonly seconds: number; } | null } {


  let motion: LineAnalysis['motion'] = null;
  if (action !== undefined) {
    motion = runAction(ctx, action, axisWords, units, distance, params, findings);
  } else if (isLinearMove) {
    motion = linear(ctx, codes, params, axisWords, units, distance, motionMode as 'G0' | 'G1', g53, findings);
  } else if (isArcMove) {
    motion = arc(ctx, codes, params, axisWords, units, distance, arcDistance, plane, motionMode === 'G2', findings);
  }
  return { motion };
}

interface DispatchMotionInput {
  action: string | undefined;
  axisWords: Word[];
  units: "G20" | "G21" | null;
  distance: "G90" | "G91" | null;
  params: Map<string, Word>;
  findings: Finding[];
  isLinearMove: boolean;
  codes: { word: Word; code: string; }[];
  motionMode: "G0" | "G1" | "G2" | "G3" | "G80" | null;
  g53: boolean;
  isArcMove: boolean;
  arcDistance: "G90.1" | "G91.1" | null;
  plane: "G17" | "G18" | "G19" | null
}
