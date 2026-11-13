/**
 * The travel check in the job flow (OD-24; SAFETY H3, H74): folded into the check's summary at load and at Start, the
 * confirmation it needs (C40) checked at Start, and the re-check on Resume after a Z re-zero at a tool change.
 *
 * Pure functions; the job layer (job.ts) calls them.
 */
import { findingReason, type SanitizeResult } from '@synthetos/safety';
import { WORD } from './fileModes.ts';
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
/**
 * Why Start may not go on for the travel check, or null: C40 is asked and the page did not confirm exactly that
 * finding (review S3: the tick names the finding it was given for; a finding that changed needs a new tick).
 */
export function travelStartRefusal(report: JobReportSummary | null, confirmed: string | null | undefined): string | null {
  const c = report?.travel?.confirm ?? null;
  if (c === null || confirmed === c.text) return null;
  return `The job could not be checked against the machine's travel: ${c.text}. Confirm C40 to start.`;
}

/** The work offsets a re-zero changes; read again after a set zero (motion.ts read-back). */
const OFFSET_TOKENS: readonly string[] = Object.freeze(['g54', 'g55', 'g56', 'g57', 'g58', 'g59', 'g92', 'ofs']);

type Values = SessionState['values'];

function zOf(values: Values, token: string): number | null {
  const v = values[token];
  if (v === undefined || v.status !== 0 || typeof v.value !== 'object' || v.value === null || Array.isArray(v.value)) return null;
  const z = (v.value as Record<string, unknown>)['z'];
  return typeof z === 'number' && Number.isFinite(z) ? z : null;
}

function withZ(values: Values, token: string, z: number): Values {
  const v = values[token] as NonNullable<Values[string]>;
  return { ...values, [token]: { ...v, value: { ...(v.value as Record<string, unknown>), z } as never } };
}

/**
 * The values to check the rest of the job with after a Z re-zero at a tool change (independent review 2026-11-08,
 * M1): every value as read at Start, but the Z offset of the system re-zeroed at the change (the one active then)
 * taken from its read-back, and the total offset moved by the same amount when that system was the one active at
 * Start, so the tool offset and G92 stay as at Start. Null with the reason when that cannot be done exactly.
 */
/**
 * The first file line before the tool change that sets `system`'s offset (G10 L2 or L20 with P of that system, or
 * P0 while it is the active one), or null (re-review 2026-11-09, M1). The replay applies the file from the Start
 * values, so such a line would write over the re-zeroed offset and the re-check would model the wrong Z. The
 * sanitiser refuses P0 before a job runs; it is still read here as the active system, tracked through G54..G59.
 */
function fileWritesOffset(j: JobState, system: number, startCoor: unknown): number | null {
  const tc = j.toolChange as NonNullable<JobState['toolChange']>;
  let active = startCoor;
  for (const line of j.lines.slice(0, tc.index)) {
    let g10 = false;
    let l: number | null = null;
    let p: number | null = null;
    for (const m of line.body.matchAll(WORD)) {
      const letter = (m[1] as string).toUpperCase();
      const v = Number(m[2]);
      if (letter === 'G' && v >= 54 && v <= 59 && Number.isInteger(v)) active = v - 53;
      if (letter === 'G' && v === 10) g10 = true;
      if (letter === 'L') l = v;
      if (letter === 'P') p = v;
    }
    if (g10 && (l === 2 || l === 20) && (p === system || (p === 0 && active === system))) return line.sourceLine;
  }
  return null;
}

function replayValues(s: SessionState, j: JobState, system: number | null): { readonly values: Values } | { readonly refusal: string } {
  const start = j.startValues;
  const tc = j.toolChange as NonNullable<JobState['toolChange']>;
  const cannot = (why: string): { readonly refusal: string } => ({ refusal: `The work offsets changed at the tool change and the rest of the job cannot be checked again: ${why}.` });
  if (start === undefined || system === null) return cannot('the active coordinate system is not known');
  const token = `g${53 + system}`;
  const now = s.values[token];
  if (now === undefined || now.at <= (tc.stoppedAt as number)) return cannot(`the ${token.toUpperCase()} offset was not read again after the change`);
  const newZ = zOf(s.values, token);
  const oldZ = zOf(start, token);
  if (newZ === null || oldZ === null) return cannot(`the ${token.toUpperCase()} Z offset was not read`);
  if (tc.units !== start['unit']?.value) return cannot('the board is in other units than when the job was checked');
  const written = fileWritesOffset(j, system, start['coor']?.value);
  if (written !== null) return cannot(`line ${written} of the file sets the ${token.toUpperCase()} offset before the tool change`);
  // Which axes are homed is a fact of now, not of Start (homedAxes.ts).
  let values: Values = { ...withZ(start, token, newZ), ...(s.values['hom'] === undefined ? {} : { hom: s.values['hom'] }) };
  if (start['coor']?.value === system) {
    const ofsZ = zOf(start, 'ofs');
    if (ofsZ === null) return cannot('the total offset was not read at Start');
    values = withZ(values, 'ofs', ofsZ + (newZ - oldZ));
  }
  return { values };
}

/**
 * Resume at a tool change after the work offsets were read again since the stop (the Z re-zero, H74): the lines from
 * the tool change on are checked again (replayValues). Refused when the check cannot run exactly, when it blocks a
 * line (M2), when a limit or position is not read, when a move leaves the travel with the position known, and when
 * it leaves the travel with the position not known but C40 was not confirmed at Start (S1). Otherwise allowed, a
 * move past travel with C40 confirmed said in the job's events. Returns the refusal reason, the note to log, or neither.
 */
export function resumeTravel(s: SessionState, j: JobState, system: number | null, recheck: (state: SessionState) => SanitizeResult): { readonly refusal: string | null; readonly note: string | null } {
  const tc = j.toolChange as NonNullable<JobState['toolChange']>;
  if (!OFFSET_TOKENS.some((k) => (s.values[k]?.at ?? -Infinity) > (tc.stoppedAt as number))) return { refusal: null, note: null };
  const replay = replayValues(s, j, system);
  if ('refusal' in replay) return { refusal: replay.refusal, note: null };
  const state = { ...s, values: replay.values };
  const result = recheck(state);
  const blocked = result.report.entries.find((e) => e.severity === 'block');
  if (blocked !== undefined) return { refusal: `With the new Z zero the rest of the job cannot be checked again: line ${blocked.line}: ${findingReason(blocked.message)}.`, note: null };
  const fromLine = (j.lines[tc.index] as JobState['lines'][number]).sourceLine;
  const travel = travelOf(state, result, fromLine);
  if (travel.block !== null) return { refusal: `With the new Z zero, ${travel.block.text}. Re-zero Z again, or stop the job.`, note: null };
  // Could not run (a limit or a position not read): refused, never guessed.
  if (travel.confirm !== null && travel.confirm.kind === 'unchecked') return { refusal: `With the new Z zero the rest of the job cannot be checked against the travel: ${travel.confirm.text}.`, note: null };
  if (travel.confirm !== null && j.travelConfirmed === undefined) return { refusal: `With the new Z zero, ${travel.confirm.text}; C40 was not confirmed at Start. Re-zero Z again, or stop the job.`, note: null };
  return { refusal: null, note: travel.confirm === null ? null : `With the new Z zero, ${travel.confirm.text}; the travel was confirmed at Start (C40).` };
}
