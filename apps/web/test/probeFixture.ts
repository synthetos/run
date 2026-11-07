/** A Probe Z view for tests: closed, nothing blocked, the input reading not touching. */
import type { ProbeSnapshot } from '@synthetos/machine';

export function probeSnap(extra: Partial<ProbeSnapshot> = {}): ProbeSnapshot {
  return {
    block: null,
    step: 'closed',
    input: { label: 'Z min', token: 'in5', reading: 'clear', activeLow: true },
    touch: { sawClear: false, sawTouching: false, sawReleased: false, problem: null },
    zjh: 40,
    system: 'G54',
    plan: null,
    outcome: null,
    plateOut: false,
    ...extra,
  };
}
