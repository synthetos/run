import {
  formatNumber,
  moveSeconds,
  noVelocityMessage
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import type { Axis } from '../types.ts';
import { AXES } from '../types.ts';
import { type ModelContext } from './context.ts';
import { block, type Finding, type LineAnalysis } from './contract.ts';
import { modelDelta, moveBy } from './motionPosition.ts';
import { shift } from './offsets.ts';
import { type Unc } from './positions.ts';
import { settle } from './uncertainty.ts';
import { motionBound, scale } from './units.ts';

/**
   * G28/G30: a rapid to the intermediate point, then a rapid on every axis to
   * the stored position (@cite EN canonical_machine.c:1390-1405). Two moves in
   * one block cannot be split, so the pair must fit within the ceiling. The
   * intermediate point is in work or machine coordinates as the dialect says
   * (`storedMoveIntermediate`; 440.21 reads it as machine coordinates).
   */
export function storedMove(ctx: ModelContext, ...[action, axisWords, units, distance, findings]: [action: 'G28' | 'G30', axisWords: readonly Word[], units: 'G20' | 'G21' | null, distance: 'G90' | 'G91' | null, findings: Finding[]]): LineAnalysis['motion'] {
  const stored = action === 'G28' ? ctx.g28 : ctx.g30;
  const storedUnc = action === 'G28' ? ctx.uG28 : ctx.uG30;
  const first: Partial<Record<Axis, number>> = {};
  const unknown: string[] = [];
  const machineFrame = ctx._job.storedMoveIntermediate === 'machine';
  for (const w of axisWords) {
    const a = w.letter as Axis;
    let d: number | null;
    if (machineFrame && distance === 'G90') {
      const sc = scale(ctx, a, units);
      const m = ctx.machine[a];
      d = sc === null || m === null ? null : w.value * sc - m;
    } else {
      d = modelDelta(ctx, a, w.value, units, distance);
    }
    if (d === null) unknown.push(a);
    else first[a] = d;
  }
  const second: Partial<Record<Axis, number>> = {};
  for (const a of AXES) {
    const m = ctx.machine[a];
    const s = stored[a];
    if (m === null || s === null) {
      unknown.push(`${action} ${a}`);
      continue;
    }
    second[a] = s - (m + (first[a] ?? 0));
  }
  if (unknown.length > 0) {
    ctx.machine = { ...stored };
    ctx.uMachine = { ...storedUnc };
    for (const a of AXES) shift(ctx, a, null, Infinity);
    findings.push(block('unknown-state', `${action} cannot be modelled: the position or stored position of ${unique(unknown).join(', ')} is not known`));
    return null;
  }
  return storedLegs(ctx, { first, second, storedUnc, findings, action });
}

export function storedLegs(ctx: ModelContext, { first, second, storedUnc, findings, action }: StoredLegsInput): LineAnalysis['motion'] {

  const legs = [first, second].map((delta) => {
    const moving = AXES.filter((a) => (delta[a] ?? 0) !== 0);
    const length = Math.hypot(...moving.map((a) => delta[a] as number));
    return { length, bound: motionBound(ctx, delta), d: moveSeconds(moving, length, null, ctx._motion) };
  });
  moveBy(ctx, first);
  moveBy(ctx, second);
  // The second leg ends at the stored position on every axis, which is only known to its reported precision.
  for (const a of AXES) settle(ctx, a, 'machine', second[a] as number, storedUnc[a]);
  let seconds = 0;
  for (const leg of legs) {
    if (leg.d.kind !== 'ok') {
      findings.push(block('no-velocity-limit', noVelocityMessage(leg.d)));
      return null;
    }
    seconds += leg.d.seconds;
  }
  const plannerLength = legs.reduce((sum, leg) => sum + leg.length, 0);
  const boundMm = legs.reduce<number | null>((sum, leg) => (sum === null || leg.bound === null ? null : sum + leg.bound), 0);
  if (seconds > ctx._motion.ceilingSeconds) {
    findings.push(block('split-impossible', `${action} moves for about ${formatNumber(seconds, 1)} s, above the queued-motion ceiling, and cannot be split`));
    return null;
  }
  return { kind: 'single', plannerLength, boundMm, seconds };
}

export function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

interface StoredLegsInput {
  first: Partial<Record<Axis, number>>;
  second: Partial<Record<Axis, number>>;
  storedUnc: Unc;
  findings: Finding[];
  action: "G28" | "G30"
}
