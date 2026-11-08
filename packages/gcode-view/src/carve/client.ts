/**
 * The page side of the carve worker (docs/design/tool-sim.md, slice 2). It
 * keeps a copy of the heightmap (the surface the renderer uploads from),
 * pastes each patch the worker sends into it, and tells its listeners: a new
 * surface (a new session), a changed rectangle, progress.
 *
 * It does not decide what to carve (the page gives the segments, grid,
 * tools and target) and it does not draw.
 */
import type { SegmentList } from '../segments.ts';
import { createHeightmap, pasteRect, type CellRect, type GridSpec } from './heightmap.ts';
import type { CarveToolTable, FromCarveWorker, ToCarveWorker } from './protocol.ts';

/** The subset of `Worker` the client uses. */
export interface CarveWorkerLike {
  postMessage(message: ToCarveWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FromCarveWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** The heightmap as the page holds it: the renderer reads `z`, which patches change in place. */
export interface CarveSurface {
  readonly session: number;
  readonly spec: GridSpec;
  readonly z: Float32Array;
}

export interface CarveProgress {
  readonly session: number;
  /** List lines 0..through-1 are carved. */
  readonly through: number;
  readonly target: number;
  readonly done: boolean;
  /** The lowest top Z carved so far (path frame), or the stock top when nothing is cut. */
  readonly lowest: number;
  /** Set when the worker failed; the carve stops. */
  readonly error?: string;
}

export interface CarveListener {
  readonly surface?: (surface: CarveSurface | null) => void;
  readonly patch?: (rect: CellRect) => void;
  readonly progress?: (progress: CarveProgress) => void;
}

/** What a drawing needs: the surface and its changes. */
export interface CarveFeed {
  /** Adds a listener; it hears the current surface at once. Returns its removal. */
  subscribe(listener: CarveListener): () => void;
}

export interface CarveClient extends CarveFeed {
  setFile(list: SegmentList | null): void;
  /** Starts a session: a new grid or new tools. A null grid stops carving. */
  setup(spec: GridSpec | null, tools: CarveToolTable): void;
  seek(target: number): void;
  readonly surface: CarveSurface | null;
  readonly progress: CarveProgress | null;
  dispose(): void;
}

export function createCarveClient(spawn: () => CarveWorkerLike): CarveClient {
  let worker: CarveWorkerLike | null = null;
  let session = 0;
  let surface: CarveSurface | null = null;
  let progress: CarveProgress | null = null;
  let lastTarget = -1;
  const listeners = new Set<CarveListener>();

  const tell = (f: (l: CarveListener) => void): void => {
    for (const l of [...listeners]) f(l);
  };

  function onMessage(m: FromCarveWorker): void {
    if (m.session !== session || surface === null) return;
    if (m.type === 'error') {
      progress = { session, through: progress?.through ?? 0, target: progress?.target ?? 0, done: true, lowest: progress?.lowest ?? surface.spec.top, error: m.message };
      tell((l) => l.progress?.(progress as CarveProgress));
      return;
    }
    if (m.rect !== null && m.data !== null) {
      pasteRect(surface.z, surface.spec.nx, m.rect, m.data);
      const rect = m.rect;
      tell((l) => l.patch?.(rect));
    }
    progress = { session, through: m.through, target: m.target, done: m.done, lowest: m.lowest };
    tell((l) => l.progress?.(progress as CarveProgress));
  }

  function ensure(): CarveWorkerLike {
    if (worker !== null) return worker;
    const w = spawn();
    w.onmessage = (event) => { onMessage(event.data); };
    w.onerror = (event) => {
      event.preventDefault();
      onMessage({ type: 'error', session, message: `the carve worker failed: ${event.message}` });
      w.terminate();
      if (worker === w) worker = null;
    };
    worker = w;
    return w;
  }

  return {
    setFile(list) {
      const segments = list === null ? null : { vertices: list.vertices, kinds: list.kinds, lineToVertex: list.lineToVertex };
      // Copied, not transferred: the page keeps drawing from its own arrays. No worker is started for nothing.
      if (segments === null && worker === null) return;
      ensure().postMessage({ type: 'file', segments });
    },
    setup(spec, tools) {
      session++;
      lastTarget = -1;
      surface = spec === null ? null : { session, spec, z: createHeightmap(spec).z };
      progress = null;
      const s = surface;
      tell((l) => l.surface?.(s));
      if (spec === null && worker === null) return;
      ensure().postMessage({ type: 'setup', session, spec, tools });
    },
    seek(target) {
      if (surface === null || target === lastTarget) return;
      lastTarget = target;
      ensure().postMessage({ type: 'seek', session, target });
    },
    get surface() {
      return surface;
    },
    get progress() {
      return progress;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener.surface?.(surface);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      worker?.terminate();
      worker = null;
      listeners.clear();
      surface = null;
    },
  };
}
