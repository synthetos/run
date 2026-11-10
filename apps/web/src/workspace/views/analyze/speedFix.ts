/**
 * The firmware model's finding (docs/design/ANALYZE.md slice 2): how much of the planned time the machine spends
 * speeding up and slowing down, and the firmware's own tag for most of it. The title and one line say it; the tags,
 * as shares of the time, go behind Details. The tags overlap: a share is "time carrying this tag", never seconds a
 * change would save. Pure.
 */
import type { Estimate, ProgramReport } from '@synthetos/advisor';
import { camTip, CAM_TOLERANCE } from './camTip.ts';
import type { Fix } from './fix.ts';
import { whole } from './format.ts';

/** Shown when at least this share of the motion time is speeding up or slowing down. */
export const SPEED_SHARE = 0.4;

export type SpeedCause = 'short' | 'junction' | 'exact_stop' | 'axis_cap';

const WHY: Readonly<Record<SpeedCause, { readonly name: string; readonly because: string; readonly todo: (cam: string | null) => string; readonly more: readonly string[] }>> = {
  short: { name: 'Short moves', because: 'Moves are too short to reach feed.', todo: camTip, more: [CAM_TOLERANCE] },
  junction: { name: 'Corners', because: 'Corners slow it down.', todo: () => 'Add a small corner radius or smoothing in your CAM.', more: ['Corner speed also depends on jd and ja in Board.'] },
  exact_stop: { name: 'Exact stop (G61.1)', because: 'Exact stop (G61.1) stops at every move.', todo: () => 'Use G64 where the part allows.', more: [] },
  axis_cap: { name: 'Axis speed limit', because: 'One axis can’t keep up with the feed.', todo: () => 'Lower the feed in your CAM.', more: ['Or check that axis’s max feed in Board.'] },
};

const pct = (part: number, of: number): string => `${whole((part / of) * 100)}%`;

/** Each tag's time, the short-move tags together. */
function causes(estimate: Estimate & { ok: true }): [SpeedCause, number][] {
  const by = estimate.shares.changingBy;
  return [['short', by.short + by.min_segment], ['junction', by.junction], ['exact_stop', by.exact_stop], ['axis_cap', by.axis_cap]];
}

/** The tag on most of the speeding up and slowing down, or null with none. */
export function speedCause(estimate: Estimate | null): SpeedCause | null {
  if (estimate?.ok !== true) return null;
  const [top, s] = causes(estimate).reduce((a, b) => (b[1] > a[1] ? b : a));
  return s > 0 ? top : null;
}

export function speedFix(estimate: Estimate, report: ProgramReport, cam: string | null): Fix | null {
  if (!estimate.ok || estimate.shares.motionS <= 0) return null;
  const s = estimate.shares;
  const share = s.changingS / s.motionS;
  if (share < SPEED_SHARE) return null;
  const top = speedCause(estimate);
  const why = top === null ? undefined : WHY[top];
  const listed = causes(estimate).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const region = report.density.regions.reduce<(typeof report.density.regions)[number] | null>((a, b) => (a === null || b.lines > a.lines ? b : a), null);
  return {
    id: 'speed',
    kind: 'speed',
    title: `${share >= 0.5 ? 'Mostly' : 'Often'} speeding up and slowing down (${pct(s.changingS, s.motionS)})`,
    meaning: [why?.because ?? 'Moves rarely reach feed.'],
    todo: [why?.todo(cam) ?? 'Use longer moves and gentler corners in your CAM.'],
    details: [...listed.map(([k, v]) => `${WHY[k].name}: ${pct(v, s.motionS)} of the time.`), ...(listed.length > 1 ? ['A move can have more than one cause.'] : []), ...(why?.more ?? [])],
    fromSent: region?.fromSent ?? 0,
    toSent: region?.toSent ?? 0,
    line: region?.fromLine ?? 0,
    lineSent: region?.fromSent ?? 0,
    linked: region !== null && top === 'short',
    regions: [],
    weight: s.changingS,
  };
}
