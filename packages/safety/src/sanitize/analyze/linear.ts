import {
  DECIMALS,
  moveSeconds,
  noVelocityMessage,
  splitLinear,
  stepErrorMm,
  type LinearAxis
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import type { Axis } from '../types.ts';
import { AXES } from '../types.ts';
import { type ModelContext } from './context.ts';
import { block, type Finding, type LineAnalysis } from './contract.ts';
import { bodies } from './formatting.ts';
import { forget, modelDelta, moveBy } from './motionPosition.ts';
import { settle, widen } from './uncertainty.ts';
import { mmPerUnit, motionBound, needsUnits, scale } from './units.ts';

/** G0/G1, optionally under G53. */
export function linear(ctx: ModelContext, ...[codes, params, axisWords, units, distance, mode, g53, findings]: [codes: readonly { word: Word; code: string }[], params: ReadonlyMap<string, Word>, axisWords: readonly Word[], units: 'G20' | 'G21' | null, distance: 'G90' | 'G91' | null, mode: 'G0' | 'G1', g53: boolean, findings: Finding[]]): LineAnalysis['motion'] {
  const delta: Partial<Record<Axis, number>> = {};
  const unknown: string[] = [];
  for (const w of axisWords) {
    const a = w.letter as Axis;
    let d: number | null;
    if (g53) {
      // G53 values are machine coordinates (G53 under G91 or an unknown distance mode is blocked above).
      const sc = scale(ctx, a, units);
      const m = ctx.machine[a];
      d = sc === null || m === null ? null : w.value * sc - m;
    } else {
      d = modelDelta(ctx, a, w.value, units, distance);
    }
    if (d === null) unknown.push(a);
    else delta[a] = d;
  }
  if (unknown.length > 0) {
    forget(ctx, axisWords);
    findings.push(block('unknown-state', unknownMessage(unknown.filter((a) => needsUnits(ctx, a as Axis)), unknown, units, distance, g53)));
    return null;
  }
  const moving = AXES.filter((a) => (delta[a] ?? 0) !== 0);
  const plannerLength = Math.hypot(...moving.map((a) => delta[a] as number));
  const boundMm = motionBound(ctx, delta);
  const feed = mode === 'G0' ? null : (ctx.feed as number);
  const d = moveSeconds(moving, plannerLength, feed, ctx._motion);
  const start = { ...ctx.work };
  const startMachine = { ...ctx.machine };
  moveBy(ctx, delta);
  for (const w of axisWords) settle(ctx, w.letter as Axis, g53 ? 'machine' : distance === 'G91' ? 'incremental' : 'work', delta[w.letter as Axis] as number);
  if (d.kind !== 'ok') {
    findings.push(block('no-velocity-limit', noVelocityMessage(d)));
    return null;
  }
  if (d.seconds <= ctx._motion.ceilingSeconds) return { kind: 'single', plannerLength, boundMm, seconds: d.seconds };
  return linearSplit(ctx, { g53, distance, axisWords, units, startMachine, start, feed, d, findings, delta, mode, codes, params });
}

export function linearSplit(ctx: ModelContext, { g53, distance, axisWords, units, startMachine, start, feed, d, findings, delta, mode, codes, params }: LinearSplitInput): LineAnalysis['motion'] {


  const absolute = g53 || distance === 'G90';
  const axes: LinearAxis[] = axisWords.map((w) => {
    const a = w.letter as Axis;
    const sc = scale(ctx, a, units) as number;
    const from = (g53 ? startMachine[a] : start[a]) ?? 0;
    return {
      axis: a,
      start: absolute ? from / sc : 0,
      delta: absolute ? w.value - from / sc : w.value,
      written: w.text,
      scale: sc,
      mmPerUnit: mmPerUnit(ctx, a),
      decimals: !needsUnits(ctx, a) ? DECIMALS.rotary : units === 'G20' ? DECIMALS.in : DECIMALS.mm,
    };
  });
  const split = splitLinear(axes, absolute, feed, d.seconds, ctx._motion);
  if (split.kind !== 'ok') {
    findings.push(block('split-impossible', `this move cannot be split within the ceiling: ${split.detail}`));
    return null;
  }
  // An incremental split is one firmware sum per sub-segment, each adding float32 rounding to the position
  // (finding: arc uncertainty, verification of c2799da). `#settle` above counted one; add the rest.
  if (!absolute) {
    for (const w of axisWords) {
      const a = w.letter as Axis;
      const reach = Math.max(Math.abs(startMachine[a] ?? 0), Math.abs(ctx.machine[a] ?? 0));
      widen(ctx, a, (split.segments.length - 1) * stepErrorMm(reach, delta[a] as number, ctx.totalOffset(a) ?? 0));
    }
  }
  const motionWords = g53 ? ['G53', mode] : [mode];
  return { kind: 'split', bodies: bodies(codes, params, split.segments, motionWords, new Set(['G53']), []), segments: split.segments, seconds: d.seconds };
}

export function unknownMessage(...[unitAxes, axes, units, distance, g53]: [unitAxes: readonly string[], axes: readonly string[], units: string | null, distance: string | null, g53: boolean]
): string {
  const what: string[] = [];
  if (units === null && unitAxes.length > 0) what.push('the units');
  if (!g53 && distance === null) what.push('the distance mode');
  if (what.length === 0) what.push(`the ${g53 ? 'machine' : 'work'} position of ${axes.join(', ')}`);
  return `this move cannot be checked against the queued-motion ceiling; not known: ${what.join(' and ')}`;
}

interface LinearSplitInput {
  g53: boolean;
  distance: "G90" | "G91" | null;
  axisWords: readonly Word[];
  units: "G20" | "G21" | null;
  startMachine: { X: number | null; Y: number | null; Z: number | null; A: number | null; B: number | null; C: number | null; };
  start: { X: number | null; Y: number | null; Z: number | null; A: number | null; B: number | null; C: number | null; };
  feed: number | null;
  d: { readonly kind: "ok"; readonly seconds: number; };
  findings: Finding[];
  delta: Partial<Record<Axis, number>>;
  mode: "G0" | "G1";
  codes: readonly { word: Word; code: string; }[];
  params: ReadonlyMap<string, Word>
}
