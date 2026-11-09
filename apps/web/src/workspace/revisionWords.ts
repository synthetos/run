/**
 * Revisions and the bed's size in words (first-time walk 2026-11-08, C2 and C3), in one place for the job card,
 * the Job's Machine step, the machine card, the tool inspector and Projects.
 *
 * - Simple hides revision numbers: a job says "Saved" (kept in this browser) or "Unsaved changes" (storage was
 *   refused), a pinned bed says whether it matches the machine's, and a save says "Saved". Advanced keeps the
 *   numbers, which are how jobs keep the bed they were planned on.
 * - A bed whose size has not been measured says so next to its size everywhere: "750 × 750 mm (not measured yet)",
 *   never "Bed size not set" while a size shows.
 */
import type { MachineBed } from './library.ts';

/** The words after a placeholder bed's size. */
export const NOT_MEASURED = 'not measured yet';

/** "750 × 750 mm", with "(not measured yet)" for a placeholder bed. */
export function bedSizeText(bed: Pick<MachineBed, 'width' | 'depth' | 'source'>): string {
  const size = `${Math.round(bed.width)} × ${Math.round(bed.depth)} mm`;
  return bed.source.kind === 'placeholder' ? `${size} (${NOT_MEASURED})` : size;
}

/** The bed's tag: "Not measured yet", "Measured" or "From a drawing". */
export function bedTag(bed: Pick<MachineBed, 'source'>): string {
  return bed.source.kind === 'placeholder' ? 'Not measured yet' : bed.source.kind === 'measured' ? 'Measured' : 'From a drawing';
}

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
