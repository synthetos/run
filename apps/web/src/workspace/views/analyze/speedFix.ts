/**
 * The firmware model's finding (docs/design/ANALYZE.md slice 2): how much of the planned time the machine spends
 * speeding up and slowing down, and the firmware's own tag for most of it. The tags overlap; the share is "time
 * carrying this tag", never seconds a change would save. Pure.
 */
import type { Estimate, ProgramReport } from '@synthetos/advisor';
import { camTip } from './camTip.ts';
import type { Fix } from './fix.ts';
import { whole } from './format.ts';

/** Shown when at least this share of the motion time is speeding up or slowing down. */
export const SPEED_SHARE = 0.4;

const WHY: Readonly<Record<string, { readonly because: string; readonly todo: (cam: string | null) => readonly string[] }>> = {
  short: { because: 'moves too short to reach the feed', todo: (cam) => [camTip(cam), 'Fewer, longer moves let it reach the feed.'] },
  junction: { because: 'corners', todo: () => ['In your CAM, a small corner radius or smoothing lets it keep speed through corners.', 'Your machine’s junction settings (jd and ja, in Board) set how fast it takes a corner.'] },
  exact_stop: { because: 'exact stops (G61.1)', todo: () => ['Use G64 (continuous) instead of G61.1 where the part allows.'] },
  axis_cap: { because: 'moves an axis cannot run at the programmed feed', todo: () => ['Lower the feed in your CAM to what the slow axis can do, or check its max feed in Board.'] },
};

export function speedFix(estimate: Estimate, report: ProgramReport, cam: string | null): Fix | null {
  if (!estimate.ok || estimate.shares.motionS <= 0) return null;
  const s = estimate.shares;
  const share = s.changingS / s.motionS;
  if (share < SPEED_SHARE) return null;
  const by = { short: s.changingBy.short + s.changingBy.min_segment, junction: s.changingBy.junction, exact_stop: s.changingBy.exact_stop, axis_cap: s.changingBy.axis_cap };
  const [top, topS] = Object.entries(by).reduce((a, b) => (b[1] > a[1] ? b : a));
  const why = topS > 0 ? WHY[top] : undefined;
  const region = report.density.regions.reduce<(typeof report.density.regions)[number] | null>((a, b) => (a === null || b.lines > a.lines ? b : a), null);
  return {
    id: 'speed',
    kind: 'speed',
    title: `${whole(share * 100)}% of the time is speeding up or slowing down`,
    meaning: [why === undefined ? `${whole(share * 100)}% of the time the machine is accelerating or braking.` : `${whole(share * 100)}% of the time the machine is accelerating or braking: ${why.because}.`, 'From your machine’s settings and the firmware’s planner.'],
    todo: why === undefined ? ['Longer moves and gentler corners let it hold the feed.'] : why.todo(cam),
    fromSent: region?.fromSent ?? 0,
    toSent: region?.toSent ?? 0,
    line: region?.fromLine ?? 0,
    lineSent: region?.fromSent ?? 0,
    linked: region !== null && top === 'short',
    regions: [],
    weight: s.changingS,
  };
}
