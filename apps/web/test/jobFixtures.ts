/** Shared job-card fixtures for the Run view's unit tests: a job, a session snapshot around it, a live view and a model. */
import { vi } from 'vitest';
import { createWorkspaceModel, INITIAL_LIVE_VIEW, type LiveActions, type LiveView } from '../src/workspace/model.ts';
import { textHash, type JobSnapshot } from '../src/workspace/jobUi.ts';

export type Snapshot = NonNullable<LiveView['message']>['snapshot'];

export function job(extra: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: 1,
    name: 'part.nc',
    hash: textHash('G0 X1\nM30'),
    bytes: 9,
    phase: 'ready',
    total: 2,
    sent: 0,
    acked: 0,
    free: null,
    inFlight: 0,
    executing: null,
    sentThrough: null,
    ackedThrough: null,
    startedAt: null,
    endedAt: null,
    totalSeconds: 3,
    remainingSeconds: 3,
    queuedSeconds: 0,
    queuedBoundMm: 0,
    stop: null,
    refused: null,
    toolChange: null,
    message: null,
    events: [],
    breakpoints: [],
    queuedBreakpoints: [],
    report: { blocked: false, counts: { block: 0, warn: 0, change: 0, info: 0 }, blocks: [], splits: 0, longestMoveSeconds: 1, endState: { spindle: 'off', mist: false, flood: false }, toolChanges: [], startsSpindle: false, speeds: [], seconds: 3 },
    rxmFrom: null,
    jobFlag: null,
    feedLimit: null,
    faultStopAt: null,
    stopping: false,
    startModes: null,
    stoppedAt: null,
    ...extra,
  };
}

export function snap(extra: Record<string, unknown> = {}): Snapshot {
  return {
    base: 'IDLE_HOMED',
    overlays: [],
    epoch: 1,
    identity: { id: 'SIM-EN-0001' },
    classification: { dialectId: 'tinyg-en', mode: 'full', reason: 'en-approved', detail: '', upgradeOffer: false },
    footerRev: 3,
    live: { stat: 1, hold: 0, vel: 0, qr: 32, home: 1, pos: {}, mpo: {} },
    values: { ofs: { value: { x: 10, y: 20, z: -5 }, status: 0, at: 0 } },
    notices: { adviseEstop: false },
    motion: null,
    reports: { phase: 'done', heartbeatMs: 1000, changes: [], detail: null },
    rxm: { restore: 0, memoryKnown: true, pending: false, leftAsFound: false, current: 0, changed: null, detail: null, busy: false },
    rtLeaves: [],
    job: job(),
    ...extra,
  } as unknown as Snapshot;
}

export function view(s: Snapshot | null, jobs = true): LiveView {
  if (s === null) return INITIAL_LIVE_VIEW;
  return { ...INITIAL_LIVE_VIEW, message: { v: 3, kind: 'snapshot', snapshot: s, motion: true, jobs, jobElapsedMs: 4000 } as unknown as LiveView['message'] };
}

/** A workspace model showing `s`, with a spy for the job actions. */
export function liveModel(s: Snapshot): { model: ReturnType<typeof createWorkspaceModel>; job: ReturnType<typeof vi.fn> } {
  const model = createWorkspaceModel();
  const jobFn = vi.fn(() => Promise.resolve(null));
  model.actions.value = { job: jobFn } as unknown as LiveActions;
  model.live.value = view(s);
  return { model, job: jobFn };
}
