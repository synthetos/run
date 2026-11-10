/**
 * The carve worker's message handler (docs/design/tool-sim.md, slice 2),
 * apart from the worker global so it runs under test. It carves in time
 * slices (about 12 ms each), posts the changed cells after each slice, and
 * yields between slices so a new target, a new session or a new file is
 * taken at once: a newer target simply replaces the old one.
 *
 * It does not choose tools or the grid (the page sends both), and it never
 * touches the page, a machine or the network.
 */
import { copyRect, unionRect } from './heightmap.ts';
import { createCarver, type Carver } from './carver.ts';
import type { CarveSegments, FromCarveWorker, ToCarveWorker } from './protocol.ts';

export type CarvePost = (message: FromCarveWorker, transfer?: Transferable[]) => void;

export interface CarveHandlerOptions {
  /** Work per slice before yielding, ms (default 12). */
  readonly sliceMs?: number;
  /** Moves per carver step between clock reads (default 256). */
  readonly stepBudget?: number;
  readonly now?: () => number;
  /** Runs `fn` after letting queued messages in (default: a MessageChannel hop, else setTimeout 0). */
  readonly yieldNext?: (fn: () => void) => void;
  readonly keyframeCapBytes?: number;
}

/** A yield that does not hit the 4 ms clamp of nested timeouts. */
function defaultYield(): (fn: () => void) => void {
  if (typeof MessageChannel === 'function') {
    const ch = new MessageChannel();
    const queue: (() => void)[] = [];
    ch.port1.onmessage = () => { queue.shift()?.(); };
    return (fn) => {
      queue.push(fn);
      ch.port2.postMessage(0);
    };
  }
  return (fn) => { setTimeout(fn, 0); };
}

export function createCarveHandler(post: CarvePost, options: CarveHandlerOptions = {}): (message: ToCarveWorker) => void {
  const sliceMs = options.sliceMs ?? 12;
  const stepBudget = options.stepBudget ?? 256;
  const now = options.now ?? (() => performance.now());
  const yieldNext = options.yieldNext ?? defaultYield();
  let segments: CarveSegments | null = null;
  let carver: Carver | null = null;
  let session = -1;
  let scheduled = false;

  function fail(e: unknown): void {
    carver = null;
    post({ type: 'error', session, message: e instanceof Error ? e.message : String(e) });
  }

  function slice(): void {
    scheduled = false;
    const c = carver;
    if (c === null) return;
    try {
      const start = now();
      let step = c.step(stepBudget);
      let rect = step.dirty;
      while (!step.done && now() - start < sliceMs) {
        step = c.step(stepBudget);
        rect = unionRect(rect, step.dirty);
      }
      const data = rect === null ? null : copyRect(c.heightmap.z, c.heightmap.spec.nx, rect);
      post({ type: 'progress', session, rect, data, through: step.through, target: c.target, done: step.done, lowest: c.lowest, below: c.below }, data === null ? [] : [data.buffer]);
      if (!step.done) schedule();
    } catch (e) {
      fail(e);
    }
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    yieldNext(slice);
  }

  return (message) => {
    try {
      if (message.type === 'file') {
        segments = message.segments;
        carver = null;
        return;
      }
      if (message.type === 'setup') {
        session = message.session;
        carver = message.spec === null || segments === null ? null : createCarver(segments, message.spec, message.tools, options.keyframeCapBytes === undefined ? {} : { keyframeCapBytes: options.keyframeCapBytes });
        return;
      }
      if (message.session !== session || carver === null) return;
      carver.seek(message.target, message.tip ?? null);
      // The next slice reports it: a restore, more to carve, or the target already reached.
      schedule();
    } catch (e) {
      fail(e);
    }
  };
}
