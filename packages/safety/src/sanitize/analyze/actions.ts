import {
  stepErrorMm
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import type { Axis, Wcs } from '../types.ts';
import { WCS_CODES } from '../types.ts';
import { type ModelContext } from './context.ts';
import { type Finding, type LineAnalysis } from './contract.ts';
import { g92Part, g92PartUnc, setG92, shift } from './offsets.ts';
import { exactUnc, zeroPos } from './positions.ts';
import { storedMove } from './stored.ts';
import { setWork } from './uncertainty.ts';
import { offsetScale } from './units.ts';

/** Group-0 actions: offsets, stored positions, dwell. */
export function runAction(ctx: ModelContext, ...[action, axisWords, units, distance, params, findings]: [action: string, axisWords: readonly Word[], units: 'G20' | 'G21' | null, distance: 'G90' | 'G91' | null, params: ReadonlyMap<string, Word>, findings: Finding[]]): LineAnalysis['motion'] {
  switch (action) {
    case 'G10': {
      return setWcsOffset(ctx, { params, axisWords, units });
    }
    case 'G92': {
      return setTemporaryOffset(ctx, { axisWords, units });
    }
    case 'G92.1':
      setG92(ctx, false, zeroPos(), exactUnc());
      return null;
    case 'G92.2':
      setG92(ctx, false, null, null);
      return null;
    case 'G92.3':
      setG92(ctx, true, null, null);
      return null;
    case 'G28.1':
      ctx.g28 = { ...ctx.machine };
      ctx.uG28 = { ...ctx.uMachine };
      return null;
    case 'G30.1':
      ctx.g30 = { ...ctx.machine };
      ctx.uG30 = { ...ctx.uMachine };
      return null;
    case 'G28':
    case 'G30':
      return storedMove(ctx, action, axisWords, units, distance, findings);
    default:
      // G4: a dwell does not move.
      return null;
  }
}

export function setWcsOffset(ctx: ModelContext, { params, axisWords, units }: SetWcsOffsetInput): LineAnalysis['motion'] {

  const target = WCS_CODES[(params.get('P') as Word).value - 1] as Wcs;
  const l20 = (params.get('L') as Word).value === 20;
  for (const w of axisWords) {
    const a = w.letter as Axis;
    const sc = offsetScale(ctx, a, units);
    const value = sc === null ? null : w.value * sc;
    if (!l20) {
      const before = ctx.wcsOffsets[target][a];
      const beforeUnc = ctx.uWcs[target][a];
      ctx.wcsOffsets[target][a] = value;
      ctx.uWcs[target][a] = value === null ? Infinity : stepErrorMm(value);
      if (ctx.wcs === target) shift(ctx, a, before === null || value === null ? null : before - value, beforeUnc + ctx.uWcs[target][a]);
    } else {
      // L20: the offset that makes the current position read `value` in that system (@cite EN canonical_machine.c:1055-1062).
      // It inherits the machine position's uncertainty; the work position then reads `value` itself.
      const m = ctx.machine[a];
      const g = g92Part(ctx, a);
      const t = ctx.toolOffset[a];
      const known = m !== null && value !== null && g !== null && t !== null;
      ctx.wcsOffsets[target][a] = known ? m - value - g - t : null;
      ctx.uWcs[target][a] = known ? ctx.uMachine[a] + g92PartUnc(ctx, a) + ctx.uTool[a] + stepErrorMm(m, value, g, t) : Infinity;
      if (ctx.wcs === target) setWork(ctx, a, value);
    }
    // With the active system unknown, it may be the one that changed.
    if (ctx.wcs === null) {
      ctx.work[a] = null;
      ctx.uWork[a] = Infinity;
    }
  }
  return null;
}

export function setTemporaryOffset(ctx: ModelContext, { axisWords, units }: SetTemporaryOffsetInput): LineAnalysis['motion'] {

  // Work position := value on the named axes; offsets applied on every axis (@cite EN canonical_machine.c:1199-1213).
  const offsets = { ...ctx.g92 };
  const unc = { ...ctx.uG92 };
  for (const w of axisWords) {
    const a = w.letter as Axis;
    const sc = offsetScale(ctx, a, units);
    const value = sc === null ? null : w.value * sc;
    const m = ctx.machine[a];
    const wo = ctx.wcs === null ? null : ctx.wcsOffsets[ctx.wcs][a];
    const t = ctx.toolOffset[a];
    const known = m !== null && wo !== null && t !== null && value !== null;
    offsets[a] = known ? m - wo - t - value : null;
    // The offset inherits the machine position's uncertainty; the work position then reads `value` itself.
    unc[a] = known ? ctx.uMachine[a] + ctx.uWcs[ctx.wcs as Wcs][a] + ctx.uTool[a] + stepErrorMm(m, wo, t, value) : Infinity;
  }
  setG92(ctx, true, offsets, unc);
  for (const w of axisWords) {
    const a = w.letter as Axis;
    const sc = offsetScale(ctx, a, units);
    setWork(ctx, a, sc === null ? null : w.value * sc);
  }
  return null;
}

interface SetWcsOffsetInput {
  params: ReadonlyMap<string, Word>;
  axisWords: readonly Word[];
  units: "G20" | "G21" | null
}

interface SetTemporaryOffsetInput {
  axisWords: readonly Word[];
  units: "G20" | "G21" | null
}
