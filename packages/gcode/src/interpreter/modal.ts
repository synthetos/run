import {
  WCS_CODES,
  type Axis
} from '@synthetos/safety';
import { ROTARY } from './constants.ts';
import { unitScale, zero } from './coordinates.ts';
import { addFindingOnce } from './findings.ts';
import { type InterpreterContext } from './state.ts';

export function unitsAndPlane(ctx: InterpreterContext, { has, src, n }: UnitsAndPlaneInput): void {


  // Modal state.
  for (const p of ['G17', 'G18', 'G19'] as const) if (has(p)) ctx.plane = p;
  for (const u of ['G20', 'G21'] as const) {
    if (!has(u)) continue;
    if (ctx.movedYet && ctx.unitsSeen && u !== ctx.units) {
      addFindingOnce(ctx, 'units-switched', src, n, 'warn', 'units-switched', `units switched to ${u} after motion: check that the rest of the file expects ${u === 'G20' ? 'inches' : 'millimetres'}`);
    }
    ctx.units = u;
    ctx.unitsSeen = true;
  }
}

export function offsetsAndModes(ctx: InterpreterContext, { has, axisWords }: OffsetsAndModesInput): void {

  if (has('G49')) ctx.tool = zero();
  if (has('G43.1')) for (const [a, v] of axisWords) if (!ROTARY.has(a)) ctx.tool[a] = v * unitScale(ctx);
  for (const w of WCS_CODES) if (has(w)) ctx.wcs = w;
  for (const d of ['G90', 'G91'] as const) {
    if (has(d)) {
      ctx.distance = d;
      ctx.distanceSeen = true;
    }
  }
  if (has('G90.1')) ctx.arcDistance = 'G90.1';
  if (has('G91.1')) ctx.arcDistance = 'G91.1';
}

export function feedAndWords(ctx: InterpreterContext, { params, codes }: FeedAndWordsInput): void {

  // F is read in the units in force for this line.
  const f = params.get('F');
  if (f !== undefined) ctx.feed = f * unitScale(ctx);
  ctx.events.words(codes, params.get('S'), params.get('T'));
}

interface UnitsAndPlaneInput {
  has: (c: string) => boolean;
  src: number;
  n: number
}

interface OffsetsAndModesInput {
  has: (c: string) => boolean;
  axisWords: Map<Axis, number>
}

interface FeedAndWordsInput {
  params: Map<string, number>;
  codes: string[]
}
