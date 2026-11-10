/**
 * The work zero note (owner, 2026-11-09): what plan versus board means, in one sentence, never a dump of coordinates.
 * "Your work zero is 129 mm from where you planned it." when both are known; "Can't compare until the machine is
 * homed." with [Home] when the machine position is not set (without homing set up: "until the machine position is
 * set"); the full comparison behind More. Pure.
 */
import type { Note } from '../notes/notes.ts';
import type { RunZeroCheck } from '../zeroPlan.ts';
import { Z_NOTE_MM } from '../../preview/livePlacement.ts';

export function zeroNote(zero: RunZeroCheck, established: boolean, canHome: boolean): Note {
  const detail = zero.text;
  if (zero.state === 'match') return { id: 'zero', topic: 'Work zero', title: 'Work zero matches your plan.', body: 'The job cuts where you placed it.', detail, tone: 'info' };
  if (zero.state === 'unknown') return { id: 'zero', topic: 'Work zero', title: 'Work zero not read yet.', body: 'Run reads it from the board.', detail, tone: 'warn' };
  if (zero.source === 'setup' && !established) {
    // A board with no homing set up can still set its position here (Set machine position); the note says that.
    if (!canHome) return { id: 'zero', topic: 'Work zero', title: 'Work zero not compared.', body: 'Can’t compare until the machine position is set.', detail, tone: 'warn' };
    return { id: 'zero', topic: 'Work zero', title: 'Work zero not compared.', body: 'Can’t compare until the machine is homed.', detail, tone: 'warn', link: { kind: 'action', action: 'home', label: 'Home' } };
  }
  const plan = zero.plan;
  if (plan === null) return { id: 'zero', topic: 'Work zero', title: 'No plan for work zero.', body: 'Start cuts from the board’s work zero.', detail, tone: 'warn', link: { kind: 'step', step: 'place', label: 'Place job' } };
  const mm = Math.round(Math.hypot(zero.board.x - plan.x, zero.board.y - plan.y, zero.board.z - plan.z));
  // The Z part in a few words (the preview's separate Z note folds in here); the sentence with the stock top is behind More.
  const dz = zero.board.z - plan.z;
  const z = Math.abs(dz) > Z_NOTE_MM ? ` (Z ${Math.abs(dz).toFixed(1)} mm ${dz < 0 ? 'lower' : 'higher'})` : '';
  return { id: 'zero', topic: 'Work zero', title: 'Work zero isn’t where you planned it.', body: `Your work zero is ${mm.toLocaleString('en-US')} mm from where you planned it${z}.`, detail, tone: 'warn', link: { kind: 'step', step: 'place', label: 'Place job' } };
}
