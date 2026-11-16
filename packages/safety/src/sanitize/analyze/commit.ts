import {
  ROTARY,
  stepErrorMm
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import type { Axis, Wcs } from '../types.ts';
import { AXES } from '../types.ts';
import { type ModelContext } from './context.ts';
import { appliedTool, selectWcs, shift } from './offsets.ts';
import { offsetScale } from './units.ts';

export function commitModal(ctx: ModelContext, { units, distance, arcDistance, plane, motionMode, feed, toolSet, axisWords, toolCancel, wcs }: CommitModalInput): void {


  // --- Modal updates (they apply before the block's action, EN execution order). ---
  ctx.units = units;
  ctx.distance = distance;
  ctx.arcDistance = arcDistance;
  ctx.plane = plane;
  ctx.motionMode = motionMode;
  ctx.feed = feed;
  if (toolSet) {
    for (const w of axisWords) {
      const a = w.letter as Axis;
      const sc = offsetScale(ctx, a, units);
      const before = appliedTool(ctx, a);
      const beforeUnc = ROTARY.has(a) ? 0 : ctx.uTool[a];
      const after = sc === null ? null : w.value * sc;
      ctx.toolOffset[a] = after;
      ctx.uTool[a] = after === null ? Infinity : stepErrorMm(after);
      const applied = appliedTool(ctx, a);
      shift(ctx, a, before === null || applied === null ? null : before - applied, beforeUnc + (ROTARY.has(a) ? 0 : ctx.uTool[a]));
    }
  }
  if (toolCancel) {
    for (const a of AXES) {
      const before = appliedTool(ctx, a);
      const beforeUnc = ROTARY.has(a) ? 0 : ctx.uTool[a];
      ctx.toolOffset[a] = 0;
      ctx.uTool[a] = 0;
      shift(ctx, a, before, beforeUnc);
    }
  }
  selectWcs(ctx, wcs);
}

interface CommitModalInput {
  units: "G20" | "G21" | null;
  distance: "G90" | "G91" | null;
  arcDistance: "G90.1" | "G91.1" | null;
  plane: "G17" | "G18" | "G19" | null;
  motionMode: "G0" | "G1" | "G2" | "G3" | "G80" | null;
  feed: number | null;
  toolSet: boolean;
  axisWords: Word[];
  toolCancel: boolean;
  wcs: Wcs | null
}
