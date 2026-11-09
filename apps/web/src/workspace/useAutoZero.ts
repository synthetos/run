/**
 * Pre-selects the file's own zero for a job (owner, 2026-11-09, OD-28): when the job's file is new to it and the
 * user has not picked a point for that file, Place job takes the point the file's bounds show (fileZero.ts), as
 * long as it is clear or likely. It never changes a pick the user made, never while a job owns the machine, and
 * leaves an unclear file alone. The Run view mounts it.
 */
import { useEffect } from 'preact/hooks';
import { currentFile, executionLock } from './fileBridge.ts';
import { fileZeroOf } from './fileZeroOf.ts';
import { datumPickedByUser, updateActiveJob, withDatum, type Job } from './jobModel.ts';

/** True when run may set the job's datum to the file's zero now. */
export function mayPreselect(job: Job): boolean {
  if (job.file === null || datumPickedByUser(job)) return false;
  const from = job.placement.datumFrom;
  return !(from?.kind === 'file' && from.hash === job.file.hash);
}

export function useAutoZero(job: Job | null): void {
  const file = currentFile.value;
  useEffect(() => {
    if (job === null || file === null || executionLock.value !== null) return;
    if (job.file === null || job.file.name !== file.name || !mayPreselect(job)) return;
    const guess = fileZeroOf(file);
    if (guess === null || guess.corner === null || guess.confidence === 'unclear') return;
    const corner = guess.corner;
    updateActiveJob((j) => (mayPreselect(j) ? withDatum(j, { corner, height: guess.height ?? j.placement.datum.height }, undefined, 'file') : j));
  }, [job?.id, job?.file?.hash, file]);
}
