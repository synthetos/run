/** Shared helpers of the Phase 3 job tests: a jobs session connected to the edge-next model. */
import type { ApprovedBuilds } from '@synthetos/protocol';
import type { TinyGModelOptions } from '@synthetos/testkit';
import { PHASE_2_RELEASE, withJobs } from '@synthetos/safety';
import { expect } from 'vitest';
import type { MachineSessionOptions } from '../src/index.ts';
import { harness, type Harness } from './sessionHarness.ts';
import { PORT, shown } from './simTransport.ts';

export const EN_APPROVED: ApprovedBuilds = {
  environment: 'staging',
  builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 'test' }],
};

// Feed accounting is off in every shipped release (firmware bug N66); these tests exercise it with the flag on.
export const JOBS_RELEASE = { ...withJobs(PHASE_2_RELEASE, 'staging'), feedAccounting: true };
export const JOBS_RELEASE_NO_FI = withJobs(PHASE_2_RELEASE, 'staging');

export async function jobHarness(options: { readonly rxm?: 0 | 1; readonly device?: TinyGModelOptions; readonly session?: Partial<MachineSessionOptions> } = {}): Promise<Harness> {
  const h = harness('en', {
    device: { start: 'ready', rxm: options.rxm ?? 0, ...options.device },
    session: { manifest: EN_APPROVED, release: JOBS_RELEASE, ...options.session },
  });
  void h.session.connect(PORT);
  await h.run(3000);
  return h;
}

/** Every write to the board, as text without its LF (realtime bytes as themselves, others as \\xNN). */
export function writes(h: Harness): string[] {
  return (h.transports.at(-1)?.writes ?? []).map((b) => shown(b).replace(/\\n$/, ''));
}

/** Job lines written (N-numbered), from write index `from`. */
export function jobLines(h: Harness, from = 0): string[] {
  return writes(h)
    .slice(from)
    .filter((w) => w.startsWith('N'));
}

export const CONFIRM = Object.freeze({ unhomed: true, workZero: true, spindle: true });

export async function load(h: Harness, text: string, name = 'part.nc'): Promise<void> {
  expect(h.session.loadJob({ name, text })).toEqual({ allowed: true });
  await h.run(500);
}

export async function start(h: Harness, text: string, breakpoints: readonly number[] = []): Promise<number> {
  await load(h, text);
  expect(h.session.snapshot.job?.report?.blocks).toEqual([]);
  const from = writes(h).length;
  expect(h.session.startJob(breakpoints, CONFIRM)).toEqual({ allowed: true });
  return from;
}

/** Runs virtual time in small steps until `done` holds (or `maxMs` passes); returns whether it held. */
export async function runUntil(h: Harness, done: () => boolean, maxMs = 30_000, stepMs = 10): Promise<boolean> {
  for (let t = 0; t < maxMs; t += stepMs) {
    if (done()) return true;
    await h.run(stepMs);
  }
  return done();
}

/** A job of `n` short feed moves back and forth (each about 0.2 s at F3000). */
export function zigzag(n: number, extra: readonly string[] = []): string {
  const lines = ['G21 G90', 'G0 X0 Y0'];
  for (let i = 0; i < n; i++) lines.push(`G1 X${i % 2 === 0 ? 10 : 0} Y${(i * 0.5).toFixed(1)} F3000`);
  return [...lines, ...extra, 'M30'].join('\n');
}
