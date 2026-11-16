import type { GcodeRule } from '@synthetos/protocol';
import { type InterpreterContext } from './state.ts';

/** The dialect's block rules, applied to one line (defence in depth behind the sanitiser). */
export function ruleBlocks(ctx: InterpreterContext, codes: readonly string[], letters: ReadonlySet<string>): GcodeRule[] {
  const out: GcodeRule[] = [];
  for (const r of ctx.dialect.gcode.blocked) {
    switch (r.kind) {
      case 'code':
        if (codes.includes(r.code)) out.push(r);
        break;
      case 'word':
        if (letters.has(r.letter)) out.push(r);
        break;
      case 'codeUnderModal': {
        const modes = [ctx.units, ctx.distance, ctx.plane, ctx.arcDistance, ctx.motion];
        if (r.codes.some((c) => codes.includes(c)) && r.modes.some((m) => modes.includes(m as never))) out.push(r);
        break;
      }
      case 'queuedCommandsPerLine': {
        queuedRule({ codes, r, letters, out });
        break;
      }
      case 'arcInPlane':
        // Applied at the arc itself, with the plane in force on that line.
        break;
      case 'textAfterComment':
        // Sent lines carry no comments (the sanitiser stripped or rejected them).
        break;
    }
  }
  return out;
}

export function queuedRule({ codes, r, letters, out }: QueuedRuleInput): void {

  let count = 0;
  for (const c of codes) if (r.counted.includes(c)) count++;
  for (const l of letters) if (r.counted.includes(l)) count++;
  if (count > r.max) out.push(r);
}

interface QueuedRuleInput {
  codes: readonly string[];
  r: { readonly id: string; readonly kind: "queuedCommandsPerLine"; readonly max: number; readonly counted: readonly string[]; readonly reason: string; };
  letters: ReadonlySet<string>;
  out: GcodeRule[]
}
