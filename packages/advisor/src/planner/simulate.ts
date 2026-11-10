/**
 * The firmware's time for a whole program (docs/design/ANALYZE.md slice 2): the interpreter's event tape run through
 * the TinyG planner model, streamed the way TG's host replay streams it (up to QUEUE_BATCH blocks queued before the
 * oldest runs; arc chords with PLANNER_BUFFER_HEADROOM buffers kept free). Commands the firmware queues stop motion;
 * dwells add their time. Rotary moves and lines the interpreter could not model are not supported: the result says
 * so instead of guessing. Pure.
 */
import { TAPE_FLAG, TAPE_KIND, type ProgramTape } from '../analysis/types.ts';
import { arcSegments } from './arcs.ts';
import { f32, makeBlock, type JerkCache, type MoveInput, type Vec3 } from './block.ts';
import { PLANNER_BUFFER_HEADROOM, PLANNER_BUFFER_POOL_SIZE, QUEUE_BATCH } from './constants.ts';
import { PlannerQueue } from './queue.ts';
import type { PlanResult, PlannerProfile } from './types.ts';

export type Simulation = { readonly ok: true; readonly result: PlanResult } | { readonly ok: false; readonly reason: string };

export function simulate(tape: ProgramTape, profile: PlannerProfile): Simulation {
  const q = new PlannerQueue();
  const cache: JerkCache = { jerk: 0, recipJerk: 0, cbrtJerk: 0 };
  // The planner's position (mm.position, float32) and the program's: a move the firmware drops leaves the first behind.
  let planned: Vec3 = [0, 0, 0];
  let program: [number, number, number] = [0, 0, 0];
  let lastSent = -1;
  const room = (limit: number): void => {
    while (q.queue.length > limit) q.drainOne();
  };
  const add = (move: MoveInput): void => {
    program = [program[0] + move.delta[0], program[1] + move.delta[1], program[2] + move.delta[2]];
    const target: Vec3 = [f32(program[0]), f32(program[1]), f32(program[2])];
    const delta: Vec3 = [f32(target[0] - planned[0]), f32(target[1] - planned[1]), f32(target[2] - planned[2])];
    const prev = q.queue[q.queue.length - 1];
    const previousUnit: Vec3 = prev === undefined ? q.runUnit : prev.type === 'aline' ? prev.unit : [0, 0, 0];
    const run = q.queue[0];
    const runEntry = run === undefined ? 0 : run.type !== 'aline' ? 0 : run.replannable ? run.entryVelocity + run.deltaVmax : run.exitVelocity;
    const block = makeBlock(profile, { ...move, delta }, cache, previousUnit, prev?.type === 'aline', runEntry);
    if (block === null) return; // too short in time: the firmware keeps its position and the travel joins the next move
    planned = target;
    q.addMove(block);
  };
  for (let e = 0; e < tape.count; e++) {
    const kind = tape.kinds[e];
    const flags = tape.flags[e] as number;
    if (kind === TAPE_KIND.UNMODELLED) return { ok: false, reason: `line ${tape.source[e] as number} could not be modelled` };
    const sent = tape.sent[e] as number;
    if (sent !== lastSent) {
      room(QUEUE_BATCH - 1); // the host waits for room before it sends the next line
      lastSent = sent;
    }
    const n = tape.source[e] as number;
    if (kind === TAPE_KIND.DWELL) q.addOther({ type: 'dwell', n, seconds: tape.seconds[e] as number });
    else if (kind === TAPE_KIND.BARRIER || kind === TAPE_KIND.TOOL_CHANGE || (kind === TAPE_KIND.COMMAND && (flags & TAPE_FLAG.SYNC) !== 0)) q.addOther({ type: 'command', n, seconds: 0 });
    else if (kind === TAPE_KIND.LINE || kind === TAPE_KIND.ARC) {
      if ((flags & TAPE_FLAG.ROTARY) !== 0) return { ok: false, reason: `line ${n} turns a rotary axis` };
      const rapid = (flags & TAPE_FLAG.RAPID) !== 0;
      const feed = tape.feed[e] as number;
      if (!rapid && !(feed > 0)) return { ok: false, reason: `line ${n} has no feed rate` };
      const exactStop = (flags & TAPE_FLAG.EXACT_STOP) !== 0;
      const arc = tape.arcIndex[e] as number;
      if (kind === TAPE_KIND.ARC && arc >= 0) {
        const a = tape.arcs;
        const shape = { plane: a[arc * 5] as number, radius: a[arc * 5 + 1] as number, theta: a[arc * 5 + 2] as number, travel: a[arc * 5 + 3] as number, linear: a[arc * 5 + 4] as number };
        for (const d of arcSegments(profile, shape, feed)) {
          room(QUEUE_BATCH - 1);
          room(PLANNER_BUFFER_POOL_SIZE - PLANNER_BUFFER_HEADROOM);
          add({ n, kind: 'arc-seg', delta: d, feed, exactStop });
        }
      } else {
        add({ n, kind: rapid ? 'rapid' : 'feed', delta: [tape.delta[e * 3] as number, tape.delta[e * 3 + 1] as number, tape.delta[e * 3 + 2] as number], feed, exactStop });
      }
    }
  }
  q.drainAll();
  return { ok: true, result: { seconds: q.motionMinutes * 60 + q.dwellSeconds, motionS: q.motionMinutes * 60, dwellS: q.dwellSeconds, blocks: q.done } };
}
