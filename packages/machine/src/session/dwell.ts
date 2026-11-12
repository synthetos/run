/**
 * Pre-N99 firmware can report idle/end and a full planner while a G4 timer still runs.
 * ACK is acceptance, not a start marker: earlier motion may delay the dwell. Conservatively
 * wait the sum of accepted dwell durations after a settled, resting poll. Any busy poll,
 * new data ACK or Resume restarts that interval. This applies to every build: fb is not
 * sufficient to identify N99. No unknown/external dwell duration is inferred here.
 */
import { WORD } from './fileModes.ts';
import { mapStat } from '@synthetos/protocol';
import type { PolledValues, SessionState } from './types.ts';

export const DWELL_MARGIN_MS = 100;
export type { DwellWait } from './types.ts';
interface DwellTx { readonly s: SessionState; set(patch: Partial<SessionState>): void }

/** Only sanitized, actually acknowledged data lines enter here (comments are already stripped). */
export function acknowledgeDwell(t: DwellTx, line: string | undefined): void {
  if (line === undefined) return;
  const words = [...line.matchAll(WORD)];
  const dwell = words.some(w => w[1]?.toUpperCase() === 'G' && Number(w[2]) === 4);
  const seconds = dwell ? Number(words.find(w => w[1]?.toUpperCase() === 'P')?.[2] ?? 0) : 0;
  const durationMs = (t.s.dwellWait?.durationMs ?? 0) + Math.ceil(Math.max(0, seconds) * 1000);
  if (dwell || t.s.dwellWait != null) t.set({ dwellWait: { durationMs, until: null } });
}

/** A Resume may release a dwell that never started; time spent held cannot discharge it. */
export function restartDwellWait(t: DwellTx): void {
  if (t.s.dwellWait != null) t.set({ dwellWait: { ...t.s.dwellWait, until: null } });
}

/** Called before any consumer judges the completed poll. Failed/missing polls cannot prove rest. */
export function observeDwellPoll(t: DwellTx, p: PolledValues | null, at: number): void {
  const wait = t.s.dwellWait;
  if (wait == null) return;
  const s = t.s;
  const cls = s.dialect === null || p === null ? null : mapStat(s.dialect, p.stat);
  // The job never sends beyond its program-stop barrier. A real program pause can confirm
  // that barrier after the conservative interval, but an ordinary hold cannot confirm idle.
  const barrier = s.job?.stop?.kind === 'barrier' && s.job.phase === 'draining' && cls === 'programStop';
  const data = (e: { purpose: string }): boolean => ['job', 'motion', 'probeZ'].includes(e.purpose);
  const settled = !s.expected.some(e => !e.late && data(e)) && !s.queue.some(data) && (s.writing === null || !data(s.writing));
  const quiet = p !== null && (cls === 'idle' || cls === 'end' || cls === 'programStop') &&
    p.vel === 0 && (p.hold === 0 || barrier) && p.qr === s.dialect?.limits.plannerBlocks && settled;
  if (!quiet) { restartDwellWait(t); return; }
  if (wait.until === null) t.set({ dwellWait: { ...wait, until: at + wait.durationMs + DWELL_MARGIN_MS } });
  else if (at >= wait.until) t.set({ dwellWait: null });
}
