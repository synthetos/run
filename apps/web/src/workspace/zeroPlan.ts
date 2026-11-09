/**
 * The Run step's work zero against the plan (H73; first-time walk 2026-11-08, S6).
 *
 * The plan is, first, a work zero saved for this file on this computer ("Save work zero for this file", jobUi
 * loadPlan); without one, the planned zero of the job's setup (Place job: the datum corner of the stock, at its
 * top or bottom, in machine coordinates). Run used to say "No plan is recorded for this file" even when Place job
 * had one, and named no distance.
 *
 * The setup's zero is in machine coordinates, so it can be compared with the board's work zero only while the
 * machine position is established (homed or set, and trusted): otherwise the text says the distance is not known.
 * Within ZERO_TOLERANCE_MM of an established setup zero the check is a match, as a saved plan's is; any other
 * case still needs C31.
 */
import type { StockCorner } from '@synthetos/library';
import { ZERO_TOLERANCE_MM, zeroCheck, zeroText, type ZeroCheck, type ZeroPoint } from './jobUi.ts';
import { effectiveZero, placementOffset, type Job } from './jobModel.ts';

/** The setup's planned zero and where it is on the stock. */
export interface SetupPlan {
  readonly zero: ZeroPoint;
  readonly corner: StockCorner;
  readonly height: 'top' | 'bottom';
  /**
   * How far the zero is moved from the corner (Place job's offset, owner 2026-11-09): inward at a corner, machine X
   * and Y at the centre; Z down from the top (or up from the bottom).
   */
  readonly offset?: { readonly x: number; readonly y: number; readonly z?: number };
  /** The job uses the machine's work zero (OD-28): the plan is the board's own zero. */
  readonly machine?: boolean;
}

export type PlanSource = 'saved' | 'setup' | 'none';

export type RunZeroCheck = ZeroCheck & {
  readonly source: PlanSource;
  /** The plan as C31 names it. */
  readonly planText: string;
};

const CORNER_WORDS: Readonly<Record<StockCorner, string>> = {
  'front-left': 'front-left corner',
  'front-right': 'front-right corner',
  'back-left': 'back-left corner',
  'back-right': 'back-right corner',
  center: 'centre',
};

/**
 * The job's zero from Place job, in machine mm: the datum point of the stock, at its top or bottom, moved by the
 * offset; or the board's work zero (`liveZero`) when the job uses it and it is known.
 */
export function setupPlan(job: Job, liveZero: ZeroPoint | null = null): SetupPlan {
  const offset = placementOffset(job);
  const machine = job.placement.zeroFrom === 'machine' && liveZero !== null;
  const moved = offset.x !== 0 || offset.y !== 0 || offset.z !== 0;
  return { zero: effectiveZero(job, liveZero), corner: job.placement.datum.corner, height: job.placement.datum.height, ...(moved && !machine ? { offset } : {}), ...(machine ? { machine: true } : {}) };
}

const signed = (n: number): string => `${n < 0 ? '−' : ''}${String(Math.abs(Number(n.toFixed(2))))}`;

/**
 * "the front-left corner of the top of the stock", with ", moved in 5 mm in X and 3 mm in Y" and ", 2 mm below
 * the top" when the zero is offset; "the machine’s work zero" when the job uses it.
 */
export function placeWords(plan: SetupPlan): string {
  if (plan.machine === true) return 'the machine’s work zero';
  const where = `the ${CORNER_WORDS[plan.corner]} of the ${plan.height} of the stock`;
  const o = plan.offset;
  if (o === undefined) return where;
  const xy = o.x === 0 && o.y === 0 ? '' : plan.corner === 'center' ? `, moved X ${signed(o.x)} mm and Y ${signed(o.y)} mm` : `, moved in ${signed(o.x)} mm in X and ${signed(o.y)} mm in Y`;
  const z = o.z === undefined || o.z === 0 ? '' : `, ${signed(o.z)} mm ${plan.height === 'top' ? 'below the top' : 'above the bottom'}`;
  return `${where}${xy}${z}`;
}

const mm = (n: number): string => Math.abs(n).toFixed(1);

/**
 * The board's work zero against the setup's, in words, one sentence per axis that differs, Z first:
 * "Work zero Z is 46.6 mm above the top of the stock you planned."
 */
export function differenceWords(board: ZeroPoint, plan: SetupPlan): string {
  const dx = board.x - plan.zero.x;
  const dy = board.y - plan.zero.y;
  const dz = board.z - plan.zero.z;
  const out: string[] = [];
  if (Math.abs(dz) > ZERO_TOLERANCE_MM) out.push(`Work zero Z is ${mm(dz)} mm ${dz > 0 ? 'above' : 'below'} the ${plan.height} of the stock you planned.`);
  const xy: string[] = [];
  if (Math.abs(dx) > ZERO_TOLERANCE_MM) xy.push(`${mm(dx)} mm to the ${dx > 0 ? 'right' : 'left'}`);
  if (Math.abs(dy) > ZERO_TOLERANCE_MM) xy.push(`${mm(dy)} mm ${dy > 0 ? 'towards the back' : 'towards the front'}`);
  if (xy.length > 0) out.push(`In X and Y it is ${xy.join(' and ')} of the ${CORNER_WORDS[plan.corner]} you planned.`);
  return out.join(' ');
}

/** The check the Run step shows: a saved plan first, then the setup's planned zero, else the board's alone. */
export function runZeroCheck(board: ZeroPoint | null, saved: ZeroPoint | null, setup: SetupPlan | null, established: boolean): RunZeroCheck {
  if (board === null || saved !== null || setup === null) {
    const check = zeroCheck(board, saved);
    return { ...check, source: saved !== null ? 'saved' : 'none', planText: saved === null ? 'none recorded' : zeroText(saved) };
  }
  const where = `${placeWords(setup)} (${zeroText(setup.zero)})`;
  if (!established) {
    return {
      state: 'differs',
      text: `Your plan puts work zero at ${where}. The machine position is not set (not homed), so how far the board’s work zero (${zeroText(board)}) is from it is not known.`,
      board,
      plan: setup.zero,
      source: 'setup',
      planText: `${zeroText(setup.zero)}, at ${placeWords(setup)}; not comparable until the machine position is set`,
    };
  }
  const d = Math.max(Math.abs(board.x - setup.zero.x), Math.abs(board.y - setup.zero.y), Math.abs(board.z - setup.zero.z));
  if (d <= ZERO_TOLERANCE_MM) {
    return { state: 'match', text: `The board’s work zero is where you planned it: ${where}.`, board, plan: setup.zero, source: 'setup', planText: zeroText(setup.zero) };
  }
  return {
    state: 'differs',
    text: `${differenceWords(board, setup)} You planned work zero at ${where}; the job will cut from the board’s work zero, ${zeroText(board)}.`,
    board,
    plan: setup.zero,
    source: 'setup',
    planText: `${zeroText(setup.zero)}, at ${placeWords(setup)}`,
  };
}
