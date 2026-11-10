/**
 * The planner queue and the exec (@cite TinyG 450.02 plan_line.c _plan_block_list, _plan_block,
 * _exit_of_previous; plan_exec.c mp_exec_aline and its head/body/tail sections; planner.c mp_queue_command,
 * mp_dwell). Blocks are planned backward then forward over the queued blocks each time a move is added; the oldest
 * block runs with the plan it has when it starts, and its sections take their length over their average speed,
 * never less than one minimum segment. Pure.
 */
import { EPSILON, MIN_SEGMENT_TIME, NOM_SEGMENT_TIME } from './constants.ts';
import { TAG, type MoveBlock, type QueuedBlock, type Vec3 } from './block.ts';
import { calculateTrapezoid } from './trapezoid.ts';
import type { Cause, ExitLimit, PlannedBlock } from './types.ts';

const eq = (a: number, b: number): boolean => Math.abs(a - b) < EPSILON;
const zero = (v: number): boolean => Math.abs(v) < EPSILON;

/** One section's run time in minutes: length over average speed, at least one minimum segment. */
export function sectionTime(length: number, v0: number, v1: number): number {
  if (zero(length)) return 0;
  const t = (2 * length) / (v0 + v1);
  return t < MIN_SEGMENT_TIME ? MIN_SEGMENT_TIME : t;
}

/** The feed-limit profile tags of the plan a block runs with (feedlimit.c fl_profile_tags). */
function profileTags(b: MoveBlock): number {
  if (b.naiiveMoveTime <= NOM_SEGMENT_TIME) return TAG.MIN_SEGMENT;
  const reached = Math.max(2, b.cruiseVmax * 0.01);
  return b.cruiseVelocity < b.cruiseVmax - reached ? TAG.SHORT : 0;
}

const CAUSES: readonly (readonly [number, Cause])[] = [[TAG.AXIS_CAP, 'axis_cap'], [TAG.JUNCTION, 'junction'], [TAG.EXACT_STOP, 'exact_stop'], [TAG.SHORT, 'short'], [TAG.MIN_SEGMENT, 'min_segment']];

/** Why the exit is what it is, from the block and the next queued block when it started (planner_timing.py). */
export function exitLimit(b: { readonly entry: number; readonly cruise: number; readonly exit: number; readonly bodyS: number; readonly tailS: number }, next: QueuedBlock | undefined): ExitLimit {
  const x = b.exit;
  const tol = (v: number): number => Math.max(0.5, Math.abs(v) * 0.001);
  if (next === undefined) return x < tol(0) ? 'end' : 'lookahead';
  if (next.type !== 'aline') {
    if (x < tol(0)) return 'stop';
  } else if (Math.abs(x - next.entryVmax) < tol(next.entryVmax)) return 'junction';
  else if (x < tol(0)) return 'end';
  if (b.bodyS > 0 && Math.abs(x - b.cruise) < tol(b.cruise)) return 'cruise';
  if (x > b.entry + tol(x) && b.bodyS === 0 && b.tailS === 0) return 'accel';
  return 'lookahead';
}

export class PlannerQueue {
  readonly queue: QueuedBlock[] = [];
  readonly done: PlannedBlock[] = [];
  /** The exit speed and direction of the last move the exec ran (mr.exit_velocity, mr.unit). */
  runExit = 0;
  runUnit: Vec3 = [0, 0, 0];
  motionMinutes = 0;
  dwellSeconds = 0;

  /** The exit of the block before queue[i] as the exec would see it. */
  #exitBefore(i: number): number {
    if (i === 0) return this.runExit;
    const pv = this.queue[i - 1] as QueuedBlock;
    return pv.type === 'aline' ? pv.exitVelocity : 0;
  }

  #plan(b: MoveBlock, entry: number, exit: number): number {
    b.entryVelocity = entry;
    b.cruiseVelocity = b.cruiseVmax;
    b.exitVelocity = exit;
    calculateTrapezoid(b);
    return b.exitVelocity;
  }

  /** Adds a move and replans the queued blocks (mp_aline, _plan_block_list). */
  addMove(bf: MoveBlock): void {
    this.queue.push(bf);
    const last = this.queue.length - 1;
    let i = last - 1;
    for (; i >= 0; i--) {
      const bp = this.queue[i] as QueuedBlock;
      if (bp.type !== 'aline' || !bp.replannable) break;
      const nx = this.queue[i + 1] as MoveBlock;
      bp.brakingVelocity = Math.min(nx.entryVmax, nx.brakingVelocity) + bp.deltaVmax;
    }
    let nextEntry: number | null = null;
    for (let j = i + 1; j < last; j++) {
      const bp = this.queue[j] as MoveBlock;
      const nx = this.queue[j + 1] as MoveBlock;
      const entry = nextEntry ?? this.#exitBefore(j);
      nextEntry = this.#plan(bp, entry, Math.min(bp.exitVmax, nx.entryVmax, nx.brakingVelocity, entry + bp.deltaVmax));
      const pv = j > 0 ? (this.queue[j - 1] as QueuedBlock) : undefined;
      const pvFixed = pv === undefined || pv.type !== 'aline' || !pv.replannable;
      if (eq(bp.exitVelocity, bp.exitVmax) || eq(bp.exitVelocity, nx.entryVmax) || (pvFixed && eq(bp.exitVelocity, bp.entryVelocity + bp.deltaVmax))) bp.replannable = false;
    }
    this.#plan(bf, nextEntry ?? this.#exitBefore(last), 0);
  }

  /** Queues a command (it stops motion: nothing plans through it) or a dwell. */
  addOther(b: QueuedBlock): void {
    this.queue.push(b);
  }

  /** Runs the oldest queued block to its end. */
  drainOne(): void {
    const b = this.queue.shift();
    if (b === undefined) return;
    if (b.type !== 'aline') {
      if (b.type === 'dwell') {
        this.dwellSeconds += b.seconds;
        this.done.push({ n: b.n, kind: 'dwell', lengthMm: 0, entry: 0, cruise: 0, exit: 0, seconds: b.seconds, headS: 0, bodyS: 0, tailS: 0, exitLimit: null, causes: [] });
      }
      return;
    }
    const head = sectionTime(b.headLength, b.entryVelocity, b.cruiseVelocity);
    const body = sectionTime(b.bodyLength, b.cruiseVelocity, b.cruiseVelocity);
    const tail = sectionTime(b.tailLength, b.cruiseVelocity, b.exitVelocity);
    const minutes = head + body + tail;
    this.motionMinutes += minutes;
    const timing = { entry: b.entryVelocity, cruise: b.cruiseVelocity, exit: b.exitVelocity, bodyS: body * 60, tailS: tail * 60 };
    const tags = b.tags | profileTags(b);
    this.done.push({
      n: b.n,
      kind: b.kind,
      lengthMm: b.length,
      ...timing,
      seconds: minutes * 60,
      headS: head * 60,
      exitLimit: exitLimit(timing, this.queue[0]),
      causes: CAUSES.filter(([bit]) => (tags & bit) !== 0).map(([, name]) => name),
    });
    this.runExit = b.exitVelocity;
    this.runUnit = b.unit;
  }

  drainAll(): void {
    while (this.queue.length > 0) this.drainOne();
  }
}
