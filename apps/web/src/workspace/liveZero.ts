/**
 * The board's work zero in machine mm, while connected and the machine position is established (homed or set,
 * and trusted), else null (OD-28: "Use the machine's work zero"). The Run view keeps it from the status reports;
 * Place job, the scene and Run's zero check read it. It is a session fact: never saved in a job, and never written
 * to the board. Report rounding (machine minus work position) does not move it (useLivePlacement's steadyZero).
 */
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { positionEstablished, type LiveReport } from '../preview/livePlacement.ts';
import { liveFrame } from '../preview/sceneModel.ts';
import { steadyZero } from '../preview/useLivePlacement.ts';

export const liveWorkZero = signal<{ readonly x: number; readonly y: number; readonly z: number } | null>(null);

/** The established work zero of a status report, or null. */
export function establishedZero(live: LiveReport | null): { readonly x: number; readonly y: number; readonly z: number } | null {
  if (live === null || !positionEstablished(live)) return null;
  const f = liveFrame(live);
  return f === null ? null : { x: f.zero[0], y: f.zero[1], z: f.zero[2] };
}

/** Keeps `liveWorkZero` from the board's reports (the Run view mounts it); returns the zero. */
export function useLiveWorkZero(live: LiveReport | null): { readonly x: number; readonly y: number; readonly z: number } | null {
  const next = establishedZero(live);
  const held = useRef<readonly [number, number, number] | null>(null);
  held.current = steadyZero(held.current, next === null ? null : [next.x, next.y, next.z]);
  const h = held.current;
  const zero = h === null ? null : { x: h[0], y: h[1], z: h[2] };
  useEffect(() => { liveWorkZero.value = zero; }, [h?.[0], h?.[1], h?.[2], h === null]);
  return zero;
}
