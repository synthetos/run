/** Shared helpers of the Probe Z tests (SAFETY §4.5c): a motion and jobs session on an edge-next 450.02 model with a Z-min probe input. */
import type { ApprovedBuilds } from '@synthetos/protocol';
import type { TinyGEdgeNextModel, TinyGModelOptions } from '@synthetos/testkit';
import { expect } from 'vitest';
import type { MachineSessionOptions, SessionIntent } from '../src/index.ts';
import { JOBS_RELEASE_NO_FI, runUntil, writes } from './jobHarness.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT } from './simTransport.ts';

export const BUILD_450_02 = Object.freeze({ fb: 450.02, fv: 0.97, hv: 8, layout: 10002 });

export const EN_450_02_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.02, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

/** A stock Z-min probe input (zsn 4), normally open (prbp 0), Z homing jerk 40. `__layout` keeps the EEPROM across boot. */
export const PROBE_EEPROM = Object.freeze({ __layout: 10002, zsn: 4, zjh: 40, prbp: 0 });

/** The plate's top, machine Z, mm: 3 mm below where the model starts. */
export const PLATE_Z = -3;

export interface ProbeHarness extends Harness {
  readonly model: TinyGEdgeNextModel;
}

export async function probeHarness(options: { readonly eeprom?: Readonly<Record<string, number>>; readonly device?: TinyGModelOptions; readonly session?: Partial<MachineSessionOptions>; readonly plate?: number | null } = {}): Promise<ProbeHarness> {
  const h = harness('en', {
    device: { start: 'ready', rxm: 0, build: BUILD_450_02, eeprom: { ...PROBE_EEPROM, ...options.eeprom }, ...options.device },
    session: { manifest: EN_450_02_APPROVED, release: JOBS_RELEASE_NO_FI, ...options.session },
  });
  const model = h.device as TinyGEdgeNextModel;
  model.setProbePlate(options.plate === undefined ? PLATE_Z : options.plate);
  void h.session.connect(PORT);
  await h.run(3000);
  return { ...h, model };
}

export const TOUCH = Object.freeze({ intent: 'probeZ', step: 'touch', thicknessMm: 12.7, depthMm: 5, feed: 25 }) as SessionIntent;
export const START = Object.freeze({ intent: 'probeZ', step: 'start', confirm: true }) as SessionIntent;

/** The touch test, passed: the owner touches the plate to the tool, then lets go. */
export async function passTouch(h: ProbeHarness, plan: SessionIntent = TOUCH): Promise<void> {
  expect(h.session.request(plan)).toEqual({ allowed: true });
  await h.run(600);
  h.model.setProbeTouch(true);
  await h.run(400);
  h.model.setProbeTouch(false);
  await h.run(400);
  expect(h.session.snapshot.probeZ.step).toBe('ready');
}

/** Starts the probe after a passed touch test; returns the write index before it. */
export function startProbe(h: ProbeHarness): number {
  const from = writes(h).length;
  expect(h.session.request(START)).toEqual({ allowed: true });
  return from;
}

export async function untilResult(h: ProbeHarness, maxMs = 60_000): Promise<void> {
  await runUntil(h, () => h.session.snapshot.probeZ.step === 'result', maxMs);
}

/** The G-code and realtime writes from `from`, without the polled GETs. */
export function probeWrites(h: ProbeHarness, from: number): string[] {
  return writes(h)
    .slice(from)
    .filter((w) => !w.startsWith('{"') || w.startsWith('{"clear"'));
}
