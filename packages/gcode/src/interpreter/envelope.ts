import type { Dialect } from '@synthetos/protocol';
import {
  type Axis,
  type SentLine
} from '@synthetos/safety';
import { KIND, LINE_FLAG, type InterpretOptions } from '../types.ts';
import { type Emitted } from './contract.ts';
import { addFinding } from './findings.ts';
import { type InterpreterContext } from './state.ts';

export function checkEnvelope(it: InterpreterContext, e: Emitted, dialect: Dialect, options: InterpretOptions): void {
  const env = options.envelope;
  if (env === undefined) return;
  const xyz: readonly Axis[] = ['X', 'Y', 'Z'];
  const outside = (c: readonly number[]): boolean =>
    xyz.some((a, k) => {
      const lim = env[a];
      const val = c[k] as number;
      return lim !== undefined && (val < lim.min || val > lim.max);
    });
  let firstLinear = -1;
  let firstArc = -1;
  for (let line = 0; line < e.lineToVertex.length - 1; line++) {
    const from = e.lineToVertex[line] as number;
    const to = e.lineToVertex[line + 1] as number;
    let out = false;
    for (let v = from; v < to; v++) {
      if (((e.kinds[v] as number) & 0x7f) === KIND.BREAK) continue;
      if (outside([e.vertices[v * 3] as number, e.vertices[v * 3 + 1] as number, e.vertices[v * 3 + 2] as number])) out = true;
    }
    const arcOut = e.arcBoxes.some((b) => b.line === line && (outside(b.box.min) || outside(b.box.max)));
    if (out || arcOut) {
      it.flags[line] = (it.flags[line] as number) | LINE_FLAG.OUT_OF_BOUNDS;
      if (arcOut && firstArc < 0) firstArc = line;
      else if (!arcOut && firstLinear < 0) firstLinear = line;
    }
  }
  const at = (i: number): SentLine => it.lines[i] as SentLine;
  if (firstLinear >= 0) {
    addFinding(it, at(firstLinear).sourceLine, at(firstLinear).n, 'block', 'out-of-bounds', 'the path leaves the work envelope (first line shown)');
  }
  if (firstArc >= 0) {
    addFinding(it, at(firstArc).sourceLine, at(firstArc).n, 'block', 'arc-out-of-bounds', dialect.caps.arcSoftLimits
      ? 'an arc leaves the work envelope (first line shown)'
      : `an arc leaves the work envelope (first line shown): ${dialect.label} does not soft-limit arcs, so only this check stops it`);
  }
}
