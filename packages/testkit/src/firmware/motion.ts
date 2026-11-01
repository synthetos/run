/**
 * Planner queue and runtime: coarse kinematics on the virtual clock.
 *
 * RUN_PLAN §8.1 asks for "coarse trapezoid moves, good enough for timing,
 * position reports and overrun measurement" (OLD-TP §7). This module is that
 * coarse layer, shared by both firmware models:
 * - a fixed pool of planner buffers; a block holds its buffer until the
 *   runtime frees it, as in `mpBufferPool_t` (@cite EN planner.h:83);
 * - moves run at their cruise velocity (no acceleration ramps); a feedhold
 *   decelerates linearly to zero over a fixed time, or sooner if the block
 *   ends first;
 * - dwells take their time; queued commands (spindle, coolant, program
 *   stop/end) run the moment the runtime reaches them, in queue order.
 *
 * Which block may start, what a hold means and what happens at cycle end are
 * firmware behaviour and live in the models, which drive this through
 * `MotionHooks`. The kinematic simplifications are listed in STATUS.md as
 * model limits; no safety claim may rest on them.
 */

import '../marker.ts';
export const AXES = ['x', 'y', 'z', 'a', 'b', 'c'] as const;
export type Axis = (typeof AXES)[number];
export type Vec = [number, number, number, number, number, number];

export const zeroVec = (): Vec => [0, 0, 0, 0, 0, 0];

export interface LinePath {
  readonly kind: 'line';
  readonly from: Vec;
  readonly to: Vec;
  readonly length: number;
}

export interface ArcPath {
  readonly kind: 'arc';
  readonly from: Vec;
  readonly to: Vec;
  /** Plane axes (indices into Vec) and the linear (helix) axis. */
  readonly axis0: number;
  readonly axis1: number;
  readonly linearAxis: number;
  readonly center0: number;
  readonly center1: number;
  readonly radius: number;
  /** Start angle: axis0 = c0 + r·sin θ, axis1 = c1 + r·cos θ (@cite EN plan_arc.c:613-615). */
  readonly theta: number;
  /** Signed angular travel in radians. */
  readonly sweep: number;
  readonly length: number;
}

export type Path = LinePath | ArcPath;

export type Block =
  | { readonly kind: 'move'; readonly path: Path; readonly feed: number; readonly line: number }
  | { readonly kind: 'dwell'; readonly ms: number; readonly line: number }
  | { readonly kind: 'command'; readonly label: string; readonly line: number; readonly run: () => void };

export interface MotionHooks {
  /**
   * Earliest time >= t at which `block` may start, or null while the
   * firmware blocks execution (program pause, hold, startup delay unknown).
   */
  earliestStart(block: Block, t: number): number | null;
  /** The runtime started executing `block` at time t. */
  onStart(block: Block, t: number): void;
  /** The runtime freed `block`; `empty` tells whether the queue is now empty. */
  onFree(block: Block, empty: boolean, t: number): void;
  /** A feedhold reached zero velocity at time t. */
  onHoldReached(t: number): void;
}

type Phase =
  | { readonly kind: 'cruise'; readonly t0: number; readonly d0: number }
  | { readonly kind: 'decel'; readonly t0: number; readonly d0: number; readonly duration: number }
  | { readonly kind: 'held'; readonly d: number };

interface Running {
  readonly block: Block;
  readonly start: number;
  phase: Phase;
}

export class Motion {
  readonly pool: number;
  readonly #hooks: MotionHooks;
  readonly queue: Block[] = [];
  #current: Running | null = null;
  #t = 0;
  /** Machine position at the start of the current block, or of the idle runtime. */
  #position: Vec = zeroVec();

  constructor(pool: number, hooks: MotionHooks) {
    this.pool = pool;
    this.#hooks = hooks;
  }

  /** Free planner buffers (the running block still holds its buffer). */
  available(): number {
    return this.pool - this.queue.length;
  }

  push(block: Block): void {
    if (this.queue.length >= this.pool) throw new Error('planner pool exhausted (the firmware would have panicked; the model never queues past its headroom)');
    this.queue.push(block);
  }

