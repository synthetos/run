/**
 * The board's units and distance mode, read before run changes them (SAFETY §4.2, §4.5b, §4.5c, H50, H74).
 *
 * A jog, go to zero, the probe and a job's tool-change return all write their own modes (`G21`, `G91`, `G90 G21`)
 * and put back afterwards the modes the board had (a jog outside a tool change: its units; it always ends in `G90`,
 * SAFETY §4.5b). "The modes the board had" is read here with `unit` and `dist`
 * GETs queued before the first line that changes them, so the board answers them in order after every earlier
 * line: after the closing `G90` of the motion before, after the job's own lines. It is never taken from the live
 * view. The live view is fed by pushed status reports, and a filtered report prints `si` ms after a change and
 * samples then: the last report a jog leaves behind can still show its own `G91` after its closing `G90` was
 * answered. A second jog that took that `dist` as the board's mode ended with `G91` and left the board relative
 * (fake-serial suite, 2026-11-08).
 *
 * A Stop job with no motion of run's in progress (a job's, or from idle) reads the units the same way, right after
 * its `!` and ahead of the polls that confirm the hold, for the `G20` it puts back with its `G90` (§4.4 step 5).
 *
 * Each read is stored on the owner that asked for it. A read that is refused, damaged or not 0 or 1 leaves the
 * value unknown: then nothing restores it (the closing line is `G90` alone, units unchanged) and a tool-change
 * return that needs it is refused (H74).
 *
 * Pure functions over the reducer's transition; nothing here touches a port or a clock.
 */
import { isReadAllowed } from '@synthetos/schema';
import { noteModeRead } from './boardModes.ts';
import type { ModesOwner, PendingRead, SessionState } from './types.ts';

/** The reads, in order: units, then distance mode. */
export const MODE_TOKENS: readonly string[] = Object.freeze(['unit', 'dist']);

interface ModesTx {
  s: SessionState;
  set(patch: Partial<SessionState>): void;
}

/** Queues the `unit` and `dist` reads for `owner`, through the read allowlist. Queue them before the first line that changes a mode. */
export function queueModeReads(t: ModesTx, owner: ModesOwner): void {
  const dialect = t.s.dialect;
  if (dialect === null) return;
  const reads: PendingRead[] = MODE_TOKENS.filter((token) => isReadAllowed(dialect.id, token)).map((token) => ({ token, purpose: 'modes', modesFor: owner }));
  t.set({ queue: [...t.s.queue, ...reads] });
}

/** A mode read was answered: `value` is the answer when its status was 0, else undefined (refused or damaged). */
export function onModesAnswer(t: ModesTx, entry: PendingRead, value: unknown): void {
  const known = value === 0 || value === 1 ? value : undefined;
  noteModeRead(t, entry.token, known === undefined ? -1 : 0, known);
  const key = entry.token === 'unit' ? 'units' : 'dist';
  const s = t.s;
  switch (entry.modesFor) {
    case 'motion':
      if (s.motion !== null) t.set({ motion: { ...s.motion, [key]: known } });
      return;
    case 'probe':
      if (s.probeZ.run !== null) t.set({ probeZ: { ...s.probeZ, run: { ...s.probeZ.run, [key]: known } } });
      return;
    case 'toolChange': {
      const tc = s.job?.toolChange ?? null;
      if (s.job !== null && tc !== null) t.set({ job: { ...s.job, toolChange: { ...tc, [key]: known } } });
      return;
    }
    /* c8 ignore next 2 -- every mode read names its owner */
    default:
      return;
  }
}
