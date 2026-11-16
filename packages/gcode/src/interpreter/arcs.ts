import {
  PLANES,
  modelArc,
  type Axis
} from '@synthetos/safety';
import { KIND, LINE_FLAG } from '../types.ts';
import { PLANE_INDEX } from './constants.ts';
import { type Pos } from './contract.ts';
import { offset, unitScale, work } from './coordinates.ts';
import { addFinding } from './findings.ts';
import { jump, kindBits } from './linear.ts';
import { type InterpreterContext } from './state.ts';
import { estimateTime } from './timing.ts';

export function interpretArc(ctx: InterpreterContext, ...[to, axisWords, params, src, n, i]: [to: Pos, axisWords: ReadonlyMap<Axis, number>, params: ReadonlyMap<string, number>, src: number, n: number, i: number]): void {
  const plane = ctx.plane;
  const ax = PLANES[plane];
  const blocked = ctx.dialect.gcode.blocked.find((r) => r.kind === 'arcInPlane' && r.plane === plane);
  if (blocked !== undefined) {
    // Never drawn with another firmware's direction: the jump is shown, the arc is not.
    addFinding(ctx, src, n, 'block', blocked.id, blocked.reason);
    ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
    jump(ctx, to, i);
    return;
  }
  const a0 = ax.a0 as Axis;
  const a1 = ax.a1 as Axis;
  const lin = ax.lin as Axis;
  const r = params.get('R');
  const o0 = params.get(ax.o0);
  const o1 = params.get(ax.o1);
  let centre: { c0: number; c1: number } | null = null;
  if (r === undefined) {
    if (ctx.arcDistance === 'G90.1') {
      centre = {
        c0: (o0 === undefined ? work(ctx, a0) : o0 * unitScale(ctx)) + offset(ctx, a0) - ctx.machine[a0],
        c1: (o1 === undefined ? work(ctx, a1) : o1 * unitScale(ctx)) + offset(ctx, a1) - ctx.machine[a1],
      };
    } else centre = { c0: (o0 ?? 0) * unitScale(ctx), c1: (o1 ?? 0) * unitScale(ctx) };
  }
  const p = params.get('P');
  const result = modelArc({
    clockwise: ctx.motion === 'G2',
    d0: to[a0] - ctx.machine[a0],
    d1: to[a1] - ctx.machine[a1],
    dLin: to[lin] - ctx.machine[lin],
    centre,
    radius: r === undefined ? null : r * unitScale(ctx),
    noPlaneEndpoint: !axisWords.has(a0) && !axisWords.has(a1),
    rotations: p ?? null,
    coincidence: ctx.job.arcCoincidence,
    magnitudeMm: Math.max(
      Math.abs(ctx.machine[a0]),
      Math.abs(ctx.machine[a1]),
      Math.abs(work(ctx, a0)),
      Math.abs(work(ctx, a1)),
      Math.abs(offset(ctx, a0)),
      Math.abs(offset(ctx, a1)),
    ),
    startUncertaintyMm: 0,
  });
  if (result.kind === 'invalid') {
    addFinding(ctx, src, n, 'block', 'arc-rejected', `the firmware will reject this arc: ${result.detail} (plan_arc.h tolerances)`);
    ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
    return;
  }
  if (result.kind === 'ambiguous') {
    addFinding(ctx, src, n, 'block', 'arc-ambiguous', `the firmware's decision for this arc cannot be predicted: ${result.detail}`);
    ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.NOT_DRAWN;
    jump(ctx, to, i);
    return;
  }
  ctx.flags[i] = (ctx.flags[i] as number) | LINE_FLAG.ARC;
  ctx.events.arc(ctx.machine, to, result.arc.lengthMm, ctx.uncertain, ctx.feed, [PLANE_INDEX[plane], result.arc.radius, result.arc.theta, result.arc.travel, to[lin] - ctx.machine[lin]]);
  ctx.arcs++;
  ctx.feedMm += result.arc.lengthMm;
  estimateTime(ctx, result.arc.lengthMm, to, false);
  ctx.pieces.push({ kind: 'arc', line: i, from: { ...ctx.machine }, to, arc: result.arc, plane, k: kindBits(ctx, KIND.ARC) });
  ctx.machine = to;
  ctx.movedYet = true;
}