  /** The block being executed, if any. */
  current(): Block | null {
    return this.#current?.block ?? null;
  }

  /** True when nothing is executing: idle, or held at zero velocity. */
  runtimeIdle(): boolean {
    return this.#current === null || this.#current.phase.kind === 'held';
  }

  isHeld(): boolean {
    return this.#current?.phase.kind === 'held';
  }

  /** The current block is a move (an ALINE). */
  executingMove(): boolean {
    return this.#current?.block.kind === 'move';
  }

  executingDwell(): boolean {
    return this.#current?.block.kind === 'dwell';
  }

  /** Line number of the executing block, or of the last one executed. */
  line(): number {
    return this.#current?.block.line ?? this.#lastLine;
  }
  #lastLine = 0;

  /** Machine position now. */
  position(now: number): Vec {
    const r = this.#current;
    if (r === null || r.block.kind !== 'move') return [...this.#position];
    return pointAt(r.block.path, this.#distance(r, now));
  }

  /** Velocity now, mm/min. */
  velocity(now: number): number {
    const r = this.#current;
    if (r === null || r.block.kind !== 'move') return 0;
    const v = r.block.feed;
    if (r.phase.kind === 'cruise') return v;
    if (r.phase.kind === 'held') return 0;
    const tau = Math.min(Math.max(now - r.phase.t0, 0), r.phase.duration);
    return v * (1 - tau / r.phase.duration);
  }

  /** Set the idle machine position (G92-free set-position, homing stand-ins, flush resync). */
  setPosition(p: Vec): void {
    if (this.#current?.block.kind === 'move') throw new Error('cannot set position while a move runs');
    this.#position = [...p];
  }

  /** Run the queue up to `now`, firing hooks at the virtual times things happen. */
  advance(now: number): void {
    for (let guard = 0; guard < 100_000; guard++) {
      if (this.#t > now) return;
      const r = this.#current;
      if (r !== null) {
        const end = this.#endOf(r);
        if (end === null || end > now) {
          this.#t = now;
          return;
        }
        this.#t = Math.max(this.#t, end);
        this.#finishPhase(r, end);
        continue;
      }
      const next = this.queue[0];
      if (next === undefined) {
        this.#t = now;
        return;
      }
      const at = this.#hooks.earliestStart(next, this.#t);
      if (at === null || at > now) {
        this.#t = now;
        return;
      }
      this.#t = Math.max(this.#t, at);
      this.#start(next, this.#t);
    }
    throw new Error('motion runtime: too many block transitions in one advance');
  }

  /**
   * Begin a feedhold at time t. A running move decelerates. A dwell is not
   * a move: the hold stays pending and the firmware applies it when the next
   * move would start (both builds plan the hold inside the line executor).
   * Returns what happened so the firmware can set its hold state.
   */
  startHold(t: number, decelMs: number): 'decel' | 'pending' | 'idle' {
    const r = this.#current;
    if (r === null) return 'idle';
    if (r.block.kind === 'dwell') return 'pending';
    if (r.block.kind !== 'move' || r.phase.kind !== 'cruise') return r.phase.kind === 'held' ? 'idle' : 'decel';
    const d = this.#distance(r, t);
    const remaining = r.block.path.length - d;
    const vPerMs = r.block.feed / 60_000;
    const full = (vPerMs * decelMs) / 2;
    const duration = vPerMs > 0 ? (remaining >= full ? decelMs : (2 * remaining) / vPerMs) : 0;
    r.phase = { kind: 'decel', t0: t, d0: d, duration };
    return 'decel';
  }

  /** Leave a hold: a held move continues from where it stopped at cruise speed. */
  resume(t: number): void {
    const r = this.#current;
    if (r === null) return;
    if (r.phase.kind === 'held') r.phase = { kind: 'cruise', t0: t, d0: r.phase.d };
    this.#t = Math.max(this.#t, t);
  }

  /** Drop every queued block. The runtime must be idle (stopped); the held block goes too. */
  flush(t: number): void {
    if (!this.runtimeIdle()) throw new Error('flush while the runtime moves');
    if (this.#current !== null) this.#position = this.position(t);
    this.#current = null;
    this.queue.length = 0;
  }

  /** Stop at once, wherever the runtime is (a stepper reset): no deceleration, the block is abandoned. */
  halt(t: number): void {
    if (this.#current !== null) {
      this.#position = this.position(t);
      const block = this.#current.block;
      this.#current = null;
      const i = this.queue.indexOf(block);
      if (i >= 0) this.queue.splice(i, 1);
    }
    this.#t = Math.max(this.#t, t);
  }

  #start(block: Block, t: number): void {
    if (block.kind === 'command') {
      this.queue.shift();
      this.#lastLine = block.line;
      this.#hooks.onStart(block, t);
      block.run();
      this.#hooks.onFree(block, this.queue.length === 0, t);
      return;
    }
    if (block.kind === 'move') this.#position = [...block.path.from];
    this.#current = { block, start: t, phase: { kind: 'cruise', t0: t, d0: 0 } };
    this.#lastLine = block.line;
    this.#hooks.onStart(block, t);
  }

  /** When the current phase ends, or null if it never ends on its own (held). */
  #endOf(r: Running): number | null {
    const b = r.block;
    if (b.kind === 'dwell') return r.start + b.ms;
    if (b.kind !== 'move') return r.start;
    const p = r.phase;
    if (p.kind === 'held') return null;
    if (p.kind === 'decel') return p.t0 + p.duration;
    const vPerMs = b.feed / 60_000;
    if (vPerMs <= 0) return null;
    return p.t0 + (b.path.length - p.d0) / vPerMs;
  }

  #finishPhase(r: Running, t: number): void {
    const b = r.block;
    if (b.kind === 'move' && r.phase.kind === 'decel') {
      const d = Math.min(r.phase.d0 + (b.feed / 60_000) * (r.phase.duration / 2), b.path.length);
      if (d >= b.path.length - 1e-9) {
        this.#free(r, t, b.path.to);
      } else {
        r.phase = { kind: 'held', d };
      }
      this.#hooks.onHoldReached(t);
      return;
    }
    this.#free(r, t, b.kind === 'move' ? b.path.to : this.#position);
  }

  #free(r: Running, t: number, end: Vec): void {
    this.#position = [...end];
    this.#current = null;
    const i = this.queue.indexOf(r.block);
    if (i >= 0) this.queue.splice(i, 1);
    this.#hooks.onFree(r.block, this.queue.length === 0, t);
  }

  #distance(r: Running, now: number): number {
    const b = r.block;
    if (b.kind !== 'move') return 0;
    const v = b.feed / 60_000;
    const p = r.phase;
    if (p.kind === 'held') return p.d;
    if (p.kind === 'cruise') return Math.min(p.d0 + v * Math.max(0, now - p.t0), b.path.length);
    const tau = Math.min(Math.max(now - p.t0, 0), p.duration);
    const d = p.duration > 0 ? p.d0 + v * (tau - (tau * tau) / (2 * p.duration)) : p.d0;
    return Math.min(d, b.path.length);
  }
}

/** Position at distance `d` along a path. */
export function pointAt(path: Path, d: number): Vec {
  const s = path.length > 0 ? Math.min(Math.max(d / path.length, 0), 1) : 1;
  if (path.kind === 'line') return path.from.map((f, i) => f + ((path.to[i] as number) - f) * s) as Vec;
  const out = path.from.map((f, i) => f + ((path.to[i] as number) - f) * s) as Vec;
  const theta = path.theta + path.sweep * s;
  out[path.axis0] = path.center0 + path.radius * Math.sin(theta);
  out[path.axis1] = path.center1 + path.radius * Math.cos(theta);
  if (s === 1) {
    out[path.axis0] = path.to[path.axis0] as number;
    out[path.axis1] = path.to[path.axis1] as number;
  }
  return out;
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(...a.map((v, i) => v - (b[i] as number)));
}
