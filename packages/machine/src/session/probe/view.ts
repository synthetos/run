/**
 * Probe Z: the page's view of the probe (`SessionSnapshot.probeZ`, the shared `ProbeSnapshot`). Pure.
 */
import { activeSystem } from '../motion.ts';
import type { SessionState } from '../types.ts';
import { probeInput } from './gate.ts';
import type { ProbeSnapshot } from './types.ts';

export function probeView(s: SessionState): ProbeSnapshot {
  const p = s.probeZ;
  const input = probeInput(p.settings);
  const system = activeSystem(s);
  return {
    block: p.block,
    step: p.step,
    input: input === null ? null : { label: input.label, token: input.token, reading: p.reading, activeLow: p.settings.prbp !== 1 },
    touch: p.touch,
    zjh: p.settings.zjh,
    system: system === null ? null : `G${53 + system}`,
    plan: p.plan,
    outcome: p.outcome,
    plateOut: p.plateOut,
  };
}
