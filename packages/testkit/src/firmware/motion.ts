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
  /** Start angle: axis0 = c0 + r·sin θ, axis1 = c1 + r·cos θ (@cite EN plan_arc.c:634-636). */
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
  /**
   * The axis is INHIBITED (am=2) now. The kinematics read the live axis mode
   * on every segment and force an inhibited axis's joint to 0 (@cite EN
   * kinematics.c:59; TG kinematics.c:63).
   */
  inhibited(axis: number): boolean;
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
  readonly #releaseDwellSlot: boolean;
  readonly queue: Block[] = [];
  #current: Running | null = null;
  #t = 0;
  /** Machine position at the start of the current block, or of the idle runtime. */
  #position: Vec = zeroVec();
  /**
   * Motor space (finding: inhibited axis). `#steps` is the runtime's step
   * target per axis in axis units (`mr.target_steps / steps_per_unit`, one
   * motor per axis); `#motor` is where each motor physically is, in the same
   * units, relative to power-up. Each executed segment sets the step target
   * to the joint of the segment's ABSOLUTE target, the joint being 0 on an
   * inhibited axis, and moves the motor by the difference from the previous
   * step target (@cite EN plan_exec.c:742-751; TG plan_exec.c:718-727). So an
   * axis inhibited while its step target is away from 0 is driven back to
   * step 0 by the next move of any axis, and an axis un-inhibited while its
   * position is away from 0 is driven out to it, while the reported position
   * (`mpo`) shows neither. A step resync (`mp_set_steps_to_runtime_position`,
   * from `cm_set_position` and G28.3) rewrites the step target from the
   * position without moving any motor (@cite EN planner.c:188-202; TG
   * planner.c:160-170).
   */
  #steps: Vec = zeroVec();
  #motor: Vec = zeroVec();

  constructor(pool: number, hooks: MotionHooks, releaseDwellSlot = false) {
    this.pool = pool;
    this.#hooks = hooks;
    this.#releaseDwellSlot = releaseDwellSlot;
  }

  /** Free planner buffers; EN dwell timers may outlive their freed planner slot. */
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

  /** Set the idle machine position (G92-free set-position, homing stand-ins, flush resync); the step target follows (`cm_set_position`). */
  setPosition(p: Vec): void {
    if (this.#current?.block.kind === 'move') throw new Error('cannot set position while a move runs');
    this.#position = [...p];
    this.#resyncSteps();
  }

  /**
   * Physical motor positions now, axis units (mm on X/Y/Z, degrees on A/B/C),
   * relative to power-up. Unlike `position()`, this is where the motors are:
   * an inhibited axis's motor stays at step 0 while its position moves.
   */
  motorPosition(now: number): Vec {
    const r = this.#current;
    if (r === null || r.block.kind !== 'move' || r.phase.kind === 'held') return [...this.#motor];
    const pos = pointAt(r.block.path, this.#distance(r, now));
    return this.#motor.map((m, i) => m + this.#joint(pos, i) - (this.#steps[i] as number)) as Vec;
  }

  /** The joint of axis i at position `pos`: 0 on an inhibited axis (@cite EN kinematics.c:59; TG kinematics.c:63). */
  #joint(pos: Vec, i: number): number {
    return this.#hooks.inhibited(i) ? 0 : (pos[i] as number);
  }

  /** One executed segment ending at `pos`: every motor moves to its new step target. */
  #segment(pos: Vec): void {
    for (let i = 0; i < AXES.length; i++) {
      const j = this.#joint(pos, i);
      this.#motor[i] = (this.#motor[i] as number) + j - (this.#steps[i] as number);
      this.#steps[i] = j;
    }
  }

  /** `mp_set_steps_to_runtime_position()`: step targets from the position, no motor moves. */
  #resyncSteps(): void {
    for (let i = 0; i < AXES.length; i++) this.#steps[i] = this.#joint(this.#position, i);
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

  /**
   * Drop every queued block. The runtime must be idle (stopped); the held
   * block goes too. `cm_queue_flush()` then sets every axis's position from
   * the runtime, which resyncs the step targets (@cite EN
   * canonical_machine.c:2144-2147; TG canonical_machine.c:1307-1309).
   */
  flush(t: number): void {
    if (!this.runtimeIdle()) throw new Error('flush while the runtime moves');
    if (this.#current !== null) this.#position = this.position(t);
    this.#current = null;
    this.queue.length = 0;
    this.#resyncSteps();
  }

  /** Stop at once, wherever the runtime is (a stepper reset): no deceleration, the block is abandoned. */
  halt(t: number): void {
    if (this.#current !== null) {
      this.#position = this.position(t);
      if (this.#current.block.kind === 'move' && this.#current.phase.kind !== 'held') this.#segment(this.#position);
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
    if (block.kind === 'move') {
      this.#position = [...block.path.from];
      // The first segment's kinematics run at once: an inhibited axis's step target goes to 0.
      this.#segment(this.#position);
    }
    this.#current = { block, start: t, phase: { kind: 'cruise', t0: t, d0: 0 } };
    this.#lastLine = block.line;
    this.#hooks.onStart(block, t);
    if (block.kind === 'dwell' && this.#releaseDwellSlot) {
      this.queue.shift();
      this.#hooks.onFree(block, this.queue.length === 0, t);
    }
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
        this.#segment(pointAt(b.path, d));
        r.phase = { kind: 'held', d };
      }
      this.#hooks.onHoldReached(t);
      return;
    }
    this.#free(r, t, b.kind === 'move' ? b.path.to : this.#position);
  }

  #free(r: Running, t: number, end: Vec): void {
    if (r.block.kind === 'move') this.#segment(end);
    this.#position = [...end];
    this.#current = null;
    const i = this.queue.indexOf(r.block);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.#hooks.onFree(r.block, this.queue.length === 0, t);
    }
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
