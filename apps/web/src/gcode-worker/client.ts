/**
 * Page side of `gcode.worker` (ROADMAP TB-03). One load at a time; a new load
 * or `cancel()` terminates the worker, so cancel is immediate however busy the
 * worker is (RUN_PLAN §7.6: stop latency under 100 ms), and a fresh worker
 * serves the next load.
 */
import type { Estimate, PlannerProfile } from '@synthetos/advisor';
import type { Finding } from '@synthetos/gcode';
import type { PreviewProgress, PreviewRequest, PreviewResult } from './pipeline.ts';
import type { FromGcodeWorker, ToGcodeWorker } from './protocol.ts';

export const GCODE_WORKER_NAME = 'gcode';

/** The subset of `Worker` the client uses. */
export interface WorkerLike {
  postMessage(message: ToGcodeWorker): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FromGcodeWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface GcodePreviewClient {
  load(blob: Blob, request: PreviewRequest, onProgress?: (p: PreviewProgress) => void): Promise<PreviewResult>;
  /** Findings on file lines [from, to] of the loaded file. */
  findings(from: number, to: number): Promise<readonly Finding[]>;
  /** The planner model's time for the loaded file on a machine with these settings. */
  estimate(profile: PlannerProfile): Promise<Estimate>;
  /** Stops the current load now; its promise rejects with an AbortError. */
  cancel(): void;
  dispose(): void;
}

function abortError(): DOMException {
  return new DOMException('the preview load was cancelled', 'AbortError');
}

interface Pending {
  readonly resolve: (value: never) => void;
  readonly reject: (e: unknown) => void;
  readonly onProgress?: (p: PreviewProgress) => void;
}

export function createGcodePreviewClient(spawn: () => WorkerLike): GcodePreviewClient {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function stop(): void {
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(abortError());
    pending.clear();
  }

  function ensure(): WorkerLike {
    if (worker !== null) return worker;
    const w = spawn();
    w.onmessage = (event) => {
      const m = event.data;
      const p = pending.get(m.id);
      if (p === undefined) return;
      if (m.type === 'progress') {
        p.onProgress?.(m.progress);
        return;
      }
      pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message));
      else if (m.type === 'result') p.resolve(m.result as never);
      else if (m.type === 'estimate') p.resolve(m.estimate as never);
      else p.resolve(m.findings as never);
    };
    w.onerror = (event) => {
      event.preventDefault();
      const failed = [...pending.values()];
      pending.clear();
      stop();
      for (const p of failed) p.reject(new Error(`the G-code worker failed: ${event.message}`));
    };
    worker = w;
    return w;
  }

  function request<T>(build: (id: number) => ToGcodeWorker, onProgress?: (p: PreviewProgress) => void): Promise<T> {
    const w = ensure();
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: never) => void, reject, ...(onProgress === undefined ? {} : { onProgress }) });
      w.postMessage(build(id));
    });
  }

  return {
    load(blob, req, onProgress) {
      stop();
      return request<PreviewResult>((id) => ({ type: 'load', id, blob, request: req }), onProgress);
    },
    findings(from, to) {
      if (worker === null) return Promise.resolve([]);
      return request<readonly Finding[]>((id) => ({ type: 'findings', id, from, to }));
    },
    estimate(profile) {
      if (worker === null) return Promise.resolve({ ok: false, reason: 'No file is loaded.' });
      return request<Estimate>((id) => ({ type: 'estimate', id, profile }));
    },
    cancel: stop,
    dispose: stop,
  };
}
