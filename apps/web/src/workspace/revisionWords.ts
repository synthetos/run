/**
 * Revisions and the bed's size in words (first-time walk 2026-11-08, C2 and C3), in one place for the job card,
 * the Job's Machine step, the machine card, the tool inspector and Projects.
 *
 * - Simple hides revision numbers: a job says "Saved" (kept in this browser) or "Unsaved changes" (storage was
 *   refused), a pinned bed says whether it matches the machine's, and a save says "Saved". Advanced keeps the
 *   numbers, which are how jobs keep the bed they were planned on.
 * - A bed nobody has entered yet comes from the machine's stock profile (owner, 2026-11-09): its size from the profile's
 *   travel is fine, so the size reads "750 × 750 mm" with no suffix, and the tag says "From the X-Carve profile". Only
 *   the bed top's height below home is unknown; a note says so where it matters (preview/previewNotes.ts).
 */
import type { MachineBed } from './library.ts';

/** "750 × 750 mm". */
export function bedSizeText(bed: Pick<MachineBed, 'width' | 'depth'>): string {
  return `${Math.round(bed.width)} × ${Math.round(bed.depth)} mm`;
}

/** Where the bed's numbers come from, in words: "from the X-Carve profile", "measured" or "from <file>". */
export function bedFromText(bed: Pick<MachineBed, 'source'>, profile: string | null): string {
  if (bed.source.kind === 'placeholder') return profile === null ? 'default size' : `from the ${profile} profile`;
  return bed.source.kind === 'measured' ? 'measured' : `from ${bed.source.file}`;
}

/** The bed's tag: "From the X-Carve profile", "Measured" or "From a drawing". */
export function bedTag(bed: Pick<MachineBed, 'source'>, profile: string | null = null): string {
  if (bed.source.kind === 'placeholder') return profile === null ? 'Default size' : `From the ${profile} profile`;
  return bed.source.kind === 'measured' ? 'Measured' : 'From a drawing';
}

/** Machines → Bed: what the bed top's height is for, in plain words. */
export const BED_TOP_PURPOSE = 'Where the bed top sits below home. Run uses it to warn before the tool cuts into the bed.';

/** The job card's last part: the job's revision in Advanced, else whether this browser kept it. */
export function jobStateText(revision: number, saved: boolean, advanced: boolean): string {
  if (advanced) return `revision ${String(revision)}`;
  return saved ? 'Saved' : 'Unsaved changes';
}

/** A machine as the job names it: "My X-Carve (rev 1)" in Advanced, "My X-Carve" in Simple. */
export function machineText(name: string, revision: number, advanced: boolean): string {
  return advanced ? `${name} (rev ${String(revision)})` : name;
}

/** True when the job's bed is the machine's saved bed, field for field (Simple's "same as the machine's"). */
export function sameBed(a: Pick<MachineBed, 'width' | 'depth' | 'thickness' | 'toMachine'>, b: Pick<MachineBed, 'width' | 'depth' | 'thickness' | 'toMachine'>): boolean {
  return a.width === b.width && a.depth === b.depth && a.thickness === b.thickness && a.toMachine.x === b.toMachine.x && a.toMachine.y === b.toMachine.y && a.toMachine.z === b.toMachine.z;
}
