import {
  PLANES,
  ROTARY,
  modelArc,
  type ArcInput,
  type Plane
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import type { Axis } from '../types.ts';
import { arcMotion } from './arcMotion.ts';
import { type ModelContext } from './context.ts';
import { block, type Finding, type LineAnalysis } from './contract.ts';
import { forgetLinear, modelDelta, planeMagnitude } from './motionPosition.ts';
import { INCH_MM } from './tables.ts';

/** G2/G3. */
export function arc(ctx: ModelContext, ...[codes, params, axisWords, units, distance, arcDistance, plane, clockwise, findings]: [codes: readonly { word: Word; code: string }[], params: ReadonlyMap<string, Word>, axisWords: readonly Word[], units: 'G20' | 'G21' | null, distance: 'G90' | 'G91' | null, arcDistance: 'G90.1' | 'G91.1' | null, plane: Plane | null, clockwise: boolean, findings: Finding[]]): LineAnalysis['motion'] {
  const forget = (): null => {
    forgetLinear(ctx);
    return null;
  };
  if (axisWords.some((w) => ROTARY.has(w.letter as Axis))) {
    findings.push(block('unsupported-word', 'rotary axis words on an arc are not modelled; write the rotary move on its own line'));
    return forget();
  }
  const centreFormat = !params.has('R');
  const unknown: string[] = [];
  if (plane === null) unknown.push('the plane');
  if (units === null) unknown.push('the units');
  if (distance === null) unknown.push('the distance mode');
  if (centreFormat && arcDistance === null) unknown.push('the arc distance mode');
  if (unknown.length > 0) {
    findings.push(block('unknown-state', `this arc cannot be modelled; not known: ${unknown.join(', ')}`));
    return forget();
  }
  return arcGeometry(ctx, { plane, units, params, distance, centreFormat, arcDistance, findings, forget, clockwise, codes });
}

export function arcGeometry(ctx: ModelContext, { plane, units, params, distance, centreFormat, arcDistance, findings, forget, clockwise, codes }: ArcGeometryInput): LineAnalysis['motion'] {

  const p = PLANES[plane as Plane];
  const s = units === 'G20' ? INCH_MM : 1;
  const deltaOf = (axis: Axis): number | null => {
    const w = params.get(axis);
    return w === undefined ? 0 : modelDelta(ctx, axis, w.value, units, distance);
  };
  const d0 = deltaOf(p.a0);
  const d1 = deltaOf(p.a1);
  const dLin = deltaOf(p.lin);
  const absoluteCentre = centreFormat && arcDistance === 'G90.1';
  const absolute = distance === 'G90';
  const noPlaneEndpoint = !params.has(p.a0) && !params.has(p.a1);
  const w0 = ctx.work[p.a0];
  const w1 = ctx.work[p.a1];
  const { missing } = arcMissing({ d0, p, d1, dLin, absoluteCentre, w0, w1, centreFormat, noPlaneEndpoint, absolute });
  if (missing.length > 0) {
    findings.push(block('unknown-state', `this arc cannot be modelled: the start position of ${missing.join(', ')} is not known`));
    return forget();
  }
  return arcModel(ctx, { p, findings, forget, params, s, absolute, absoluteCentre, clockwise, d0, d1, dLin, centreFormat, w0, w1, noPlaneEndpoint, plane, units, codes });
}

export function arcMissing({ d0, p, d1, dLin, absoluteCentre, w0, w1, centreFormat, noPlaneEndpoint, absolute }: ArcMissingInput): { missing: string[] } {

  const missing: string[] = [];
  if (d0 === null) missing.push(p.a0);
  if (d1 === null) missing.push(p.a1);
  if (dLin === null) missing.push(p.lin);
  if (absoluteCentre && (w0 === null || w1 === null)) missing.push(`${p.a0}${p.a1} (for the G90.1 centre)`);
  // An absolute full circle ends where it starts: both plane starts must be known, never assumed (independent review P0-10 #2).
  if (centreFormat && noPlaneEndpoint && absolute && (w0 === null || w1 === null)) missing.push(`${p.a0}${p.a1} (for an absolute full circle)`);
  return { missing };
}

export function arcModel(ctx: ModelContext, { p, findings, forget, params, s, absolute, absoluteCentre, clockwise, d0, d1, dLin, centreFormat, w0, w1, noPlaneEndpoint, plane, units, codes }: ArcModelInput): LineAnalysis['motion'] {

  // The firmware decides coincidence in float32 machine coordinates; their size bounds its rounding (independent review P0-10 #1).
  const magnitude = planeMagnitude(ctx, [p.a0, p.a1]);
  if (magnitude === null) {
    findings.push(
      block('unknown-state', `this arc cannot be modelled: the machine position of ${p.a0} and ${p.a1} is needed to bound the firmware's float32 arithmetic`),
    );
    return forget();
  }
  const o = (letter: string): number => (params.get(letter)?.value ?? 0) * s;
  // How far the firmware's start-relative end point and centre can be from the model's: an absolute end point
  // word and a G90.1 centre are measured from the work start, which is only known to `uWork`; an incremental
  // word or offset is added to the firmware's own position and inherits nothing.
  let startUncertainty = 0;
  for (const a of [p.a0, p.a1]) {
    if ((absolute && params.has(a)) || absoluteCentre) startUncertainty = Math.max(startUncertainty, ctx.uWork[a]);
  }
  const input: ArcInput = {
    clockwise,
    d0: d0 as number,
    d1: d1 as number,
    dLin: dLin as number,
    centre: centreFormat
      ? { c0: absoluteCentre ? o(p.o0) - (w0 as number) : o(p.o0), c1: absoluteCentre ? o(p.o1) - (w1 as number) : o(p.o1) }
      : null,
    radius: centreFormat ? null : (params.get('R') as Word).value * s,
    noPlaneEndpoint,
    rotations: params.get('P')?.value ?? null,
    coincidence: ctx._job.arcCoincidence,
    magnitudeMm: magnitude,
    startUncertaintyMm: startUncertainty,
  };
  const model = modelArc(input);
  if (model.kind === 'ambiguous') {
    findings.push(block('arc-ambiguous', `the firmware's float32 arithmetic could run this arc more than one way: ${model.detail}`));
    return forget();
  }
  if (model.kind !== 'ok') {
    findings.push(block('malformed', `the firmware would refuse this arc: ${model.detail}`));
    return forget();
  }
  return arcMotion(ctx, { p, input, model, plane, params, absolute, findings, units, s, absoluteCentre, clockwise, codes });
}

interface ArcGeometryInput {
  plane: "G17" | "G18" | "G19" | null;
  units: "G20" | "G21" | null;
  params: ReadonlyMap<string, Word>;
  distance: "G90" | "G91" | null;
  centreFormat: boolean;
  arcDistance: "G90.1" | "G91.1" | null;
  findings: Finding[];
  forget: () => null;
  clockwise: boolean;
  codes: readonly { word: Word; code: string; }[]
}

interface ArcMissingInput {
  d0: number | null;
  p: { readonly a0: "X"; readonly a1: "Y"; readonly lin: "Z"; readonly o0: "I"; readonly o1: "J"; } | { readonly a0: "Z"; readonly a1: "X"; readonly lin: "Y"; readonly o0: "K"; readonly o1: "I"; } | { readonly a0: "Y"; readonly a1: "Z"; readonly lin: "X"; readonly o0: "J"; readonly o1: "K"; };
  d1: number | null;
  dLin: number | null;
  absoluteCentre: boolean;
  w0: number | null;
  w1: number | null;
  centreFormat: boolean;
  noPlaneEndpoint: boolean;
  absolute: boolean
}

interface ArcModelInput {
  p: { readonly a0: "X"; readonly a1: "Y"; readonly lin: "Z"; readonly o0: "I"; readonly o1: "J"; } | { readonly a0: "Z"; readonly a1: "X"; readonly lin: "Y"; readonly o0: "K"; readonly o1: "I"; } | { readonly a0: "Y"; readonly a1: "Z"; readonly lin: "X"; readonly o0: "J"; readonly o1: "K"; };
  findings: Finding[];
  forget: () => null;
  params: ReadonlyMap<string, Word>;
  s: 25.4 | 1;
  absolute: boolean;
  absoluteCentre: boolean;
  clockwise: boolean;
  d0: number | null;
  d1: number | null;
  dLin: number | null;
  centreFormat: boolean;
  w0: number | null;
  w1: number | null;
  noPlaneEndpoint: boolean;
  plane: "G17" | "G18" | "G19" | null;
  units: "G20" | "G21" | null;
  codes: readonly { word: Word; code: string; }[]
}
