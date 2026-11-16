import type { TinyGEdgeNextModel } from '@synthetos/testkit';
import {
  type JobState,
  type SessionEffect,
  type SessionState
} from '../src/index.ts';
import {
  type JobLayerTx
} from '../src/session/job.ts';
import { DEFAULT_TIMINGS } from '../src/session/types.ts';
import { EN_APPROVED, JOBS_RELEASE, jobHarness, load } from './jobHarness.ts';

export const SMALL = ['G21 G90', 'G0 X1 Y1', 'G1 X5 F600', 'G1 Y5', 'G1 X1', 'G1 Y1', 'G0 X0 Y0', 'M30'].join('\n');

export const model = (h: { readonly device: unknown }): TinyGEdgeNextModel => h.device as TinyGEdgeNextModel;
export const TC = ['G21 G90', 'M3 S12000', 'G1 X5 F600', 'G1 X0', 'T2 M6', 'G1 X3 F600', 'G1 X0', 'M5', 'M30'].join('\n');

export const value = (v: unknown, status = 0) => ({ value: v as never, status, at: 0 });

/** The refusal's reason, or null when allowed. */
export const why = (d: { readonly allowed: boolean; readonly reason?: string }): string | null => (d.allowed ? null : (d.reason as string));

export interface Recorder {
  readonly t: JobLayerTx;
  readonly fx: SessionEffect[];
  readonly faults: string[];
}

export function tx(s: SessionState, release = JOBS_RELEASE): Recorder {
  const fx: SessionEffect[] = [];
  const faults: string[] = [];
  const t: JobLayerTx = {
    s,
    config: { release, manifest: EN_APPROVED, timings: DEFAULT_TIMINGS },
    set(patch) {
      t.s = { ...t.s, ...patch };
    },
    emit(e) {
      fx.push(e);
    },
    arm(id, ms) {
      fx.push({ kind: 'armTimer', id, seq: 0, ms });
    },
    cancel(id) {
      fx.push({ kind: 'cancelTimer', id });
    },
  };
  return { t, fx, faults };
}

export const deps = (r: Recorder) => ({ fault: (_t: JobLayerTx, cause: string) => void r.faults.push(cause) });

/** A connected jobs session with SMALL loaded and checked: its state is the base of every unit here. */
export async function ready(text = 'G21 G90\nG1 X5 F600\nG1 X0\nM30'): Promise<SessionState> {
  const h = await jobHarness();
  await load(h, text);
  return h.session.state;
}

export function withJob(s: SessionState, patch: Partial<JobState>): SessionState {
  return { ...s, job: { ...(s.job as JobState), ...patch } };
}
