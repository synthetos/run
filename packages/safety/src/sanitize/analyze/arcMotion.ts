import { extendByArc } from '../extent.ts';
import {
  DECIMALS,
  formatNumber,
  moveSeconds,
  noVelocityMessage,
  splitArc,
  stepErrorMm,
  type ArcInput, type ArcModel,
  type Plane,
  type Segment
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import type { Axis } from '../types.ts';
import { type ModelContext } from './context.ts';
import { block, type Finding, type LineAnalysis } from './contract.ts';
import { bodies } from './formatting.ts';
import { moveBy } from './motionPosition.ts';
import { settle, widen } from './uncertainty.ts';

export function arcMotion(ctx: ModelContext, { p, input, model, plane, params, absolute, findings, units, s, absoluteCentre, clockwise, codes }: ArcMotionInput): LineAnalysis['motion'] {

  const moving: Axis[] = [p.a0, p.a1];
  if (input.dLin !== 0) moving.push(p.lin);
  const feed = ctx.feed as number;
  const d = moveSeconds(moving, model.arc.lengthMm, feed, ctx._motion);
  const start = { ...ctx.work };
  ctx._extent = extendByArc(ctx._extent, ctx.machine, plane as Plane, model.arc);
  moveBy(ctx, { [p.a0]: input.d0, [p.a1]: input.d1, [p.lin]: input.dLin });
  // An omitted axis ends exactly where it was (the firmware's target starts as its position).
  for (const [a, delta] of [[p.a0, input.d0], [p.a1, input.d1], [p.lin, input.dLin]] as const) {
    if (params.has(a)) settle(ctx, a, absolute ? 'work' : 'incremental', delta);
  }
  if (d.kind !== 'ok') {
    findings.push(block('no-velocity-limit', noVelocityMessage(d)));
    return null;
  }
  // Arcs carry no rotary words (blocked above), so the arc length is a physical length in mm.
  if (d.seconds <= ctx._motion.ceilingSeconds) {
    return { kind: 'single', plannerLength: model.arc.lengthMm, boundMm: model.arc.lengthMm, seconds: d.seconds };
  }
  return arcSplit(ctx, { units, start, s, absolute, p, findings, params, model, input, plane, absoluteCentre, feed, d, clockwise, codes });
}

export function arcSplit(ctx: ModelContext, { units, start, s, absolute, p, findings, params, model, input, plane, absoluteCentre, feed, d, clockwise, codes }: ArcSplitInput): LineAnalysis['motion'] {


  const dec = units === 'G20' ? DECIMALS.in : DECIMALS.mm;
  const startOf = (axis: Axis): number | null => {
    const v = start[axis];
    return v === null ? null : v / s;
  };
  // An absolute split writes both plane axes on every sub-arc, so each start must be known (independent review P0-10 #2).
  const unwritable = absolute ? [p.a0, p.a1].filter((a) => startOf(a) === null) : [];
  if (unwritable.length > 0) {
    findings.push(
      block('unknown-state', `this arc must be split, but the start position of ${unwritable.join(', ')} is not known, so its sub-arc end points cannot be written`),
    );
    return null;
  }
  const writtenOf = (axis: Axis, delta: number): string => {
    const w = params.get(axis);
    if (w !== undefined) return w.text;
    return absolute ? formatNumber(startOf(axis) as number, dec) : formatNumber(delta / s, dec);
  };
  const split = splitArc(
    model.arc,
    input,
    {
      plane: plane as Plane,
      absolute,
      absoluteCentre,
      start0: startOf(p.a0),
      start1: startOf(p.a1),
      startLin: startOf(p.lin),
      scale: s,
      decimals: dec,
      written: { a0: writtenOf(p.a0, input.d0), a1: writtenOf(p.a1, input.d1), lin: writtenOf(p.lin, input.dLin) },
      linearMoves: input.dLin !== 0,
    },
    feed,
    d.seconds,
    ctx._motion,
  );
  if (split.kind !== 'ok') {
    findings.push(block('split-impossible', `this arc cannot be split within the ceiling: ${split.detail}`));
    return null;
  }
  return arcFinish(ctx, { absolute, p, params, writtenOf, s, start, split, model, input, clockwise, codes, d });
}

export function arcFinish(ctx: ModelContext, { absolute, p, params, writtenOf, s, start, split, model, input, clockwise, codes, d }: ArcFinishInput): LineAnalysis['motion'] {

  // The sub-arcs are what the firmware sums (finding: arc uncertainty, verification of c2799da):
  // - absolute: the last sub-arc writes an omitted plane axis as its start rounded to `dec` decimals, so the
  //   board ends at the written value, not exactly where it was;
  // - incremental: every sub-arc writes both plane axes (and a moving linear axis) as a distance the firmware
  //   adds to its own position, one float32 rounding each.
  if (absolute) {
    for (const a of [p.a0, p.a1]) {
      if (params.has(a)) continue;
      settle(ctx, a, 'work', 0);
      widen(ctx, a, Math.abs(Number(writtenOf(a, 0)) * s - (start[a] as number)));
    }
  } else {
    const n = split.segments.length;
    for (const a of [p.a0, p.a1]) widen(ctx, a, n * stepErrorMm(model.arc.pathMagnitudeMm));
    if (input.dLin !== 0) {
      // An unknown position or offset (Number(null) is 0 here) already has an infinite bound.
      const lin = p.lin;
      const reach = Math.abs(Number(ctx.machine[lin])) + Math.abs(input.dLin);
      widen(ctx, lin, n * stepErrorMm(reach, input.dLin, Number(ctx.totalOffset(lin))));
    }
  }
  const mode = clockwise ? 'G2' : 'G3';
  return { kind: 'split', bodies: bodies(codes, params, split.segments, [mode], new Set(), ['P']), segments: split.segments, seconds: d.seconds };
}

interface ArcMotionInput {
  p: { readonly a0: "X"; readonly a1: "Y"; readonly lin: "Z"; readonly o0: "I"; readonly o1: "J"; } | { readonly a0: "Z"; readonly a1: "X"; readonly lin: "Y"; readonly o0: "K"; readonly o1: "I"; } | { readonly a0: "Y"; readonly a1: "Z"; readonly lin: "X"; readonly o0: "J"; readonly o1: "K"; };
  input: ArcInput;
  model: { readonly kind: "ok"; readonly arc: ArcModel; };
  plane: "G17" | "G18" | "G19" | null;
  params: ReadonlyMap<string, Word>;
  absolute: boolean;
  findings: Finding[];
  units: "G20" | "G21" | null;
  s: 25.4 | 1;
  absoluteCentre: boolean;
  clockwise: boolean;
  codes: readonly { word: Word; code: string; }[]
}

interface ArcSplitInput {
  units: "G20" | "G21" | null;
  start: { X: number | null; Y: number | null; Z: number | null; A: number | null; B: number | null; C: number | null; };
  s: 25.4 | 1;
  absolute: boolean;
  p: { readonly a0: "X"; readonly a1: "Y"; readonly lin: "Z"; readonly o0: "I"; readonly o1: "J"; } | { readonly a0: "Z"; readonly a1: "X"; readonly lin: "Y"; readonly o0: "K"; readonly o1: "I"; } | { readonly a0: "Y"; readonly a1: "Z"; readonly lin: "X"; readonly o0: "J"; readonly o1: "K"; };
  findings: Finding[];
  params: ReadonlyMap<string, Word>;
  model: { readonly kind: "ok"; readonly arc: ArcModel; };
  input: ArcInput;
  plane: "G17" | "G18" | "G19" | null;
  absoluteCentre: boolean;
  feed: number;
  d: { readonly kind: "ok"; readonly seconds: number; };
  clockwise: boolean;
  codes: readonly { word: Word; code: string; }[]
}

interface ArcFinishInput {
  absolute: boolean;
  p: { readonly a0: "X"; readonly a1: "Y"; readonly lin: "Z"; readonly o0: "I"; readonly o1: "J"; } | { readonly a0: "Z"; readonly a1: "X"; readonly lin: "Y"; readonly o0: "K"; readonly o1: "I"; } | { readonly a0: "Y"; readonly a1: "Z"; readonly lin: "X"; readonly o0: "J"; readonly o1: "K"; };
  params: ReadonlyMap<string, Word>;
  writtenOf: (axis: Axis, delta: number) => string;
  s: 25.4 | 1;
  start: { X: number | null; Y: number | null; Z: number | null; A: number | null; B: number | null; C: number | null; };
  split: { readonly kind: "ok"; readonly segments: readonly Segment[]; };
  model: { readonly kind: "ok"; readonly arc: ArcModel; };
  input: ArcInput;
  clockwise: boolean;
  codes: readonly { word: Word; code: string; }[];
  d: { readonly kind: "ok"; readonly seconds: number; }
}
