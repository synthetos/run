/**
 * The live carve's follower as a hook (carveFollow.ts): while a job of the open file owns the machine, the carve
 * follows the drawn tool along the line the board executes. When the job ends it holds where it got to; a scrub
 * after it hands the carve back to the scrubber. Display only.
 */
import { useEffect, useMemo } from 'preact/hooks';
import type { SegmentList, Vec3 } from '@synthetos/gcode-view';
import { createLiveFollower, type TipSource } from './carveFollow.ts';
import type { LiveCarve } from './liveCarve.ts';

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useLiveFollower(live: LiveCarve | null, scrub: number, segments: SegmentList | null, tool: Vec3 | null): TipSource {
  const follower = useMemo(() => createLiveFollower({
    now: () => performance.now(),
    frame: (fn) => requestAnimationFrame(fn),
    cancel: (h) => { cancelAnimationFrame(h as number); },
    reducedMotion,
  }), []);
  useEffect(() => () => { follower.dispose(); }, [follower]);
  const held = live !== null && !live.active && scrub === 0;
  useEffect(() => {
    // Held at the end of a job: frozen where it got to (the tool may be jogged now; that is not cutting).
    if (held) return;
    if (live === null || !live.active || segments === null) {
      follower.report(null, null);
      return;
    }
    follower.report(segments, { target: live.target, pos: tool });
  }, [follower, held, live?.key, live?.target, live?.active, segments, tool?.[0], tool?.[1], tool?.[2]]);
  return follower;
}
