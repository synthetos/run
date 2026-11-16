import { openJob, type OpenSource } from '../fileBridge.ts';
/** Opens a file through the one job opener and reports a refusal in the job card. */
export function openFrom(file: File, source: OpenSource, setNote: (n: string | null) => void): void {
  setNote(null);
  void openJob(file, source).then((r) => {
    if (!r.ok) setNote(r.reason);
  });
}
