/**
 * How old the board's last position report is: "Live · 0.25 s", "Lagging · …", "Stale · …" (the Position panel's
 * chip and the Advanced planner block share it). The age counts on between snapshots from the page's redraw tick.
 */
import type { LiveView } from './model.ts';

export function ageText(view: LiveView): { readonly text: string; readonly lag: string } {
  const m = view.message;
  if (m === null || m.snapshot.base === 'NOT_CONNECTED') return { text: 'Not connected', lag: 'none' };
  const base = m.dro.machineSource.ageMs;
  if (base === null) return { text: 'Waiting for position', lag: 'none' };
  const age = base + Math.max(0, view.now - view.receivedAt);
  const lag = m.snapshot.overlays.includes('STALE') || age >= m.lag.redMs ? 'red' : age >= m.lag.amberMs ? 'amber' : 'fresh';
  return { text: `${lag === 'fresh' ? 'Live' : lag === 'amber' ? 'Lagging' : 'Stale'} · ${(age / 1000).toFixed(2)} s`, lag };
}
