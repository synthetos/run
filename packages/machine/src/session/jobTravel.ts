/**
 * The travel check in the job flow (OD-24; SAFETY H3, H74): folded into the check's summary at load and at Start, the
 * confirmation it needs (C40) checked at Start, and the re-check on Resume after a Z re-zero at a tool change.
 *
 * Pure functions; the job layer (job.ts) calls them.
 */
import type { SanitizeResult } from '@synthetos/safety';
import { checkTravel, type TravelCheck } from './travelCheck.ts';
import type { JobReportSummary, JobState, SessionState } from './types.ts';

/** The summary with the travel check in it: a block finding when a move leaves the travel with the position known. */
export function withTravel(report: JobReportSummary, travel: TravelCheck): JobReportSummary {
  if (travel.block === null) return { ...report, travel };
  // A block is always a move past travel, which names its line.
  const block = { line: travel.block.line as number, message: travel.block.text.replace(/^line \d+: /, '') };
  return { ...report, travel, blocked: true, counts: { ...report.counts, block: report.counts.block + 1 }, blocks: [block, ...report.blocks].slice(0, 8) };
}

/** The travel check of a sanitised file against the board as read now. */
export function travelOf(s: SessionState, result: SanitizeResult, fromLine = 1): TravelCheck {
  return checkTravel(s, result.extents, fromLine);
}

/** Why Start may not go on for the travel check: C40 not confirmed when the check asks for it, else null. */
export function travelStartRefusal(report: JobReportSummary | null, confirmed: boolean): string | null {
  const c = report?.travel?.confirm ?? null;
  return c !== null && !confirmed ? `The job could not be checked against the machine's travel: ${c.text}. Confirm C40 to start.` : null;
}

/**
 * Resume at a tool change after the work offsets were read again since the stop (the Z re-zero, H74): the lines from
 * the tool change on are checked again against the new offsets. Known position and a move past travel: refused (Stop
 * job is the way out). A limit or a position not read: refused. A move past travel with the position not known:
 * allowed, the finding said in the job's events (C40 was confirmed at Start).
 * Returns the refusal reason, the note to log, or neither.
 */
export function resumeTravel(s: SessionState, j: JobState, offsetsChanged: boolean, recheck: () => SanitizeResult): { readonly refusal: string | null; readonly note: string | null } {
  if (!offsetsChanged) return { refusal: null, note: null };
  // Called only at a tool change, whose line was sent up to.
  const tc = j.toolChange as NonNullable<JobState['toolChange']>;
  if (tc.units !== s.values['unit']?.value) {
    return { refusal: 'The work offsets changed at the tool change and the board is in other units than when the job was checked, so the rest of the job cannot be checked again.', note: null };
  }
  const fromLine = (j.lines[tc.index] as JobState['lines'][number]).sourceLine;
  const travel = travelOf(s, recheck(), fromLine);
  if (travel.block !== null) return { refusal: `With the new Z zero, ${travel.block.text}. Re-zero Z again, or stop the job.`, note: null };
  // Could not run (a limit or a position not read): refused, never guessed.
  if (travel.confirm !== null && travel.confirm.kind === 'unchecked') return { refusal: `With the new Z zero the rest of the job cannot be checked against the travel: ${travel.confirm.text}.`, note: null };
  return { refusal: null, note: travel.confirm === null ? null : `With the new Z zero, ${travel.confirm.text}; the travel was confirmed at Start (C40).` };
}
