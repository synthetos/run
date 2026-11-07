/**
 * Probe Z while it runs: starting, probing, setting Z (SAFETY §4.5c). No buttons: the only stop is Stop job in the
 * machine strip, and a second stop here that isn't the real one would be worse than none. Nothing claims contact
 * or a zero until the board reports it.
 */
import { h, type ComponentChild } from 'preact';
import type { ProbePlan, ProbeSnapshot } from '../../machine-worker/probeShared.ts';
import { InputReading } from './InputReading.ts';
import { ProbeCard } from './ProbeCard.ts';
import { probeSeconds } from './probeForm.ts';
import { mm, w51 } from './probeStrings.ts';

export function ProbeRunning({ step, plan, input, advanced }: { readonly step: 'starting' | 'probing' | 'zeroing'; readonly plan: ProbePlan | null; readonly input: ProbeSnapshot['input']; readonly advanced: boolean }): ComponentChild {
  const title = step === 'zeroing' ? 'Setting Z' : step === 'starting' ? 'Starting…' : 'Probing Z';
  const what =
    step === 'zeroing'
      ? 'The board reported contact. Setting Z…'
      : plan === null
        ? 'Moving down until the board reports contact.'
        : `Moving down until the board reports contact, up to ${mm(plan.depthMm)} mm (about ${probeSeconds(plan.depthMm, plan.feed)} s).`;
  return h(
    ProbeCard,
    { title, stage: null, step, focusHeading: true },
    h('p', { role: 'status', 'data-probe': 'running' }, what),
    step === 'zeroing' ? null : h(InputReading, { input, advanced }),
    h('p', { class: 'probe-warn', 'data-safety': 'W51' }, w51()),
  );
}
